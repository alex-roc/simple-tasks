import { Notice, TFile } from 'obsidian';
import type { PeriodicGranularity } from '../domain/periodic.ts';
import {
	cutRange,
	insertBlock,
	locateTaskLine,
	planBulkMove,
	reindentBlock,
	subtreeRange,
} from '../domain/subtree.ts';
import type { Task, TaskNode } from '../domain/task.ts';
import { planCompletionTransfers } from '../index/completion-log.ts';
import type { CompletionTransfer } from '../index/completion-log.ts';
import { t, tCount } from '../i18n/index.ts';
import type SimpleTasksPlugin from '../main.ts';
import { ensureNote } from './ensure-note.ts';

/**
 * Moving a task, **with its whole subtree**, to another note, heading or date.
 *
 * This is the operation that can destroy a note, so the shape of it is worth
 * reading before changing anything.
 *
 * ## What moves
 *
 * The root line plus every descendant the index knows — including the list
 * items that carry no checkbox, which are grouping nodes and part of the tree —
 * plus the continuation lines that hang off them (a wrapped paragraph, an
 * indented code block). Boundaries come from `ListItemCache.parent` via the
 * index, never from counting indentation; indentation only decides whether a
 * *non-list* line belongs. All of that lives in `domain/subtree.ts` and is unit
 * tested there.
 *
 * ## Order of operations
 *
 * 1. **Create the destination first.** A missing note or heading is created
 *    before a single character is removed from the source, so a failure there
 *    cannot leave the task nowhere.
 * 2. **Cut inside `vault.process`.** The block that gets removed is the block
 *    read in that same atomic callback, not the one the index remembers — the
 *    index is debounced and may be a keystroke behind.
 * 3. **Insert, and roll the cut back if it throws.** The window between the two
 *    writes is the only risk, and it is covered.
 *
 * When source and destination are the same note the whole thing collapses into
 * a single `vault.process`, which is both safer and the common case for
 * reordering inside a daily note.
 *
 * ## The completion log travels with the task
 *
 * A completion key carries the note path, so a cross-note move mints a new key
 * for the same task and the indexer, seeing a task that "appeared already
 * completed", would date it **today** — a completion from 2025 landing on
 * today's heatmap cell. The move is the only moment that knows both halves of
 * that identity, so it carries the entries across itself, for the whole subtree
 * and before the index catches up. See {@link planCompletionTransfer}.
 */

export interface MoveDestination {
	/** Vault-relative path of the destination note. */
	path: string;
	/** Heading to file the subtree under. `null` appends at the end of the note. */
	heading?: string | null;
	/** Level used if the heading has to be created. */
	headingLevel?: number;
	/**
	 * Date of the destination note when it is a periodic one, so it can be
	 * created from its template.
	 */
	date?: string;
	granularity?: PeriodicGranularity;
}

export interface MoveResult {
	/** Destination path. */
	path: string;
	/** Line the subtree landed on. */
	line: number;
	/** Lines moved, including the continuations. */
	lines: number;
}

/**
 * How a move reports itself.
 *
 * A single move announces what it did and explains what it could not do. A move
 * that is one of many says nothing at all: a selection of eight tasks produced
 * eight stacked notices, which is not feedback but an obstruction. The batch in
 * {@link moveTasks} announces the whole thing once instead.
 */
export interface MoveOptions {
	silent?: boolean;
}

