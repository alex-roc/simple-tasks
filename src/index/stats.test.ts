import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	PRIORITY_XP,
	bestStreak,
	buildHeatmapCalendar,
	completionDate,
	completionsByDate,
	computeStats,
	currentStreak,
	isoAddDays,
	isoAddMonths,
	levelFor,
	levelOf,
	ownDayDate,
	startOfWeek,
} from './stats.ts';
import type { StatTask } from './stats.ts';

/** A task completed in the daily note of `date`, the ordinary case. */
function done(date: string, extra: Partial<StatTask> = {}): StatTask {
	return {
		isTask: true,
		isCompleted: true,
		noteGranularity: 'day',
		noteDate: date,
		dates: {},
		priority: null,
		tags: [],
		...extra,
	};
}

/** A task in a note that is not periodic at all: a project note. */
function inProject(extra: Partial<StatTask> = {}): StatTask {
	return done('', { noteGranularity: null, noteDate: null, ...extra });
}

describe('completionDate', () => {
	it("takes the day of the task's own daily note", () => {
		assert.equal(completionDate(done('2026-08-12')), '2026-08-12');
	});

	it('prefers a completion date written on the line', () => {
		// Written in the 11th's note, ticked with a ✅ of the 12th.
		const task = done('2026-08-11', { dates: { done: '2026-08-12' } });
		assert.equal(completionDate(task), '2026-08-12');
		assert.equal(completionDate(inProject({ dates: { done: '2025-03-04' } })), '2025-03-04');
	});

	it('gives a project note no day at all', () => {
		// The regression this whole rule exists for. Such a task used to be dated by
		// the day the plugin happened to observe it, so opening an old project note
		// filed years of finished work onto that one day.
		assert.equal(completionDate(inProject()), null);
	});

	it('gives a note coarser than a day no day either', () => {
		assert.equal(completionDate(done('2026-08-01', { noteGranularity: 'month' })), null);
		assert.equal(completionDate(done('2025-12-29', { noteGranularity: 'week' })), null);
	});

	it('is null for anything that is not a completed task', () => {
		assert.equal(completionDate(done('2026-08-12', { isCompleted: false })), null);
		assert.equal(completionDate(done('2026-08-12', { isTask: false })), null);
	});
});

describe('ownDayDate', () => {
	it('is the day of the note, whether the task is done or open', () => {
		assert.equal(ownDayDate(done('2026-08-12', { isCompleted: false })), '2026-08-12');
		assert.equal(ownDayDate(done('2026-08-12')), '2026-08-12');
	});

	it('is null outside a daily note, a ✅ on the line notwithstanding', () => {
		assert.equal(ownDayDate(inProject({ dates: { done: '2025-03-04' } })), null);
		assert.equal(ownDayDate(done('2026-08-01', { noteGranularity: 'month' })), null);
	});
});

describe('completionsByDate', () => {
	it('counts only what a day can be named for', () => {
		const counts = completionsByDate([
			done('2026-08-12'),
			done('2026-08-12'),
			done('2026-08-12', { isCompleted: false }),
			inProject(),
			done('2026-08-01', { noteGranularity: 'month' }),
		]);
		assert.deepEqual([...counts], [['2026-08-12', 2]]);
	});

	it('keeps monthly notes from spiking the first of the month', () => {
		const tasks = [
			done('2026-01-01', { noteGranularity: 'month' }),
			done('2026-01-01', { noteGranularity: 'month' }),
			done('2026-01-01'),
		];
		assert.deepEqual([...completionsByDate(tasks)], [['2026-01-01', 1]]);
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
