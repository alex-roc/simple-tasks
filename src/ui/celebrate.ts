import { Component, MarkdownView } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { CompletionLedger, particleField, planCelebration } from '../domain/celebrate.ts';
import type { Task } from '../domain/task.ts';
import type SimpleTasksPlugin from '../main.ts';

/**
 * The completion burst: a short particle animation fired when a task is
 * actually finished.
 *
 * ## Two hooks, because there are two ways to finish a task
 *
 * **The plugin's own routes** — the agenda checkbox, the popover in a view, the
 * popover in the editor, the Bases view, the `Cycle task status` command — all
 * go through `actions/cycle-status.ts:setTaskStatus()`, which is the single
 * place that knows a task moved into a completed status, and the only one that
 * calls {@link CompletionCelebrations.onCompleted}. A sixth such route inherits
 * the burst for free.
 *
 * **The editor** is not one of those routes and never can be. Clicking the
 * native checkbox in live preview or reading view, or typing the `x` by hand,
 * is Obsidian writing the line — no code of ours runs. The only place that
 * still sees it is the indexer, which already diffs each note against what it
 * knew a moment ago in order to feed the completion log. That same diff calls
 * {@link CompletionCelebrations.onObservedCompletions}. There is no second
 * detector, and the log's `seeding` guard — nothing is a transition until the
 * note has been seen once — is what keeps a cold start over a vault of
 * thousands of completed tasks silent.
 *
 * The two hooks overlap by design: a status change made from the agenda is also
 * observed by the indexer 400 ms later. {@link CompletionCelebrations.judge}
 * settles that, once per completion, on whichever hook gets there first.
 *
 * ## Where the burst appears
 *
 * A completion made through `actions/` has no element to point at, so the
 * anchor is resolved when the burst fires:
 *
 * 1. the last pointer press, when it is recent enough to be the cause;
 * 2. otherwise the focused element — which is where a keyboard user is
 *    looking, including the editor's active line for the command;
 * 3. otherwise the centre of the workspace, so a scripted completion still
 *    shows something rather than drawing in a corner.
 *
 * A completion observed in a note is anchored to **the line itself**, in a pane
 * that is actually showing it, and to nothing else — see {@link lineAnchor}.
 * Refusing to draw is deliberate there: a note edited outside Obsidian or
 * arriving over sync must not set off fireworks, and "somewhere in the middle of
 * the workspace" is worse than nothing when the user is not even looking at the
 * task.
 *
 * ## Not leaking
 *
 * Every burst is one element with one timer. Both are tracked, the timer
 * removes the element, and unloading the plugin clears the timers and removes
 * whatever is still on screen — so a reload mid-animation cannot leave an
 * orphan node behind. Concurrent bursts are capped: completing thirty tasks
 * from a script must not put thirty overlays in the DOM.
 */

/** How long the whole animation runs, including the per-particle delay. */
const BURST_MS = 600;

/** Slack before the host is removed, so nothing is cut off mid-frame. */
const CLEANUP_SLACK_MS = 250;

/** A pointer press older than this did not cause the completion. */
const POINTER_FRESH_MS = 2000;

/** Overlays alive at once. Beyond this a completion updates silently. */
const MAX_ACTIVE_BURSTS = 3;

/**
 * How long a completion stays judged.
 *
 * It has to outlast the write plus the index's 400 ms debounce, which is what
 * separates the two hooks seeing the same completion, and stay well short of
 * anything a human could plausibly re-complete in.
 */
const JUDGED_MS = 4000;

/** Obsidian's own view type for a markdown pane. */
const MARKDOWN_VIEW_TYPE = 'markdown';

/** Class Obsidian puts on the checkbox it renders for a task line. */
const RENDERED_CHECKBOX_CLASS = 'task-list-item-checkbox';

/** Where the burst is drawn, in viewport coordinates of `doc`. */
interface BurstPoint {
	doc: Document;
	x: number;
	y: number;
}

export class CompletionCelebrations extends Component {
	private readonly plugin: SimpleTasksPlugin;

	/** Live overlays and the timer that will remove each one. */
	private readonly active = new Map<HTMLElement, { win: Window; timer: number }>();

	private lastPointer: (BurstPoint & { at: number; onCheckbox: boolean }) | null = null;

	/**
	 * Completions already ruled on. The decision itself is pure and lives in
	 * `domain/celebrate.ts`; a stale entry can only ever suppress a burst, never
	 * invent one.
	 */
	private readonly judged = new CompletionLedger(JUDGED_MS);

	/** Bumped per burst so two bursts in a row are not the same shape. */
	private seed = 1;

	constructor(plugin: SimpleTasksPlugin) {
		super();
		this.plugin = plugin;
	}

	onload(): void {
		this.watch(this.plugin.app.workspace.containerEl.doc);
		// Popout windows have their own document; a burst drawn in the main window
		// would be invisible to a user working in a popout.
		this.registerEvent(
			this.plugin.app.workspace.on('window-open', (workspaceWindow) => {
				this.watch(workspaceWindow.doc);
			})
		);
	}