/** Moves a task and its subtree. Returns `null` when nothing was written. */
export async function moveTask(
	plugin: SimpleTasksPlugin,
	task: Task,
	destination: MoveDestination,
	options: MoveOptions = {}
): Promise<MoveResult | null> {
	const { vault } = plugin.app;
	const notify = (key: Parameters<typeof t>[0], params?: Record<string, string>): void => {
		if (options.silent !== true) new Notice(t(key, params));
	};
	const source = vault.getFileByPath(task.path);
	if (!(source instanceof TFile)) {
		notify('action.noFile', { path: task.path });
		return null;
	}

	// Step 1: the destination exists before anything is removed.
	const target = await ensureNote(plugin, destination);
	if (target === null) return null;

	const heading = destination.heading ?? null;
	const headingLevel = destination.headingLevel ?? 2;
	const sameFile = target.path === source.path;

	if (sameFile) {
		return moveWithinNote(plugin, task, target, { heading, headingLevel }, options);
	}

	// Planned before anything is written: it reads the index, which still
	// describes both notes as they are at this instant.
	const completions = planCompletionTransfer(plugin, task, target.path);

	// Step 2: cut, atomically, from whatever the note says right now.
	const cut = await cutSubtree(plugin, source, task);
	if (cut === null) {
		notify('action.notFound');
		return null;
	}

	// Step 3: insert, and put the block back if the destination refuses it.
	try {
		const result = await insertIntoNote(plugin, target, cut.block, { heading, headingLevel });
		applyCompletionTransfer(plugin, completions);
		if (options.silent !== true) announce(result);
		return result;
	} catch (error) {
		await restoreSubtree(plugin, source, cut);
		// Not silenced even in a batch: a rollback is the one thing the user has to
		// hear about, whether it happened on its own or as one of eight.
		new Notice(t('action.moveFailed'));
		throw error;
	}
}

/** Moves a task into the periodic note of a date, creating it from its template. */
export async function moveTaskToDate(
	plugin: SimpleTasksPlugin,
	task: Task,
	date: string,
	granularity: PeriodicGranularity = 'day',
	options: MoveOptions = {}
): Promise<MoveResult | null> {
	const path = plugin.periodicNotePath(granularity, date);
	if (path === null) {
		if (options.silent !== true) new Notice(t('action.notPeriodic'));
		return null;
	}
	if (path === task.path) {
		if (options.silent !== true) new Notice(t('action.sameDestination'));
		return null;
	}
	return moveTask(
		plugin,
		task,
		{
			path,
			heading: emptyToNull(plugin.settings.moveHeading),
			date,
			granularity,
		},
		options
	);
}

/* ------------------------------------------------------------------ *
 * Several tasks at once
 * ------------------------------------------------------------------ */

export interface BulkMoveResult {
	/** Tasks whose subtree really landed in the destination. */
	moved: number;
	/**
	 * Tasks the batch did not move. Either they were already there, or they were
	 * dropped as descendants of another selected task, or the note changed under
	 * the batch and the line could no longer be identified — see
	 * `domain/subtree.ts:locateTaskLine()`, which refuses to guess.
	 */
	skipped: number;
}

/**
 * Moves a whole selection to one destination.
 *
 * **Sequentially, never in parallel.** Every move is a read-modify-write of a
 * note, and two of them running at once on the same note is a lost update; the
 * loop is what makes the batch as safe as the single move it is built from. The
 * order comes from `planBulkMove`, which also drops a task selected together
 * with one of its ancestors — see that function for both reasons.
 *
 * A failure is per task, not per batch: one task whose line can no longer be
 * identified is counted as skipped and the rest still move. A rollback — the one
 * case where a note was left in an unexpected state — still throws, because at
 * that point the batch has stopped being something the user can reason about.
 */
export async function moveTasks(
	plugin: SimpleTasksPlugin,
	tasks: readonly Task[],
	destination: MoveDestination
): Promise<BulkMoveResult> {
	const plan = planBulkMove(tasks);
	let moved = 0;
	for (const task of plan) {
		const result = await moveTask(plugin, task, destination, { silent: true });
		if (result !== null) moved += 1;
	}
	announceBulk(moved, tasks.length, destination.path);
	return { moved, skipped: tasks.length - moved };
}

