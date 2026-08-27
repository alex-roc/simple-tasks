import { TFile, TFolder, debounce, getAllTags } from 'obsidian';
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

/**
 * Metadata changes are bursty (one per keystroke pause); coalesce them.
 *
 * Kept short on purpose. Everything downstream — the heatmap, the agenda, the
 * calendar's shading — only learns about a ticked checkbox when this flush lands,
 * and Obsidian's own delay in front of it (the editor buffer has to reach disk
 * before `metadataCache` fires at all) is already the larger half of the wait. A
 * full reindex of one note is a parse of one file; there is nothing to save here.
 */
const CHANGE_DEBOUNCE_MS = 200;

export class TaskIndexer {
	private periodic: PeriodicConfig = emptyPeriodicConfig();
	private templatePaths = new Set<string>();
	private readonly pending = new Set<string>();
	private readonly removed = new Set<string>();
	private started = false;

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
		private readonly settings: () => SimpleTasksSettings
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
		const files = this.app.vault.getMarkdownFiles();
		const touched: string[] = [];
		for (let i = 0; i < files.length; i += 1) {
			const file = files[i];
			if (file === undefined) continue;
			if (this.indexFile(file, await this.readIfNeeded(file))) touched.push(file.path);
			// Yield to the event loop between batches: 500+ notes must not block paint.
			if (i % SCAN_BATCH === SCAN_BATCH - 1) await nextTick();
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
				if (file instanceof TFile) this.pending.add(file.path);
				this.flush();
			})
		);
		this.plugin.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFolder) this.index.removeFolder(file.path);
				else this.removed.add(file.path);
				this.flush();
			})
		);
	}

	private async processPending(): Promise<void> {
		const touched: string[] = [];
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
			return false;
		}
		const cache = this.app.metadataCache.getFileCache(file);
		if (cache?.listItems === undefined) {
			this.index.removeFile(file.path);
			return false;
		}
		const periodic = resolvePeriodicNote(this.periodic, file.path);
		if (periodic?.granularity === 'semester') rememberSemesterFolder(this.periodic, file.path);

		const items = this.buildItems(file.path, content, cache, cache.listItems, periodic);
		const entry: FileEntry = { path: file.path, mtime: file.stat.mtime, items, periodic };
		this.index.setFile(entry);
		return true;
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
