import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	PRIORITY_XP,
	bestStreak,
	buildHeatmapCalendar,
	completionsByDate,
	completionsElsewhereByDate,
	computeStats,
	currentStreak,
	isDayPrecise,
	isoAddDays,
	isoAddMonths,
	levelFor,
	levelOf,
	startOfWeek,
} from './stats.ts';
import type { StatTask } from './stats.ts';

function done(date: string, extra: Partial<StatTask> = {}): StatTask {
	return {
		isTask: true,
		isCompleted: true,
		effectiveDate: date,
		noteGranularity: 'day',
		// The default is a task living in the daily note of its own date, which is
		// what makes `completionsElsewhereByDate` count nothing unless a test says so.
		noteDate: date,
		dates: {},
		priority: null,
		tags: [],
		...extra,
	};
}

describe('completionsElsewhereByDate', () => {
	it('counts nothing when every completion is in its own day note', () => {
		const counts = completionsElsewhereByDate([done('2026-08-12'), done('2026-08-12')]);
		assert.equal(counts.get('2026-08-12'), undefined);
	});

	it('counts a task completed in a project note, which the log dated', () => {
		// The case that reads as a contradiction in the interface: the daily note has
		// nothing done, and the day still says three completed.
		const counts = completionsElsewhereByDate([
			done('2026-08-12'),
			done('2026-08-12', { noteGranularity: null, noteDate: null }),
			done('2026-08-12', { noteGranularity: null, noteDate: null }),
		]);
		assert.equal(counts.get('2026-08-12'), 2);
	});

	it('counts a task carried into another day by its own done date', () => {
		// Written in the 11th's note, ticked with a ✅ of the 12th: it counts on the
		// 12th, and it is not the 12th's own note that holds it.
		const counts = completionsElsewhereByDate([
			done('2026-08-12', { noteDate: '2026-08-11', dates: { done: '2026-08-12' } }),
		]);
		assert.equal(counts.get('2026-08-12'), 1);
	});

	it('ignores what is not a completion and what has no day', () => {
		const counts = completionsElsewhereByDate([
			done('2026-08-12', { isCompleted: false, noteDate: null, noteGranularity: null }),
			done('2026-08-12', { noteGranularity: 'month', noteDate: '2026-08-01' }),
		]);
		assert.equal(counts.size, 0);
	});
});

describe('ISO arithmetic', () => {
	it('crosses months, years and leap days', () => {
		assert.equal(isoAddDays('2024-02-28', 1), '2024-02-29');
		assert.equal(isoAddDays('2025-12-31', 1), '2026-01-01');
		assert.equal(isoAddDays('2026-01-01', -1), '2025-12-31');
	});

	it('clamps the day when subtracting months', () => {
		assert.equal(isoAddMonths('2026-05-31', -3), '2026-02-28');
		assert.equal(isoAddMonths('2026-08-01', -12), '2025-08-01');
	});

	it('honours the locale week start', () => {
		// 2026-08-01 is a Saturday.
		assert.equal(startOfWeek('2026-08-01', 1), '2026-07-27');
		assert.equal(startOfWeek('2026-08-01', 0), '2026-07-26');
	});
});

describe('day precision', () => {
	it('accepts a date written on the line, a daily note and the completion log', () => {
		assert.equal(isDayPrecise(done('2026-01-05', { noteGranularity: 'day' })), true);
		assert.equal(isDayPrecise(done('2026-01-05', { noteGranularity: null })), true);
		assert.equal(
			isDayPrecise(done('2026-01-05', { noteGranularity: 'month', dates: { done: '2026-01-05' } })),
			true
		);
	});

	it('rejects a task dated only by its weekly or monthly note', () => {
		assert.equal(isDayPrecise(done('2026-01-01', { noteGranularity: 'month' })), false);
		assert.equal(isDayPrecise(done('2025-12-29', { noteGranularity: 'week' })), false);
	});

	it('keeps monthly notes from spiking the first of the month', () => {
		const tasks = [
			done('2026-01-01', { noteGranularity: 'month' }),
			done('2026-01-01', { noteGranularity: 'month' }),
			done('2026-01-01', { noteGranularity: 'day' }),
		];
		assert.deepEqual([...completionsByDate(tasks)], [['2026-01-01', 1]]);
	});
});

