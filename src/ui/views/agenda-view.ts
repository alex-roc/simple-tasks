import { ItemView, debounce, moment, setIcon, setTooltip } from 'obsidian';
import type { Component, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import { openTaskAt } from '../../actions/open-task.ts';
import { buildAgendaTree, collectAgenda, detailLines, groupTasks } from '../../domain/agenda.ts';
import type { AgendaGroup, AgendaGrouping, AgendaNode } from '../../domain/agenda.ts';
import { resolveStatus } from '../../domain/statuses.ts';
import type { Task } from '../../domain/task.ts';
import { INDEX_CHANGED } from '../../index/task-index.ts';
import { t, tCount } from '../../i18n/index.ts';
import type SimpleTasksPlugin from '../../main.ts';
import { renderScope } from '../components/render-scope.ts';
import { TaskRowList, noteName } from '../components/task-row-list.ts';
import { DatePickerModal } from '../modals/date-modal.ts';
import { TagSuggestModal } from '../modals/tag-modal.ts';

/**
 * The agenda: every task that belongs to one day, grouped and hierarchical.
 *
 * ## Where the tasks come from
 *
 * Nothing is rescanned. Three index queries are unioned by task id:
 *
 * - `coveringDate(date, scope)` — the tasks living in the periodic notes whose
 *   span covers the day. The scope defaults to the daily note alone; widening it
 *   pulls in the week, month, quarter, semester and year notes, which is exactly
 *   what an outline-driven vault wants on a Monday morning.
 * - `byDate(date)` — the tasks *attributed* to the day: a `✅` on the line, or the
 *   date of the containing periodic note.
 * - the tasks whose line carries an explicit `due`, `scheduled` or `start` for
 *   that day, wherever they live.
 *
 * A tag filter, when set, intersects all of that with `byTag(tag)`.
 *
 * ## Not opened from `onload`
 *
 * Obsidian restores sidebar leaves asynchronously, so an auto-open finds zero
 * leaves and adds a duplicate on every plugin reload — measured in this project.
 * The ribbon icon and the command are the only ways in.
 *
 * ## Nothing is registered against the view while rendering
 *
 * The view repaints on every index change, so a handler tied to its lifetime is
 * a leak. The rows are wired once by delegation (`components/task-row-list.ts`)
 * and the toolbar's own handlers belong to a per-render child component
 * (`components/render-scope.ts`).
 */

export const AGENDA_VIEW_TYPE = 'simple-tasks-agenda';

/** Index changes arrive per keystroke pause; one repaint per burst is plenty. */
const RENDER_DEBOUNCE_MS = 120;

const GROUPINGS: readonly AgendaGrouping[] = ['note', 'project', 'tag', 'status', 'none'];

const GROUPING_LABELS: Readonly<Record<AgendaGrouping, Parameters<typeof t>[0]>> = {
	note: 'agenda.groupBy.note',
	project: 'agenda.groupBy.project',
	tag: 'agenda.groupBy.tag',
	status: 'agenda.groupBy.status',
	none: 'agenda.groupBy.none',
};

interface AgendaState {
	date: string;
	grouping: AgendaGrouping;
	hideCompleted: boolean;
	/** Whether the week, month and year notes join the day's own. */
	widePeriods: boolean;
	/** Tag the day is filtered by, or `null`. */
	tag: string | null;
}

export class AgendaView extends ItemView {
	private state: AgendaState = {
		date: moment().format('YYYY-MM-DD'),
		grouping: 'note',
		hideCompleted: false,
		widePeriods: false,
		tag: null,
	};

	private readonly scheduleRender = debounce(() => {
		this.render();
	}, RENDER_DEBOUNCE_MS);

	/** Delegated row handling; built once, in `onOpen`. */
	private rows: TaskRowList | null = null;

	/** Owns the toolbar's handlers for exactly one render. */
	private toolbarScope: Component | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: SimpleTasksPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return AGENDA_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('view.agenda.title');
	}

	getIcon(): string {
		return 'list-checks';
	}

	/** Obsidian persists this per leaf, so the day survives a restart. */
	getState(): Record<string, unknown> {
		return { ...this.state };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (typeof state === 'object' && state !== null) {
			const raw = state as Partial<AgendaState>;
			if (typeof raw.date === 'string' && moment(raw.date, 'YYYY-MM-DD', true).isValid()) {
				this.state.date = raw.date;
			}
			if (raw.grouping !== undefined && GROUPINGS.includes(raw.grouping)) {
				this.state.grouping = raw.grouping;
			}
			this.state.hideCompleted = Boolean(raw.hideCompleted);
			this.state.widePeriods = Boolean(raw.widePeriods);
			this.state.tag = typeof raw.tag === 'string' ? raw.tag : null;
		}
		await super.setState(state, result);
		this.render();
	}

	/** Jumps the open agenda to a day. Used by the heatmap and the commands. */
	showDate(date: string): void {
		this.state.date = date;
		this.render();
	}

	protected onOpen(): Promise<void> {
		// `contentEl` outlives every render, which is what makes one set of
		// delegated listeners enough for all the rows this view will ever draw.
		this.rows = new TaskRowList(this, this.contentEl, {
			plugin: this.plugin,
			prefix: 'simple-tasks-agenda',
			draggable: true,
			selectable: true,
			showSource: () => this.state.grouping !== 'note',
			onChanged: () => {
				this.scheduleRender();
			},
		});
		this.registerEvent(
			this.plugin.index.on(INDEX_CHANGED, () => {
				this.scheduleRender();
			})
		);
		this.render();
		return Promise.resolve();
	}

	protected onClose(): Promise<void> {
		this.scheduleRender.cancel();
		this.contentEl.empty();
		return Promise.resolve();
	}

	/* -------------------------------------------------- data */

	/**
	 * The day's tasks, deduplicated by id. The union itself is pure and lives in
	 * `domain/agenda.ts`, because `simple-tasks:today` on the command line has to
	 * answer the same question and two implementations of "what belongs to today"
	 * would drift apart.
	 */
	private collect(): Task[] {
		return collectAgenda(this.plugin.index, this.state);
	}

	/* -------------------------------------------------- rendering */

	private render(): void {
		const { contentEl } = this;
		this.toolbarScope = renderScope(this, this.toolbarScope);
		contentEl.empty();
		contentEl.addClass('simple-tasks-agenda');

		const tasks = this.collect();
		// Before a single row exists: a painted row that this render is not going to
		// draw — completed away, filtered out, moved — leaves the selection here.
		this.rows?.retainSelection(tasks);
		this.renderToolbar(contentEl, tasks);

		if (tasks.length === 0) {
			contentEl.createDiv({ cls: 'simple-tasks-agenda-empty', text: t('agenda.empty') });
			return;
		}

		const groups = groupTasks(tasks, this.state.grouping, {
			untaggedLabel: t('agenda.untagged'),
			noProjectLabel: t('agenda.noProject'),
			statusName: (symbol) => resolveStatus(this.plugin.settings.statuses, symbol).name,
			itemsOf: (path) => this.plugin.index.fileEntry(path)?.items ?? [],
		});

		const body = contentEl.createDiv({ cls: 'simple-tasks-agenda-body' });
		for (const group of groups) {
			const section = body.createDiv({ cls: 'simple-tasks-agenda-group' });
			if (group.label !== '') {
				const header = section.createDiv({ cls: 'simple-tasks-agenda-group-header' });
				this.renderGroupName(header, group);
				// The progress pair, not a bare total: on a day's agenda "3/3" says
				// the project is closed and "1/4" says it is not, which is the one
				// thing a count of tasks never says.
				header.createSpan({
					cls: 'simple-tasks-agenda-group-count',
					attr: {
						'aria-label': t('agenda.groupProgress', {
							completed: group.completed,
							total: group.total,
						}),
					},
					text: `${String(group.completed)}/${String(group.total)}`,
				});
			}
			const list = section.createDiv({ cls: 'simple-tasks-agenda-list' });
			if (this.state.grouping === 'note') this.renderTree(list, group.key, group.tasks);
			else for (const task of group.tasks) this.renderRow(list, task, 0, true);
		}
	}

	/**
	 * The group's title.
	 *
	 * **Grouped by note it is a `<button>` that opens the note**, at the first of
	 * the day's tasks in document order rather than at the top of the file: the
	 * agenda's own answer to "where does this come from" is a place, not a
	 * filename. A real button rather than a `div` with a listener, so it is in the
	 * tab order, announces itself as a button and fires on Enter and Space with no
	 * key handler of ours.
	 *
	 * **Grouped by project it is a `<button>` too**, opening the project note.
	 * The project is a place as much as a note is — the user linked it — so it
	 * takes exactly the same route, `openTaskAt`, rather than a second one. The
	 * only extra step is resolving the link the way Obsidian would, against the
	 * note it was written in; a link that resolves to nothing (a project note
	 * that does not exist yet) falls back to a plain title rather than offering a
	 * button that would do nothing.
	 *
	 * **Grouped by tag or by status it stays a `<span>`**, and deliberately does
	 * not look pressable. A tag and a status are not places: there is no note to
	 * open, and the only destinations one could invent — a vault search, a
	 * filtered list — would be a second query surface, which is exactly what this
	 * plugin delegates to Bases rather than build. A control that has to decide
	 * what to do from the current grouping is also a control the user cannot
	 * predict; a title that is only a title in the modes with no place behind it
	 * is honest.
	 */
	private renderGroupName(header: HTMLElement, group: AgendaGroup): void {
		if (this.state.grouping === 'note') {
			const line = Math.min(...group.tasks.map((task) => task.line));
			this.openButton(header, noteName(group.label), group.key, Number.isFinite(line) ? line : 0);
			return;
		}
		if (this.state.grouping === 'project' && group.link !== undefined) {
			const file = this.app.metadataCache.getFirstLinkpathDest(
				group.link.target,
				group.link.sourcePath
			);
			if (file !== null) {
				this.openButton(header, group.label, file.path, 0);
				return;
			}
		}
		header.createSpan({ cls: 'simple-tasks-agenda-group-name', text: group.label });
	}

	/** The one way a group title opens a note. Shared by note and project groups. */
	private openButton(header: HTMLElement, name: string, path: string, line: number): void {
		const button = header.createEl('button', {
			cls: 'simple-tasks-agenda-group-name is-clickable',
			attr: { type: 'button', 'aria-label': t('agenda.openNote', { note: name }) },
			text: name,
		});
		this.toolbarScope?.registerDomEvent(button, 'click', () => {
			void openTaskAt(this.app, path, line);
		});
	}

	/**
	 * Inside a note, the outline is what makes the list readable: a task is shown
	 * under the grouping items that title it, which in a weekly note is the whole
	 * point of the note.
	 */
	private renderTree(container: HTMLElement, path: string, tasks: readonly Task[]): void {
		const items = this.plugin.index.fileEntry(path)?.items ?? [];
		const roots = buildAgendaTree(items, tasks);
		const walk = (nodes: readonly AgendaNode[], depth: number): void => {
			for (const node of nodes) {
				this.renderRow(container, node.task, depth, node.matched);
				walk(node.children, depth + 1);
			}
		};
		walk(roots, 0);
	}

	/**
	 * A row, plus the lines that are notes *on* that row folded underneath it.
	 *
	 * Which lines those are is decided in `domain/agenda.ts:detailLines()`: a
	 * checkbox-less item with no task anywhere below it. Folded and dimmed rather
	 * than dropped, because they are the reasoning behind the task and the user
	 * wrote them on purpose — but they are not work to be done, so they must not
	 * cost a full row of the agenda each.
	 *
	 * `<details>` rather than a button of ours: it opens on Enter and Space, is in
	 * the tab order and announces its state, with no handler to register — which
	 * matters here, since every row is redrawn on every index change.
	 */
	private renderRow(container: HTMLElement, task: Task, depth: number, matched: boolean): void {
		this.rows?.renderRow(container, task, depth, matched);
		if (!task.isTask) return;
		const items = this.plugin.index.fileEntry(task.path)?.items ?? [];
		const lines = detailLines(items, task.line);
		if (lines.length === 0) return;

		const fold = container.createEl('details', { cls: 'simple-tasks-agenda-detail' });
		fold.style.setProperty('--st-row-depth', String(depth + 1));
		fold.createEl('summary', {
			cls: 'simple-tasks-agenda-detail-summary',
			text: tCount('agenda.detailCount', lines.length),
		});
		const list = fold.createDiv({ cls: 'simple-tasks-agenda-detail-list' });
		for (const line of lines) {
			const row = list.createDiv({
				cls: 'simple-tasks-agenda-detail-line',
				text: line.task.cleanText,
			});
			row.style.setProperty('--st-detail-depth', String(line.depth));
		}
	}

	private renderToolbar(container: HTMLElement, tasks: readonly Task[]): void {
		const bar = container.createDiv({ cls: 'simple-tasks-agenda-toolbar' });

		const nav = bar.createDiv({ cls: 'simple-tasks-agenda-nav' });
		this.iconButton(nav, 'chevron-left', t('agenda.previousDay'), () => {
			this.shift(-1);
		});
		const label = nav.createEl('button', {
			cls: 'simple-tasks-agenda-date',
			attr: { type: 'button', 'aria-label': t('agenda.pickDay') },
		});
		// The date goes in a child so it can be given an ellipsis: `text-overflow`
		// has nothing to act on when the string is an anonymous item of a flex box,
		// and this is the one control in the toolbar that may give way — a sidebar
		// dragged to 190 px is narrower than "Sun, 9 August 2026".
		label.createSpan({
			cls: 'simple-tasks-agenda-date-text',
			text: moment(this.state.date, 'YYYY-MM-DD').format('ddd, LL'),
		});
		this.toolbarScope?.registerDomEvent(label, 'click', () => {
			new DatePickerModal(this.app, this.state.date, (date) => {
				this.showDate(date);
			}).open();
		});
		this.iconButton(nav, 'chevron-right', t('agenda.nextDay'), () => {
			this.shift(1);
		});
		this.iconButton(nav, 'calendar-check', t('agenda.goToToday'), () => {
			this.showDate(moment().format('YYYY-MM-DD'));
		});
		this.iconButton(nav, 'file-symlink', t('agenda.openDailyNote'), () => {
			void this.plugin.openPeriodicNote('day', this.state.date);
		});

		const controls = bar.createDiv({ cls: 'simple-tasks-agenda-controls' });
		const select = controls.createEl('select', {
			cls: 'dropdown',
			attr: { 'aria-label': t('agenda.groupBy') },
		});
		for (const grouping of GROUPINGS) {
			select.createEl('option', {
				value: grouping,
				text: t(GROUPING_LABELS[grouping]),
			});
		}
		select.value = this.state.grouping;
		this.toolbarScope?.registerDomEvent(select, 'change', () => {
			const value = select.value as AgendaGrouping;
			this.state.grouping = GROUPINGS.includes(value) ? value : 'note';
			this.render();
		});

		this.toggleButton(
			controls,
			this.state.hideCompleted ? 'eye-off' : 'eye',
			this.state.hideCompleted ? t('agenda.showCompleted') : t('agenda.hideCompleted'),
			this.state.hideCompleted,
			() => {
				this.state.hideCompleted = !this.state.hideCompleted;
				this.render();
			}
		);
		this.toggleButton(
			controls,
			'calendar-range',
			t('settings.periodic.name'),
			this.state.widePeriods,
			() => {
				this.state.widePeriods = !this.state.widePeriods;
				this.render();
			}
		);
		this.toggleButton(controls, 'tag', t('agenda.groupBy.tag'), this.state.tag !== null, () => {
			if (this.state.tag !== null) {
				this.state.tag = null;
				this.render();
				return;
			}
			new TagSuggestModal(this.app, this.plugin.index, {}, (tag) => {
				this.state.tag = tag;
				this.render();
			}).open();
		});

		const open = tasks.filter((task) => task.isTask && !task.isCompleted).length;
		bar.createDiv({
			cls: 'simple-tasks-agenda-summary',
			text:
				this.state.tag === null
					? t('agenda.summary', { open, total: tasks.length })
					: `${this.state.tag} · ${t('agenda.summary', { open, total: tasks.length })}`,
		});
	}

	private iconButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		onClick: () => void
	): HTMLButtonElement {
		const button = parent.createEl('button', {
			cls: 'simple-tasks-agenda-icon',
			attr: { type: 'button', 'aria-label': label },
		});
		setIcon(button, icon);
		setTooltip(button, label, { placement: 'top' });
		this.toolbarScope?.registerDomEvent(button, 'click', onClick);
		return button;
	}

	private toggleButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		pressed: boolean,
		onClick: () => void
	): void {
		const button = this.iconButton(parent, icon, label, onClick);
		button.setAttribute('aria-pressed', String(pressed));
	}

	private shift(days: number): void {
		this.showDate(moment(this.state.date, 'YYYY-MM-DD').add(days, 'days').format('YYYY-MM-DD'));
	}
}
