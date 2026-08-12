import { Platform, setIcon, setTooltip } from 'obsidian';
import type { Component } from 'obsidian';
import { cycleTaskStatus } from '../../actions/cycle-status.ts';
import { openTaskAt } from '../../actions/open-task.ts';
import { PRIORITY_EMOJI } from '../../domain/parse-line.ts';
import type { Task } from '../../domain/task.ts';
import { t } from '../../i18n/index.ts';
import { setTaskDragData } from '../../integrations/calendar-plus.ts';
import type SimpleTasksPlugin from '../../main.ts';
import { HOVER_DELAY_MS, TaskPopover } from '../popover/task-popover.ts';

/**
 * The task row, drawn once and made interactive by **event delegation**.
 *
 * ## Why delegation and not a per-render component
 *
 * A row needs up to seven handlers — the checkbox, a double click, drag start
 * and end, and the three that drive the hover popover — and both views that use
 * it repaint on every index change. Registering those against the view, which
 * is what the agenda and the Bases view both did, left one dead closure per
 * handler per row per repaint. Measured before this change: **284 registrations
 * per agenda repaint at 41 rows, 790 per Bases repaint at 158 rows**, growing
 * without bound for as long as the view stayed open.
 *
 * A per-render child component ({@link renderScope}) would stop the growth, but
 * it would still hold seven live listeners per row. Rows are the unbounded part
 * of these views — a Base over a folder easily renders hundreds — so the whole
 * list is wired with **one listener per event type, on the container**, for the
 * lifetime of the view. Cost is now independent of the number of rows.
 *
 * ## How a row is identified
 *
 * `renderRow` records the row element in a `WeakMap`; the delegated handlers
 * look the event's row up in it. Nothing has to be cleared between renders: an
 * entry dies with the element that keys it. A row that is drawn only as outline
 * context (`matched: false`) is recorded as such, which is what keeps it inert
 * — no drag, no double click, no popover — while still letting its checkbox
 * work, exactly as it did before.
 *
 * The checkbox is a real `<button>`, so Enter and Space fire its `click`
 * natively and there is deliberately **no keyboard handler on it**: with both a
 * delegated click and a key handler alive, a keyboard activation would cycle
 * the status twice.
 *
 * ## Three ways to the popover, one per input device
 *
 * - **pointer, desktop only**: resting on a row for {@link HOVER_DELAY_MS}. A
 *   touch WebView synthesizes `mouseover` from a tap, so on a phone this fired
 *   from taps that were aimed at the checkbox;
 * - **keyboard**: the row is a tab stop and Enter or Space opens it, with focus
 *   moved inside;
 * - **touch, mobile only**: a long press, delivered as `contextmenu`. Registered
 *   only when {@link Platform.isMobile}, so right-clicking a row on the desktop
 *   keeps behaving exactly as it always did.
 */

/**
 * ## Selecting several rows: paint with the mouse, then hover
 *
 * Everything above acts on one task. A day's review does not: three tasks that
 * did not happen go to the same place, and doing that one popover at a time is
 * four gestures each.
 *
 * The gesture is **press and drag across the rows**, the way one paints a
 * selection in any list, and then **hover one of them**: the popover opens with
 * the whole selection as its target, so every action it already offers — status,
 * priority, due date, tags, move — applies to all of them. There is no separate
 * bulk UI, and nothing new to learn beyond the painting itself.
 *
 * The rules that make a press unambiguous:
 *
 * - **A press with no drag selects nothing.** Painting only starts once the
 *   pointer reaches a *second* row, so a plain click on a row keeps meaning what
 *   it always meant.
 * - **Any plain press clears the selection** — on a row, or on the empty space of
 *   the view. That is the way out, and it costs no button.
 * - **A press on a row that is already selected changes nothing**, so it can start
 *   the native drag that carries the selection onto a Calendar Plus day. Only
 *   selected rows are `draggable`, which is also what keeps the paint gesture from
 *   turning into a drag halfway through.
 * - **`Cmd`/`Ctrl` + click** toggles a single row, for adding the odd one out
 *   without repainting.
 *
 * Desktop only, deliberately. There is no press-and-drag on a phone that does not
 * collide with scrolling, and the popover there is one task at a time.
 *
 * The selection holds **ids**, and it is pruned to what the view is about to draw
 * on every render ({@link TaskRowList.retainSelection}). A task that has been
 * completed away, filtered out or moved elsewhere therefore drops out of it by
 * itself: acting on a row that is no longer on screen is exactly the surprise
 * this is here to avoid.
 */

