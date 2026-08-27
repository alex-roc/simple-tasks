/**
 * Everything the heatmap and the stats panel show, derived from the index.
 *
 * Two rules shape this file:
 *
 * - **No parallel source of truth.** Every number here is a fold over the tasks
 *   the index already holds; nothing is accumulated over time or stored.
 * - **Pure.** No `obsidian` import, no DOM, no `app` — so `node --test` runs it
 *   directly and the numbers can be asserted without opening the app.
 *
 * Cancelled (`[-]`) and rescheduled (`[>]`) do **not** count as completed. That
 * is the status catalog's decision (`isCompleted`), taken in phase 1, and this
 * file only reads it.
 */

import type { PeriodicGranularity, TaskPriority } from '../domain/task.ts';

/** The fields of a `Task` the stats need. A `Task` satisfies it structurally. */
export interface StatTask {
	isTask: boolean;
	isCompleted: boolean;
	noteGranularity: PeriodicGranularity | null;
	/** First day of the containing periodic note's period, or null. */
	noteDate: string | null;
	dates: { done?: string };
	priority: TaskPriority | null;
	tags: readonly string[];
}

export interface TagCount {
	tag: string;
	count: number;
}

export interface TaskStats {
	completedToday: number;
	completedYesterday: number;
	completedThisWeek: number;
	completedThisMonth: number;
	/** Every completion the index can attribute to a day. */
	completedTotal: number;
	/** Consecutive days with at least one completion, counting back from today. */
	currentStreak: number;
	bestStreak: number;
	/** Days with at least one completion. */
	activeDays: number;
	busiestDay: { date: string; count: number } | null;
	/** Completions per active day, one decimal. */
	perActiveDay: number;
	/** Most frequent tags among completed tasks. */
	topTags: TagCount[];
	xp: number;
	level: number;
	/** XP earned inside the current level. */
	xpIntoLevel: number;
	/** XP the current level spans, so a progress bar is `xpIntoLevel / xpForLevel`. */
	xpForLevel: number;
}

/**
 * XP per completed task, by priority. Weighted rather than flat so that
 * clearing a `🔺` matters more than ticking a trivium, and low enough at the top
 * that a single task cannot dominate a week.
 */
export const PRIORITY_XP: Readonly<Record<TaskPriority | 'none', number>> = {
	highest: 25,
	high: 15,
	medium: 10,
	none: 5,
	low: 3,
	lowest: 2,
};

/** Level `n` starts at `LEVEL_STEP * (n - 1)²`, so levels widen as they go. */
export const LEVEL_STEP = 100;

/* ------------------------------------------------------------------ *
 * ISO date arithmetic. UTC only: these are calendar days, not instants.
 * ------------------------------------------------------------------ */

function toUtc(date: string): number {
	const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
	return Date.UTC(year, month - 1, day);
}

function fromUtc(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

const DAY_MS = 86_400_000;

export function isoAddDays(date: string, days: number): string {
	return fromUtc(toUtc(date) + days * DAY_MS);
}

export function isoAddMonths(date: string, months: number): string {
	const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
	const target = new Date(Date.UTC(year, month - 1 + months, 1));
	// Clamp: three months before 31 May is 28/29 February, not 3 March.
	const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0));
	target.setUTCDate(Math.min(day, lastDay.getUTCDate()));
	return fromUtc(target.getTime());
}

/** Day of the week, 0 = Sunday, matching `moment.localeData().firstDayOfWeek()`. */
export function isoWeekday(date: string): number {
	return new Date(toUtc(date)).getUTCDay();
}

/** First day of the week `date` falls in, for a locale starting on `firstDay`. */
export function startOfWeek(date: string, firstDay: number): string {
	const offset = (isoWeekday(date) - firstDay + 7) % 7;
	return isoAddDays(date, -offset);
}

export function startOfMonth(date: string): string {
	return `${date.slice(0, 7)}-01`;
}

/* ------------------------------------------------------------------ *
 * Aggregation.
 * ------------------------------------------------------------------ */

/**
 * The day a completed task counts for, or `null` when there is no honest answer.
 *
 * Two attributions, in order, and **only** these two:
 *
 * 1. a completion date written on the line (`✅ 2026-01-31`) — the user's own
 *    statement about when it happened, and the only one that survives the task
 *    being edited, renamed or moved;
 * 2. the task living in **that day's own daily note**.
 *
 * Everything else is unknown, and unknown does not become today. A task in a
 * project note carries no date at all: the markdown does not say when it closed,
 * and no amount of watching the vault can recover a day that passed before the
 * plugin existed. It is left out of every per-day figure.
 *
 * This used to have a third source — a log in `data.json` recording the day the
 * plugin first *observed* each completion — and it was a mistake worth naming.
 * Observation is not evidence: a task that merely turns up already completed
 * (a note synced in, a line edited, a cache read that disagreed with the
 * metadata) got stamped with the current date, so opening an old project note
 * could file years of finished work onto a single day. The date must come from
 * the vault or not at all.
 *
 * A note coarser than a day is excluded on purpose: a completed task in a
 * *monthly* note would otherwise spike every first-of-month.
 */
