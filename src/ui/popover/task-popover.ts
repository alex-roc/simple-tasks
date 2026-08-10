import { Component, setIcon, setTooltip } from 'obsidian';
import { cycleTaskStatus, setTaskStatus } from '../../actions/cycle-status.ts';
import { addTaskTag, removeTaskTag, setTaskPriority } from '../../actions/edit-task.ts';
import { moveTask, moveTaskToDate } from '../../actions/move-task.ts';
import { openTaskAt } from '../../actions/open-task.ts';
import { relativeDate, rescheduleTask } from '../../actions/reschedule.ts';
import { PRIORITY_EMOJI } from '../../domain/parse-line.ts';
import type { Task, TaskPriority } from '../../domain/task.ts';
import { t } from '../../i18n/index.ts';
import type SimpleTasksPlugin from '../../main.ts';
import { renderScope } from '../components/render-scope.ts';
import { DatePickerModal } from '../modals/date-modal.ts';
import { pickNoteTarget } from '../modals/note-target-modal.ts';
import { TagSuggestModal } from '../modals/tag-modal.ts';

/**
 * The task actions popover. **One component, two triggers**: the plugin's own
 * views open it on hover with a delay, and the CodeMirror extension in
 * `editor-hover.ts` mounts the very same class inside a hover tooltip. Nothing
 * about the actions or the markup is duplicated between the two.
 *
 * ## Accessibility
 *
 * The catalog requires it and a hover-only affordance would fail it outright:
 *
 * - the popover is a `role="dialog"` with an `aria-label`;
 * - focus moves into it when it opens from the keyboard, and goes back where it
 *   came from when it closes — but **only if the popover held it**, so a hover
 *   that the user never focused cannot pull the caret out of the editor;
 * - **focus is trapped** while it is open: Tab and Shift+Tab cycle inside it;
 * - Escape closes it;
 * - every icon-only button carries an `aria-label`, and the state buttons carry
 *   `aria-pressed` so a screen reader announces the current status and priority
 *   rather than just a symbol.
 *
 * ## Staleness
 *
 * The index is debounced, so re-reading the task straight after a write would
 * show the old value. The popover therefore patches its own copy optimistically
 * and re-renders; the index catches up a moment later and the views repaint on
 * its `changed` event. Actions that relocate the task close the popover instead,
 * because there is nothing left to point at.
 */

/** Milliseconds the pointer must rest on a task before the popover appears. */
export const HOVER_DELAY_MS = 300;

/** Grace period before a popover closes after the pointer leaves it. */
const LEAVE_GRACE_MS = 180;

const FOCUSABLE =
	'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export interface TaskPopoverOptions {
	plugin: SimpleTasksPlugin;
	task: Task;
	/**
	 * Element focus returns to when the popover closes. Defaults to whatever had
	 * focus at the moment it opened, which is the right answer for the triggers
	 * that have no element to name.
	 */
	returnFocusTo?: HTMLElement | null;
	/** Called after any write, so a host view can refresh itself. */
	onChanged?: () => void;
	/**
	 * Viewport point to open at, instead of under the anchor. What a long press
	 * wants: the card appears where the finger is, not at the top of a row that
	 * may be the full width of a phone.
	 */
	at?: { x: number; y: number };
}

export class TaskPopover extends Component {
	readonly containerEl: HTMLElement;

	private readonly plugin: SimpleTasksPlugin;
	private readonly options: TaskPopoverOptions;
	/** Floating popovers own their element; mounted ones do not. */
	private readonly floating: boolean;
	private task: Task;
	private closed = false;
	private leaveTimer = 0;
	/**
	 * Where focus goes when the popover closes.
	 *
	 * Defaults to whatever had focus when it opened, because two of the three
	 * triggers cannot name an element: the `Show task actions` command anchors to
	 * the active editor line, and the editor tooltip is built by CodeMirror. With
	 * only the explicit option, closing either of those left focus on `<body>` —
	 * measured — which strands a keyboard user in the middle of a document.
	 */
	private readonly returnFocusTo: HTMLElement | null;
	/**
	 * Owns the buttons' handlers for exactly one render. The popover re-renders
	 * after every write, so registering them against the popover itself would
	 * pile up a dead closure per button per action taken.
	 */
	private buttonScope: Component | null = null;

	private constructor(container: HTMLElement, options: TaskPopoverOptions, floating: boolean) {
		super();
		this.plugin = options.plugin;
		this.options = options;
		this.task = options.task;
		this.floating = floating;
		this.containerEl = container;
		const previous = container.doc.activeElement;
		this.returnFocusTo =
			options.returnFocusTo ?? (previous instanceof HTMLElement ? previous : null);
	}

