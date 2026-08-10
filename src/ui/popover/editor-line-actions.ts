import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { editorInfoField, setIcon, setTooltip } from 'obsidian';
import type { Extension } from '@codemirror/state';
import type { Task } from '../../domain/task.ts';
import { t } from '../../i18n/index.ts';
import type SimpleTasksPlugin from '../../main.ts';
import { TaskPopover } from './task-popover.ts';

/**
 * The third trigger of the popover, and the only one a phone can use in the
 * **editor**: a small button at the end of the task line the cursor is on.
 *
 * ## Why this shape
 *
 * Hover does not exist without a pointer, and the `Show task actions` command is
 * an `editorCheckCallback`, so it is reachable from the command palette but has
 * no target to tap. What was missing was an *affordance*, and the requirement on
 * it was that it be available without being imposed: opening a popover whenever
 * the cursor entered a task line would cover the very text being typed.
 *
 * So the button appears with the cursor and does nothing until it is pressed.
 * Three properties are load-bearing, and each is a way this could have been worse
 * than nothing:
 *
 * - **It never moves the text.** The widget is inserted at the *end* of the line,
 *   after the last character, so nothing before it shifts; and the icon is
 *   line-height sized, with the finger-sized target added as an absolutely
 *   positioned overlay in CSS, so the line does not grow taller either.
 * - **It does not flicker while typing.** {@link LineActionsWidget.eq} compares
 *   the path and the line, so editing *within* a task line reuses the very same
 *   DOM node; the decoration is only rebuilt when the cursor changes line, the
 *   document changes or the index does.
 * - **It is only ever one.** The decoration set holds the cursor's line and
 *   nothing else, so a note with three hundred tasks pays for one widget.
 *
 * Registered only on mobile. On the desktop the hover popover already covers
 * this, and an icon appearing on the active line would be noise.
 */
export function taskLineActionsExtension(plugin: SimpleTasksPlugin): Extension {
	class LineActionsWidget extends WidgetType {
		private readonly plugin: SimpleTasksPlugin;
		private readonly task: Task;

		constructor(host: SimpleTasksPlugin, task: Task) {
			super();
			this.plugin = host;
			this.task = task;
		}

		/**
		 * Identity is the line, not the task: the task object is rebuilt by every
		 * reindex, and comparing it would replace the button under the user's finger
		 * on each keystroke.
		 */
		override eq(other: LineActionsWidget): boolean {
			return other.task.path === this.task.path && other.task.line === this.task.line;
		}

		override toDOM(): HTMLElement {
			const button = createEl('button', {
				cls: 'simple-tasks-line-actions',
				attr: { type: 'button', 'aria-label': t('popover.lineActions') },
			});
			setIcon(button, 'ellipsis-vertical');
			setTooltip(button, t('popover.lineActions'), { placement: 'top' });
			button.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				// Read the task again: the one captured when the widget was built may be
				// several keystrokes old, and the popover writes to what it is given.
				const current = taskAt(this.plugin, this.task.path, this.task.line) ?? this.task;
				TaskPopover.showAt(button, {
					plugin: this.plugin,
					task: current,
					returnFocusTo: button,
				});
			});
			return button;
		}

		/**
		 * CodeMirror must not treat a press on the button as a click on the text
		 * under it — that would move the cursor and, on a phone, raise the keyboard.
		 */
		override ignoreEvent(): boolean {
			return true;
		}
	}

	const decorate = (view: EditorView): DecorationSet => {
		const path = view.state.field(editorInfoField, false)?.file?.path;
		if (path === undefined) return Decoration.none;
		const { selection } = view.state;
		// One cursor, one button. A selection spanning lines is not a place to offer
		// a single line's actions.
		if (!selection.main.empty) return Decoration.none;
		const line = view.state.doc.lineAt(selection.main.head);
		const task = taskAt(plugin, path, line.number - 1);
		if (task === null) return Decoration.none;
		return Decoration.set([
			Decoration.widget({
				widget: new LineActionsWidget(plugin, task),
				side: 1,
			}).range(line.to),
		]);
	};

	return ViewPlugin.define(
		(view) => ({
			decorations: decorate(view),
			update(update: ViewUpdate) {
				if (!update.docChanged && !update.selectionSet && !update.viewportChanged) return;
				this.decorations = decorate(update.view);
			},
		}),
		{ decorations: (value) => value.decorations }
	);
}

/** The indexed task on a line, or `null`. Mirrors `editor-hover.ts` exactly. */
function taskAt(plugin: SimpleTasksPlugin, path: string, line: number): Task | null {
	const entry = plugin.index.fileEntry(path);
	return entry?.items.find((item) => item.line === line && item.isTask) ?? null;
}
