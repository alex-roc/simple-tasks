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
 * `Cycle task status` command. That makes this the single sensible place to
 * fire the completion burst — see `ui/celebrate.ts`. Hooking it into the four
 * call sites instead would guarantee the fifth one forgets.
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
	// Resolved from the symbol rather than read off `task.isCompleted`: the
	// popover hands back an optimistically patched copy whose `status` is current
	// but whose derived flags are not.
	const wasCompleted = resolveStatus(plugin.settings.statuses, task.status).isCompleted;
	const today = moment().format('YYYY-MM-DD');
	const written = await rewriteTaskLine(plugin, task, (line) => {
		const next = withStatus(line, symbol);
		if (line.dates.done === undefined) return next;
		const dates = { ...next.dates };
		if (completed) dates.done = today;
		else delete dates.done;
		return { ...next, dates };
	});

	// Only a real transition, and only after the write landed: re-ticking a done
	// task is not an achievement, and neither is a write that was refused.
	if (written && completed && !wasCompleted) plugin.celebration.onCompleted(task);
	return written;
}

/** Moves the task to the `nextSymbol` its current status declares. */
export async function cycleTaskStatus(
	plugin: SimpleTasksPlugin,
	task: Task
): Promise<boolean> {
	return setTaskStatus(plugin, task, nextStatusSymbol(plugin.settings.statuses, task.status));
}
