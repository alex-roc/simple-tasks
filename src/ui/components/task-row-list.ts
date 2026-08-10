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
 * - **pointer**: resting on a row for {@link HOVER_DELAY_MS};
 * - **keyboard**: the row is a tab stop and Enter or Space opens it, with focus
 *   moved inside;
 * - **touch, mobile only**: a long press, delivered as `contextmenu`. Registered
 *   only when {@link Platform.isMobile}, so right-clicking a row on the desktop
 *   keeps behaving exactly as it always did.
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

	/** Row element → what it draws. Entries are collected with the elements. */
	private readonly rows = new WeakMap<HTMLElement, RowEntry>();

	/** The hover that has not fired yet, and the popover that is open. */
	private pending: { row: HTMLElement; timer: number } | null = null;
	private open: { row: HTMLElement; popover: TaskPopover } | null = null;

	/**
	 * @param owner  the view; the delegated listeners live as long as it does
	 * @param root   the element that contains every row, across all renders
	 */
	constructor(owner: Component, root: HTMLElement, options: TaskRowListOptions) {
		this.options = options;
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
		if (matched && this.options.draggable && task.isTask) row.draggable = true;

		this.rows.set(row, { task, matched });
	}

	/* -------------------------------------------------- delegation */

	private listen(owner: Component, root: HTMLElement): void {
		owner.registerDomEvent(root, 'click', (event) => {
			if (this.closest(event.target, this.checkClass) === null) return;
			const entry = this.entryAt(event.target);
			if (entry === null) return;
			void cycleTaskStatus(this.options.plugin, entry.task);
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
				setTaskDragData(event.dataTransfer, entry.task);
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
			if (event.key !== 'Enter' && event.key !== ' ') return;
			const row = this.closest(event.target, this.rowClass);
			// Only the row itself: inside it the checkbox is a button and handles
			// its own keys, and stealing them would open a popover as well.
			if (row === null || event.target !== row) return;
			if (this.rows.get(row)?.matched !== true) return;
			event.preventDefault();
			this.show(row, true);
		});

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
		const entry = this.rows.get(row);
		if (entry === undefined || !entry.matched) return;
		if (this.open !== null) {
			if (this.open.row === row) {
				this.open.popover.cancelLeave();
				return;
			}
			this.open.popover.close();
		}
		const popover = TaskPopover.showAt(row, {
			plugin: this.options.plugin,
			task: entry.task,
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