export interface TaskRowListOptions {
	plugin: SimpleTasksPlugin;
	/**
	 * Class prefix for the row and its parts, e.g. `simple-tasks-agenda`. The
	 * two views keep their own prefixes because their rows are styled
	 * differently — the agenda's checkbox follows the vault's checkbox
	 * variables, the Bases one is a compact square.
	 */
	prefix: string;
	/** Whether task rows can be dragged onto a Calendar Plus day. */
	draggable: boolean;
	/** Whether a row names the note it came from. Read at render time. */
	showSource: () => boolean;
	/** Called after any write made through the popover. */
	onChanged: () => void;
	/** Whether rows can be selected for a bulk action. Off unless asked for. */
	selectable?: boolean;
}

interface RowEntry {
	task: Task;
	/** False for an ancestor drawn only to give a task its place. */
	matched: boolean;
}

export class TaskRowList {
	private readonly options: TaskRowListOptions;
	private readonly rowClass: string;
	private readonly checkClass: string;
	/** The container every row of every render lives in. */
	private readonly root: HTMLElement;

	/** Row element → what it draws. Entries are collected with the elements. */
	private readonly rows = new WeakMap<HTMLElement, RowEntry>();

	/** The hover that has not fired yet, and the popover that is open. */
	private pending: { row: HTMLElement; timer: number } | null = null;
	private open: { row: HTMLElement; popover: TaskPopover } | null = null;

	/** Selected tasks by id. */
	private readonly selected = new Map<string, Task>();

	/**
	 * The press in progress that may become a paint: the row it started on, and
	 * whether it has already reached a second row. Null when no button is down.
	 */
	private paint: { anchor: HTMLElement; spread: boolean } | null = null;

	/**
	 * @param owner  the view; the delegated listeners live as long as it does
	 * @param root   the element that contains every row, across all renders
	 */
	constructor(owner: Component, root: HTMLElement, options: TaskRowListOptions) {
		this.options = options;
		this.root = root;
		this.rowClass = `${options.prefix}-row`;
		this.checkClass = `${options.prefix}-check`;
		this.listen(owner, root);
		owner.register(() => {
			this.cancelPending();
		});
	}

	/* -------------------------------------------------- rendering */

	renderRow(container: HTMLElement, task: Task, depth: number, matched: boolean): void {
		const { prefix } = this.options;
		const row = container.createDiv({
			cls: matched ? this.rowClass : `${this.rowClass} is-context`,
		});
		const selected = matched && this.selected.has(task.id);
		if (selected) {
			row.addClass('is-selected');
			row.setAttribute('aria-selected', 'true');
		}
		row.style.setProperty('--st-row-depth', String(depth));
		row.tabIndex = 0;
		row.setAttribute('role', 'listitem');
		row.setAttribute('aria-label', t('agenda.taskActions', { task: task.cleanText }));

		if (task.isTask) {
			const label = t('agenda.setStatus', { task: task.cleanText });
			const box = row.createEl('button', {
				cls: this.checkClass,
				attr: {
					type: 'button',
					'aria-label': label,
					'aria-pressed': String(task.isCompleted),
					'data-status': task.status,
				},
			});
			box.createSpan({ text: task.status === ' ' ? '' : task.status });
			setTooltip(box, label, { placement: 'top' });
		} else {
			const bullet = row.createSpan({ cls: `${prefix}-bullet` });
			setIcon(bullet, 'chevron-right');
			bullet.setAttribute('aria-hidden', 'true');
		}

		const text = row.createDiv({ cls: `${prefix}-text` });
		text.createSpan({
			cls: task.isCompleted ? `${prefix}-title is-done` : `${prefix}-title`,
			text: task.cleanText,
		});
		if (task.priority !== null) {
			text.createSpan({ cls: `${prefix}-priority`, text: PRIORITY_EMOJI[task.priority] });
		}
		for (const tag of task.ownTags) {
			text.createSpan({ cls: `${prefix}-tag`, text: tag });
		}
		if (this.options.showSource()) {
			text.createSpan({ cls: `${prefix}-source`, text: noteName(task.path) });
		}

		// Draggable so the task can be dropped on a calendar day; the payload
		// carries our own MIME type, which is what lets a cell tell one of our
		// tasks from any other drag before it offers itself as a target. Grouping
		// items are not draggable: moving one means moving everything under it,
		// which is not what dropping a line on a day suggests.
		//
		// **Only while selected**, when the list is selectable at all: a press on a
		// draggable row starts the native drag after a few pixels, which is the same
		// movement the paint gesture is made of, and the two cannot both own it. So
		// selecting is what a press on an unselected row does, and dragging is what a
		// press on a selected one does. One click first, then drag — and now the drag
		// can carry several tasks instead of one.
		if (matched && this.options.draggable && task.isTask) {
			row.draggable = this.options.selectable !== true || selected;
		}

		this.rows.set(row, { task, matched });
	}

