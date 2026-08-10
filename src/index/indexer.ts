import { TFile, TFolder, debounce, getAllTags, moment } from 'obsidian';
import type { App, CachedMetadata, ListItemCache, Plugin } from 'obsidian';
import { parseLine } from '../domain/parse-line.ts';
import {
	emptyPeriodicConfig,
	loadPeriodicConfig,
	periodicNotePath,
	rememberSemesterFolder,
	resolvePeriodicNote,
} from '../domain/periodic.ts';
import type { PeriodicConfig, PeriodicGranularity, PeriodicLevel } from '../domain/periodic.ts';
import { resolveStatus } from '../domain/statuses.ts';
import type { ParsedLine, Task } from '../domain/task.ts';
import type { SimpleTasksSettings } from '../settings.ts';
import { completionKeys, detectCompletions, isKeyUnder, remapKeyPath } from './completion-log.ts';
import type { CompletionLog } from './completion-log.ts';
import { TaskIndex } from './task-index.ts';
import type { FileEntry } from './task-index.ts';

/**
 * Fills and maintains the {@link TaskIndex}.
 *
 * The hierarchy comes exclusively from `ListItemCache.parent`; indentation is
 * never counted. A list item without `task` is kept as a grouping node, because
 * in real outlines it is the heading of the tasks nested under it.
 */

/** Files handled per tick of the initial scan, so the UI never freezes. */
const SCAN_BATCH = 40;

/** Metadata changes are bursty (one per keystroke pause); coalesce them. */
const CHANGE_DEBOUNCE_MS = 400;

/** What the completion log needs from its host. */
export interface CompletionLogHost {
	log: CompletionLog;
	/** Called after the log gained or moved an entry, so it can be persisted. */
	onChanged: () => void;
	/**
	 * Tasks observed moving from open to completed in the notes of one flush,
	 * fired **after** the index has been updated so the receiver can read the
	 * new subtree. This is the same open→completed diff the log is fed from —
	 * there is deliberately no second detector — and it is what lets a checkbox
	 * ticked directly in the editor be celebrated, which no route through
	 * `actions/` ever sees.
	 */
	onCompleted?: (tasks: readonly Task[]) => void;
}

export class TaskIndexer {
	private periodic: PeriodicConfig = emptyPeriodicConfig();
	private templatePaths = new Set<string>();
	private readonly pending = new Set<string>();
	private readonly removed = new Set<string>();
	private started = false;

	/**
	 * Last seen `key → isCompleted` per note. This is how a completion is
	 * detected: not by watching the editor, but by diffing the note against what
	 * the index knew a moment ago.
	 *
	 * It covers **every** task, not only the ones the completion log can be
	 * responsible for. The log still records just its own — a task with a `✅` on
	 * the line or one living in a periodic note already has a better date — but
	 * the diff itself is also what tells the celebration a checkbox was ticked in
	 * the editor, and a daily note is exactly where that happens most.
	 */
	private readonly snapshot = new Map<string, Map<string, boolean>>();

	/**
	 * Transitions seen while indexing the notes of the current flush, held until
	 * the index has actually been updated. `trackCompletions` runs *before*
	 * `index.setFile`, so firing from there would hand the receiver the previous
	 * state of the note.
	 */
	private readonly completed: Task[] = [];

	/**
	 * True while the snapshot is being filled from scratch. Nothing is recorded
	 * then: on a cold start every completed task looks like it just happened, and
	 * the whole vault would be stamped with today's date.
	 */
	private seeding = false;

	private readonly flush = debounce(
		() => {
			void this.processPending();
		},
		CHANGE_DEBOUNCE_MS,
		true
	);

	constructor(
		private readonly app: App,
		private readonly plugin: Plugin,
		readonly index: TaskIndex,
		private readonly settings: () => SimpleTasksSettings,
		private readonly completions: CompletionLogHost
	) {}

	/**
	 * Loads the periodic-note configuration, does the initial scan and starts
	 * listening. Call from `workspace.onLayoutReady` so the scan never delays
	 * the app becoming usable.
	 */
	async start(): Promise<void> {
		await this.reloadPeriodicConfig();
		if (!this.started) {
			this.registerListeners();
			this.started = true;
		}
		await this.rebuild();
	}

