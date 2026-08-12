import { hoverTooltip } from '@codemirror/view';
import type { EditorView, Tooltip, TooltipView } from '@codemirror/view';
import { editorInfoField } from 'obsidian';
import type { Extension } from '@codemirror/state';
import type { Task } from '../../domain/task.ts';
import type SimpleTasksPlugin from '../../main.ts';
import { HOVER_DELAY_MS, TaskPopover } from './task-popover.ts';

/**
 * The second trigger of the popover: hovering a task line **in the editor**.
 *
 * Built on `hoverTooltip` from `@codemirror/view` rather than on a DOM listener
 * over the rendered markdown. Three reasons that matter:
 *
 * - CodeMirror already knows which document position the pointer is over, so
 *   there is no guessing from a DOM node back to a line number;
 * - it handles the delay, the placement, the flipping and the dismissal, and it
 *   keeps the tooltip alive while the pointer is inside it, which is what makes
 *   an *interactive* hover card possible at all;
 * - it works in Live Preview and in Source mode alike, because it is the editor,
 *   not the renderer.
 *
 * `@codemirror/view` is already in the esbuild `external` list, so this imports
 * the very instance Obsidian is running — bundling a second copy would give the
 * extension a different `StateField` registry and it would silently do nothing.
 *
 * The task itself is resolved **from the index**, never re-parsed here: the file
 * comes from `editorInfoField`, the line from the document position, and
 * `index.byFile()` does the rest.
 *
 * Several tasks at once come from the editor's **own text selection** — see
 * {@link tasksInSelection}. Selecting lines and hovering one of them is a gesture
 * that already exists; nothing here invents a second one.
 */

/**
 * Everything before a task's text: the indent, the list marker and the checkbox.
 *
 * Hovering that part opens nothing. The checkbox is a *control* — it is what you
 * click to finish the task — and a card appearing over it as the pointer arrives
 * is a card in the way of the gesture. The bullet of a plain list item is in there
 * for the same reason: it is where the pointer passes on its way in.
 */
const TASK_PREFIX = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[.\][ \t]*)?/u;

export function taskHoverExtension(plugin: SimpleTasksPlugin): Extension {
	return hoverTooltip(
		(view: EditorView, pos: number): Tooltip | null => {
			if (!plugin.settings.editorHoverPopover) return null;
			const task = taskAt(plugin, view, pos);
			if (task === null) return null;
			const line = view.state.doc.lineAt(pos);
			const textStart = line.from + (TASK_PREFIX.exec(line.text)?.[0].length ?? 0);
			if (pos < textStart) return null;
			return {
				// The tooltip's own range starts at the text too, so moving *onto* the
				// checkbox closes it instead of keeping it open over the target.
				pos: textStart,
				end: line.to,
				above: false,
				create: (): TooltipView => {
					const dom = createDiv({ cls: 'simple-tasks-popover-tooltip' });
					const popover = TaskPopover.mount(dom, {
						plugin,
						task,
						// Read now rather than when the tooltip was decided on: `create`
						// runs when it is really about to be shown, which is the moment
						// whose selection the user is looking at.
						selection: tasksInSelection(plugin, view, task),
					});
					return {
						dom,
						// CodeMirror wraps the tooltip in its own `.cm-tooltip`, which
						// carries a hardcoded light background from the base theme — the
						// popover would sit on a white card in a dark vault. There is no
						// parent selector available (`:has` is off limits), so the class
						// goes on from here, where the parent is finally known.
						mount: () => {
							dom.parentElement?.addClass('simple-tasks-popover-host');
						},
						destroy: () => {
							popover.unload();
						},
					};
				},
			};
		},
		{ hoverTime: HOVER_DELAY_MS }
	);
}

/**
 * The tasks the **editor's own text selection** covers, when it covers the hovered
 * line too. `undefined` for anything else, which is the ordinary one-task popover.
 *
 * This is the whole gesture for acting on several tasks in a note: select the lines
 * the way you would select any text — drag across them, `Shift`+arrow, whatever —
 * and hover one of them. Nothing new to learn and nothing of ours to discover; the
 * popover simply says how many it is about to write to.
 *
 * Every range of a multi-cursor selection counts, so `Cmd`+dragging three separate
 * task lines works as well as one continuous sweep. A range that **ends** at the
 * very start of a line does not pull that line in: dragging down to the beginning
 * of the next line is how a selection normally ends, and it must not quietly
 * include a task the user did not touch.
 */
function tasksInSelection(
	plugin: SimpleTasksPlugin,
	view: EditorView,
	hovered: Task
): Task[] | undefined {
	const { doc, selection } = view.state;
	const lines = new Set<number>();
	for (const range of selection.ranges) {
		if (range.empty) continue;
		const first = doc.lineAt(range.from).number - 1;
		const end = doc.lineAt(range.to);
		// Nothing of the last line is selected when the range stops at its very
		// first character, so it only counts if it is also the first line.
		const touchesEnd = range.to > end.from || end.number - 1 === first;
		const last = end.number - 1 - (touchesEnd ? 0 : 1);
		for (let line = first; line <= last; line += 1) lines.add(line);
	}
	if (!lines.has(hovered.line)) return undefined;
	const items = plugin.index.fileEntry(hovered.path)?.items ?? [];
	const tasks = items.filter((item) => item.isTask && lines.has(item.line));
	// One task is not a selection: it is the same popover it would have been.
	return tasks.length > 1 ? tasks : undefined;
}

/** The indexed task on the line under `pos`, or `null` when there is none. */
function taskAt(plugin: SimpleTasksPlugin, view: EditorView, pos: number): Task | null {
	const file = view.state.field(editorInfoField, false)?.file ?? null;
	if (file === null) return null;
	// CodeMirror lines are 1-based; the index is 0-based, like `ListItemCache`.
	const line = view.state.doc.lineAt(pos).number - 1;
	const entry = plugin.index.fileEntry(file.path);
	return entry?.items.find((item) => item.line === line && item.isTask) ?? null;
}
