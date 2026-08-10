/**
 * The plugin's own record of *when* a task was completed.
 *
 * The plugin never writes a completion date into the user's markdown. A task's
 * date is resolved in this order:
 *
 * 1. a completion date already written on the line (`✅ 2026-01-31`);
 * 2. the date of the periodic note holding the task;
 * 3. this log — the only source for tasks that live outside periodic notes and
 *    carry no date of their own (`Atenas/…`), which would otherwise never reach
 *    the heatmap.
 *
 * Nothing here imports from `obsidian`, so it runs under `node --test`.
 *
 * ## Task identity
 *
 * The log outlives the session, so it needs a key that survives the task moving
 * up and down the note. Three candidates were on the table:
 *
 * - `path:line` — what `Task.id` uses. Useless here: inserting one line above a
 *   task silently re-points every key below it.
 * - `path` + the block reference (`^abc123`) when the line carries one. This is
 *   the user's own explicit identifier and survives *everything*, including a
 *   full rewrite of the text. Used whenever it is available.
 * - `path` + normalized text + an occurrence ordinal, otherwise. Survives the
 *   line moving, sibling edits and tag changes (tags are already stripped from
 *   `cleanText`). It does **not** survive editing the text itself, and it does
 *   not survive moving the task to another note.
 *
 * The consequences of the fallback are bounded on purpose: a lost key means the
 * task falls back to "no date", not a wrong date, and a re-keyed completed task
 * is recorded under {@link CompletionLog.record} with `overwrite: false`, so an
 * edit can add an entry but never move an existing one.
 */

/** Bumped only when the persisted shape changes incompatibly. */
export const COMPLETION_LOG_VERSION = 1;

/** Entries older than this are dropped, so `data.json` cannot grow forever. */
export const RETENTION_DAYS = 400;

/** Hard ceiling, newest kept, for a vault that completes far more than expected. */
export const MAX_ENTRIES = 5000;

/** Shape stored under the `completionLog` key of `data.json`. */
export interface CompletionLogData {
	version: number;
	/** Task key → ISO `YYYY-MM-DD` of the day the completion was observed. */
	entries: Record<string, string>;
}

