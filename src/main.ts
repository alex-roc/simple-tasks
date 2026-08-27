import { Notice, Platform, Plugin, moment } from 'obsidian';
import type { Editor, MarkdownFileInfo, MarkdownView } from 'obsidian';
import { cycleTaskStatus, setTaskStatus } from './actions/cycle-status.ts';
import { addTaskTag, removeTaskTag, setTaskPriority } from './actions/edit-task.ts';
import { openPeriodicNote } from './actions/ensure-note.ts';
import { moveTask, moveTaskToDate } from './actions/move-task.ts';
import type { MoveDestination } from './actions/move-task.ts';
import { relativeToTask, rescheduleTask } from './actions/reschedule.ts';
import type { ReschedulableField } from './actions/reschedule.ts';
import { registerCliCommands } from './cli/index.ts';
import type { PeriodicGranularity, PeriodicLevel } from './domain/periodic.ts';
import type { Task, TaskPriority } from './domain/task.ts';
import { CalendarPlusIntegration } from './integrations/calendar-plus.ts';
import { TaskIndexer } from './index/indexer.ts';
import { StatsCache } from './index/stats.ts';
import { INDEX_CHANGED, TaskIndex } from './index/task-index.ts';
import { t } from './i18n/index.ts';
import { DEFAULT_SETTINGS, SimpleTasksSettingTab, normalizeSettings } from './settings.ts';
import type { SimpleTasksSettings } from './settings.ts';
import { CalendarPlusMissingModal } from './ui/modals/calendar-plus-modal.ts';
import { DatePickerModal } from './ui/modals/date-modal.ts';
import { taskHoverExtension } from './ui/popover/editor-hover.ts';
import { taskLineActionsExtension } from './ui/popover/editor-line-actions.ts';
import { TaskPopover } from './ui/popover/task-popover.ts';
import { AGENDA_VIEW_TYPE, AgendaView } from './ui/views/agenda-view.ts';
import { BASES_VIEW_TYPE, TasksBasesView, basesViewOptions } from './ui/views/bases-view.ts';
import { HEATMAP_VIEW_TYPE, HeatmapView } from './ui/views/heatmap-view.ts';

/**
 * Lifecycle only: load persisted state, start the index, register the views,
 * the commands and the editor extension. Views, markdown mutations and derived
 * numbers belong to their own folders.
 */

/**
 * A key written by versions up to 0.2.0: a record of when the plugin first
 * *observed* each completion, used to date tasks the markdown does not date. It
 * was removed because observation is not evidence — see `completionDate` in
 * `index/stats.ts`. Its presence in `data.json` is the trigger to rewrite the
 * file without it, so the stale dates do not linger in a user's vault.
 */
const LEGACY_COMPLETION_LOG = 'completionLog';

export default class SimpleTasksPlugin extends Plugin {
	settings: SimpleTasksSettings = DEFAULT_SETTINGS;

	/**
	 * Public on purpose: it is the plugin's read API for the rest of the code and
	 * the handle used to verify the index from the Obsidian CLI (`eval`).
	 */
	readonly index = new TaskIndex();

	/** Memoized aggregates over the index. Invalidated by the index's own event. */
	readonly stats = new StatsCache(() => ({
		tasks: this.index.all(),
		options: {
			today: moment().format('YYYY-MM-DD'),
			firstDayOfWeek: moment.localeData().firstDayOfWeek(),
		},
	}));

	/**
	 * Every mutation the plugin can perform on a task, in one object.
	 *
	 * Public for the same reason {@link index} is: it is the handle the Obsidian
	 * CLI needs to exercise a write from `eval` without a human driving the mouse,
	 * which is the only way `move-task` can be regression-tested against a real
	 * vault. It is also the shape an inter-plugin API would take, should one be
	 * needed later.
	 */
	readonly actions = {
		setStatus: (task: Task, symbol: string) => setTaskStatus(this, task, symbol),
		cycleStatus: (task: Task) => cycleTaskStatus(this, task),
		setPriority: (task: Task, priority: TaskPriority | null) =>
			setTaskPriority(this, task, priority),
		addTag: (task: Task, tag: string) => addTaskTag(this, task, tag),
		removeTag: (task: Task, tag: string) => removeTaskTag(this, task, tag),
		reschedule: (task: Task, date: string | null, field?: ReschedulableField) =>
			rescheduleTask(this, task, date, field),
		move: (task: Task, destination: MoveDestination) => moveTask(this, task, destination),
		moveToDate: (task: Task, date: string, granularity?: PeriodicGranularity) =>
			moveTaskToDate(this, task, date, granularity),
	};

