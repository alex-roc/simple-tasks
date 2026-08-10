import { Events } from 'obsidian';
import type { PeriodicGranularity, PeriodicRef } from '../domain/periodic.ts';
import type { Task, TaskNode } from '../domain/task.ts';

/**
 * In-memory index of every task in the vault, plus the grouping list items that
 * give them structure. The vault stays the source of truth: nothing here is
 * persisted, and every entry can be rebuilt from `metadataCache` alone.
 *
 * Queries are shaped for what the later phases need — a daily agenda, a
 * completion heatmap, a per-note outline and tag grouping — so the derived maps
 * are built once per change and reused, not recomputed per query.
 */

/** Everything the index knows about one note. */
export interface FileEntry {
	path: string;
	mtime: number;
	/** Every list item of the note in document order, tasks and grouping nodes. */
	items: Task[];
	/** Period the note covers, when it is a periodic note. */
	periodic: PeriodicRef | null;
}

export interface IndexStats {
	notes: number;
	/** Real tasks: list items carrying a checkbox. */
	tasks: number;
	/** Grouping list items: no checkbox, but they structure the outline. */
	groupingNodes: number;
	completed: number;
	/** Task count per status symbol. */
	byStatus: Record<string, number>;
	/** Milliseconds the last full scan took. */
	lastScanMs: number;
}

interface Derived {
	tasks: Task[];
	byStatus: Map<string, Task[]>;
	byTag: Map<string, Task[]>;
	byEffectiveDate: Map<string, Task[]>;
	byNoteStart: Map<string, Task[]>;
}

/** Event name fired after any set of files was added, replaced or removed. */
export const INDEX_CHANGED = 'changed';

export class TaskIndex extends Events {
	private readonly files = new Map<string, FileEntry>();
	private derived: Derived | null = null;
	private scanMs = 0;

	/* -------------------------------------------------- mutation */

	/** Replaces everything the index knows about one note. */
	setFile(entry: FileEntry): void {
		this.files.set(entry.path, entry);
		this.derived = null;
	}

	/** Forgets a note. Returns whether anything was actually removed. */
	removeFile(path: string): boolean {
		const removed = this.files.delete(path);
		if (removed) this.derived = null;
		return removed;
	}

	/** Forgets every note under a folder, for folder deletes and renames. */
	removeFolder(folder: string): string[] {
		const prefix = `${folder}/`;
		const removed: string[] = [];
		for (const path of this.files.keys()) {
			if (path === folder || path.startsWith(prefix)) removed.push(path);
		}
		for (const path of removed) this.files.delete(path);
		if (removed.length > 0) this.derived = null;
		return removed;
	}

	clear(): void {
		this.files.clear();
		this.derived = null;
	}

	/** Notifies listeners once, after a batch of changes. */
	notifyChanged(paths: readonly string[]): void {
		this.trigger(INDEX_CHANGED, [...paths]);
	}

	setScanDuration(ms: number): void {
		this.scanMs = ms;
	}

	/* -------------------------------------------------- derived state */

	private get view(): Derived {
		if (this.derived !== null) return this.derived;
		const tasks: Task[] = [];
		const byStatus = new Map<string, Task[]>();
		const byTag = new Map<string, Task[]>();
		const byEffectiveDate = new Map<string, Task[]>();
		const byNoteStart = new Map<string, Task[]>();

		for (const entry of this.files.values()) {
			for (const item of entry.items) {
				if (!item.isTask) continue;
				tasks.push(item);
				push(byStatus, item.status, item);
				for (const tag of item.tags) push(byTag, tag, item);
				if (item.effectiveDate !== null) push(byEffectiveDate, item.effectiveDate, item);
				if (entry.periodic !== null) push(byNoteStart, entry.periodic.start, item);
			}
		}
		this.derived = { tasks, byStatus, byTag, byEffectiveDate, byNoteStart };
		return this.derived;
	}

	/* -------------------------------------------------- queries */

	/** Every task in the vault, notes in insertion order, lines in document order. */
	all(): Task[] {
		return this.view.tasks;
	}

	/** Every list item, including the grouping nodes that carry no checkbox. */
	allItems(): Task[] {
		const out: Task[] = [];
		for (const entry of this.files.values()) out.push(...entry.items);
		return out;
	}

	/** Indexed notes, for callers that need to iterate files rather than tasks. */
	entries(): FileEntry[] {
		return [...this.files.values()];
	}

	paths(): string[] {
		return [...this.files.keys()];
	}

	hasFile(path: string): boolean {
		return this.files.has(path);
	}

	fileEntry(path: string): FileEntry | null {
		return this.files.get(path) ?? null;
	}

	/** Tasks of one note, in document order. */
	byFile(path: string): Task[] {
		return (this.files.get(path)?.items ?? []).filter((i) => i.isTask);
	}