/** The fields of a `Task` this module needs. Keeps the log usable from tests. */
export interface KeyableTask {
	path: string;
	isTask: boolean;
	/** `ParsedLine.cleanText`: tags stripped, whitespace collapsed. */
	cleanText: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** A trailing `^block-id`, the user's own stable handle on a line. */
const BLOCK_ID = /\s\^([A-Za-z0-9-]+)$/u;

/** Longest text kept in a key: enough to disambiguate, short enough to store. */
const MAX_KEY_TEXT = 120;

/** The block reference of a line, or `null` when it carries none. */
export function blockIdOf(text: string): string | null {
	return BLOCK_ID.exec(text.trimEnd())?.[1] ?? null;
}

/**
 * The part of a line that identifies it: case-folded, whitespace-collapsed and
 * without the block reference, which is keyed separately.
 */
export function normalizeTaskText(text: string): string {
	return text
		.replace(BLOCK_ID, '')
		.toLowerCase()
		.replace(/\s+/gu, ' ')
		.trim()
		.slice(0, MAX_KEY_TEXT);
}

/**
 * Keys for every item of **one note**, in document order: `null` for the
 * grouping items that carry no checkbox. The occurrence ordinal is what keeps
 * two identical lines in the same note apart.
 */
export function completionKeys(items: readonly KeyableTask[]): (string | null)[] {
	const seen = new Map<string, number>();
	return items.map((item) => {
		if (!item.isTask) return null;
		const block = blockIdOf(item.cleanText);
		if (block !== null) return `${item.path}::^${block}`;
		const text = normalizeTaskText(item.cleanText);
		const occurrence = seen.get(text) ?? 0;
		seen.set(text, occurrence + 1);
		return `${item.path}::${String(occurrence)}::${text}`;
	});
}

/**
 * The note path a key belongs to. Paths never contain `::` in practice.
 *
 * Exported because the snapshot the indexer keeps is keyed the same way, and
 * two different notions of "which note is this key about" is exactly how a
 * folder rename ends up half-followed.
 */
export function keyNotePath(key: string): string {
	const separator = key.indexOf('::');
	return separator === -1 ? key : key.slice(0, separator);
}

/** Whether a key belongs to `path`, or to a note inside it when it is a folder. */
export function isKeyUnder(key: string, path: string): boolean {
	const owner = keyNotePath(key);
	return owner === path || owner.startsWith(`${path}/`);
}

/**
 * The same key with its note path rewritten, or `null` when the key does not
 * belong under `from`.
 *
 * A plain `startsWith` on the whole key is not enough: renaming a folder called
 * `Notes` would also capture `Notes2.md::0::…`, which belongs to a different
 * note entirely. The comparison has to be on the path segment.
 */
export function remapKeyPath(key: string, from: string, to: string): string | null {
	if (!isKeyUnder(key, from)) return null;
	return `${to}${key.slice(from.length)}`;
}

/**
 * Where a moved subtree's completion entries have to end up.
 *
 * The key carries the note path, so moving a task to another note mints a
 * *different* key for the same task. Left alone, the indexer then sees a task
 * that "appeared already completed" and dates it today — a completion from 2025
 * lands on today's heatmap cell. The move is the only moment that knows both
 * halves of the identity, so it is the move that has to carry the entry across.
 *
 * `movedIndices` are positions in `sourceItems`, in document order.
 * `destinationItems` are the destination note's items **before** the insertion.
 *
 * The ordinal is the one weak spot, and it is the one already documented for
 * this key scheme: it counts same-text tasks that precede the task in its note.
 * Predicting it exactly would need the destination note as it will be *after*
 * the write; counting what is there now is exact whenever the block lands after
 * the identical lines already present (appending to the note, or to a heading
 * at its end), which is every destination this plugin offers. Keys built from a
 * block reference (`^abc`) carry no ordinal and are always exact.
 */
export interface KeyRelocation {
	/** Position in `sourceItems` of the task this relocation is for. */
	index: number;
	from: string;
	to: string;
}

export function relocateKeys(
	sourceItems: readonly KeyableTask[],
	movedIndices: readonly number[],
	destinationPath: string,
	destinationItems: readonly KeyableTask[]
): KeyRelocation[] {
	const sourceKeys = completionKeys(sourceItems);

	// Seed the ordinal counter with the destination as it stands today, so a
	// moved "Revisar" filed into a note that already has one becomes `::1::`.
	const seen = new Map<string, number>();
	for (const item of destinationItems) {
		if (!item.isTask || blockIdOf(item.cleanText) !== null) continue;
		const text = normalizeTaskText(item.cleanText);
		seen.set(text, (seen.get(text) ?? 0) + 1);
	}

	const out: KeyRelocation[] = [];
	for (const index of [...movedIndices].sort((a, b) => a - b)) {
		const item = sourceItems[index];
		const from = sourceKeys[index];
		if (item === undefined || from === undefined || from === null) continue;
		const block = blockIdOf(item.cleanText);
		let to: string;
		if (block !== null) {
			to = `${destinationPath}::^${block}`;
		} else {
			const text = normalizeTaskText(item.cleanText);
			const occurrence = seen.get(text) ?? 0;
			seen.set(text, occurrence + 1);
			to = `${destinationPath}::${String(occurrence)}::${text}`;
		}
		out.push({ index, from, to });
	}
	return out;
}

/** The extra facts {@link planCompletionTransfers} needs about a moved task. */
export interface RelocatableTask extends KeyableTask {
	isCompleted: boolean;
	/** A completion date written on the line itself, which travels with it. */
	dates: { done?: string };
	/** The date the task is attributed to before the move. */
	effectiveDate: string | null;
}

/** One completion entry on its way from one note's key to another's. */
export interface CompletionTransfer {
	from: string;
	to: string;
	date: string;
}

/**
 * Which log entries a move has to carry across, and with what date.
 *
 * Pure so the decision can be asserted without an app; `actions/move-task.ts`
 * is only the I/O that reads the index before the write and applies the result
 * after it. Three rules:
 *
 * - **Only completed tasks.** An open one has nothing to preserve.
 * - **Not the ones that date themselves.** A `✅ 2025-11-03` on the line moves
 *   with its own text; touching the log for it would create a second answer.
 * - **The date is the one the task already had**: its log entry when it has one,
 *   otherwise whatever it was attributed to — which is how a task leaving a
 *   *periodic* note keeps its day. That case has no entry at all today and is
 *   just as broken without this: with the note's date left behind and nothing
 *   recorded, the indexer stamps it today.
 */
export function planCompletionTransfers(
	sourceItems: readonly RelocatableTask[],
	movedIndices: readonly number[],
	destinationPath: string,
	destinationItems: readonly KeyableTask[],
	dateOf: (key: string) => string | null
): CompletionTransfer[] {
	const out: CompletionTransfer[] = [];
	for (const relocation of relocateKeys(
		sourceItems,
		movedIndices,
		destinationPath,
		destinationItems
	)) {
		const item = sourceItems[relocation.index];
		if (item === undefined || !item.isCompleted) continue;
		if (item.dates.done !== undefined) continue;
		if (relocation.from === relocation.to) continue;
		const date = dateOf(relocation.from) ?? item.effectiveDate;
		if (date === null) continue;
		out.push({ from: relocation.from, to: relocation.to, date });
	}
	return out;
}

/** What changed between two snapshots of the same note. */
export interface CompletionDiff {
	/** Keys that were known as open and are now completed: a real transition. */
	transitioned: string[];
	/** Keys that appear already completed. A new line — or a re-keyed old one. */
	appeared: string[];
}

/**
 * Compares two `key → isCompleted` snapshots of one note. `previous` is `null`
 * when the note had never been seen, in which case nothing is a transition:
 * every completed task would look like one, and the whole vault would be dated
 * on the day the plugin first ran.
 */
export function detectCompletions(
	previous: ReadonlyMap<string, boolean> | null,
	current: ReadonlyMap<string, boolean>
): CompletionDiff {
	const transitioned: string[] = [];
	const appeared: string[] = [];
	if (previous === null) return { transitioned, appeared };
	for (const [key, completed] of current) {
		if (!completed) continue;
		const before = previous.get(key);
		if (before === false) transitioned.push(key);
		else if (before === undefined) appeared.push(key);
	}
	return { transitioned, appeared };
}

/** ISO date `days` before `date`. Pure string arithmetic, no time zones. */
export function isoDaysBefore(date: string, days: number): string {
	const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
	const shifted = new Date(Date.UTC(year, month - 1, day - days));
	return shifted.toISOString().slice(0, 10);
}

/**
 * The persisted completion dates. Deliberately dumb: a string map plus the
 * pruning that keeps it bounded. Deciding *when* a task completed is the
 * indexer's job.
 */
export class CompletionLog {
	private readonly entries = new Map<string, string>();

