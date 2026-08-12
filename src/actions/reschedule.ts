import { moment } from 'obsidian';
import type { Task, TaskDates } from '../domain/task.ts';
import type SimpleTasksPlugin from '../main.ts';
import { rewriteTaskLine } from './edit-task.ts';

/**
 * Reprogramming a task by rewriting the date on its line — as opposed to
 * `move-task.ts`, which physically relocates it into another note.
 *
 * The two are genuinely different operations and both are offered: a task in a
 * project note gets a due date, a task in a daily note gets moved to another
 * day. Confusing them is how a plugin ends up scattering a project's tasks over
 * the calendar.
 */

/** Date fields a user can reschedule. `done` and `cancelled` are not ours to set. */
export type ReschedulableField = Extract<keyof TaskDates, 'due' | 'scheduled' | 'start'>;

export const RESCHEDULABLE_FIELDS: readonly ReschedulableField[] = ['due', 'scheduled', 'start'];

/**
 * Writes `date` into one date field, or removes it when `date` is `null`.
 * The field defaults to whatever the settings say the popover should write.
 */
export async function rescheduleTask(
	plugin: SimpleTasksPlugin,
	task: Task,
	date: string | null,
	field: ReschedulableField = plugin.settings.rescheduleField
): Promise<boolean> {
	return rewriteTaskLine(plugin, task, (line) => {
		const dates = { ...line.dates };
		if (date === null) delete dates[field];
		else dates[field] = date;
		return { ...line, dates };
	});
}

/** `YYYY-MM-DD` for today plus `days`. The one place the offset is computed. */
export function relativeDate(days: number): string {
	return moment().add(days, 'days').format('YYYY-MM-DD');
}

/**
 * The day a **move** is measured from: the date of the daily note the task lives
 * in, or today for a task that lives anywhere else.
 *
 * This is what "tomorrow" means for a task, and it is deliberately not today.
 * The gesture it exists for is reviewing a day that has passed: standing in
 * yesterday's note and pushing an unfinished task to the next day has to land in
 * today's note, not the day after today. Measuring from the clock skipped a day
 * every time and quietly put the task where nobody was looking.
 *
 * Only the **daily** level anchors: a task in a weekly or monthly note has no
 * day of its own — its `noteDate` is the first day of the period, and treating
 * that as "its day" would send every task in a monthly note to the 2nd. Today is
 * the honest answer there, and it is also the answer for project notes.
 *
 * A **due date**, by contrast, is measured from the clock, because it is a
 * promise about the real calendar rather than a position in the outline. The two
 * rows of the popover therefore resolve differently on purpose, and both show
 * the date they resolved to.
 */
export function taskAnchorDate(task: Task): string {
	const anchored = task.noteGranularity === 'day' && task.noteDate !== null;
	return anchored && task.noteDate !== null ? task.noteDate : relativeDate(0);
}

/** `YYYY-MM-DD`, `days` after the task's own day. See {@link taskAnchorDate}. */
export function relativeToTask(task: Task, days: number): string {
	return moment(taskAnchorDate(task), 'YYYY-MM-DD').add(days, 'days').format('YYYY-MM-DD');
}
