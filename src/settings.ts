import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type { ReschedulableField } from './actions/reschedule.ts';
import { DEFAULT_FORMATS } from './domain/periodic.ts';
import { cloneDefaultStatuses, sanitizeStatuses } from './domain/statuses.ts';
import type { TaskWriteSyntax } from './domain/serialize-line.ts';
import type { TaskStatus } from './domain/task.ts';
import { t } from './i18n/index.ts';
import { openCalendarPlusPage } from './integrations/calendar-plus.ts';
import type SimpleTasksPlugin from './main.ts';

export interface SimpleTasksSettings {
	/** Our own status catalog. Order is the order shown in the UI. */
	statuses: TaskStatus[];
	/** Whether a task also carries the tags of its outline ancestors. */
	inheritTags: boolean;
	/** Dialect used when writing. Reading always accepts both. */
	writeSyntax: TaskWriteSyntax;
	/** Vault-relative folders kept out of the index, one per entry. */
	excludedFolders: string[];
	/** Keep tasks that live in notes the vault declares as templates out. */
	excludeTemplates: boolean;
	/** Folder of the semester notes. Empty means "infer from the other levels". */
	semesterFolder: string;
	/** moment format of the semester notes, with `S` as the semester number. */
	semesterFormat: string;
	/**
	 * Heading a moved task is filed under. Created when missing; empty means
	 * "append at the end of the note".
	 */
	moveHeading: string;
	/** Date field the popover writes when rescheduling. */
	rescheduleField: ReschedulableField;
	/** Whether hovering a task line in the editor opens the actions popover. */
	editorHoverPopover: boolean;
	/**
	 * How the Calendar Plus integration draws a period's tasks.
	 *
	 * `intensity` contributes the number of completions and lets the calendar
	 * shade the cell, which is the default and costs the cell no room.
	 * `dots` contributes the filled/hollow markers instead — which is the other
	 * half of that plugin's contract, and what somebody used to the original
	 * Calendar may prefer.
	 */
	calendarDisplay: CalendarDisplay;
	/**
	 * Which sections the heatmap view draws besides the grid itself.
	 *
	 * The grid is deliberately not among them: it is what the view *is*, and a
	 * toggle that can empty a view is a way to make it look broken. Everything
	 * else defaults to off except the level, so the view opens showing the one
	 * thing it is named after plus the one number that reads at a glance.
	 */
	heatmapShowLevel: boolean;
	heatmapShowTiles: boolean;
	heatmapShowSummary: boolean;
	heatmapShowTopTags: boolean;
}

export const DEFAULT_SETTINGS: SimpleTasksSettings = {
	statuses: cloneDefaultStatuses(),
	inheritTags: true,
	writeSyntax: 'emoji',
	excludedFolders: [],
	excludeTemplates: true,
	semesterFolder: '',
	semesterFormat: DEFAULT_FORMATS.semester,
	moveHeading: '',
	rescheduleField: 'due',
	editorHoverPopover: true,
	calendarDisplay: 'intensity',
	heatmapShowLevel: true,
	heatmapShowTiles: false,
	heatmapShowSummary: false,
	heatmapShowTopTags: false,
};

/** What Simple Tasks contributes to a Calendar Plus cell. */
export type CalendarDisplay = 'intensity' | 'dots';

const RESCHEDULE_FIELDS: readonly ReschedulableField[] = ['due', 'scheduled', 'start'];

