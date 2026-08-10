import { BasesView, debounce } from 'obsidian';
import type { BasesAllOptions, QueryController } from 'obsidian';
import { buildAgendaTree, groupTasks } from '../../domain/agenda.ts';
import type { AgendaGrouping, AgendaNode } from '../../domain/agenda.ts';
import { resolveStatus } from '../../domain/statuses.ts';
import type { Task } from '../../domain/task.ts';
import { INDEX_CHANGED } from '../../index/task-index.ts';
import { t, tCount } from '../../i18n/index.ts';
import type SimpleTasksPlugin from '../../main.ts';
import { TaskRowList, noteName } from '../components/task-row-list.ts';

/**
 * A Bases view that shows the **tasks** of the notes a Base selects.
 *
 * ## The division of labour
 *
 * Bases filters *notes* — by folder, tag, property, formula — with its own
 * native interface, which is exactly why this plugin has no query language of
 * its own (see `AGENTS.md`). This view takes the notes that survived that
 * filter and renders the tasks inside them, read from the index. **The vault is
 * never scanned here**: `entry.file.path` goes straight into
 * `index.fileEntry()`, the same in-memory structure the agenda and the heatmap
 * read.
 *
 * ## `this.data` is not yours to keep
 *
 * The framework replaces the whole `BasesQueryResult` on every update and
 * recreates its `BasesEntry` objects, so nothing from it survives a render:
 * each pass reads `groupedData`, extracts plain strings (paths, group labels)
 * and drops the entries on the floor. A cached `BasesEntry` would be a stale
 * pointer within a keystroke.
 *
 * ## Not a second way to write
 *
 * The checkbox calls `cycleTaskStatus`, the row opens the very same
 * `TaskPopover` the agenda and the editor open, and both go through
 * `actions/`. So a status change from a Base takes the same path — the same
 * re-location, the same serializer, the same completion log, the same
 * completion burst — as one made anywhere else. The rows themselves are drawn
 * by the same `TaskRowList` the agenda uses.
 *
 * ## Nothing is registered while rendering
 *
 * Bases calls `onDataUpdated()` on every query change and the index's own event
 * adds more repaints, so a listener tied to the view's lifetime accumulates
 * without bound. Rows are wired once, by delegation on the container.
 */

/** View type id, as it appears in a `.base` file's `views[].type`. */
export const BASES_VIEW_TYPE = 'simple-tasks-tasks';

/** Index changes arrive per keystroke pause; one repaint per burst is plenty. */
const RENDER_DEBOUNCE_MS = 250;

const GROUPINGS: readonly AgendaGrouping[] = ['note', 'project', 'tag', 'status'];

const DEFAULT_MAX_DEPTH = 4;

/**
 * Config keys, kept in one place because they are written into `.base` files
 * and are therefore a compatibility surface.
 *
 * `taskGroupBy`, not `groupBy`: `groupBy` is a reserved key of the Bases view
 * config — it is how the *note* grouping is stored — and reusing it would have
 * the view read the framework's object and the framework read our string.
 */
const KEY = {
	groupBy: 'taskGroupBy',
	showCompleted: 'showCompleted',
	maxDepth: 'maxDepth',
} as const;

/**
 * The options Bases renders in the view's config menu. Declared as a function
 * because the labels are translated and the language is resolved at call time.
 */
export function basesViewOptions(): BasesAllOptions[] {
	return [
		{
			type: 'dropdown',
			key: KEY.groupBy,
			displayName: t('agenda.groupBy'),
			default: 'note',
			options: {
				note: t('agenda.groupBy.note'),
				project: t('agenda.groupBy.project'),
				tag: t('agenda.groupBy.tag'),
				status: t('agenda.groupBy.status'),
			},
		},
		{
			type: 'toggle',
			key: KEY.showCompleted,
			displayName: t('bases.showCompleted'),
			default: true,
		},
		{
			type: 'slider',
			key: KEY.maxDepth,
			displayName: t('bases.maxDepth'),
			default: DEFAULT_MAX_DEPTH,
			min: 1,
			max: 8,
			step: 1,
		},
	];
}

export class TasksBasesView extends BasesView {
	readonly type = BASES_VIEW_TYPE;

	private readonly plugin: SimpleTasksPlugin;
	private readonly root: HTMLElement;

	private readonly scheduleRender = debounce(() => {
		this.render();
	}, RENDER_DEBOUNCE_MS);

	/** Delegated row handling; built once, in `onload`. */
	private rows: TaskRowList | null = null;

	constructor(controller: QueryController, containerEl: HTMLElement, plugin: SimpleTasksPlugin) {
		super(controller);
		this.plugin = plugin;
		this.root = containerEl;
	}

	onload(): void {
		// The container outlives every render, which is what makes one set of
		// delegated listeners enough for all the rows this view will ever draw.
		this.rows = new TaskRowList(this, this.root, {
			plugin: this.plugin,
			prefix: 'simple-tasks-bases',
			// A Base is not the agenda: there is no day to drop onto from here.
			draggable: false,
			showSource: () => this.grouping !== 'note',
			onChanged: () => {
				this.scheduleRender();
			},
		});
		// A write from the popover lands in the vault, not in the Bases query, so
		// the framework has no reason to call `onDataUpdated`. The index's own event
		// is what keeps the list honest after a status change.
		this.registerEvent(
			this.plugin.index.on(INDEX_CHANGED, () => {
				this.scheduleRender();
			})
		);
	}

	onunload(): void {
		this.scheduleRender.cancel();
		this.root.empty();
	}

	onDataUpdated(): void {
		this.render();
	}

	/* -------------------------------------------------- options */

	private get grouping(): AgendaGrouping {
		const raw = this.config.get(KEY.groupBy);
		return GROUPINGS.find((option) => option === raw) ?? 'note';
	}

