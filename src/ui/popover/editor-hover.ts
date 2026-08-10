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
 */
export function taskHoverExtension(plugin: SimpleTasksPlugin): Extension {
	return hoverTooltip(
		(view: EditorView, pos: number): Tooltip | null => {
			if (!plugin.settings.editorHoverPopover) return null;
			const task = taskAt(plugin, view, pos);
			if (task === null) return null;
			const line = view.state.doc.lineAt(pos);
			return {
				pos: line.from,
				end: line.to,
				above: false,
				create: (): TooltipView => {
					const dom = createDiv({ cls: 'simple-tasks-popover-tooltip' });
					const popover = TaskPopover.mount(dom, { plugin, task });
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

/** The indexed task on the line under `pos`, or `null` when there is none. */
function taskAt(plugin: SimpleTasksPlugin, view: EditorView, pos: number): Task | null {
	const file = view.state.field(editorInfoField, false)?.file ?? null;
	if (file === null) return null;
	// CodeMirror lines are 1-based; the index is 0-based, like `ListItemCache`.
	const line = view.state.doc.lineAt(pos).number - 1;
	const entry = plugin.index.fileEntry(file.path);
	return entry?.items.find((item) => item.line === line && item.isTask) ?? null;
}