	/**
	 * Renders the popover into an element somebody else owns and positions — the
	 * CodeMirror hover tooltip. Closing is that owner's business.
	 */
	static mount(container: HTMLElement, options: TaskPopoverOptions): TaskPopover {
		const popover = new TaskPopover(container, options, false);
		popover.load();
		popover.setup();
		return popover;
	}

	/** Opens a floating popover next to an anchor, and owns its lifetime. */
	static showAt(anchor: HTMLElement, options: TaskPopoverOptions): TaskPopover {
		const host = anchor.doc.body.createDiv({ cls: 'simple-tasks-popover-layer' });
		const popover = new TaskPopover(host, options, true);
		popover.load();
		popover.setup();
		popover.position(anchor);
		// `pointerdown` rather than `mousedown`: it is the one event a tap, a click
		// and a pen all raise, so dismissing by tapping outside does not depend on
		// the mouse events a mobile WebView chooses to synthesize.
		popover.registerDomEvent(anchor.doc, 'pointerdown', (event) => {
			if (!host.contains(event.targetNode)) popover.close();
		});
		popover.registerDomEvent(host, 'mouseenter', () => {
			popover.cancelLeave();
		});
		popover.registerDomEvent(host, 'mouseleave', () => {
			popover.closeSoon();
		});
		return popover;
	}

	/** Keeps a hover-opened popover alive while the pointer is on its trigger. */
	cancelLeave(): void {
		if (this.leaveTimer !== 0) {
			this.containerEl.win.clearTimeout(this.leaveTimer);
			this.leaveTimer = 0;
		}
	}

	/** Closes after a short grace period, so the pointer can travel to it. */
	closeSoon(): void {
		this.cancelLeave();
		this.leaveTimer = this.containerEl.win.setTimeout(() => {
			this.close();
		}, LEAVE_GRACE_MS);
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.cancelLeave();
		// Focus is only given back if it was ours to give. A popover opened by hover
		// never took it, and restoring it unconditionally moved focus *to* the row
		// every time the pointer merely crossed one — measured: the caret left the
		// editor on a mouse-out. Read before unloading, or the element is gone.
		const active = this.containerEl.doc.activeElement;
		const hadFocus = active instanceof Node && this.containerEl.contains(active);
		this.unload();
		if (this.floating) {
			this.containerEl.remove();
		} else {
			// A mounted popover lives inside somebody else's element — the CodeMirror
			// hover tooltip — which we must not remove. Emptying it would leave an
			// empty box floating over the text, so it is hidden with a class rather
			// than with an inline style, which the linter forbids and a theme could
			// not override.
			this.containerEl.empty();
			this.containerEl.addClass('simple-tasks-popover-closed');
		}
		if (hadFocus) this.returnFocusTo?.focus();
	}

	/** Moves keyboard focus into the popover. */
	focusFirst(): void {
		const first = this.containerEl.querySelector<HTMLElement>(FOCUSABLE);
		first?.focus();
	}

	/* -------------------------------------------------- rendering */

