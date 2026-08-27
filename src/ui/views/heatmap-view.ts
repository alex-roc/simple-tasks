import { ItemView, debounce } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import { buildHeatmapCalendar } from '../../index/stats.ts';
import type { HeatmapDay, TaskStats } from '../../index/stats.ts';
import { INDEX_CHANGED } from '../../index/task-index.ts';
import { t, tCount } from '../../i18n/index.ts';
import type SimpleTasksPlugin from '../../main.ts';
import { renderHeatmapGrid } from '../components/heatmap-grid.ts';

/**
 * Sidebar view: a year of completions as a contribution graph, with whichever
 * derived stats the user asked for beside it.
 *
 * ## The grid is the view; everything else is opt-in
 *
 * The panel used to be a fixed stack of six things. It is now four independent
 * sections (level, streak cards, summary, top tags) and only the level is on by
 * default, so the view opens as what it is called. The check is made *before*
 * the panel element exists: it is a flex item with a `min-width`, so an empty
 * one would still reserve a column and leave the grid next to a hole.
 *
 * It owns no data. Everything drawn comes from `plugin.stats`, which folds the
 * index on demand and is invalidated by the index's own `changed` event — so
 * the vault stays the single source of truth and the view is free to be
 * destroyed and rebuilt at any time.
 *
 * The view is never opened from `onload`: Obsidian restores sidebar leaves
 * asynchronously, so an auto-open sees zero leaves and creates a duplicate on
 * every reload. The ribbon icon and the command are the only ways in.
 */

export const HEATMAP_VIEW_TYPE = 'simple-tasks-heatmap';

/** Months the grid reaches back. */
const MONTHS_SHOWN = 12;

/** Fallback when the CSS variable is missing or nonsense. */
const DEFAULT_DENSITY = 8;

/** Index changes arrive per keystroke pause; one repaint per burst is plenty. */
const RENDER_DEBOUNCE_MS = 120;

export class HeatmapView extends ItemView {
	private focusedDate: string | null = null;

	private readonly scheduleRender = debounce(() => {
		this.render();
	}, RENDER_DEBOUNCE_MS);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: SimpleTasksPlugin
	) {
		super(leaf);
	}

	getViewType(): string {
		return HEATMAP_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('view.heatmap.title');
	}

	getIcon(): string {
		return 'calendar-range';
	}

	protected onOpen(): Promise<void> {
		// Invalidation is not this view's job: `main.ts` registers it on the same
		// event at load, so the cache is dropped even while the heatmap is closed,
		// and it runs first because it was registered first. Doing it again here
		// only made the design harder to read.
		this.registerEvent(
			this.plugin.index.on(INDEX_CHANGED, () => {
				this.scheduleRender();
			})
		);
		this.render();
		return Promise.resolve();
	}

	protected onClose(): Promise<void> {
		this.scheduleRender.cancel();
		this.contentEl.empty();
		return Promise.resolve();
	}

	/**
	 * Repaints now. The view otherwise only redraws when the index changes, so
	 * turning a section on in the settings would look like it did nothing until
	 * the next edit — `main.ts` calls this after a settings save.
	 */
	refresh(): void {
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('simple-tasks-heatmap');

		const { stats, counts } = this.plugin.stats.get();
		const locale = window.moment.localeData();
		const calendar = buildHeatmapCalendar({
			endDate: window.moment().format('YYYY-MM-DD'),
			months: MONTHS_SHOWN,
			firstDayOfWeek: locale.firstDayOfWeek(),
			counts,
			density: this.density(),
		});

		renderHeatmapGrid(contentEl, {
			calendar,
			weekdayNames: rotate(locale.weekdaysMin(), locale.firstDayOfWeek()),
			monthNames: locale.monthsShort(),
			describe: describeDay,
			focusedDate: this.focusedDate,
			onFocusDate: (date) => {
				this.focusedDate = date;
			},
			onSelectDate: (date) => {
				this.focusedDate = date;
				void this.plugin.showAgendaFor(date);
			},
		});

		this.renderStats(contentEl, stats);
	}

	/**
	 * How many completions a day needs to reach the darkest shade. It lives in
	 * CSS so the Style Settings plugin can offer it as a slider without this
	 * plugin building any UI for it.
	 */
	private density(): number {
		const raw = getComputedStyle(this.contentEl).getPropertyValue('--st-heatmap-density');
		const parsed = Number.parseFloat(raw);
		return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_DENSITY;
	}

	/**
	 * The panel beside the grid, and only the sections the user asked for.
	 *
	 * The panel element itself is created **after** the check, not before: it is a
	 * flex item with a `min-width`, so an empty one would still reserve a column
	 * of the pane and leave the grid sitting next to a hole. With every section
	 * off the grid is simply the view's only child.
	 */
	private renderStats(container: HTMLElement, stats: TaskStats): void {
		const { settings } = this.plugin;
		if (
			!settings.heatmapShowLevel &&
			!settings.heatmapShowTiles &&
			!settings.heatmapShowSummary &&
			!settings.heatmapShowTopTags
		) {
			return;
		}
		const panel = container.createDiv({ cls: 'simple-tasks-stats' });
		if (settings.heatmapShowLevel) this.renderLevel(panel, stats);
		if (settings.heatmapShowTiles) renderTiles(panel, stats);
		if (settings.heatmapShowSummary) renderSummary(panel, stats);
		if (settings.heatmapShowTopTags) renderTopTags(panel, stats);
	}

	private renderLevel(panel: HTMLElement, stats: TaskStats): void {
		const level = panel.createDiv({ cls: 'simple-tasks-stats-level' });
		level.createDiv({
			cls: 'simple-tasks-stats-level-name',
			text: t('stats.level', { count: stats.level }),
		});
		const bar = level.createDiv({ cls: 'simple-tasks-stats-bar' });
		bar.setAttribute('role', 'progressbar');
		bar.setAttribute('aria-valuemin', '0');
		bar.setAttribute('aria-valuemax', String(stats.xpForLevel));
		bar.setAttribute('aria-valuenow', String(stats.xpIntoLevel));
		bar.setAttribute(
			'aria-label',
			t('stats.xpProgress', {
				current: stats.xpIntoLevel,
				total: stats.xpForLevel,
				next: stats.level + 1,
			})
		);
		const fill = bar.createDiv({ cls: 'simple-tasks-stats-bar-fill' });
		const ratio = stats.xpForLevel === 0 ? 0 : stats.xpIntoLevel / stats.xpForLevel;
		fill.style.setProperty('--st-progress', `${String(Math.round(ratio * 100))}%`);
		level.createDiv({
			cls: 'simple-tasks-stats-level-xp',
			text: t('stats.xpSummary', {
				xp: stats.xp,
				remaining: stats.xpForLevel - stats.xpIntoLevel,
			}),
		});
	}
}