	/** Tolerant on purpose: `data.json` may be old, partial or hand-edited. */
	static fromJSON(raw: unknown): CompletionLog {
		const log = new CompletionLog();
		log.load(raw);
		return log;
	}

	/** Replaces the contents with what was read from `data.json`. */
	load(raw: unknown): void {
		this.entries.clear();
		if (typeof raw !== 'object' || raw === null) return;
		const entries = (raw as Partial<CompletionLogData>).entries;
		if (typeof entries !== 'object' || entries === null) return;
		for (const [key, value] of Object.entries(entries)) {
			if (typeof value === 'string' && ISO_DATE.test(value)) this.entries.set(key, value);
		}
	}

	toJSON(): CompletionLogData {
		return { version: COMPLETION_LOG_VERSION, entries: Object.fromEntries(this.entries) };
	}

	get size(): number {
		return this.entries.size;
	}

	get(key: string): string | null {
		return this.entries.get(key) ?? null;
	}

	/**
	 * Records a completion date. Returns whether anything changed, so the caller
	 * only persists when it has to.
	 *
	 * `overwrite` is `true` for an observed transition (the task really was
	 * completed again today) and `false` for a task that merely showed up already
	 * completed — that is usually the same old completion under a new key after
	 * an edit, and moving its date to today would be a lie.
	 */
	record(key: string, date: string, overwrite: boolean): boolean {
		if (!ISO_DATE.test(date)) return false;
		const existing = this.entries.get(key);
		if (existing === date) return false;
		if (existing !== undefined && !overwrite) return false;
		this.entries.set(key, date);
		return true;
	}

	forget(key: string): boolean {
		return this.entries.delete(key);
	}

	/** Drops every entry of a note, and of everything under it when it is a folder. */
	forgetPath(path: string): number {
		let removed = 0;
		for (const key of [...this.entries.keys()]) {
			if (isKeyUnder(key, path)) {
				this.entries.delete(key);
				removed += 1;
			}
		}
		return removed;
	}

	/**
	 * Follows a note or folder rename, so a move does not erase its history.
	 *
	 * The indexer calls this from `vault.on('rename')`, which fires *before* the
	 * renamed note is re-indexed, so the entry is already sitting under the new
	 * path when the diff runs and the task is never seen as "appeared already
	 * completed". That is why a rename needs nothing from `move-task`.
	 */
	renamePath(from: string, to: string): number {
		let moved = 0;
		for (const [key, date] of [...this.entries]) {
			const renamed = remapKeyPath(key, from, to);
			if (renamed === null) continue;
			this.entries.delete(key);
			this.entries.set(renamed, date);
			moved += 1;
		}
		return moved;
	}

	/**
	 * Drops entries older than `RETENTION_DAYS` before `today`, then trims the
	 * oldest until at most `MAX_ENTRIES` remain. Returns how many were removed.
	 */
	prune(today: string): number {
		const cutoff = isoDaysBefore(today, RETENTION_DAYS);
		let removed = 0;
		for (const [key, date] of [...this.entries]) {
			if (date < cutoff) {
				this.entries.delete(key);
				removed += 1;
			}
		}
		if (this.entries.size <= MAX_ENTRIES) return removed;
		const sorted = [...this.entries].sort((a, b) => (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
		for (const [key] of sorted.slice(0, this.entries.size - MAX_ENTRIES)) {
			this.entries.delete(key);
			removed += 1;
		}
		return removed;
	}
}