	private setup(): void {
		this.containerEl.addClass('simple-tasks-popover');
		this.containerEl.setAttribute('role', 'dialog');
		this.containerEl.setAttribute('aria-label', t('popover.label'));
		this.containerEl.tabIndex = -1;
		this.registerDomEvent(this.containerEl, 'keydown', (event) => {
			this.onKeyDown(event);
		});
		this.render();
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			this.close();
			return;
		}
		if (event.key !== 'Tab') return;
		// Focus trap: a dialog the keyboard can fall out of is not a dialog.
		const items = Array.from(this.containerEl.querySelectorAll<HTMLElement>(FOCUSABLE));
		if (items.length === 0) return;
		const first = items[0];
		const last = items[items.length - 1];
		const active = this.containerEl.doc.activeElement;
		if (event.shiftKey && active === first) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && active === last) {
			event.preventDefault();
			first?.focus();
		}
	}

	private render(): void {
		const root = this.containerEl;
		this.buttonScope = renderScope(this, this.buttonScope);
		root.empty();

		const header = root.createDiv({ cls: 'simple-tasks-popover-header' });
		header.createDiv({
			cls: 'simple-tasks-popover-title',
			text: this.task.cleanText === '' ? this.task.path : this.task.cleanText,
		});
		header.createDiv({
			cls: 'simple-tasks-popover-subtitle',
			text: `${this.task.path}:${String(this.task.line + 1)}`,
		});

		this.renderStatuses(root);
		this.renderPriorities(root);
		this.renderMove(root);
		this.renderDue(root);
		this.renderTags(root);
		this.renderFooter(root);
	}

	private row(parent: HTMLElement, label: string): HTMLElement {
		const row = parent.createDiv({ cls: 'simple-tasks-popover-row' });
		row.createDiv({ cls: 'simple-tasks-popover-row-label', text: label });
		return row.createDiv({ cls: 'simple-tasks-popover-row-items' });
	}

	private button(
		parent: HTMLElement,
		options: {
			text?: string;
			icon?: string;
			/** Puts the icon after the text, for a chip whose action is "remove". */
			iconTrailing?: boolean;
			label: string;
			pressed?: boolean;
		},
		onClick: () => void
	): HTMLButtonElement {
		const button = parent.createEl('button', {
			cls: 'simple-tasks-popover-button',
			attr: { type: 'button', 'aria-label': options.label },
		});
		if (options.pressed !== undefined) {
			button.setAttribute('aria-pressed', String(options.pressed));
		}
		// The icon always goes in its own span: `setIcon` empties the element it is
		// given, so calling it on the button after adding the label would silently
		// delete the label. Cost one span, saves a class of invisible bugs.
		const addIcon = (): void => {
			if (options.icon === undefined) return;
			setIcon(button.createSpan({ cls: 'simple-tasks-popover-icon' }), options.icon);
		};
		if (options.iconTrailing !== true) addIcon();
		if (options.text !== undefined) button.createSpan({ text: options.text });
		if (options.iconTrailing === true) addIcon();
		setTooltip(button, options.label, { placement: 'top' });
		this.buttonScope?.registerDomEvent(button, 'click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			onClick();
		});
		return button;
	}

	private renderStatuses(root: HTMLElement): void {
		if (!this.task.isTask) return;
		const items = this.row(root, t('popover.status'));
		for (const status of this.plugin.settings.statuses) {
			this.button(
				items,
				{
					text: status.symbol === ' ' ? '·' : status.symbol,
					label: t('popover.setStatus', { name: status.name }),
					pressed: status.symbol === this.task.status,
				},
				() => {
					void this.run(() => setTaskStatus(this.plugin, this.task, status.symbol), {
						status: status.symbol,
					});
				}
			);
		}
	}

	private renderPriorities(root: HTMLElement): void {
		const items = this.row(root, t('popover.priority'));
		const priorities: TaskPriority[] = ['highest', 'high', 'medium', 'low', 'lowest'];
		for (const priority of priorities) {
			this.button(
				items,
				{
					text: PRIORITY_EMOJI[priority],
					label: t('popover.setPriority', { name: t(`priority.${priority}`) }),
					pressed: this.task.priority === priority,
				},
				() => {
					void this.run(() => setTaskPriority(this.plugin, this.task, priority), { priority });
				}
			);
		}
		this.button(
			items,
			{
				icon: 'x',
				label: t('popover.clearPriority'),
				pressed: this.task.priority === null,
			},
			() => {
				void this.run(() => setTaskPriority(this.plugin, this.task, null), { priority: null });
			}
		);
	}

	private renderMove(root: HTMLElement): void {
		const items = this.row(root, t('popover.moveTo'));
		this.button(items, { text: t('common.today'), label: t('popover.moveToToday') }, () => {
			void this.relocate(() => moveTaskToDate(this.plugin, this.task, relativeDate(0)));
		});
		this.button(items, { text: t('common.tomorrow'), label: t('popover.moveToTomorrow') }, () => {
			void this.relocate(() => moveTaskToDate(this.plugin, this.task, relativeDate(1)));
		});
		this.button(items, { icon: 'calendar', label: t('popover.moveToDate') }, () => {
			const task = this.task;
			this.close();
			new DatePickerModal(this.plugin.app, null, (date) => {
				void moveTaskToDate(this.plugin, task, date);
			}).open();
		});
		this.button(items, { icon: 'file-input', label: t('popover.moveToNote') }, () => {
			const task = this.task;
			this.close();
			pickNoteTarget(
				this.plugin.app,
				(target) => {
					void moveTask(this.plugin, task, {
						path: target.file.path,
						heading: target.heading,
						headingLevel: target.headingLevel,
					});
				},
				{}
			);
		});
	}

	private renderDue(root: HTMLElement): void {
		const items = this.row(root, t('popover.due'));
		const field = this.plugin.settings.rescheduleField;
		const current = this.task.dates[field];
		if (current !== undefined) {
			items.createSpan({ cls: 'simple-tasks-popover-value', text: current });
		}
		this.button(items, { text: t('common.today'), label: t('popover.dueToday') }, () => {
			void this.run(() => rescheduleTask(this.plugin, this.task, relativeDate(0)), {
				dates: { ...this.task.dates, [field]: relativeDate(0) },
			});
		});
		this.button(items, { text: t('common.tomorrow'), label: t('popover.dueTomorrow') }, () => {
			void this.run(() => rescheduleTask(this.plugin, this.task, relativeDate(1)), {
				dates: { ...this.task.dates, [field]: relativeDate(1) },
			});
		});
		this.button(items, { icon: 'calendar-clock', label: t('popover.dueDate') }, () => {
			const task = this.task;
			this.close();
			new DatePickerModal(this.plugin.app, current ?? null, (date) => {
				void rescheduleTask(this.plugin, task, date);
			}).open();
		});
		if (current !== undefined) {
			this.button(items, { icon: 'calendar-x', label: t('popover.dueClear') }, () => {
				const dates = { ...this.task.dates };
				delete dates[field];
				void this.run(() => rescheduleTask(this.plugin, this.task, null), { dates });
			});
		}
	}

	private renderTags(root: HTMLElement): void {
		const items = this.row(root, t('popover.tags'));
		if (this.task.ownTags.length === 0) {
			items.createSpan({ cls: 'simple-tasks-popover-value', text: t('popover.noTags') });
		}
		for (const tag of this.task.ownTags) {
			const remove = { text: tag, icon: 'x', iconTrailing: true, label: t('popover.removeTag', { tag }) };
			this.button(items, remove, () => {
				void this.run(() => removeTaskTag(this.plugin, this.task, tag), {
					ownTags: this.task.ownTags.filter((existing) => existing !== tag),
				});
			});
		}
		this.button(items, { icon: 'plus', label: t('popover.addTag') }, () => {
			new TagSuggestModal(
				this.plugin.app,
				this.plugin.index,
				{ exclude: this.task.ownTags },
				(tag) => {
					void this.run(() => addTaskTag(this.plugin, this.task, tag), {
						ownTags: [...this.task.ownTags, tag],
					});
				}
			).open();
		});
	}

	private renderFooter(root: HTMLElement): void {
		const footer = root.createDiv({ cls: 'simple-tasks-popover-footer' });
		this.button(footer, { icon: 'file-symlink', label: t('popover.openNote') }, () => {
			const task = this.task;
			this.close();
			void openTaskAt(this.plugin.app, task.path, task.line);
		});
		this.button(footer, { icon: 'check-check', label: t('command.cycleStatus') }, () => {
			void this.run(() => cycleTaskStatus(this.plugin, this.task), {});
		});
		this.button(footer, { icon: 'x', label: t('popover.close') }, () => {
			this.close();
		});
	}

	/* -------------------------------------------------- action plumbing */

	/**
	 * Runs a write and repaints. The optimistic patch is what keeps the popover
	 * from showing the pre-write state for the 400 ms the index takes to notice.
	 */
	private async run(action: () => Promise<boolean>, patch: Partial<Task>): Promise<void> {
		const ok = await action();
		if (!ok) return;
		this.task = { ...this.task, ...patch };
		this.options.onChanged?.();
		if (!this.closed) this.render();
	}

	/** Runs a write that moves the task elsewhere, after which there is nothing to show. */
	private async relocate(action: () => Promise<unknown>): Promise<void> {
		this.close();
		await action();
		this.options.onChanged?.();
	}

	/**
	 * Places the popover under its anchor — or under a bare point, when the caller
	 * gave one — flipping above when the bottom of the window is closer than the
	 * popover is tall. The coordinates go through CSS custom properties: assigning
	 * literal styles is what the linter forbids, and a custom property is also what
	 * lets a theme override the offsets.
	 */
	private position(anchor: HTMLElement): void {
		const host = this.containerEl;
		const { at } = this.options;
		// A zero-sized rect at the point makes the flip and the clamp below work out
		// the same for both cases, with no second branch to keep in step.
		const rect =
			at === undefined ? anchor.getBoundingClientRect() : new DOMRect(at.x, at.y, 0, 0);
		const { innerHeight, innerWidth } = host.win;
		const size = host.getBoundingClientRect();
		const below = innerHeight - rect.bottom;
		const top = below >= size.height || below >= rect.top ? rect.bottom : rect.top - size.height;
		const left = Math.max(4, Math.min(rect.left, innerWidth - size.width - 4));
		host.style.setProperty('--st-popover-top', `${String(Math.round(top))}px`);
		host.style.setProperty('--st-popover-left', `${String(Math.round(left))}px`);
	}
}