	/** Rereads the vault's periodic-note configuration. */
	async reloadPeriodicConfig(): Promise<void> {
		const settings = this.settings();
		const setup = await loadPeriodicConfig({
			configDir: this.app.vault.configDir,
			read: async (path) => {
				if (!(await this.app.vault.adapter.exists(path))) return null;
				return this.app.vault.adapter.read(path);
			},
			semester: { folder: settings.semesterFolder, format: settings.semesterFormat },
		});
		this.periodic = setup.config;
		this.templatePaths = new Set(setup.templatePaths);
	}

	/** Full rescan. Cheap enough to be the answer to any settings change. */
	async rebuild(): Promise<void> {
		const started = performance.now();
		this.index.clear();
		this.snapshot.clear();
		this.completed.length = 0;
		this.seeding = true;
		const files = this.app.vault.getMarkdownFiles();
		const touched: string[] = [];
		try {
			for (let i = 0; i < files.length; i += 1) {
				const file = files[i];
				if (file === undefined) continue;
				if (this.indexFile(file, await this.readIfNeeded(file))) touched.push(file.path);
				// Yield to the event loop between batches: 500+ notes must not block paint.
				if (i % SCAN_BATCH === SCAN_BATCH - 1) await nextTick();
			}
		} finally {
			this.seeding = false;
		}
		this.index.setScanDuration(performance.now() - started);
		this.index.notifyChanged(touched);
	}

	/** Path of the periodic note for a date, for the views that link to one. */
	notePathFor(granularity: PeriodicGranularity, date: string): string | null {
		return periodicNotePath(this.periodic, granularity, date);
	}

	/**
	 * The vault's own configuration for one periodic level. Exposed because
	 * creating a note from its template needs the template path and the date
	 * format, and the indexer is the only thing that has read them.
	 */
	levelFor(granularity: PeriodicGranularity): PeriodicLevel {
		return this.periodic[granularity];
	}