	private get showCompleted(): boolean {
		return this.config.get(KEY.showCompleted) !== false;
	}

	private get maxDepth(): number {
		const raw = this.config.get(KEY.maxDepth);
		return typeof raw === 'number' && raw >= 1 ? Math.floor(raw) : DEFAULT_MAX_DEPTH;
	}

	/* -------------------------------------------------- rendering */

	private render(): void {
		this.root.empty();
		this.root.addClass('simple-tasks-bases');

		// `groupedData` is a single unlabelled group when the Base has no groupBy,
		// so honouring it costs nothing and a Base that *does* group by a property
		// keeps its sections. Nothing from the result is retained past this loop.
		const sections = (this.dataGroups() ?? []).map((group) => ({
			label: group.label,
			paths: group.paths,
		}));

		let tasks = 0;
		let open = 0;
		const notes = new Set<string>();
		const body = this.root.createDiv({ cls: 'simple-tasks-bases-body' });

		for (const section of sections) {
			const counted = this.renderSection(body, section.label, section.paths);
			tasks += counted.tasks;
			open += counted.open;
			for (const path of counted.notes) notes.add(path);
		}

		if (tasks === 0) {
			body.createDiv({ cls: 'simple-tasks-bases-empty', text: t('bases.empty') });
		}
		this.root.createDiv({
			cls: 'simple-tasks-bases-summary',
			text: `${t('agenda.summary', { open, total: tasks })} · ${tCount('bases.noteCount', notes.size)}`,
		});
	}

	/** The Bases groups reduced to plain data, so no `BasesEntry` outlives the call. */
	private dataGroups(): { label: string; paths: string[] }[] | null {
		// `data` is populated by the framework before the first `onDataUpdated`,
		// but `onload` and the index event can both fire before that happens.
		const result: unknown = this.data;
		if (typeof result !== 'object' || result === null) return null;
		return this.data.groupedData.map((group) => ({
			label: group.key?.toString() ?? '',
			paths: group.entries.map((entry) => entry.file.path),
		}));
	}

	private renderSection(
		parent: HTMLElement,
		label: string,
		paths: readonly string[]
	): { tasks: number; open: number; notes: string[] } {
		const selected: Task[] = [];
		const notes: string[] = [];
		for (const path of paths) {
			const found = this.plugin.index
				.byFile(path)
				.filter((task) => this.showCompleted || !task.isCompleted);
			if (found.length === 0) continue;
			notes.push(path);
			selected.push(...found);
		}
		if (selected.length === 0) return { tasks: 0, open: 0, notes: [] };

		const section = parent.createDiv({ cls: 'simple-tasks-bases-section' });
		if (label !== '') {
			section.createDiv({ cls: 'simple-tasks-bases-section-title', text: label });
		}

		const groups = groupTasks(selected, this.grouping, {
			untaggedLabel: t('agenda.untagged'),
			noProjectLabel: t('agenda.noProject'),
			statusName: (symbol) => resolveStatus(this.plugin.settings.statuses, symbol).name,
			itemsOf: (path) => this.plugin.index.fileEntry(path)?.items ?? [],
		});

		for (const group of groups) {
			const block = section.createDiv({ cls: 'simple-tasks-bases-group' });
			const header = block.createDiv({ cls: 'simple-tasks-bases-group-header' });
			header.createSpan({
				cls: 'simple-tasks-bases-group-name',
				text: this.grouping === 'note' ? noteName(group.label) : group.label,
			});
			header.createSpan({
				cls: 'simple-tasks-bases-group-count',
				attr: {
					'aria-label': t('agenda.groupProgress', {
						completed: group.completed,
						total: group.total,
					}),
				},
				text: `${String(group.completed)}/${String(group.total)}`,
			});
			const list = block.createDiv({ cls: 'simple-tasks-bases-list' });
			// Grouping by note is the only case with a single note per group, which
			// is what makes the outline meaningful; the others mix notes and are
			// rendered flat.
			if (this.grouping === 'note') this.renderTree(list, group.key, group.tasks);
			else for (const task of group.tasks) this.rows?.renderRow(list, task, 0, true);
		}

		return {
			tasks: selected.length,
			open: selected.filter((task) => !task.isCompleted).length,
			notes,
		};
	}

	/**
	 * The note's outline, cut off at the configured depth. The ancestors that give
	 * a task its place are pulled in by `buildAgendaTree`, including the list items
	 * without a checkbox that title a section.
	 *
	 * A context ancestor is only worth drawing when something it contains is still
	 * visible *within the depth limit*. Without that rule, `maxDepth: 1` on a note
	 * whose tasks are nested renders a page of headings and not one task — and,
	 * with `showCompleted: false`, headings that are themselves completed, which
	 * reads as the option not working.
	 */
	private renderTree(container: HTMLElement, path: string, tasks: readonly Task[]): void {
		const items = this.plugin.index.fileEntry(path)?.items ?? [];
		const roots = buildAgendaTree(items, tasks);
		const limit = this.maxDepth;
		const walk = (nodes: readonly AgendaNode[], depth: number): void => {
			if (depth >= limit) return;
			for (const node of nodes) {
				if (!reaches(node, limit - depth)) continue;
				this.rows?.renderRow(container, node.task, depth, node.matched);
				walk(node.children, depth + 1);
			}
		};
		walk(roots, 0);
	}
}

/**
 * Whether a matched task sits inside `budget` levels of this node — the node
 * itself counting as level one. Pure, and the reason a truncated outline never
 * shows a heading with nothing under it.
 */
function reaches(node: AgendaNode, budget: number): boolean {
	if (node.matched) return true;
	if (budget <= 1) return false;
	return node.children.some((child) => reaches(child, budget - 1));
}