export function completionDate(task: StatTask): string | null {
	if (!task.isTask || !task.isCompleted) return null;
	if (task.dates.done !== undefined) return task.dates.done;
	return ownDayDate(task);
}

/**
 * The day a task **lives in**, when it lives in that day's own daily note, and
 * `null` for everything else — a project note, or a note coarser than a day.
 *
 * This is what a day cell of the calendar counts as still open: the tasks written
 * in that day's note. A task's due date does not put it here, because a day cell
 * is about the note, not about promises made elsewhere.
 */
export function ownDayDate(task: StatTask): string | null {
	return task.noteGranularity === 'day' ? task.noteDate : null;
}

/** Completions per day, over the tasks a day can be named for. */
export function completionsByDate(tasks: readonly StatTask[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const task of tasks) {
		const date = completionDate(task);
		if (date === null) continue;
		out.set(date, (out.get(date) ?? 0) + 1);
	}
	return out;
}

/**
 * Consecutive active days ending today. A day with nothing done does not break
 * the streak until it is over: if today is still empty the count starts at
 * yesterday, the same forgiveness contribution graphs use.
 */
export function currentStreak(counts: ReadonlyMap<string, number>, today: string): number {
	let cursor = (counts.get(today) ?? 0) > 0 ? today : isoAddDays(today, -1);
	let streak = 0;
	while ((counts.get(cursor) ?? 0) > 0) {
		streak += 1;
		cursor = isoAddDays(cursor, -1);
	}
	return streak;
}

/** Longest run of consecutive active days anywhere in the record. */
export function bestStreak(counts: ReadonlyMap<string, number>): number {
	const days = [...counts.entries()]
		.filter(([, count]) => count > 0)
		.map(([date]) => date)
		.sort();
	let best = 0;
	let run = 0;
	let previous: string | null = null;
	for (const day of days) {
		run = previous !== null && isoAddDays(previous, 1) === day ? run + 1 : 1;
		if (run > best) best = run;
		previous = day;
	}
	return best;
}

export function xpOf(tasks: readonly StatTask[]): number {
	let xp = 0;
	for (const task of tasks) {
		if (!task.isTask || !task.isCompleted) continue;
		xp += PRIORITY_XP[task.priority ?? 'none'];
	}
	return xp;
}

export function levelOf(xp: number): { level: number; xpIntoLevel: number; xpForLevel: number } {
	const level = Math.floor(Math.sqrt(Math.max(xp, 0) / LEVEL_STEP)) + 1;
	const start = LEVEL_STEP * (level - 1) ** 2;
	const next = LEVEL_STEP * level ** 2;
	return { level, xpIntoLevel: xp - start, xpForLevel: next - start };
}