	/**
	 * Optional wiring to Calendar Plus. Always constructed: it is the thing that
	 * knows whether the other plugin is there, and the settings tab asks it.
	 */
	readonly calendar = new CalendarPlusIntegration(this);

	private indexer: TaskIndexer | null = null;

	async onload() {
		await this.loadPersisted();

		this.indexer = new TaskIndexer(this.app, this, this.index, () => this.settings);
		this.addSettingTab(new SimpleTasksSettingTab(this.app, this));

		// Registered here rather than in the view: the cache outlives every view,
		// so a change while the heatmap is closed must still invalidate it.
		this.registerEvent(
			this.index.on(INDEX_CHANGED, () => {
				this.stats.invalidate();
			})
		);

		this.registerView(HEATMAP_VIEW_TYPE, (leaf) => new HeatmapView(leaf, this));
		this.registerView(AGENDA_VIEW_TYPE, (leaf) => new AgendaView(leaf, this));
		this.registerTaskViews();

		// The same popover the views open on hover, over the editor. It resolves the
		// task from the index, so it agrees with everything else by construction.
		//
		// **Desktop only.** A touch WebView synthesizes pointer and mouse events from
		// a tap, so on a phone `hoverTooltip` fired from the very tap that was aimed
		// at the ⋮ button — one popover from the hover and one from the button, both
		// on screen at once, and a popover appearing over the text whenever a line
		// was touched at all. There is no hover on a phone to be replaced: the button
		// below is the whole route there, and it is the only one.
		if (!Platform.isMobile) this.registerEditorExtension(taskHoverExtension(this));

		// And the same popover again, reached by a button on the task line the cursor
		// is on. Mobile only: there is no hover to replace it there, and on the
		// desktop an icon appearing on the active line would be noise.
		if (Platform.isMobile) this.registerEditorExtension(taskLineActionsExtension(this));

		this.addRibbonIcon('calendar-range', t('ribbon.heatmap'), () => {
			void this.activateView(HEATMAP_VIEW_TYPE);
		});
		this.addRibbonIcon('list-checks', t('ribbon.agenda'), () => {
			void this.activateView(AGENDA_VIEW_TYPE);
		});

		this.registerCommands();

		// `registerCliHandler` landed in 1.12.2 and `minAppVersion` is 1.10.0, so the
		// commands register themselves only where the API exists. See `cli/index.ts`.
		registerCliCommands(this);

		// Registered before the index starts: the integration only has to know the
		// provider may show up later, which it re-checks on its own.
		this.calendar.load();

		// Scanning ~500 notes must not delay the app becoming usable.
		this.app.workspace.onLayoutReady(() => {
			void this.indexer?.start();
		});
	}

	/* -------------------------------------------------- periodic notes */

	/** Path of the periodic note for a date, or `null` when the level is off. */
	periodicNotePath(granularity: PeriodicGranularity, date: string): string | null {
		return this.indexer?.notePathFor(granularity, date) ?? null;
	}

	/** Path of the daily note for a date. Kept for the heatmap's day clicks. */
	dailyNotePath(date: string): string | null {
		return this.periodicNotePath('day', date);
	}

	/** The vault's configuration for one periodic level: folder, format, template. */
	periodicLevel(granularity: PeriodicGranularity): PeriodicLevel | null {
		return this.indexer?.levelFor(granularity) ?? null;
	}

	/** Opens the note of a period, creating it from its template when missing. */
	async openPeriodicNote(granularity: PeriodicGranularity, date: string): Promise<void> {
		await openPeriodicNote(this, granularity, date);
	}