	private async readIfNeeded(file: TFile): Promise<string | null> {
		if (this.isExcluded(file.path)) return null;
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache?.listItems === undefined || cache.listItems.length === 0) return null;
		return this.app.vault.cachedRead(file);
	}

	private registerListeners(): void {
		this.plugin.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				this.pending.add(file.path);
				this.flush();
			})
		);
		this.plugin.registerEvent(
			this.app.metadataCache.on('deleted', (file) => {
				this.removed.add(file.path);
				this.flush();
			})
		);
		// The metadata cache deliberately does not fire on rename, and folder
		// deletes only surface on the vault.
		this.plugin.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFolder) this.index.removeFolder(oldPath);
				else this.removed.add(oldPath);
				// Keys carry the note path, so a move has to be followed or the log
				// silently forgets everything the note ever completed.
				this.movePath(oldPath, file.path);
				if (file instanceof TFile) this.pending.add(file.path);
				this.flush();
			})
		);
		this.plugin.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFolder) this.index.removeFolder(file.path);
				else this.removed.add(file.path);
				this.dropPath(file.path);
				this.flush();
			})
		);
	}

	/** Follows a note or folder rename in the snapshot and in the log. */
	private movePath(from: string, to: string): void {
		for (const [path, entry] of [...this.snapshot]) {
			if (!isKeyUnder(path, from)) continue;
			this.snapshot.delete(path);
			this.snapshot.set(`${to}${path.slice(from.length)}`, remapKeys(entry, from, to));
		}
		if (this.completions.log.renamePath(from, to) > 0) this.completions.onChanged();
	}

	/** Forgets a deleted note or folder, so the log does not keep dead keys. */
	private dropPath(path: string): void {
		for (const known of [...this.snapshot.keys()]) {
			if (isKeyUnder(known, path)) this.snapshot.delete(known);
		}
		if (this.completions.log.forgetPath(path) > 0) this.completions.onChanged();
	}

	private async processPending(): Promise<void> {
		const touched: string[] = [];
		this.completed.length = 0;
		for (const path of this.removed) {
			if (this.index.removeFile(path)) touched.push(path);
		}
		this.removed.clear();

		for (const path of this.pending) {
			const file = this.app.vault.getFileByPath(path);
			if (file === null) {
				if (this.index.removeFile(path)) touched.push(path);
				continue;
			}
			this.indexFile(file, await this.readIfNeeded(file));
			touched.push(path);
		}
		this.pending.clear();

		if (touched.length > 0) this.index.notifyChanged(touched);
		// After the index is current, so the receiver sees the note as it now is.
		if (this.completed.length > 0) this.completions.onCompleted?.([...this.completed]);
		this.completed.length = 0;
	}

	private isExcluded(path: string): boolean {
		const settings = this.settings();
		if (settings.excludeTemplates && this.templatePaths.has(path)) return true;
		for (const folder of settings.excludedFolders) {
			if (path === folder || path.startsWith(`${folder}/`)) return true;
		}
		return false;
	}

	/**
	 * Indexes one note. `content` is `null` when the note has no list items or is
	 * excluded, in which case any previous entry is dropped. Returns whether the
	 * note ended up in the index.
	 */
	private indexFile(file: TFile, content: string | null): boolean {
		if (content === null) {
			this.index.removeFile(file.path);
			this.snapshot.delete(file.path);
			return false;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache?.listItems === undefined) {
			this.index.removeFile(file.path);
			this.snapshot.delete(file.path);
			return false;
		}
		const periodic = resolvePeriodicNote(this.periodic, file.path);
		if (periodic?.granularity === 'semester') rememberSemesterFolder(this.periodic, file.path);

		const items = this.buildItems(file.path, content, cache, cache.listItems, periodic);
		this.trackCompletions(file.path, items);

		const entry: FileEntry = { path: file.path, mtime: file.stat.mtime, items, periodic };
		this.index.setFile(entry);
		return true;
	}

	/**
	 * Diffs the note against the previous snapshot, records the completions the
	 * markdown does not date by itself, hands those dates back to the tasks as
	 * their `effectiveDate`, and collects the transitions worth celebrating.
	 *
	 * The **diff** covers every task; the **log** does not. Only tasks the log can
	 * be responsible for are recorded: one with a `✅` date on the line, or one
	 * living in a periodic note, already has a better date and is left alone.
	 * Widening the diff without widening the log is what lets the celebration see
	 * a checkbox ticked in a daily note — the commonest case there is — while
	 * `data.json` keeps storing exactly what it stored before.
	 *
	 * Nothing is collected while {@link seeding}, and `detectCompletions` returns
	 * nothing when the note has never been seen. Between them, the initial scan of
	 * a vault full of completed tasks is silent, which is the whole reason those
	 * two guards exist.
	 */
	private trackCompletions(path: string, items: readonly Task[]): void {
		const keys = completionKeys(items);
		const current = new Map<string, boolean>();
		/** The task behind each key, so a transition can name what transitioned. */
		const owner = new Map<string, Task>();
		for (const [i, item] of items.entries()) {
			const key = keys[i];
			if (key === undefined || key === null) continue;
			current.set(key, item.isCompleted);
			owner.set(key, item);
		}

		const { log } = this.completions;
		if (!this.seeding) {
			const previous = this.snapshot.get(path) ?? null;
			const { transitioned, appeared } = detectCompletions(previous, current);
			const today = moment().format('YYYY-MM-DD');
			let changed = false;
			// A real transition is dated today. A task that merely turned up already
			// completed is usually an old one whose text was edited into a new key,
			// so it only fills a gap — it never moves a date that already exists.
			for (const key of transitioned) {
				const task = owner.get(key);
				if (dateableByLog(task)) changed = log.record(key, today, true) || changed;
				if (task !== undefined) this.completed.push(task);
			}
			// `appeared` is not celebrated, on purpose. A task that simply turns up
			// already completed is a pasted line, a synced note or an old completion
			// under a new key after an edit — never a checkbox somebody just ticked.
			for (const key of appeared) {
				if (dateableByLog(owner.get(key))) changed = log.record(key, today, false) || changed;
			}
			if (changed) this.completions.onChanged();
		}

		if (current.size > 0) this.snapshot.set(path, current);
		else this.snapshot.delete(path);

		// Only completed tasks take a date from the log. The entry survives a task
		// being un-ticked — so re-completing it later is a real transition and gets
		// a fresh date — but an open task must not claim the old completion's day.
		for (const [i, item] of items.entries()) {
			if (item.effectiveDate !== null || !item.isCompleted) continue;
			const key = keys[i];
			if (key === undefined || key === null) continue;
			item.effectiveDate = log.get(key);
		}
	}

	private buildItems(
		path: string,
		content: string,
		cache: CachedMetadata,
		listItems: readonly ListItemCache[],
		periodic: FileEntry['periodic']
	): Task[] {
		const settings = this.settings();
		const noteTags = collectNoteTags(cache, listItems);
		const items = oneItemPerLine(listItems);

		// Line → position in `items`, so parents resolve in constant time.
		const byLine = new Map<number, number>();
		for (const [i, item] of items.entries()) byLine.set(item.position.start.line, i);

		const lines = items.map((item) => lineTextOf(content, item));
		const parsed: (ParsedLine | null)[] = lines.map((l) => {
			const result = parseLine(l.body);
			// Everything before the item's own marker is opaque prefix: usually
			// indentation, but on `- * Título` it is the outer list marker.
			return result === null ? null : { ...result, indent: l.prefix };
		});

		const parentOf = items.map((item) => resolveParentLine(item, byLine));
		const childLines: number[][] = items.map(() => []);
		for (const [i, item] of items.entries()) {
			const parentLine = parentOf[i];
			if (parentLine === null || parentLine === undefined) continue;
			const parentIndex = byLine.get(parentLine);
			if (parentIndex === undefined) continue;
			childLines[parentIndex]?.push(item.position.start.line);
		}

		const tasks: Task[] = [];
		for (const [i, item] of items.entries()) {
			const line = item.position.start.line;
			const raw = lines[i] ?? { prefix: '', body: '' };
			const parsedLine = parsed[i] ?? fallbackLine(raw.prefix, raw.body, item);
			const ancestorLines = ancestorsOf(i, items, parentOf, byLine);
			const inherited = settings.inheritTags
				? ancestorLines.flatMap((l) => {
						const index = byLine.get(l);
						return index === undefined ? [] : (parsed[index]?.tags ?? []);
					})
				: [];
			const isTask = item.task !== undefined;
			const status = item.task ?? '';
			const resolved = resolveStatus(settings.statuses, status);
			const doneDate = parsedLine.dates.done ?? null;

			tasks.push({
				...parsedLine,
				// `listItems` is authoritative about what is a task: the cache already
				// parsed the markdown, so the line regex never gets a second opinion.
				isTask,
				status,
				id: `${path}:${String(line)}`,
				path,
				line,
				parentLine: parentOf[i] ?? null,
				depth: ancestorLines.length,
				statusName: isTask ? resolved.name : '',
				isCompleted: isTask && resolved.isCompleted,
				childLines: childLines[i] ?? [],
				ancestorLines,
				ownTags: parsedLine.tags,
				noteTags,
				inheritedTags: inherited,
				tags: uniqueLower([...parsedLine.tags, ...noteTags, ...inherited]),
				noteDate: periodic?.start ?? null,
				noteGranularity: periodic?.granularity ?? null,
				effectiveDate: doneDate ?? periodic?.start ?? null,
			});
		}
		return tasks;
	}
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Whether the completion log is this task's only possible source of a date: it
 * carries no completion date of its own and lives outside every periodic note.
 *
 * The snapshot is wider than this — it diffs every task — so the argument is
 * optional: a key with no task behind it is nothing the log should record.
 */