/** Never trust what comes back from `data.json`: it may be old or hand-edited. */
export function normalizeSettings(raw: unknown): SimpleTasksSettings {
	const merged = Object.assign(
		{},
		DEFAULT_SETTINGS,
		typeof raw === 'object' && raw !== null ? raw : {}
	);
	return {
		statuses: sanitizeStatuses(Array.isArray(merged.statuses) ? merged.statuses : []),
		inheritTags: Boolean(merged.inheritTags),
		writeSyntax: merged.writeSyntax === 'inline-field' ? 'inline-field' : 'emoji',
		excludedFolders: (Array.isArray(merged.excludedFolders) ? merged.excludedFolders : [])
			.filter((f): f is string => typeof f === 'string')
			.map((f) => f.replace(/^\/+|\/+$/gu, '').trim())
			.filter((f) => f !== ''),
		excludeTemplates: Boolean(merged.excludeTemplates),
		semesterFolder:
			typeof merged.semesterFolder === 'string'
				? merged.semesterFolder.replace(/^\/+|\/+$/gu, '').trim()
				: '',
		semesterFormat:
			typeof merged.semesterFormat === 'string' && merged.semesterFormat.trim() !== ''
				? merged.semesterFormat.trim()
				: DEFAULT_FORMATS.semester,
		moveHeading: typeof merged.moveHeading === 'string' ? merged.moveHeading.trim() : '',
		rescheduleField: RESCHEDULE_FIELDS.includes(merged.rescheduleField)
			? merged.rescheduleField
			: 'due',
		editorHoverPopover: Boolean(merged.editorHoverPopover),
		calendarDisplay: merged.calendarDisplay === 'dots' ? 'dots' : 'intensity',
		heatmapShowLevel: Boolean(merged.heatmapShowLevel),
		heatmapShowTiles: Boolean(merged.heatmapShowTiles),
		heatmapShowSummary: Boolean(merged.heatmapShowSummary),
		heatmapShowTopTags: Boolean(merged.heatmapShowTopTags),
	};
}

/**
 * `minAppVersion` is 1.10.0, so `display()` is the only settings API available:
 * the declarative `getSettingDefinitions()` landed in 1.13.0 and would render
 * nothing at all on the versions this plugin supports. The lint rule that asks
 * for it is switched off in eslint.config.mts for that reason.
 *
 * Every string here comes from `i18n/`, including the placeholders and the
 * tooltips — the settings tab is the largest surface of visible text in the
 * plugin and leaving it in English would make the translation pointless.
 */