	/* -------------------------------------------------- delegation */

	private listen(owner: Component, root: HTMLElement): void {
		owner.registerDomEvent(root, 'click', (event) => {
			if (this.closest(event.target, this.checkClass) !== null) {
				const entry = this.entryAt(event.target);
				if (entry === null) return;
				void cycleTaskStatus(this.options.plugin, entry.task);
				return;
			}
			this.onRowClick(event);
		});

		owner.registerDomEvent(root, 'dblclick', (event) => {
			const entry = this.entryAt(event.target);
			if (entry === null || !entry.matched) return;
			void openTaskAt(this.options.plugin.app, entry.task.path, entry.task.line);
		});

		if (this.options.draggable) {
			owner.registerDomEvent(root, 'dragstart', (event) => {
				const row = this.closest(event.target, this.rowClass);
				const entry = row === null ? undefined : this.rows.get(row);
				if (row === null || entry === undefined || !entry.matched) return;
				// The whole selection when this row is part of it, so dropping on a
				// calendar day moves everything that was painted; otherwise just this
				// task. Either way the payload is a list, so the drop has one shape.
				const dragged = this.selected.has(entry.task.id)
					? this.selectedTasks()
					: [entry.task];
				setTaskDragData(event.dataTransfer, dragged);
				row.addClass('is-dragging');
			});
			owner.registerDomEvent(root, 'dragend', (event) => {
				this.closest(event.target, this.rowClass)?.removeClass('is-dragging');
			});
		}

		// Mobile only. A phone has no hover to rest on, and the `Show task actions`
		// command is `editorCheck`, so it does not exist while the agenda has focus:
		// without this these views had no route to the popover at all on a phone.
		//
		// `contextmenu` is the whole mechanism, and it is deliberately not a gesture
		// of ours: WebKit and Chromium raise it from a long press, which is how the
		// Tasks plugin offers the same menu. Desktop is left exactly as it was —
		// right-clicking a row keeps doing whatever Obsidian did with it before.
		if (Platform.isMobile) {
			owner.registerDomEvent(root, 'contextmenu', (event) => {
				const row = this.closest(event.target, this.rowClass);
				if (row === null || this.rows.get(row)?.matched !== true) return;
				// Ours wins over anything else on a task row: the default long-press
				// callout would otherwise start selecting the task's text underneath.
				event.preventDefault();
				event.stopPropagation();
				this.show(row, false, { x: event.clientX, y: event.clientY });
			});
		}

		owner.registerDomEvent(root, 'keydown', (event) => {
			// Escape drops a selection: what a user presses after painting one by
			// accident, and the keyboard's way out.
			if (event.key === 'Escape' && this.selected.size > 0) {
				event.preventDefault();
				this.clearSelection();
				return;
			}
			if (event.key !== 'Enter' && event.key !== ' ') return;
			const row = this.closest(event.target, this.rowClass);
			// Only the row itself: inside it the checkbox is a button and handles
			// its own keys, and stealing them would open a popover as well.
			if (row === null || event.target !== row) return;
			if (this.rows.get(row)?.matched !== true) return;
			event.preventDefault();
			this.show(row, true);
		});

		// Everything below is pointer work, and a touch WebView synthesizes pointer
		// and mouse events from a tap: on a phone this opened the popover 300 ms after
		// a tap aimed at the checkbox, and painting has no gesture there that does not
		// collide with scrolling. The long press above is the touch route.
		if (Platform.isMobile) return;

		this.listenForPainting(owner, root);

		// `mouseenter`/`mouseleave` do not bubble, so delegation uses the bubbling
		// pair and ignores the moves that stay inside the same row.
		owner.registerDomEvent(root, 'mouseover', (event) => {
			const row = this.enteredRow(event);
			if (row === null || this.rows.get(row)?.matched !== true) return;
			if (this.open !== null && this.open.row === row) {
				this.open.popover.cancelLeave();
				return;
			}
			this.cancelPending();
			this.pending = {
				row,
				timer: row.win.setTimeout(() => {
					this.pending = null;
					this.show(row, false);
				}, HOVER_DELAY_MS),
			};
		});

		owner.registerDomEvent(root, 'mouseout', (event) => {
			const row = this.enteredRow(event);
			if (row === null) return;
			if (this.pending?.row === row) this.cancelPending();
			// The popover is not inside the row, so the pointer travelling into it
			// reads as a leave. Its own `mouseenter` cancels this grace period,
			// which is what makes an interactive hover card possible.
			if (this.open?.row === row) this.open.popover.closeSoon();
		});
	}

