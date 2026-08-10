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