describe('streaks', () => {
	const counts = new Map([
		['2026-07-28', 1],
		['2026-07-29', 3],
		['2026-07-30', 2],
		['2026-08-01', 1],
	]);

	it('counts back from today', () => {
		assert.equal(currentStreak(counts, '2026-08-01'), 1);
		assert.equal(currentStreak(counts, '2026-07-30'), 3);
	});

	it('forgives a today that is still empty', () => {
		assert.equal(currentStreak(counts, '2026-07-31'), 3);
	});

	it('breaks after two empty days', () => {
		assert.equal(currentStreak(counts, '2026-08-03'), 0);
	});

	it('finds the longest run anywhere', () => {
		assert.equal(bestStreak(counts), 3);
		assert.equal(bestStreak(new Map()), 0);
	});
});

describe('xp and levels', () => {
	it('weights by priority and treats an unset priority as normal', () => {
		const tasks = [done('2026-08-01', { priority: 'highest' }), done('2026-08-01')];
		assert.equal(
			computeStats(tasks, { today: '2026-08-01', firstDayOfWeek: 1 }).xp,
			PRIORITY_XP.highest + PRIORITY_XP.none
		);
	});

	it('does not award xp for cancelled or rescheduled work', () => {
		const tasks = [done('2026-08-01', { isCompleted: false })];
		assert.equal(computeStats(tasks, { today: '2026-08-01', firstDayOfWeek: 1 }).xp, 0);
	});

	it('widens each level', () => {
		assert.deepEqual(levelOf(0), { level: 1, xpIntoLevel: 0, xpForLevel: 100 });
		assert.deepEqual(levelOf(100), { level: 2, xpIntoLevel: 0, xpForLevel: 300 });
		assert.deepEqual(levelOf(450), { level: 3, xpIntoLevel: 50, xpForLevel: 500 });
	});
});

describe('computeStats', () => {
	it('aggregates the windows a panel shows', () => {
		const tasks = [
			done('2026-08-01'),
			done('2026-08-01'),
			done('2026-07-31'),
			done('2026-07-20', { tags: ['#lab'] }),
			done('2026-06-30', { tags: ['#lab', '#casa'] }),
			// Not a completion: cancelled and rescheduled do not count.
			done('2026-08-01', { isCompleted: false }),
		];
		const stats = computeStats(tasks, { today: '2026-08-01', firstDayOfWeek: 1 });
		assert.equal(stats.completedToday, 2);
		assert.equal(stats.completedYesterday, 1);
		// The week of Monday 2026-07-27 through Saturday 2026-08-01.
		assert.equal(stats.completedThisWeek, 3);
		assert.equal(stats.completedThisMonth, 2);
		assert.equal(stats.completedTotal, 5);
		assert.equal(stats.currentStreak, 2);
		assert.equal(stats.activeDays, 4);
		assert.deepEqual(stats.busiestDay, { date: '2026-08-01', count: 2 });
		assert.deepEqual(stats.topTags, [
			{ tag: '#lab', count: 2 },
			{ tag: '#casa', count: 1 },
		]);
	});
});

describe('heatmap calendar', () => {
	const counts = new Map([['2026-08-01', 4]]);
	const calendar = buildHeatmapCalendar({
		endDate: '2026-08-01',
		months: 12,
		firstDayOfWeek: 1,
		counts,
		density: 8,
	});

	it('spans exactly a year, ending today', () => {
		assert.equal(calendar.from, '2025-08-02');
		assert.equal(calendar.to, '2026-08-01');
	});

	it('pads the first and last week so every day keeps its weekday row', () => {
		const first = calendar.weeks[0];
		assert.ok(first !== undefined);
		// 2025-08-02 is a Saturday: with a Monday start it is the sixth slot.
		assert.deepEqual(
			first.days.map((d) => d?.date ?? null),
			[null, null, null, null, null, '2025-08-02', '2025-08-03']
		);
		const days = calendar.weeks.flatMap((w) => w.days.filter((d) => d !== null));
		assert.equal(days.length, 365);
		assert.equal(days[days.length - 1]?.date, '2026-08-01');
	});

	it('labels each month once, above its first full column', () => {
		assert.equal(calendar.months.length, 12);
		const labels = calendar.months.map((m) => `${String(m.year)}-${String(m.month)}`);
		assert.equal(new Set(labels).size, 12);
	});

	it('reports the peak and shades against the density', () => {
		assert.equal(calendar.peak, 4);
		assert.equal(levelFor(0, 8), 0);
		assert.equal(levelFor(1, 8), 1);
		assert.equal(levelFor(4, 8), 2);
		assert.equal(levelFor(8, 8), 4);
		assert.equal(levelFor(80, 8), 4);
		// A density below the number of shades still produces four usable steps.
		assert.equal(levelFor(1, 2), 1);
		assert.equal(levelFor(4, 2), 4);
	});
});
