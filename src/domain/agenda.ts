import { outlineByLine, resolveProject } from './project.ts';
import type { PeriodicGranularity, Task, TaskPriority } from './task.ts';

/**
 * Grouping and ordering for the agenda view. Pure: it folds `Task` objects the
 * index already built, so the view never rescans anything and the layout
 * decisions are unit-tested instead of eyeballed.
 */

export type AgendaGrouping = 'note' | 'project' | 'tag' | 'status' | 'none';

export interface AgendaGroup {
	/** Stable identity: a path, a project, a tag, a status, or the empty string. */
	key: string;
	/** What to show. For notes this is the path; the view shortens it. */
	label: string;
	tasks: Task[];
	/** Tasks in the group whose status counts as finished. */
	completed: number;
	/** Tasks in the group. Same as `tasks.length`, named for the progress pair. */
	total: number;
	/**
	 * Where the group's title points, when the title names a note the user did
	 * not spell as a path. Only project groups set it: the link has to be
	 * resolved against the note it was written in, which is a `metadataCache`
	 * question and therefore the view's.
	 */
	link?: { target: string; sourcePath: string };
}

/** A task with its children, plus the ancestors that give it context. */
export interface AgendaNode {
	task: Task;
	children: AgendaNode[];
	/** `false` for an ancestor pulled in only to show where the task lives. */
	matched: boolean;
}

const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = {
	highest: 0,
	high: 1,
	medium: 2,
	low: 3,
	lowest: 4,
};

/** Unset priority sorts between medium and low, where an unmarked task belongs. */
const UNSET_RANK = 2.5;

function rankOf(priority: TaskPriority | null): number {
	return priority === null ? UNSET_RANK : PRIORITY_RANK[priority];
}

/**
 * Open tasks first, then by priority, then by where they sit in the vault. The
 * last key is what keeps the order stable across renders.
 */
export function sortTasks(tasks: readonly Task[]): Task[] {
	return [...tasks].sort((a, b) => {
		if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
		const rank = rankOf(a.priority) - rankOf(b.priority);
		if (rank !== 0) return rank;
		if (a.path !== b.path) return a.path < b.path ? -1 : 1;
		return a.line - b.line;
	});
}

export interface GroupOptions {
	/** Label used for tasks that carry no tag at all. */
	untaggedLabel: string;
	/** Label used for tasks whose branch names no project. */
	noProjectLabel: string;
	/** Resolves a status symbol to its catalog name. */
	statusName: (symbol: string) => string;
	/**
	 * Every list item of a note, in document order — `FileEntry.items`. Grouping
	 * by project walks the outline above a task to find the wikilink that names
	 * it, and the index is the only thing that knows the whole outline; the
	 * tasks handed in are just the ones the agenda selected.
	 */
	itemsOf: (path: string) => readonly Task[];
}

/**
 * Splits tasks into groups. A task with several tags appears under each of
 * them — a task tagged `#lab` and `#dev` genuinely belongs to both agendas, and
 * hiding it from one of them would make the grouping lie.
 *
 * A project, unlike a tag, is **one per task**: it is a place in the outline,
 * and a task sits in exactly one. See `domain/project.ts` for how it is read.
 */
export function groupTasks(
	tasks: readonly Task[],
	grouping: AgendaGrouping,
	options: GroupOptions
): AgendaGroup[] {
	if (grouping === 'none') {
		return tasks.length === 0 ? [] : [withProgress({ key: '', label: '', tasks: sortTasks(tasks) })];
	}

	const groups = new Map<string, Draft>();
	const add = (key: string, label: string, task: Task, link?: Draft['link']): void => {
		const group = groups.get(key);
		if (group === undefined) groups.set(key, { key, label, tasks: [task], link });
		else group.tasks.push(task);
	};

	// One outline map per note, not per task: a day's agenda is mostly one note.
	const outlines = new Map<string, ReadonlyMap<number, Task>>();
	const outlineOf = (path: string): ReadonlyMap<number, Task> => {
		let found = outlines.get(path);
		if (found === undefined) {
			found = outlineByLine(options.itemsOf(path));
			outlines.set(path, found);
		}
		return found;
	};

	for (const task of tasks) {
		if (grouping === 'note') add(task.path, task.path, task);
		else if (grouping === 'status') add(task.status, options.statusName(task.status), task);
		else if (grouping === 'project') {
			const project = resolveProject(task, outlineOf(task.path));
			if (project === null) add('', options.noProjectLabel, task);
			else {
				add(project.key, project.label, task, {
					target: project.target,
					sourcePath: project.sourcePath,
				});
			}
		} else if (task.tags.length === 0) add('', options.untaggedLabel, task);
		else for (const tag of task.tags) add(tag, tag, task);
	}

	const out = [...groups.values()];
	for (const group of out) group.tasks = sortTasks(group.tasks);
	out.sort(compareGroups);
	return out.map(withProgress);
}