	onunload(): void {
		for (const [host, { win, timer }] of this.active) {
			win.clearTimeout(timer);
			host.remove();
		}
		this.active.clear();
	}

	/**
	 * A task just moved into a completed status. Decides whether that is worth
	 * celebrating (see `domain/celebrate.ts`) and draws it if so.
	 *
	 * The subtree comes from the index, which is debounced, so the children's
	 * statuses can be up to one write old. That is the right trade: re-reading
	 * the note here would mean a second file read on every checkbox click, to
	 * refine a decision about an animation.
	 */
	onCompleted(task: Task): void {
		// Judged even when it will not be celebrated: the indexer is about to see
		// the same transition, and "a parent with pending children gets nothing" has
		// to be the verdict for the completion, not for one of its two observers.
		this.judge(task);
		if (!this.plugin.settings.celebrateCompletions) return;
		const plan = planCelebration(this.plugin.index.subtree(task.path, task.line));
		if (!plan.celebrate) return;
		this.burst(plan.particles);
	}

	/**
	 * Transitions the indexer saw in the notes of one flush — the route a
	 * checkbox ticked in the editor takes.
	 *
	 * **At most one burst per flush.** A single edit can complete several tasks
	 * (a paste, an undo, a find-and-replace) and one edit deserves one piece of
	 * feedback; the particle count already grows with the subtree a completion
	 * closes, so the size carries the magnitude. The ones already judged do not
	 * spend that budget — they were another hook's, and skipping them must not
	 * hide a genuine editor completion in the same flush.
	 */
	onObservedCompletions(tasks: readonly Task[]): void {
		for (const task of tasks) {
			if (this.judged.has(markOf(task), Date.now())) continue;
			this.judge(task);
			if (this.celebrateInNote(task)) return;
		}
	}

	/**
	 * One completion observed in a note. Returns whether a burst was drawn, which
	 * is what caps a flush at one.
	 */
	private celebrateInNote(task: Task): boolean {
		if (!this.plugin.settings.celebrateCompletions) return false;
		const point = this.lineAnchor(task);
		if (point === null) return false;
		const plan = planCelebration(this.plugin.index.subtree(task.path, task.line));
		if (!plan.celebrate) return false;
		return this.burst(plan.particles, point);
	}

	/** Records that this completion has been ruled on, whatever the ruling was. */
	private judge(task: Task): void {
		this.judged.record(markOf(task), Date.now());
	}