	/** Tasks with a given status character. */
	byStatus(symbol: string): Task[] {
		return this.view.byStatus.get(symbol) ?? [];
	}

	/** Tasks whose status counts as completed. */
	completed(): Task[] {
		return this.view.tasks.filter((t) => t.isCompleted);
	}

	/** Tasks whose status does not count as completed. */
	open(): Task[] {
		return this.view.tasks.filter((t) => !t.isCompleted);
	}

	/**
	 * Tasks carrying a tag. Matching is case-insensitive and includes nested
	 * tags: `#lab` also returns `#lab/infra`.
	 */
	byTag(tag: string, options: { includeNested?: boolean } = {}): Task[] {
		const needle = (tag.startsWith('#') ? tag : `#${tag}`).toLowerCase();
		const exact = this.view.byTag.get(needle) ?? [];
		if (options.includeNested === false) return exact;
		const out = [...exact];
		const prefix = `${needle}/`;
		for (const [key, tasks] of this.view.byTag) {
			if (key.startsWith(prefix)) out.push(...tasks);
		}
		return out;
	}

	/** Every tag in the index with its task count, for tag grouping UIs. */
	tagCounts(): Map<string, number> {
		const out = new Map<string, number>();
		for (const [tag, tasks] of this.view.byTag) out.set(tag, tasks.length);
		return out;
	}

	/**
	 * Tasks attributed to a date: the done date when the line carries one,
	 * otherwise the date of the containing periodic note. This is the axis the
	 * heatmap uses.
	 */
	byDate(date: string): Task[] {
		return this.view.byEffectiveDate.get(date) ?? [];
	}

	/** Tasks attributed to any date in `[from, to]`, inclusive. */
	byDateRange(from: string, to: string): Task[] {
		const out: Task[] = [];
		for (const [date, tasks] of this.view.byEffectiveDate) {
			if (date >= from && date <= to) out.push(...tasks);
		}
		return out;
	}

	/**
	 * Tasks living in the periodic note that *starts* on this date — the day's
	 * daily note, or the week's weekly note when `date` is its first day.
	 */
	byNoteDate(date: string): Task[] {
		return this.view.byNoteStart.get(date) ?? [];
	}

	/**
	 * Tasks in any periodic note whose span covers this date, optionally limited
	 * to some granularities. This is what a daily agenda wants: the day's note
	 * plus the week, month, quarter, semester and year it falls in.
	 */
	coveringDate(date: string, granularities?: readonly PeriodicGranularity[]): Task[] {
		const wanted = granularities === undefined ? null : new Set(granularities);
		const out: Task[] = [];
		for (const entry of this.files.values()) {
			const period = entry.periodic;
			if (period === null) continue;
			if (wanted !== null && !wanted.has(period.granularity)) continue;
			if (date < period.start || date > period.end) continue;
			for (const item of entry.items) {
				if (item.isTask) out.push(item);
			}
		}
		return out;
	}

	/**
	 * The outline of a note as a forest, built from `ListItemCache.parent`.
	 * Grouping items without a checkbox are kept, because they are what titles
	 * the tasks nested under them.
	 */
	tree(path: string): TaskNode[] {
		const entry = this.files.get(path);
		if (entry === undefined) return [];
		const nodes = new Map<number, TaskNode>();
		for (const item of entry.items) nodes.set(item.line, { task: item, children: [] });
		const roots: TaskNode[] = [];
		for (const item of entry.items) {
			const node = nodes.get(item.line);
			if (node === undefined) continue;
			const parent = item.parentLine === null ? undefined : nodes.get(item.parentLine);
			if (parent === undefined) roots.push(node);
			else parent.children.push(node);
		}
		return roots;
	}

	/** The subtree rooted at one item, or `null` when the line is not indexed. */
	subtree(path: string, line: number): TaskNode | null {
		const found = findNode(this.tree(path), line);
		return found;
	}

	stats(): IndexStats {
		const byStatus: Record<string, number> = {};
		let tasks = 0;
		let groupingNodes = 0;
		let completed = 0;
		for (const entry of this.files.values()) {
			for (const item of entry.items) {
				if (!item.isTask) {
					groupingNodes += 1;
					continue;
				}
				tasks += 1;
				if (item.isCompleted) completed += 1;
				byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
			}
		}
		return {
			notes: this.files.size,
			tasks,
			groupingNodes,
			completed,
			byStatus,
			lastScanMs: this.scanMs,
		};
	}
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
	const bucket = map.get(key);
	if (bucket === undefined) map.set(key, [value]);
	else bucket.push(value);
}

function findNode(nodes: readonly TaskNode[], line: number): TaskNode | null {
	for (const node of nodes) {
		if (node.task.line === line) return node;
		const found = findNode(node.children, line);
		if (found !== null) return found;
	}
	return null;
}