/** A group before its progress pair is counted. */
type Draft = Omit<AgendaGroup, 'completed' | 'total'>;

/**
 * The progress pair every group header shows. Counted over the tasks the group
 * actually holds, so it always matches what is drawn under the title — and it
 * is counted here, once, rather than in each of the two views.
 */
function withProgress(group: Draft): AgendaGroup {
	const real = group.tasks.filter((task) => task.isTask);
	return {
		...group,
		completed: real.filter((task) => task.isCompleted).length,
		total: real.length,
	};
}

/** The catch-all group ("no tag", "no project") last, the rest alphabetically. */
function compareGroups(a: Draft, b: Draft): number {
	if (a.key === '' !== (b.key === '')) return a.key === '' ? 1 : -1;
	return a.label.localeCompare(b.label);
}

/**
 * Builds the minimal outline that contains every matched task: the tasks
 * themselves, their descendants that also matched, and the ancestors needed to
 * reach them — including the grouping list items without a checkbox, which are
 * the headings of the outline and the only thing that makes a weekly note
 * readable.
 *
 * @param items every list item of one note, in document order
 * @param matched the ones the agenda actually selected
 */
export function buildAgendaTree(items: readonly Task[], matched: readonly Task[]): AgendaNode[] {
	const keep = new Set<number>();
	for (const task of matched) {
		keep.add(task.line);
		for (const ancestor of task.ancestorLines) keep.add(ancestor);
	}

	const matchedLines = new Set(matched.map((task) => task.line));
	const nodes = new Map<number, AgendaNode>();
	for (const item of items) {
		if (!keep.has(item.line)) continue;
		nodes.set(item.line, { task: item, children: [], matched: matchedLines.has(item.line) });
	}

	const roots: AgendaNode[] = [];
	for (const item of items) {
		const node = nodes.get(item.line);
		if (node === undefined) continue;
		// An ancestor that was filtered out of `items` cannot hold the child, so
		// the child is promoted to a root rather than dropped.
		const parent = nearestKeptAncestor(item, nodes);
		if (parent === null) roots.push(node);
		else parent.children.push(node);
	}
	// A grouping node whose tasks all failed the filter has nothing to say.
	return roots.filter((node) => hasMatch(node));
}

function nearestKeptAncestor(
	item: Task,
	nodes: ReadonlyMap<number, AgendaNode>
): AgendaNode | null {
	for (const line of item.ancestorLines) {
		const node = nodes.get(line);
		if (node !== undefined) return node;
	}
	return null;
}

function hasMatch(node: AgendaNode): boolean {
	return node.matched || node.children.some(hasMatch);
}

/* ------------------------------------------------------------------ *
 * Detail: the notes hanging off a task
 * ------------------------------------------------------------------ */

/** One line of detail, with its depth relative to the task it belongs to. */
export interface DetailLine {
	task: Task;
	/** 0 for a direct child of the task. */
	depth: number;
}

/**
 * The lines that are **notes on a task** rather than structure.
 *
 * A list item without a checkbox is ambiguous by itself. Two things are written
 * that way and they want opposite treatment:
 *
 * ```markdown
 * - 🎯 [[censos-explora]]        ← a heading: it has tasks under it
 *   - [ ] Preparar PAD
 *     - Revisión de Codex        ← detail: nothing under it is a task
 *     - Guía a partir del PAD    ← detail
 * ```
 *
 * So the two are told apart **by what they contain**, not by how they are
 * written: a checkbox-less item whose subtree holds no task at all is detail.
 * Nothing new has to be typed, and the rule is computable from the outline the
 * index already has.
 *
 * Returned flat, in document order, because that is how a fold renders them —
 * and the whole subtree of a detail line is detail too, by construction: if it
 * held a task, the line would not be detail in the first place.
 *
 * @param items every list item of the note, in document order
 * @param line  the task whose detail is wanted
 */