	/** Fires a burst at `point`, or at the current anchor. Public for checks. */
	burst(particles: number, at?: BurstPoint): boolean {
		if (this.active.size >= MAX_ACTIVE_BURSTS) return false;
		const point = at ?? this.anchor();
		const win = point.doc.defaultView;
		if (win === null) return false;
		// Honoured in CSS too, but a user who asked for no motion should not get
		// the nodes either — this way there is nothing to animate, not even a
		// stylesheet away from moving.
		if (win.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;

		const host = point.doc.body.createDiv({ cls: 'simple-tasks-burst' });
		host.setAttribute('aria-hidden', 'true');
		// Custom properties rather than literal styles: the linter forbids the
		// latter and a theme can override the former.
		host.style.setProperty('--st-burst-x', `${String(Math.round(point.x))}px`);
		host.style.setProperty('--st-burst-y', `${String(Math.round(point.y))}px`);

		this.seed += 1;
		for (const particle of particleField(particles, this.seed)) {
			const dot = host.createDiv({ cls: 'simple-tasks-burst-particle' });
			dot.style.setProperty('--st-burst-dx', String(particle.dx));
			dot.style.setProperty('--st-burst-dy', String(particle.dy));
			dot.style.setProperty('--st-burst-delay', `${String(Math.round(particle.delay * BURST_MS))}ms`);
			dot.style.setProperty('--st-burst-scale', String(particle.scale));
		}

		const timer = win.setTimeout(() => {
			this.active.delete(host);
			host.remove();
		}, BURST_MS + CLEANUP_SLACK_MS);
		this.active.set(host, { win, timer });
		return true;
	}

	/** Overlays currently in the DOM. The assertion an orphan-node check needs. */
	get activeCount(): number {
		return this.active.size;
	}

	private watch(doc: Document): void {
		// Capture phase: a handler that stops propagation must not blind us to the
		// click that is about to complete a task.
		this.registerDomEvent(
			doc,
			'pointerdown',
			(event) => {
				const target = event.target;
				this.lastPointer = {
					doc,
					x: event.clientX,
					y: event.clientY,
					at: Date.now(),
					// Whether the press landed on a rendered checkbox. That is not a
					// heuristic about *where* to draw but about *whether* to: it is the
					// one piece of evidence that a completion arriving through the
					// indexer was a person clicking, and not a sync landing.
					onCheckbox:
						target instanceof HTMLElement &&
						target.closest(`.${RENDERED_CHECKBOX_CLASS}`) !== null,
				};
			},
			{ capture: true }
		);
	}

	/**
	 * Where to draw a completion observed in a note: **the line, in a pane that
	 * is showing it**.
	 *
	 * In an **editing** mode — source and live preview alike, since live preview
	 * is still CodeMirror — the line is `coordsAtPos()`, which is exact and needs
	 * nothing rendered. In **reading** view there is no editor to ask, so the
	 * fallback is the last pointer press *on a checkbox*: in a mode where the only
	 * way to complete anything is to click that checkbox, the press is the line.
	 *
	 * Looking the rendered `input.task-list-item-checkbox` up by line was tried
	 * and removed. It cannot work: in live preview those inputs carry no
	 * `data-line` at all, and in reading view the attribute is **relative to the
	 * rendered section**, not to the document — three tasks on lines 2, 3 and 4
	 * come back as 0, 1 and 2. Matching a document line against it silently
	 * anchors the burst to a different task, and reading view keeps the hidden
	 * live-preview checkboxes in the same `containerEl`, so the query is not even
	 * looking at one list.
	 *
	 * Failing both, `null`: the note is not on screen, so the edit came from
	 * somewhere else and there is nowhere honest to draw.
	 *
	 * The resolved point must land inside the pane's own box. That single check
	 * rules out both a background tab (`display: none`, everything measures zero)
	 * and a line scrolled out of view, either of which would put the burst in a
	 * corner of the window.
	 */
	private lineAnchor(task: Task): BurstPoint | null {
		for (const leaf of this.plugin.app.workspace.getLeavesOfType(MARKDOWN_VIEW_TYPE)) {
			const { view } = leaf;
			if (!(view instanceof MarkdownView) || view.file?.path !== task.path) continue;
			const point = editorLinePoint(view.containerEl.doc, view, task.line);
			if (point !== null && within(point, view.containerEl)) return point;
		}
		const pointer = this.lastPointer;
		if (pointer !== null && pointer.onCheckbox && Date.now() - pointer.at < POINTER_FRESH_MS) {
			return { doc: pointer.doc, x: pointer.x, y: pointer.y };
		}
		return null;
	}

	private anchor(): BurstPoint {
		const pointer = this.lastPointer;
		if (pointer !== null && Date.now() - pointer.at < POINTER_FRESH_MS) {
			return { doc: pointer.doc, x: pointer.x, y: pointer.y };
		}

		const container = this.plugin.app.workspace.containerEl;
		const doc = container.doc;
		const focused = doc.activeElement;
		if (focused instanceof HTMLElement) {
			// Inside the editor the focused element is the whole content area, which
			// would put the burst in its middle; the active line is where the caret
			// — and the task the command just completed — actually is.
			const line = focused.querySelector<HTMLElement>('.cm-line.cm-active');
			const point = centreOf(doc, line ?? focused);
			// A collapsed rect means the focused element is not on screen — a hidden
			// input, or `body` in a window that has never been clicked. Drawing there
			// puts the burst in the top-left corner, which reads as a glitch.
			if (point !== null) return point;
		}
		return centreOf(doc, container) ?? { doc, x: 0, y: 0 };
	}
}

/** The centre of an element, or `null` when it has no box to speak of. */
function centreOf(doc: Document, element: HTMLElement): BurstPoint | null {
	const rect = element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return null;
	return { doc, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function markOf(task: Task): string {
	return CompletionLedger.mark(task.path, task.line);
}

/**
 * CodeMirror's coordinates for the start of a line — the route for source mode
 * and live preview, which are the same editor. Only in an editing mode: in
 * reading view the editor is still there but hidden, and its coordinates
 * describe nothing on screen.
 *
 * `view.editor.cm` is the documented way to the `EditorView` — the same one
 * `registerEditorExtension` extends — but it is not in the published typings,
 * so the shape is checked rather than asserted.
 */
function editorLinePoint(doc: Document, view: MarkdownView, line: number): BurstPoint | null {
	if (view.getMode() === 'preview') return null;
	const editor = editorViewOf(view);
	if (editor === null) return null;
	// CodeMirror lines are 1-based; the index is 0-based, like `ListItemCache`.
	if (line < 0 || line + 1 > editor.state.doc.lines) return null;
	const coords = editor.coordsAtPos(editor.state.doc.line(line + 1).from);
	// A caret position has no width and, in a pane that is not laid out, no
	// height either — which is the degenerate rect that once drew in the corner.
	if (coords === null || coords.bottom <= coords.top) return null;
	return { doc, x: coords.left, y: (coords.top + coords.bottom) / 2 };
}

function editorViewOf(view: MarkdownView): EditorView | null {
	const candidate = (view.editor as unknown as { cm?: unknown }).cm;
	if (typeof candidate !== 'object' || candidate === null) return null;
	return 'coordsAtPos' in candidate ? (candidate as EditorView) : null;
}

/** Whether a point falls inside an element that actually occupies space. */
function within(point: BurstPoint, element: HTMLElement): boolean {
	const rect = element.getBoundingClientRect();
	if (rect.width <= 0 || rect.height <= 0) return false;
	return (
		point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
	);
}