/** {@link moveTasks} into the periodic note of a date. */
export async function moveTasksToDate(
	plugin: SimpleTasksPlugin,
	tasks: readonly Task[],
	date: string,
	granularity: PeriodicGranularity = 'day'
): Promise<BulkMoveResult> {
	const path = plugin.periodicNotePath(granularity, date);
	if (path === null) {
		new Notice(t('action.notPeriodic'));
		return { moved: 0, skipped: tasks.length };
	}
	const plan = planBulkMove(tasks);
	let moved = 0;
	for (const task of plan) {
		const result = await moveTaskToDate(plugin, task, date, granularity, { silent: true });
		if (result !== null) moved += 1;
	}
	announceBulk(moved, tasks.length, path);
	return { moved, skipped: tasks.length - moved };
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

interface Placement {
	heading: string | null;
	headingLevel: number;
}

/** A subtree that has been removed from its note, and where it came from. */
interface Cut {
	at: number;
	block: string[];
}

/**
 * Removes the subtree and hands it back. Wrapped in its own function so the
 * result crosses a `Promise` boundary with a declared type: a `let` assigned
 * inside a `vault.process` callback is narrowed to `never` by the compiler,
 * which is correct for it and useless for us.
 */
async function cutSubtree(
	plugin: SimpleTasksPlugin,
	file: TFile,
	task: Task
): Promise<Cut | null> {
	let cut: Cut | null = null;
	await plugin.app.vault.process(file, (data) => {
		const lines = data.split('\n');
		const range = rangeOf(plugin, task, lines);
		if (range === null) return data;
		const removed = cutRange(lines, range);
		cut = { at: range.start, block: removed.block };
		return removed.remaining.join('\n');
	});
	return cut;
}

/** Undoes a {@link cutSubtree} when the insertion could not be completed. */
async function restoreSubtree(
	plugin: SimpleTasksPlugin,
	file: TFile,
	cut: Cut
): Promise<void> {
	await plugin.app.vault.process(file, (data) => {
		const lines = data.split('\n');
		lines.splice(Math.min(cut.at, lines.length), 0, ...cut.block);
		return lines.join('\n');
	});
}

/**
 * Source and destination are the same note, so cut and insert have to happen in
 * one atomic pass: doing them as two `vault.process` calls would let an editor
 * write land in between and shift every line number.
 */
async function moveWithinNote(
	plugin: SimpleTasksPlugin,
	task: Task,
	file: TFile,
	placement: Placement,
	options: MoveOptions
): Promise<MoveResult | null> {
	let result: MoveResult | null = null;
	await plugin.app.vault.process(file, (data) => {
		const lines = data.split('\n');
		const range = rangeOf(plugin, task, lines);
		if (range === null) return data;
		const cut = cutRange(lines, range);
		const block = reindentBlock(cut.block, DESTINATION_INDENT);
		const inserted = insertBlock(cut.remaining, block, placement);
		result = { path: file.path, line: inserted.insertedAt, lines: block.length };
		return inserted.lines.join('\n');
	});
	if (result === null) {
		if (options.silent !== true) new Notice(t('action.notFound'));
		return null;
	}
	if (options.silent !== true) announce(result);
	return result;
}

async function insertIntoNote(
	plugin: SimpleTasksPlugin,
	file: TFile,
	block: readonly string[],
	placement: Placement
): Promise<MoveResult> {
	const reindented = reindentBlock(block, DESTINATION_INDENT);
	let line = 0;
	await plugin.app.vault.process(file, (data) => {
		const inserted = insertBlock(data.split('\n'), reindented, placement);
		line = inserted.insertedAt;
		return inserted.lines.join('\n');
	});
	return { path: file.path, line, lines: reindented.length };
}

/**
 * Destinations are always a note or a heading, so the subtree lands at the top
 * level of the destination outline. Named rather than inlined because nesting
 * under another task is the obvious next destination, and this is the only
 * value that would have to change for it.
 */
const DESTINATION_INDENT = '';

/**
 * The lines to move, resolved against the content being written. The index
 * supplies the shape of the tree; the content supplies the truth about where it
 * currently sits.
 */
function rangeOf(
	plugin: SimpleTasksPlugin,
	task: Task,
	lines: readonly string[]
): { start: number; end: number } | null {
	const at = locateTaskLine(lines, task.line, task.text, task.indent);
	if (at === null) return null;
	const entry = plugin.index.fileEntry(task.path);
	const items = entry?.items ?? [];
	const shift = at - task.line;
	const itemLines = new Set(items.map((item) => item.line + shift));
	const descendants = new Set(descendantLines(plugin, task).map((line) => line + shift));
	return subtreeRange(lines, at, descendants, itemLines);
}

/* ------------------------------------------------------------------ *
 * The completion log
 * ------------------------------------------------------------------ */

/**
 * The completion entries the subtree has to take with it.
 *
 * All this does is feed the index to {@link planCompletionTransfers}, which
 * holds the decision and is unit-tested without an app. It reads the index
 * *before* the write, while it still describes both notes.
 *
 * A same-note move is skipped outright: the key does not mention the line, so
 * reordering inside a note does not change it.
 */
function planCompletionTransfer(
	plugin: SimpleTasksPlugin,
	task: Task,
	destinationPath: string
): CompletionTransfer[] {
	if (destinationPath === task.path) return [];
	const entry = plugin.index.fileEntry(task.path);
	if (entry === null) return [];

	const movedLines = new Set([task.line, ...descendantLines(plugin, task)]);
	const movedIndices: number[] = [];
	for (const [i, item] of entry.items.entries()) {
		if (movedLines.has(item.line)) movedIndices.push(i);
	}

	return planCompletionTransfers(
		entry.items,
		movedIndices,
		destinationPath,
		plugin.index.fileEntry(destinationPath)?.items ?? [],
		(key) => plugin.completionLog.get(key)
	);
}

/**
 * Writes the planned entries, once the subtree is really in its new note.
 *
 * `overwrite: true` on purpose: whatever the destination key held was a guess
 * made by the "appeared already completed" rule, and this is the one caller
 * that actually knows. Running before the debounced reindex is what stops that
 * rule from ever seeing the task as new.
 */
function applyCompletionTransfer(
	plugin: SimpleTasksPlugin,
	moves: readonly CompletionTransfer[]
): void {
	if (moves.length === 0) return;
	const log = plugin.completionLog;
	let changed = false;
	for (const move of moves) {
		if (log.record(move.to, move.date, true)) changed = true;
		if (log.forget(move.from)) changed = true;
	}
	if (changed) plugin.markCompletionLogChanged();
}

/** Every line below a task in the outline, from the index's own tree. */
export function descendantLines(plugin: SimpleTasksPlugin, task: Task): number[] {
	const node = plugin.index.subtree(task.path, task.line);
	if (node === null) return [];
	const out: number[] = [];
	const walk = (children: readonly TaskNode[]): void => {
		for (const child of children) {
			out.push(child.task.line);
			walk(child.children);
		}
	};
	walk(node.children);
	return out;
}

function emptyToNull(value: string): string | null {
	return value.trim() === '' ? null : value.trim();
}

function announce(result: MoveResult): void {
	new Notice(
		t('action.moved', {
			count: tCount('action.movedLines', result.lines),
			path: result.path,
		})
	);
}

/**
 * One notice for a whole batch, which says how many of the selection actually
 * moved. The difference is the interesting part: a silent "3 moved" out of five
 * selected is how a user ends up believing a task went somewhere it did not.
 */
function announceBulk(moved: number, selected: number, path: string): void {
	if (moved === 0) {
		new Notice(t('action.movedNone'));
		return;
	}
	const skipped = selected - moved;
	const message = t('action.movedTasks', {
		count: tCount('action.taskCount', moved),
		path,
	});
	new Notice(
		skipped > 0 ? `${message} ${t('action.movedSkipped', { count: skipped })}` : message
	);
}