function topTagsOf(tasks: readonly StatTask[], limit: number): TagCount[] {
	const counts = new Map<string, number>();
	for (const task of tasks) {
		if (!task.isTask || !task.isCompleted) continue;
		for (const tag of task.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((a, b) => (b.count - a.count === 0 ? a.tag.localeCompare(b.tag) : b.count - a.count))
		.slice(0, limit);
}

export interface StatsOptions {
	/** Today, `YYYY-MM-DD`, in the user's own time zone. */
	today: string;
	/** `moment.localeData().firstDayOfWeek()`: 0 = Sunday, 1 = Monday. */
	firstDayOfWeek: number;
	/** How many tags the panel shows. */
	tagLimit?: number;
}

export function computeStats(
	tasks: readonly StatTask[],
	options: StatsOptions,
	precomputed?: ReadonlyMap<string, number>
): TaskStats {
	const counts = precomputed ?? completionsByDate(tasks);
	const weekStart = startOfWeek(options.today, options.firstDayOfWeek);
	const monthStart = startOfMonth(options.today);

	let completedTotal = 0;
	let completedThisWeek = 0;
	let completedThisMonth = 0;
	let activeDays = 0;
	let busiestDay: TaskStats['busiestDay'] = null;
	for (const [date, count] of counts) {
		completedTotal += count;
		if (count > 0) activeDays += 1;
		if (date >= weekStart && date <= options.today) completedThisWeek += count;
		if (date >= monthStart && date <= options.today) completedThisMonth += count;
		if (busiestDay === null || count > busiestDay.count) busiestDay = { date, count };
	}

	const xp = xpOf(tasks);
	return {
		completedToday: counts.get(options.today) ?? 0,
		completedYesterday: counts.get(isoAddDays(options.today, -1)) ?? 0,
		completedThisWeek,
		completedThisMonth,
		completedTotal,
		currentStreak: currentStreak(counts, options.today),
		bestStreak: bestStreak(counts),
		activeDays,
		busiestDay,
		perActiveDay: activeDays === 0 ? 0 : Math.round((completedTotal / activeDays) * 10) / 10,
		topTags: topTagsOf(tasks, options.tagLimit ?? 5),
		xp,
		...levelOf(xp),
	};
}

/**
 * Memoized {@link computeStats}.
 *
 * Both the stats and the per-day counts are a full pass over the index, and a
 * sidebar view would otherwise pay for them on every render — including the
 * renders caused by its own resize. The cache is invalidated by the index's
 * `changed` event, and by the clock rolling past midnight.
 */
export class StatsCache {
	private cached: {
		stats: TaskStats;
		counts: Map<string, number>;
		today: string;
	} | null = null;

	/**
	 * A plain field rather than a parameter property: `node --test` strips types
	 * without transforming, and parameter properties are real code.
	 */
	private readonly source: () => { tasks: readonly StatTask[]; options: StatsOptions };

	constructor(source: () => { tasks: readonly StatTask[]; options: StatsOptions }) {
		this.source = source;
	}

	invalidate(): void {
		this.cached = null;
	}

	get(): { stats: TaskStats; counts: Map<string, number> } {
		const { tasks, options } = this.source();
		if (this.cached !== null && this.cached.today === options.today) return this.cached;
		const counts = completionsByDate(tasks);
		this.cached = { stats: computeStats(tasks, options, counts), counts, today: options.today };
		return this.cached;
	}
}

/* ------------------------------------------------------------------ *
 * Heatmap calendar.
 * ------------------------------------------------------------------ */

export interface HeatmapDay {
	date: string;
	count: number;
	/** 0 (nothing) to 4 (at or above the density threshold). Drives the colour. */
	level: number;
}

export interface HeatmapWeek {
	/** Seven slots, week-start first. `null` pads the range's first and last week. */
	days: (HeatmapDay | null)[];
}

export interface HeatmapMonthLabel {
	/** Index into `weeks` of the column the label sits above. */
	column: number;
	/** 0-11, for the caller to format in the user's locale. */
	month: number;
	year: number;
}

export interface HeatmapCalendar {
	weeks: HeatmapWeek[];
	months: HeatmapMonthLabel[];
	from: string;
	to: string;
	/** Highest single-day count in range, for the legend. */
	peak: number;
}

/** Number of shades above zero. Four is what a contribution graph uses. */
export const HEATMAP_LEVELS = 4;

export interface HeatmapOptions {
	/** Last day shown, normally today. */
	endDate: string;
	/** How many months back the grid reaches. */
	months: number;
	firstDayOfWeek: number;
	counts: ReadonlyMap<string, number>;
	/** Completions a day needs to reach the darkest shade. */
	density: number;
}

/** The shade of a day, 0 when nothing was completed. */
export function levelFor(count: number, density: number): number {
	if (count <= 0) return 0;
	const step = Math.max(density, HEATMAP_LEVELS) / HEATMAP_LEVELS;
	return Math.min(HEATMAP_LEVELS, Math.max(1, Math.ceil(count / step)));
}

/**
 * Lays the range out as columns of weeks, the way a contribution graph does:
 * one column per week, seven rows, the first and last columns padded with
 * `null` so every real day sits on its own weekday row.
 */
export function buildHeatmapCalendar(options: HeatmapOptions): HeatmapCalendar {
	const to = options.endDate;
	const from = isoAddDays(isoAddMonths(to, -options.months), 1);
	const gridStart = startOfWeek(from, options.firstDayOfWeek);

	const weeks: HeatmapWeek[] = [];
	const months: HeatmapMonthLabel[] = [];
	let peak = 0;
	let labelledMonth = -1;

	for (let cursor = gridStart; cursor <= to; cursor = isoAddDays(cursor, 7)) {
		const days: (HeatmapDay | null)[] = [];
		let firstInRange: string | null = null;
		for (let offset = 0; offset < 7; offset += 1) {
			const date = isoAddDays(cursor, offset);
			if (date < from || date > to) {
				days.push(null);
				continue;
			}
			firstInRange ??= date;
			const count = options.counts.get(date) ?? 0;
			if (count > peak) peak = count;
			days.push({ date, count, level: levelFor(count, options.density) });
		}
		if (firstInRange !== null) {
			const month = Number(firstInRange.slice(5, 7)) - 1;
			// Label a column only when its month is new, and never in the sliver of
			// a first column that has fewer than four days of that month.
			if (month !== labelledMonth && Number(firstInRange.slice(8, 10)) <= 7) {
				months.push({ column: weeks.length, month, year: Number(firstInRange.slice(0, 4)) });
				labelledMonth = month;
			}
		}
		weeks.push({ days });
	}

	return { weeks, months, from, to, peak };
}