	/** The row a pointer crossed the border of, or `null` for a move inside one. */
	private enteredRow(event: MouseEvent): HTMLElement | null {
		const row = this.closest(event.target, this.rowClass);
		if (row === null) return null;
		const related = event.relatedTarget;
		if (related instanceof Node && row.contains(related)) return null;
		return row;
	}

	private closest(target: EventTarget | null, cls: string): HTMLElement | null {
		return target instanceof HTMLElement ? target.closest<HTMLElement>(`.${cls}`) : null;
	}

	private entryAt(target: EventTarget | null): RowEntry | null {
		const row = this.closest(target, this.rowClass);
		return row === null ? null : (this.rows.get(row) ?? null);
	}

	/* -------------------------------------------------- the selection */

	get selectedCount(): number {
		return this.selected.size;
	}

	/** The selected tasks, as of the last render that kept them. */
	selectedTasks(): Task[] {
		return [...this.selected.values()];
	}

	/** Whether a task is part of the current selection. */
	isSelected(task: Task): boolean {
		return this.selected.has(task.id);
	}

	clearSelection(): void {
		if (this.selected.size === 0) return;
		for (const row of this.selectedRows()) this.mark(row, false);
		this.selected.clear();
	}

	/**
	 * Drops from the selection anything the view is no longer about to draw, and
	 * refreshes what is left to the freshly parsed task. Called at the top of a
	 * render, before any row exists.
	 */
	retainSelection(visible: readonly Task[]): void {
		if (this.selected.size === 0) return;
		const byId = new Map(visible.map((task) => [task.id, task]));
		for (const id of [...this.selected.keys()]) {
			const fresh = byId.get(id);
			if (fresh === undefined) this.selected.delete(id);
			else this.selected.set(id, fresh);
		}
	}

	/**
	 * The press, the paint and the release.
	 *
	 * Registered only on the desktop, from {@link listen}. Three listeners, all
	 * delegated, and the state between them is one nullable field.
	 */
	private listenForPainting(owner: Component, root: HTMLElement): void {
		if (this.options.selectable !== true) return;

		owner.registerDomEvent(root, 'mousedown', (event) => {
			// The primary button only, and never through the checkbox: that is its own
			// control, and pressing it must not disturb a selection.
			if (event.button !== 0) return;
			if (this.closest(event.target, this.checkClass) !== null) return;
			if (event.metaKey || event.ctrlKey || event.shiftKey) return;
			const row = this.closest(event.target, this.rowClass);
			const entry = row === null ? undefined : this.rows.get(row);
			// A press on an already selected row is left completely alone: it is what
			// starts the native drag that carries the selection to the calendar.
			if (row !== null && entry !== undefined && this.selected.has(entry.task.id)) return;
			this.clearSelection();
			if (row === null || entry === undefined || !entry.matched) return;
			// Nothing is selected yet — a click must select nothing. What is armed here
			// is the *possibility* of a paint, which the move onto a second row takes.
			this.paint = { anchor: row, spread: false };
			// Stops the press from starting a text selection across the rows, which is
			// what the same drag would otherwise do.
			event.preventDefault();
		});

		owner.registerDomEvent(root, 'mouseover', (event) => {
			const paint = this.paint;
			if (paint === null) return;
			// The button was released outside the panel and the `mouseup` never
			// arrived: `buttons` is the only honest signal for that.
			if (event.buttons === 0) {
				this.paint = null;
				return;
			}
			const row = this.closest(event.target, this.rowClass);
			const entry = row === null ? undefined : this.rows.get(row);
			if (row === null || entry === undefined || !entry.matched) return;
			if (row === paint.anchor && !paint.spread) return;
			if (!paint.spread) {
				// The second row is what turns the press into a paint, so the row it
				// started on joins here rather than on `mousedown`.
				paint.spread = true;
				this.cancelPending();
				this.open?.popover.close();
				this.selectRow(paint.anchor);
			}
			this.selectRow(row);
		});

		// On the document, not the panel: a release outside it still ends the paint.
		owner.registerDomEvent(root.doc, 'mouseup', () => {
			this.paint = null;
		});
	}