function renderTiles(panel: HTMLElement, stats: TaskStats): void {
	const grid = panel.createDiv({ cls: 'simple-tasks-stats-grid' });
	const tiles: [string, string][] = [
		[t('stats.today'), String(stats.completedToday)],
		[t('stats.thisWeek'), String(stats.completedThisWeek)],
		[t('stats.currentStreak'), tCount('common.dayCount', stats.currentStreak)],
		[t('stats.bestStreak'), tCount('common.dayCount', stats.bestStreak)],
		[t('stats.thisMonth'), String(stats.completedThisMonth)],
		[t('stats.perActiveDay'), String(stats.perActiveDay)],
	];
	for (const [label, value] of tiles) {
		const tile = grid.createDiv({ cls: 'simple-tasks-stats-tile' });
		tile.createDiv({ cls: 'simple-tasks-stats-value', text: value });
		tile.createDiv({ cls: 'simple-tasks-stats-label', text: label });
	}
}

function renderSummary(panel: HTMLElement, stats: TaskStats): void {
	const footer = panel.createDiv({ cls: 'simple-tasks-stats-footer' });
	footer.createDiv({
		cls: 'simple-tasks-stats-note',
		text: t('stats.completedOver', {
			count: stats.completedTotal,
			days: tCount('common.activeDayCount', stats.activeDays),
		}),
	});
	if (stats.busiestDay === null) return;
	footer.createDiv({
		cls: 'simple-tasks-stats-note',
		text: t('stats.busiestDay', {
			date: window.moment(stats.busiestDay.date, 'YYYY-MM-DD').format('LL'),
			count: stats.busiestDay.count,
		}),
	});
}

/** Nothing at all when no tag has a completion: a bare subhead is worse. */
function renderTopTags(panel: HTMLElement, stats: TaskStats): void {
	if (stats.topTags.length === 0) return;
	panel.createDiv({ cls: 'simple-tasks-stats-subhead', text: t('stats.topTags') });
	const tags = panel.createDiv({ cls: 'simple-tasks-stats-tags' });
	for (const { tag, count } of stats.topTags) {
		const chip = tags.createDiv({ cls: 'simple-tasks-stats-tag' });
		chip.createSpan({ cls: 'simple-tasks-stats-tag-name', text: tag });
		chip.createSpan({ cls: 'simple-tasks-stats-tag-count', text: String(count) });
	}
}

/**
 * A cell's tooltip. The count needs no footnote any more: a day is the tasks
 * completed in that day's own note, which is what you see on opening it.
 */
function describeDay(day: HeatmapDay): string {
	const date = window.moment(day.date, 'YYYY-MM-DD').format('LL');
	if (day.count === 0) return t('heatmap.dayEmpty', { date });
	return tCount('heatmap.dayCount', day.count, { date });
}

/** Moves the week-start weekday to the front of a Sunday-first list. */
function rotate(names: readonly string[], firstDay: number): string[] {
	return [...names.slice(firstDay), ...names.slice(0, firstDay)];
}
