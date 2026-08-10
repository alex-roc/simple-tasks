import { Notice, TFile } from 'obsidian';
import { parseLine } from '../domain/parse-line.ts';
import { serializeLine } from '../domain/serialize-line.ts';
import { locateTaskLine } from '../domain/subtree.ts';
import { addTag, removeTag } from '../domain/tags.ts';
import type { ParsedLine, Task, TaskPriority } from '../domain/task.ts';
import { t } from '../i18n/index.ts';
import type SimpleTasksPlugin from '../main.ts';

/**
 * The single-line write primitive every action is built on.
 *
 * Three rules hold for everything in `actions/`:
 *
 * 1. **`vault.process` only.** It is atomic and does not race with an open
 *    editor; `vault.modify` on a file the user is typing in loses keystrokes.
 * 2. **`serializeLine` only.** No action formats a date, a priority or a
 *    checkbox by hand, so the vault never grows a second dialect.
 * 3. **Re-locate before writing.** The index is debounced, so `task.line` can
 *    be one edit out of date. Every write finds the line again inside the
 *    process callback, on the content it is about to replace, and gives up
 *    rather than write to a line it cannot identify.
 */

/** The note a task lives in, or `null` when it is gone. */
export function fileOf(plugin: SimpleTasksPlugin, path: string): TFile | null {
	const file = plugin.app.vault.getFileByPath(path);
	return file instanceof TFile ? file : null;
}

/**
 * Rewrites the task's line. The transform receives the line as parsed *now*,
 * not as the index remembers it, and returns what should be written.
 *
 * Returns `false` — after telling the user why — when the line could not be
 * identified, which is the only safe answer to a note that moved under us.
 */
export async function rewriteTaskLine(
	plugin: SimpleTasksPlugin,
	task: Task,
	transform: (line: ParsedLine) => ParsedLine
): Promise<boolean> {
	const file = fileOf(plugin, task.path);
	if (file === null) {
		new Notice(t('action.noFile', { path: task.path }));
		return false;
	}

	let done = false;
	await plugin.app.vault.process(file, (data) => {
		const lines = data.split('\n');
		const at = locateTaskLine(lines, task.line, task.text, task.indent);
		if (at === null) return data;
		// Re-parse from the item's own marker, the way the indexer did, so a line
		// holding two list items (`- * Título`) keeps its outer prefix.
		const raw = lines[at] ?? '';
		const prefix = raw.startsWith(task.indent) ? task.indent : '';
		const current = parseLine(raw.slice(prefix.length));
		if (current === null) return data;
		lines[at] = serializeLine(
			{ ...transform(current), indent: `${prefix}${current.indent}` },
			{ syntax: plugin.settings.writeSyntax }
		);
		done = true;
		return lines.join('\n');
	});

	if (!done) new Notice(t('action.notFound'));
	return done;
}

/** Sets or clears the priority. */
export async function setTaskPriority(
	plugin: SimpleTasksPlugin,
	task: Task,
	priority: TaskPriority | null
): Promise<boolean> {
	return rewriteTaskLine(plugin, task, (line) => ({ ...line, priority }));
}

/** Appends a tag to the line, unless it is already there. */
export async function addTaskTag(
	plugin: SimpleTasksPlugin,
	task: Task,
	tag: string
): Promise<boolean> {
	return rewriteTaskLine(plugin, task, (line) => ({ ...line, text: addTag(line.text, tag) }));
}

/** Removes one tag from the line, leaving nested children of it alone. */
export async function removeTaskTag(
	plugin: SimpleTasksPlugin,
	task: Task,
	tag: string
): Promise<boolean> {
	return rewriteTaskLine(plugin, task, (line) => ({ ...line, text: removeTag(line.text, tag) }));
}