export function detailLines(items: readonly Task[], line: number): DetailLine[] {
	const children = new Map<number, Task[]>();
	for (const item of items) {
		if (item.parentLine === null) continue;
		const bucket = children.get(item.parentLine);
		if (bucket === undefined) children.set(item.parentLine, [item]);
		else bucket.push(item);
	}

	const holdsTask = (item: Task): boolean => {
		if (item.isTask) return true;
		return (children.get(item.line) ?? []).some(holdsTask);
	};

	const out: DetailLine[] = [];
	const walk = (parent: number, depth: number): void => {
		for (const child of children.get(parent) ?? []) {
			if (holdsTask(child)) continue;
			out.push({ task: child, depth });
			walk(child.line, depth + 1);
		}
	};
	walk(line, 0);
	return out;
}

/* ------------------------------------------------------------------ *
 * What belongs to a day
 * ------------------------------------------------------------------ */

/**
 * The index queries a day's agenda needs. `TaskIndex` satisfies it
 * structurally, which is what keeps this file free of any `obsidian` import
 * and therefore unit-testable — the same trick `index/stats.ts` uses with
 * `StatTask`.
 */
export interface AgendaSource {
	coveringDate(date: string, granularities?: readonly PeriodicGranularity[]): Task[];
	byDate(date: string): Task[];
	all(): Task[];
	byTag(tag: string): Task[];
}

export interface AgendaQuery {
	/** ISO day. */
	date: string;
	/** Widen past the daily note to the week, month, quarter, semester and year. */
	widePeriods?: boolean;
	/** Intersect with the tasks carrying this tag. */
	tag?: string | null;
	hideCompleted?: boolean;
}

/** Only the daily note, unless the caller asks for the wider periods. */
const DAY_ONLY: readonly PeriodicGranularity[] = ['day'];

/**
 * Everything that belongs to one day, deduplicated by task id.
 *
 * Three sources are unioned — the periodic notes covering the day, the tasks
 * *attributed* to it, and the tasks due, scheduled or starting on it — and
 * nothing is rescanned: each one is a query the index already answers.
 *
 * It lives here rather than in the view because the agenda view is not the only
 * caller any more: `simple-tasks:today` on the command line has to give the
 * same answer, and a second implementation of "what is today" would drift.
 */
export function collectAgenda(source: AgendaSource, query: AgendaQuery): Task[] {
	const found = new Map<string, Task>();

	const scope = query.widePeriods === true ? undefined : DAY_ONLY;
	for (const task of source.coveringDate(query.date, scope)) found.set(task.id, task);
	for (const task of source.byDate(query.date)) found.set(task.id, task);

	// A task can be due today from anywhere in the vault, so this one really is a
	// pass over every task — over an array the index already holds, not the disk.
	for (const task of source.all()) {
		const { due, scheduled, start } = task.dates;
		if (due === query.date || scheduled === query.date || start === query.date) {
			found.set(task.id, task);
		}
	}

	const tag = query.tag ?? null;
	if (tag !== null) {
		const allowed = new Set(source.byTag(tag).map((task) => task.id));
		for (const id of [...found.keys()]) {
			if (!allowed.has(id)) found.delete(id);
		}
	}

	const tasks = [...found.values()];
	return query.hideCompleted === true ? tasks.filter((task) => !task.isCompleted) : tasks;
}

/** Every task in a forest, depth first, for counting and for the keyboard. */
export function flattenNodes(nodes: readonly AgendaNode[]): AgendaNode[] {
	const out: AgendaNode[] = [];
	const walk = (list: readonly AgendaNode[]): void => {
		for (const node of list) {
			out.push(node);
			walk(node.children);
		}
	};
	walk(nodes);
	return out;
}