	/* -------------------------------------------------- views */

	/**
	 * Reveals a sidebar view, reusing the leaf when one is already open. Views are
	 * deliberately not opened from `onload`: Obsidian restores sidebar leaves
	 * asynchronously, so an auto-open would find nothing and add a duplicate leaf
	 * on every plugin reload.
	 */
	async activateView(type: string): Promise<void> {
		const { workspace } = this.app;
		const existing = workspace.getLeavesOfType(type)[0];
		if (existing !== undefined) {
			await workspace.revealLeaf(existing);
			return;
		}
		const leaf = workspace.getRightLeaf(false);
		if (leaf === null) return;
		await leaf.setViewState({ type, active: true });
		await workspace.revealLeaf(leaf);
	}

	/**
	 * The Bases view, when this Obsidian has Bases.
	 *
	 * `registerBasesView` is 1.10.0 — the declared minimum — but it also returns
	 * `false` when the core Bases plugin is switched off in the vault, so the
	 * capability is probed rather than assumed and its absence is simply one
	 * fewer view.
	 */
	private registerTaskViews(): void {
		if (!('registerBasesView' in this)) return;
		this.registerBasesView(BASES_VIEW_TYPE, {
			name: t('bases.viewName'),
			icon: 'list-checks',
			factory: (controller, containerEl) => new TasksBasesView(controller, containerEl, this),
			options: () => basesViewOptions(),
		});
	}

	/** Opens the agenda on a given day. Used by the heatmap's day clicks. */
	async showAgendaFor(date: string): Promise<void> {
		await this.activateView(AGENDA_VIEW_TYPE);
		for (const leaf of this.app.workspace.getLeavesOfType(AGENDA_VIEW_TYPE)) {
			const { view } = leaf;
			if (view instanceof AgendaView) view.showDate(date);
		}
	}

	/* -------------------------------------------------- commands */

	private registerCommands(): void {
		this.addCommand({
			id: 'open-heatmap',
			name: t('command.openHeatmap'),
			callback: () => {
				void this.activateView(HEATMAP_VIEW_TYPE);
			},
		});
		this.addCommand({
			id: 'open-agenda',
			name: t('command.openAgenda'),
			callback: () => {
				void this.activateView(AGENDA_VIEW_TYPE);
			},
		});
		this.addCommand({
			id: 'show-in-calendar',
			name: t('command.showInCalendar'),
			callback: () => {
				void this.showInCalendar();
			},
		});
		this.addCommand({
			id: 'agenda-today',
			name: t('command.agendaToday'),
			callback: () => {
				void this.showAgendaFor(moment().format('YYYY-MM-DD'));
			},
		});

		// The cursor commands are the keyboard route to everything the popover
		// offers, which is what keeps a hover-only feature accessible.
		this.addTaskCommand('cycle-status', t('command.cycleStatus'), (task) => {
			void cycleTaskStatus(this, task);
		});
		// The day after the task's own day, not after today: same rule as the
		// popover's move row, from `actions/reschedule.ts:taskAnchorDate()`.
		this.addTaskCommand('move-to-tomorrow', t('command.moveToTomorrow'), (task) => {
			void moveTaskToDate(this, task, relativeToTask(task, 1));
		});
		this.addTaskCommand('set-due-date', t('command.setDueDate'), (task) => {
			new DatePickerModal(this.app, task.dates[this.settings.rescheduleField] ?? null, (date) => {
				void rescheduleTask(this, task, date);
			}).open();
		});
		this.addTaskCommand('task-actions', t('command.taskActions'), (task, _editor, context) => {
			TaskPopover.showAt(cursorAnchor(this, context), { plugin: this, task }).focusFirst();
		});
	}

