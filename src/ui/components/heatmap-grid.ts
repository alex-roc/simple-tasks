import { setTooltip } from 'obsidian';
import { t } from '../../i18n/index.ts';
import type { HeatmapCalendar, HeatmapDay } from '../../index/stats.ts';

/**
 * The contribution-graph grid: one column per week, one cell per day.
 *
 * Rendering only. The calendar itself is built by `index/stats.ts`, which is
 * pure and unit-tested; this file turns it into DOM and wires the keyboard.
 *
 * ## Accessibility
 *
 * A year is 365 cells, so tabbing through them one by one would be hostile.
 * The grid uses the roving-tabindex pattern instead: it is a single tab stop,
 * and the arrows move within it — left/right by week, up/down by day, matching
 * what the eye sees. Every cell is a real `<button>` with its own `aria-label`,
 * so Enter and Space work without a keydown handler and a screen reader reads
 * the date and the count rather than a coloured box.
 *
 * The two listeners below are on the grid, not on the cells: 365 of them would
 * be 730 listeners rebuilt on every repaint. They are added with
 * `addEventListener` rather than through a component because the element they
 * sit on is discarded with the render, so there is nothing to unregister.
 */

export interface HeatmapGridOptions {
	calendar: HeatmapCalendar;
	/** Weekday names, week-start first, already localized. */
	weekdayNames: readonly string[];
	/** Month names indexed 0-11, already localized. */
	monthNames: readonly string[];
	/** Full sentence used as both tooltip and `aria-label`. */
	describe: (day: HeatmapDay) => string;
	/** The cell that owns the tab stop. Falls back to the last day in range. */
	focusedDate: string | null;
	onFocusDate: (date: string) => void;
	onSelectDate: (date: string) => void;
}

/** Weekday rows that get a label, so they do not crowd each other. */
const LABELLED_ROWS = new Set([1, 3, 5]);

export function renderHeatmapGrid(container: HTMLElement, options: HeatmapGridOptions): void {
	const { calendar } = options;
	const root = container.createDiv({ cls: 'simple-tasks-heatmap-grid' });

	const days = calendar.weeks.flatMap((week) => week.days.filter(isDay));
	if (days.length === 0) {
		root.createDiv({ cls: 'simple-tasks-heatmap-empty', text: t('heatmap.empty') });
		return;
	}
	const focused = options.focusedDate ?? days[days.length - 1]?.date ?? null;

	// The scroller holds only the calendar: the legend must not scroll away with it.
	const scroll = root.createDiv({ cls: 'simple-tasks-heatmap-scroll' });

	const months = scroll.createDiv({ cls: 'simple-tasks-heatmap-months' });
	const byColumn = new Map(calendar.months.map((label) => [label.column, label]));
	for (let column = 0; column < calendar.weeks.length; column += 1) {
		const label = byColumn.get(column);
		months.createDiv({
			cls: 'simple-tasks-heatmap-month',
			text: label === undefined ? '' : (options.monthNames[label.month] ?? ''),
		});
	}

	const body = scroll.createDiv({ cls: 'simple-tasks-heatmap-body' });

	const weekdays = body.createDiv({ cls: 'simple-tasks-heatmap-weekdays' });
	weekdays.setAttribute('aria-hidden', 'true');
	for (let row = 0; row < 7; row += 1) {
		weekdays.createDiv({
			cls: 'simple-tasks-heatmap-weekday',
			text: LABELLED_ROWS.has(row) ? (options.weekdayNames[row] ?? '') : '',
		});
	}

	const grid = body.createDiv({ cls: 'simple-tasks-heatmap-weeks' });
	grid.setAttribute('role', 'grid');
	grid.setAttribute('aria-label', t('heatmap.gridLabel'));

	const cells = new Map<string, HTMLButtonElement>();
	for (const week of calendar.weeks) {
		const column = grid.createDiv({ cls: 'simple-tasks-heatmap-week' });
		column.setAttribute('role', 'row');
		for (const day of week.days) {
			if (day === null) {
				const filler = column.createDiv({ cls: 'simple-tasks-heatmap-filler' });
				filler.setAttribute('role', 'presentation');
				continue;
			}
			const cell = column.createEl('button', {
				cls: 'simple-tasks-heatmap-cell',
				attr: {
					type: 'button',
					role: 'gridcell',
					'data-level': String(day.level),
					'data-date': day.date,
					'aria-label': options.describe(day),
					tabindex: day.date === focused ? '0' : '-1',
				},
			});
			setTooltip(cell, options.describe(day), { placement: 'top' });
			cells.set(day.date, cell);
		}
	}

	const orderedDates = days.map((day) => day.date);

	const focus = (date: string): void => {
		for (const [key, cell] of cells) cell.tabIndex = key === date ? 0 : -1;
		cells.get(date)?.focus();
		options.onFocusDate(date);
	};

	const move = (from: string, offset: number): void => {
		const index = orderedDates.indexOf(from);
		if (index === -1) return;
		const target = orderedDates[clamp(index + offset, 0, orderedDates.length - 1)];
		if (target !== undefined) focus(target);
	};

	grid.addEventListener('click', (event) => {
		const date = dateOf(event.target);
		if (date !== null) options.onSelectDate(date);
	});

	grid.addEventListener('keydown', (event) => {
		const date = dateOf(event.target);
		if (date === null) return;
		const step = keyStep(event.key);
		if (step === null) return;
		event.preventDefault();
		if (step === 'first') focus(orderedDates[0] ?? date);
		else if (step === 'last') focus(orderedDates[orderedDates.length - 1] ?? date);
		else move(date, step);
	});

	const legend = root.createDiv({ cls: 'simple-tasks-heatmap-legend' });
	legend.createSpan({ cls: 'simple-tasks-heatmap-legend-text', text: t('heatmap.less') });
	for (let level = 0; level <= 4; level += 1) {
		const swatch = legend.createDiv({ cls: 'simple-tasks-heatmap-cell' });
		swatch.setAttribute('data-level', String(level));
		swatch.setAttribute('aria-hidden', 'true');
	}
	legend.createSpan({ cls: 'simple-tasks-heatmap-legend-text', text: t('heatmap.more') });

	// A year is wider than a sidebar. Start at the recent end, which is what the
	// user came to look at. Done twice on purpose: the synchronous assignment
	// avoids a visible jump, and the frame callback catches the renders where the
	// grid has not been laid out yet and `scrollWidth` is still zero.
	scroll.scrollLeft = scroll.scrollWidth;
	scroll.win.requestAnimationFrame(() => {
		if (scroll.isConnected) scroll.scrollLeft = scroll.scrollWidth;
	});
}

function isDay(day: HeatmapDay | null): day is HeatmapDay {
	return day !== null;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/** Left and right jump a week, up and down a day: the grid is column-major. */
function keyStep(key: string): number | 'first' | 'last' | null {
	switch (key) {
		case 'ArrowLeft':
			return -7;
		case 'ArrowRight':
			return 7;
		case 'ArrowUp':
			return -1;
		case 'ArrowDown':
			return 1;
		case 'PageUp':
			return -28;
		case 'PageDown':
			return 28;
		case 'Home':
			return 'first';
		case 'End':
			return 'last';
		default:
			return null;
	}
}

function dateOf(target: EventTarget | null): string | null {
	if (!(target instanceof HTMLElement)) return null;
	const cell = target.closest('.simple-tasks-heatmap-cell');
	return cell instanceof HTMLElement ? cell.dataset.date ?? null : null;
}
