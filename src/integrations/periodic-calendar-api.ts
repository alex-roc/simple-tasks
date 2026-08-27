/**
 * Periodic Calendar public API — **a verbatim copy** of `src/api/types.ts` from the
 * Periodic Calendar repository, taken at contract version 1.
 *
 * It is copied rather than imported on purpose: Simple Tasks must build, lint
 * and run with Periodic Calendar absent from the machine, exactly like any other
 * third-party consumer. Nothing in `src/` may import from the other repo.
 *
 * Re-copy the file wholesale when the contract version changes; do not edit it
 * here. The only local addition is this header.
 *
 * ---
 */

import type { Menu, TFile } from 'obsidian';

/**
 * `moment` is provided globally by Obsidian; we only need the type here.
 * Exported so consumers implementing `CalendarSource` by hand don't have to
 * re-derive the same expression.
 */
export type Moment = ReturnType<typeof window.moment>;

/**
 * A period a calendar cell can represent. `day` and `week` are rendered by the
 * month grid; the coarser ones are the header's period buttons. Sources are
 * consulted for all of them.
 */
export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'semester' | 'year';

/** A small colored marker rendered inside a calendar cell. */
export interface Dot {
	/**
	 * Appended to the dot element's class list, for CSS targeting. It is
	 * namespaced with the source id before reaching the DOM, so two sources
	 * cannot collide, and characters invalid in a class name are stripped.
	 */
	className?: string;
	/**
	 * A CSS color *value or variable*, e.g. `var(--color-accent)`.
	 * Never a literal hex: the calendar must follow the user's theme.
	 */
	color?: string;
	/** Filled dots read as "present"; hollow ones as "pending". */
	isFilled?: boolean;
}

/** What a source contributes to a single calendar cell. */
export interface CellMetadata {
	/** Markers to render in the cell. Keep it to a handful; space is tight. */
	dots?: Dot[];
	/**
	 * A magnitude for this cell. Depending on the user's display setting it is
	 * rendered as a number or as a background intensity.
	 */
	value?: number;
	/**
	 * The maximum `value` is measured against when rendering intensity. Supply it
	 * when you know your own range — say 100 for a percentage — and the shading
	 * stays stable as the user moves between months. Without it the calendar
	 * scales against the largest value currently on screen, which means the same
	 * number can shade differently in different months.
	 */
	valueScale?: number;
	/**
	 * Extra classes on the cell element, for CSS targeting. Namespaced with the
	 * source id and sanitized, like `Dot.className`.
	 */
	classes?: string[];
	/** Tooltip text, shown on hover. Plain text, no markup. */
	tooltip?: string;
}

/**
 * A contributor of per-cell information to the calendar.
 *
 * Sources are called once per visible cell on every render, so `getMetadata`
 * must be cheap: read from an in-memory index, never scan the vault. Returning
 * a promise is allowed; the cell updates when it resolves, unless a newer
 * repaint has already superseded it.
 *
 * A source that throws is caught and skipped for that cell. One that throws on
 * every cell of a pass is degraded — it stops being queried until the next
 * `refresh()` naming it — so a broken source can never take the calendar down.
 *
 * **How contributions combine** when several sources answer for the same cell,
 * in registration order: dots are concatenated, classes are concatenated,
 * tooltips are joined with newlines, and values are **summed**.
 */
export interface CalendarSource {
	/** Stable, unique. Convention: the contributing plugin's id. */
	id: string;
	/** Human-readable, sentence case. Labels this source's toggle in settings. */
	name: string;

	/**
	 * Information for the cell representing `date` at `granularity`.
	 * Return `null` to contribute nothing to this cell.
	 */
	getMetadata(
		date: Moment,
		granularity: Granularity
	): CellMetadata | null | Promise<CellMetadata | null>;

	/**
	 * Whether this source would accept a drop of `evt`'s payload. Called on
	 * dragover to decide if the cell should present itself as a drop target, so
	 * it must be synchronous and cheap. Omit it and the source is assumed
	 * interested in every drag, which makes cells look droppable for payloads
	 * nobody will take.
	 */
	canDrop?(date: Moment, granularity: Granularity, evt: DragEvent): boolean;

	/**
	 * Called when something is dropped on a calendar cell. Return `true` if the
	 * drop was handled, which stops other sources from receiving it.
	 */
	onDrop?(date: Moment, granularity: Granularity, evt: DragEvent): boolean;

	/** Add items to a cell's context menu. Called before the menu is shown. */
	onContextMenu?(date: Moment, granularity: Granularity, menu: Menu): void;
}

/** Events a consumer can subscribe to. */
export interface PeriodicCalendarEvents {
	/**
	 * A cell was activated, by mouse or by keyboard. Fires for every
	 * granularity, not only days — check `granularity`.
	 */
	'cell-click': (
		date: Moment,
		granularity: Granularity,
		evt: MouseEvent | KeyboardEvent
	) => void;
	'month-change': (displayedMonth: Moment) => void;
	/** Fired after a drop was accepted by some source. */
	'date-drop': (date: Moment, granularity: Granularity) => void;
}

export interface PeriodicCalendarApi {
	/** Contract version. Check it before using anything below. */
	readonly version: 1;

	/**
	 * Register a source. Returns an unregister function — call it in your
	 * plugin's `onunload`, or pass it to `this.register()`.
	 * Registering an id that already exists replaces the previous source; the
	 * superseded unregister function then does nothing.
	 */
	registerSource(source: CalendarSource): () => void;

	/**
	 * Ask the calendar to re-query sources and repaint. Pass a source id to say
	 * that only that source's data changed; treat it as a hint rather than a
	 * guarantee of narrower work. Naming a degraded source also revives it.
	 *
	 * A silent no-op when no calendar view is open — there is nothing to repaint.
	 * It is cheap enough to call unconditionally from a vault listener.
	 */
	refresh(sourceId?: string): void;

	/**
	 * The note for a period, or `null` if it does not exist or that granularity
	 * is not configured. Resolving this yourself would mean re-reading the core
	 * Daily notes settings and the Periodic Notes plugin's data, so the calendar
	 * — which already does it — exposes the answer.
	 */
	resolveNote(date: Moment, granularity: Granularity): TFile | null;

	/**
	 * Open the calendar view, or reveal it if it is already open. Resolves once
	 * the view exists, so `revealDate` right after it will find something to move.
	 *
	 * Without this, a consumer wanting to show the calendar would have to hardcode
	 * the view type — a string outside this contract that could change without a
	 * version bump.
	 */
	openView(): Promise<void>;

	/**
	 * Switch the calendar to the month containing `date`. A no-op when no calendar
	 * view is open — `await openView()` first if you need one; applies to all of
	 * them when several are.
	 *
	 * `granularity` only decides which cell takes the keyboard focus: the grid
	 * always displays a month, so revealing a quarter and revealing a day inside
	 * it land on the same view.
	 */
	revealDate(date: Moment, granularity: Granularity): void;

	/**
	 * The month currently displayed, as a moment at its first day. Answers for
	 * the first open view, or the current month when none is open.
	 */
	getDisplayedMonth(): Moment;

	/** Subscribe to a calendar event. Returns an unsubscribe function. */
	on<K extends keyof PeriodicCalendarEvents>(
		event: K,
		callback: PeriodicCalendarEvents[K]
	): () => void;
}