function dateableByLog(item: Task | undefined): boolean {
	if (item === undefined) return false;
	return item.isTask && item.dates.done === undefined && item.noteGranularity === null;
}

/**
 * Rewrites the note path inside a snapshot's keys after a rename, using the
 * same path-segment comparison the log itself uses — a raw `startsWith` on the
 * whole key would drag `Notes2.md::…` along when the folder `Notes` is renamed.
 */
function remapKeys(
	entry: ReadonlyMap<string, boolean>,
	from: string,
	to: string
): Map<string, boolean> {
	const out = new Map<string, boolean>();
	for (const [key, completed] of entry) {
		out.set(remapKeyPath(key, from, to) ?? key, completed);
	}
	return out;
}

function nextTick(): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, 0);
	});
}

interface RawLine {
	/** Characters before the item's own list marker. */
	prefix: string;
	/** From the list marker to the end of the line. */
	body: string;
}

/**
 * Splits the item's line at its own list marker. The cached offsets are the
 * documented way in, with two adjustments: `start.offset` points at the marker,
 * so the line really starts `start.col` characters earlier (which preserves tabs
 * exactly as written), and a parent item's range can span its children, so
 * everything past the first newline is dropped.
 */
function lineTextOf(content: string, item: ListItemCache): RawLine {
	const start = item.position.start.offset;
	const lineStart = Math.max(start - item.position.start.col, 0);
	const raw = content.slice(start, item.position.end.offset);
	const newline = raw.indexOf('\n');
	return {
		prefix: content.slice(lineStart, start),
		body: newline === -1 ? raw : raw.slice(0, newline),
	};
}