	/**
	 * A click on a row that was not on its checkbox: only `Cmd`/`Ctrl` + click does
	 * anything, which is what keeps a plain click as inert as it has always been.
	 */
	private onRowClick(event: MouseEvent): void {
		if (this.options.selectable !== true) return;
		if (!event.metaKey && !event.ctrlKey) return;
		const row = this.closest(event.target, this.rowClass);
		const entry = row === null ? undefined : this.rows.get(row);
		if (row === null || entry === undefined || !entry.matched) return;
		event.preventDefault();
		event.stopPropagation();
		this.cancelPending();
		this.open?.popover.close();
		if (this.selected.delete(entry.task.id)) this.mark(row, false);
		else this.selectRow(row);
	}

	/** Adds one row to the selection, if it is not in it already. */
	private selectRow(row: HTMLElement): void {
		const entry = this.rows.get(row);
		if (entry === undefined || !entry.matched) return;
		if (this.selected.has(entry.task.id)) return;
		this.selected.set(entry.task.id, entry.task);
		this.mark(row, true);
	}

	/**
	 * Paints one row as selected or not.
	 *
	 * Done here rather than left to the next render: painting is direct
	 * manipulation and has to answer under the pointer, while the host's repaint is
	 * debounced behind the index. `draggable` moves with the class, because only a
	 * selected row may start the drag — see the note in {@link renderRow}.
	 */
	private mark(row: HTMLElement, selected: boolean): void {
		row.toggleClass('is-selected', selected);
		if (selected) row.setAttribute('aria-selected', 'true');
		else row.removeAttribute('aria-selected');
		if (this.options.draggable && this.rows.get(row)?.task.isTask === true) {
			row.draggable = selected;
		}
	}

	/** The rows currently painted as selected, from the live DOM. */
	private selectedRows(): HTMLElement[] {
		const scope = this.root;
		return scope === null
			? []
			: Array.from(scope.querySelectorAll<HTMLElement>(`.${this.rowClass}.is-selected`));
	}

	/* -------------------------------------------------- the popover */

	private cancelPending(): void {
		if (this.pending === null) return;
		this.pending.row.win.clearTimeout(this.pending.timer);
		this.pending = null;
	}

	/**
	 * One popover at a time. The per-row closures this replaced each kept their
	 * own reference, so hovering a second row while the first popover was still
	 * up left two of them on screen.
	 */
	private show(row: HTMLElement, focus: boolean, at?: { x: number; y: number }): void {
		this.cancelPending();
		// Never in the middle of a paint: the pointer is crossing rows, not resting.
		if (this.paint !== null) return;
		const entry = this.rows.get(row);
		if (entry === undefined || !entry.matched) return;
		if (this.open !== null) {
			if (this.open.row === row) {
				this.open.popover.cancelLeave();
				return;
			}
			this.open.popover.close();
		}
		// Hovering a row that is part of a selection acts on the **whole** selection;
		// hovering any other row acts on that row alone, even while a selection
		// exists elsewhere. That is what makes the painted rows the target and not
		// some invisible state.
		const selection =
			this.selected.size > 1 && this.selected.has(entry.task.id)
				? this.selectedTasks()
				: undefined;
		const popover = TaskPopover.showAt(row, {
			plugin: this.options.plugin,
			task: entry.task,
			selection,
			returnFocusTo: row,
			onChanged: this.options.onChanged,
			at,
		});
		const opened = { row, popover };
		this.open = opened;
		popover.register(() => {
			if (this.open === opened) this.open = null;
		});
		if (focus) popover.focusFirst();
	}
}

/** Basename without the extension. The full path is still on the row's label. */
export function noteName(path: string): string {
	const slash = path.lastIndexOf('/');
	const name = slash === -1 ? path : path.slice(slash + 1);
	return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}