	/**
	 * Opens the calendar on today, or explains what is missing.
	 *
	 * The explanation is a panel opened *here*, when the user asked for the
	 * feature — never a notice at startup.
	 *
	 * The second explanation is the one this command was missing. Revealing the
	 * calendar is the feedback in the normal case, but a calendar with nothing on
	 * it looks identical before and after — no dot, no shading, no tooltip — so a
	 * command that cannot change anything says so rather than appearing dead.
	 */
	private async showInCalendar(): Promise<void> {
		if (!(await this.calendar.revealToday())) {
			new CalendarPlusMissingModal(this.app).open();
			return;
		}
		// A cell is drawn from the periodic note a task lives in, or from a `✅` on
		// its line. A vault where no task has either contributes nothing anywhere.
		if (this.index.all().some((task) => task.effectiveDate !== null)) return;
		new Notice(t('calendar.nothingToShow'));
	}

	/**
	 * A command that only exists when the cursor is on an indexed task. Uses
	 * `editorCheckCallback` so it disappears from the palette rather than firing a
	 * notice at somebody who is not editing a task.
	 */
	private addTaskCommand(
		id: string,
		name: string,
		run: (task: Task, editor: Editor, context: MarkdownView | MarkdownFileInfo) => void
	): void {
		this.addCommand({
			id,
			name,
			editorCheckCallback: (checking, editor, context) => {
				const task = this.taskAtCursor(editor, context);
				if (task === null) return false;
				if (!checking) run(task, editor, context);
				return true;
			},
		});
	}

	/** The indexed task on the cursor's line, or `null`. */
	private taskAtCursor(editor: Editor, context: MarkdownView | MarkdownFileInfo): Task | null {
		const path = context.file?.path;
		if (path === undefined) return null;
		const line = editor.getCursor().line;
		const entry = this.index.fileEntry(path);
		return entry?.items.find((item) => item.line === line && item.isTask) ?? null;
	}

	/* -------------------------------------------------- persistence */

	private async loadPersisted(): Promise<void> {
		const raw: unknown = await this.loadData();
		this.settings = normalizeSettings(raw);
		// Drop the observed-completion log of 0.2.0 and earlier. Rewriting on sight
		// rather than leaving it in place matters: the entries are wrong dates, and a
		// user who downgrades should not get them back.
		if (typeof raw === 'object' && raw !== null && LEGACY_COMPLETION_LOG in raw) {
			await this.persist();
		}
	}

	/**
	 * Persists settings. Anything that changes how a line is read has to rebuild
	 * the index, since the stored tasks were derived under the old settings.
	 */
	async saveSettings(options: { rebuildIndex?: boolean } = {}): Promise<void> {
		await this.persist();
		this.refreshViews();
		if (options.rebuildIndex !== true || this.indexer === null) return;
		await this.indexer.reloadPeriodicConfig();
		await this.indexer.rebuild();
	}

	/**
	 * Repaints the views a setting can change the shape of.
	 *
	 * The heatmap otherwise only redraws when the index changes, so switching one
	 * of its sections on would appear to do nothing until the next edit. Leaves
	 * are looked up here rather than held in a field: a view reference stored on
	 * the plugin outlives the view.
	 */
	private refreshViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(HEATMAP_VIEW_TYPE)) {
			const { view } = leaf;
			if (view instanceof HeatmapView) view.refresh();
		}
	}

	/**
	 * The single writer of `data.json`, which now holds nothing but the settings.
	 *
	 * `saveData()` replaces the whole file, so writing a slice of it drops
	 * everything else — which is exactly how the legacy completion log gets
	 * removed, and why nothing else may accumulate state here. Every number the
	 * plugin shows is derived from the vault.
	 */
	private async persist(): Promise<void> {
		await this.saveData({ ...this.settings });
	}
}

/**
 * Where the keyboard-triggered popover should appear: over the line the cursor
 * is on. CodeMirror marks it with `.cm-active`, which is a far better anchor
 * than the top of the pane, and the workspace container is the fallback for the
 * cases where there is no rendered active line (a collapsed fold, a popout).
 */
function cursorAnchor(
	plugin: SimpleTasksPlugin,
	context: MarkdownView | MarkdownFileInfo
): HTMLElement {
	const scope = 'containerEl' in context ? context.containerEl : null;
	const active = scope?.querySelector<HTMLElement>('.cm-line.cm-active');
	return active ?? scope ?? plugin.app.workspace.containerEl;
}