/** Used when a line somehow does not look like a list item to the parser. */
function fallbackLine(prefix: string, body: string, item: ListItemCache): ParsedLine {
	return {
		indent: prefix,
		marker: '-',
		isTask: item.task !== undefined,
		status: item.task ?? '',
		text: body.trim(),
		cleanText: body.trim(),
		priority: null,
		dates: {},
		tags: [],
		links: [],
	};
}

/**
 * `ListItemCache.parent` is a **line number**, so the index has to be line-based
 * too — and markdown can put two list items on one line: `- * Dirección del Lab`
 * is a `-` item whose content is a `*` sublist, and the cache reports both, with
 * the inner one claiming `parent === its own line`.
 *
 * Keeping both would duplicate every root of every weekly note and make `parent`
 * ambiguous. So one item per line survives: the one carrying a checkbox if any,
 * otherwise the innermost, whose text is the real content. Nothing is lost — the
 * prefix from {@link lineTextOf} still rebuilds the line byte for byte.
 */
function oneItemPerLine(listItems: readonly ListItemCache[]): ListItemCache[] {
	const chosen = new Map<number, ListItemCache>();
	for (const item of listItems) {
		const line = item.position.start.line;
		const current = chosen.get(line);
		if (current === undefined) {
			chosen.set(line, item);
			continue;
		}
		const currentIsTask = current.task !== undefined;
		const itemIsTask = item.task !== undefined;
		if (currentIsTask !== itemIsTask) {
			if (itemIsTask) chosen.set(line, item);
			continue;
		}
		if (item.position.start.col > current.position.start.col) chosen.set(line, item);
	}
	return [...chosen.values()].sort((a, b) => a.position.start.line - b.position.start.line);
}

/**
 * Resolves the parent line. Three traps beyond the documented sign convention:
 * a list starting on line 0 makes a root item report `parent === 0`, an item
 * sharing a line with its parent reports its own line, and a parent line may not
 * be in the list at all. All three mean "root".
 */
function resolveParentLine(item: ListItemCache, byLine: Map<number, number>): number | null {
	const parent = item.parent;
	if (parent < 0) return null;
	if (parent === item.position.start.line) return null;
	return byLine.has(parent) ? parent : null;
}

function ancestorsOf(
	index: number,
	listItems: readonly ListItemCache[],
	parentOf: readonly (number | null)[],
	byLine: Map<number, number>
): number[] {
	const out: number[] = [];
	let cursor: number | undefined = index;
	const guard = new Set<number>();
	while (cursor !== undefined) {
		const item = listItems[cursor];
		if (item === undefined) break;
		if (guard.has(cursor)) break;
		guard.add(cursor);
		const parentLine = parentOf[cursor] ?? null;
		if (parentLine === null) break;
		out.push(parentLine);
		cursor = byLine.get(parentLine);
	}
	return out;
}

/**
 * Note-level tags: the frontmatter ones plus prose tags that live outside every
 * list item. `getAllTags` alone would hand each task every tag written anywhere
 * in the note, including on its siblings, which makes tag queries meaningless.
 */
function collectNoteTags(cache: CachedMetadata, listItems: readonly ListItemCache[]): string[] {
	const all = getAllTags(cache) ?? [];
	const inlineTags = cache.tags ?? [];
	const inlineSet = new Set(inlineTags.map((t) => t.tag));
	const frontmatterTags = all.filter((tag) => !inlineSet.has(tag));

	const itemRanges = listItems.map((item) => ({
		from: item.position.start.line,
		to: item.position.end.line,
	}));
	const prose = inlineTags
		.filter((tag) => {
			const line = tag.position.start.line;
			return !itemRanges.some((r) => line >= r.from && line <= r.to);
		})
		.map((tag) => tag.tag);

	return [...new Set([...frontmatterTags, ...prose])];
}

function uniqueLower(tags: readonly string[]): string[] {
	return [...new Set(tags.map((t) => t.toLowerCase()))];
}