export class SimpleTasksSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: SimpleTasksPlugin
	) {
		super(app, plugin);
	}

	display(): void {
		this.render();
	}

	/**
	 * The actual rendering. Internal re-renders call this rather than `display()`,
	 * which Obsidian deprecated in 1.13.0.
	 */
	private render(): void {
		const { containerEl } = this;
		containerEl.empty();

		this.renderStatuses(containerEl);
		this.renderWriting(containerEl);
		this.renderActions(containerEl);
		this.renderHeatmap(containerEl);
		this.renderIndexing(containerEl);
		this.renderPeriodic(containerEl);
		this.renderCalendar(containerEl);
	}

	/**
	 * The sections of the heatmap view. Four toggles rather than one "compact
	 * mode": the panel was a fixed stack of six different things, and a user who
	 * only wants the streak has no reason to also take the tag chips.
	 */
	private renderHeatmap(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.heatmap.name'))
			.setDesc(t('settings.heatmap.desc'))
			.setHeading();

		const sections: [
			keyof Pick<
				SimpleTasksSettings,
				'heatmapShowLevel' | 'heatmapShowTiles' | 'heatmapShowSummary' | 'heatmapShowTopTags'
			>,
			Parameters<typeof t>[0],
			Parameters<typeof t>[0],
		][] = [
			['heatmapShowLevel', 'settings.heatmapLevel.name', 'settings.heatmapLevel.desc'],
			['heatmapShowTiles', 'settings.heatmapTiles.name', 'settings.heatmapTiles.desc'],
			['heatmapShowSummary', 'settings.heatmapSummary.name', 'settings.heatmapSummary.desc'],
			['heatmapShowTopTags', 'settings.heatmapTopTags.name', 'settings.heatmapTopTags.desc'],
		];

		for (const [key, name, desc] of sections) {
			new Setting(containerEl)
				.setName(t(name))
				.setDesc(t(desc))
				.addToggle((toggle) =>
					toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
						this.plugin.settings[key] = value;
						await this.save(false);
					})
				);
		}
	}

	private async save(rebuild: boolean): Promise<void> {
		await this.plugin.saveSettings({ rebuildIndex: rebuild });
	}

	private renderStatuses(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.statuses.name'))
			.setDesc(t('settings.statuses.desc'))
			.setHeading();

		for (const [i, status] of this.plugin.settings.statuses.entries()) {
			const label = status.symbol === ' ' ? t('settings.statuses.blank') : `[${status.symbol}]`;
			const setting = new Setting(containerEl).setName(label);

			setting.addText((text) =>
				text
					.setPlaceholder(t('settings.statuses.namePlaceholder'))
					.setValue(status.name)
					.onChange(async (value) => {
						status.name = value;
						await this.save(true);
					})
			);

			setting.addText((text) => {
				text.inputEl.maxLength = 1;
				text.inputEl.addClass('simple-tasks-symbol-input');
				text.setPlaceholder(t('settings.statuses.nextPlaceholder')).setValue(status.nextSymbol);
				text.onChange(async (value) => {
					status.nextSymbol = value === '' ? ' ' : value;
					await this.save(false);
				});
			});

			setting.addToggle((toggle) =>
				toggle
					.setTooltip(t('settings.statuses.completedTooltip'))
					.setValue(status.isCompleted)
					.onChange(async (value) => {
						status.isCompleted = value;
						await this.save(true);
					})
			);

			setting.addExtraButton((button) =>
				button
					.setIcon('trash-2')
					.setTooltip(t('settings.statuses.remove'))
					.onClick(async () => {
						this.plugin.settings.statuses.splice(i, 1);
						await this.save(true);
						this.render();
					})
			);
		}

		new Setting(containerEl)
			.addButton((button) =>
				button.setButtonText(t('settings.statuses.add')).onClick(async () => {
					this.plugin.settings.statuses.push({
						symbol: '?',
						name: t('settings.statuses.newName'),
						isCompleted: false,
						nextSymbol: ' ',
					});
					await this.save(true);
					this.render();
				})
			)
			.addButton((button) =>
				button.setButtonText(t('settings.statuses.restore')).onClick(async () => {
					this.plugin.settings.statuses = cloneDefaultStatuses();
					await this.save(true);
					this.render();
				})
			);
	}

	private renderWriting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.writing.name'))
			.setDesc(t('settings.writing.desc'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings.syntax.name'))
			.setDesc(t('settings.syntax.desc'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('emoji', t('settings.syntax.emoji'))
					.addOption('inline-field', t('settings.syntax.inlineField'))
					.setValue(this.plugin.settings.writeSyntax)
					.onChange(async (value) => {
						this.plugin.settings.writeSyntax =
							value === 'inline-field' ? 'inline-field' : 'emoji';
						await this.save(false);
					})
			);
	}

	private renderActions(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.actions.name'))
			.setDesc(t('settings.actions.desc'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings.moveHeading.name'))
			.setDesc(t('settings.moveHeading.desc'))
			.addText((text) =>
				text
					.setPlaceholder(t('settings.moveHeading.placeholder'))
					.setValue(this.plugin.settings.moveHeading)
					.onChange(async (value) => {
						this.plugin.settings.moveHeading = value.trim();
						await this.save(false);
					})
			);

		new Setting(containerEl)
			.setName(t('settings.dueField.name'))
			.setDesc(t('settings.dueField.desc'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('due', t('settings.dueField.due'))
					.addOption('scheduled', t('settings.dueField.scheduled'))
					.addOption('start', t('settings.dueField.start'))
					.setValue(this.plugin.settings.rescheduleField)
					.onChange(async (value) => {
						this.plugin.settings.rescheduleField = RESCHEDULE_FIELDS.includes(
							value as ReschedulableField
						)
							? (value as ReschedulableField)
							: 'due';
						await this.save(false);
					})
			);

		new Setting(containerEl)
			.setName(t('settings.hoverPopover.name'))
			.setDesc(t('settings.hoverPopover.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.editorHoverPopover).onChange(async (value) => {
					this.plugin.settings.editorHoverPopover = value;
					await this.save(false);
				})
			);

	}

	private renderIndexing(containerEl: HTMLElement): void {
		new Setting(containerEl).setName(t('settings.index.name')).setHeading();

		new Setting(containerEl)
			.setName(t('settings.inheritTags.name'))
			.setDesc(t('settings.inheritTags.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.inheritTags).onChange(async (value) => {
					this.plugin.settings.inheritTags = value;
					await this.save(true);
				})
			);

		new Setting(containerEl)
			.setName(t('settings.excludeTemplates.name'))
			.setDesc(t('settings.excludeTemplates.desc'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.excludeTemplates).onChange(async (value) => {
					this.plugin.settings.excludeTemplates = value;
					await this.save(true);
				})
			);

		new Setting(containerEl)
			.setName(t('settings.excludedFolders.name'))
			.setDesc(t('settings.excludedFolders.desc'))
			.addTextArea((text) =>
				text
					.setPlaceholder(t('settings.excludedFolders.placeholder'))
					.setValue(this.plugin.settings.excludedFolders.join('\n'))
					.onChange(async (value) => {
						this.plugin.settings.excludedFolders = value
							.split('\n')
							.map((f) => f.replace(/^\/+|\/+$/gu, '').trim())
							.filter((f) => f !== '');
						await this.save(true);
					})
			);
	}

	/**
	 * A status row rather than a setting: there is nothing to configure here, and
	 * the one thing a user needs to know is whether the two plugins found each
	 * other. It is re-read every time the tab is rendered, and the integration
	 * re-checks itself on the plugin manager's `changed` event, so enabling
	 * Calendar Plus and reopening the tab shows it connected.
	 */
	private renderCalendar(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.calendar.name'))
			.setDesc(t('settings.calendar.desc'))
			.setHeading();

		const connected = this.plugin.calendar.isConnected;
		const row = new Setting(containerEl)
			.setName(t('settings.calendar.status'))
			.setDesc(connected ? t('settings.calendar.connected') : t('settings.calendar.missing'));
		if (!connected) {
			row.addButton((button) =>
				button.setButtonText(t('calendar.missing.install')).onClick(() => {
					openCalendarPlusPage();
				})
			);
			// Nothing else is worth offering: a choice about how the calendar draws
			// tasks, with no calendar, is a control that cannot be checked.
			return;
		}

		new Setting(containerEl)
			.setName(t('settings.calendarDisplay.name'))
			.setDesc(t('settings.calendarDisplay.desc'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('intensity', t('settings.calendarDisplay.intensity'))
					.addOption('dots', t('settings.calendarDisplay.dots'))
					.setValue(this.plugin.settings.calendarDisplay)
					.onChange(async (value) => {
						this.plugin.settings.calendarDisplay = value === 'dots' ? 'dots' : 'intensity';
						await this.save(false);
						// The calendar caches nothing of ours, but it will not repaint on
						// its own for a setting it knows nothing about.
						this.plugin.calendar.refresh();
					})
			);
	}

	private renderPeriodic(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName(t('settings.periodic.name'))
			.setDesc(t('settings.periodic.desc'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings.semesterFolder.name'))
			.setDesc(t('settings.semesterFolder.desc'))
			.addText((text) =>
				text.setValue(this.plugin.settings.semesterFolder).onChange(async (value) => {
					this.plugin.settings.semesterFolder = value.replace(/^\/+|\/+$/gu, '').trim();
					await this.save(true);
				})
			);

		new Setting(containerEl)
			.setName(t('settings.semesterFormat.name'))
			.setDesc(t('settings.semesterFormat.desc'))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_FORMATS.semester)
					.setValue(this.plugin.settings.semesterFormat)
					.onChange(async (value) => {
						this.plugin.settings.semesterFormat =
							value.trim() === '' ? DEFAULT_FORMATS.semester : value.trim();
						await this.save(true);
					})
			);
	}
}
