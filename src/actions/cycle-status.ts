import { moment } from 'obsidian';
import { nextStatusSymbol, resolveStatus } from '../domain/statuses.ts';
import { withStatus } from '../domain/serialize-line.ts';
import type { Task } from '../domain/task.ts';
import type SimpleTasksPlugin from '../main.ts';
import { rewriteTaskLine } from './edit-task.ts';

/**
 * Changing the status of a task.
 *
 * ## Completion dates
 *
 * The plugin **never introduces** a completion date into a note that did not
 * already use that syntax — thousands of existing lines carry no `✅` and
 * stamping one on every click would rewrite the vault. What it does do:
 *
 * - a line that *already* carries a done date gets it refreshed when the task
 *   is completed again, because a stale date is worse than none;
 * - a line that carries a done date but is moved to a status that is **not** a
 *   completion loses it, for the same reason.
 *
 * Everything else — when did this actually get done — is the completion log's
 * job, and it needs no markdown at all. See `dev-docs/heatmap-and-stats.md`.
 *
 * ## The one place that knows a task was completed
 *
 * Every route into a completed status ends here: the agenda checkbox, the
 * popover in the views, the popover in the editor, the Bases view and the
 * `Cycle task status` command. Nothing is hooked onto that at the moment — the
 * completion animation that used to be was removed — but it is the seam to use if
 * anything ever needs to know, rather than the five call sites.
 */

/** Sets an explicit status symbol. */
export async function setTaskStatus(
	plugin: SimpleTasksPlugin,
	task: Task,
	symbol: string
): Promise<boolean> {
	// A list item without a checkbox is a grouping node, not a task. Giving it one
	// would silently turn a section heading into something the stats count.
	if (!task.isTask) return false;
	const completed = resolveStatus(plugin.settings.statuses, symbol).isCompleted;
	const today = moment().format('YYYY-MM-DD');
	return rewriteTaskLine(plugin, task, (line) => {
		const next = withStatus(line, symbol);
		if (line.dates.done === undefined) return next;
		const dates = { ...next.dates };
		if (completed) dates.done = today;
		else delete dates.done;
		return { ...next, dates };
	});
}

/** Moves the task to the `nextSymbol` its current status declares. */
export async function cycleTaskStatus(
	plugin: SimpleTasksPlugin,
	task: Task
): Promise<boolean> {
	return setTaskStatus(plugin, task, nextStatusSymbol(plugin.settings.statuses, task.status));
}
