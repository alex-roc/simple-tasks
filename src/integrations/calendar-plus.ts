import { Events, debounce, moment } from 'obsidian';
import type { App, Menu } from 'obsidian';
import { moveTasksToDate } from '../actions/move-task.ts';
import type { Task } from '../domain/task.ts';
import { INDEX_CHANGED } from '../index/task-index.ts';
import { completionDate, ownDayDate } from '../index/stats.ts';
import { t, tCount } from '../i18n/index.ts';
import type SimpleTasksPlugin from '../main.ts';
import type {
	CalendarPlusApi,
	CalendarSource,
	CellMetadata,
	Dot,
	Granularity,
	Moment,
} from './calendar-plus-api.ts';

/**
 * Optional wiring to **Calendar Plus**: task counts on its cells, tasks dragged
 * from the agenda onto a day, and an entry in a cell's context menu.
 *
 * Three rules shape this file.
 *
 * - **Simple Tasks works whole without it.** Nothing here is imported by the
 *   index, the views or the actions; the contract lives in a copied type file
 *   (`calendar-plus-api.ts`) and the plugin is reached only through
 *   `app.plugins.plugins['calendar-plus'].api`, guarded on `version === 1`.
 * - **Calendar Plus can arrive later.** The user may enable it after us, or
 *   disable and re-enable it mid-session, so the check is re-run on
 *   `workspace.onLayoutReady` and on the plugin manager's own `changed` event.
 *   {@link CalendarPlusIntegration.sync} is idempotent and cheap enough to call
 *   from anywhere.
 * - **`getMetadata` never reads the vault.** It is called once per visible cell
 *   on every repaint. Everything it needs is precomputed in {@link TaskCounts}
 *   from the index and thrown away when the index changes, which is also when
 *   the calendar is asked to repaint.
 */

/** Plugin id of the provider, as it appears in `app.plugins.plugins`. */
export const CALENDAR_PLUS_ID = 'calendar-plus';

/** View type Calendar Plus registers. Not part of the contract — see the docs. */
const CALENDAR_PLUS_VIEW_TYPE = 'calendar-plus';

/** Obsidian deep link that opens a plugin's page in the community browser. */
const INSTALL_URL = `obsidian://show-plugin?id=${CALENDAR_PLUS_ID}`;

/**
 * The drag payload's own MIME type.
 *
 * Without it `canDrop` would have to guess from `text/plain`, and every cell
 * would advertise itself as a drop target for any text the user happens to
 * drag — a promise the source cannot keep. `dataTransfer.types` is readable
 * during `dragover` (the *data* is not), which is exactly what a synchronous
 * `canDrop` needs.
 */
export const TASK_DRAG_MIME = 'application/x-simple-tasks-task';

/** One task in the drag. Enough to find it again after a repaint. */
interface TaskDragEntry {
	path: string;
	line: number;
	/** `cleanText`, the fallback when the line number has moved on. */
	text: string;
}

/**
 * What travels in the drag: **always a list**, even for one task.
 *
 * A painted selection can be dragged onto a day as a whole, so the drop has to
 * handle several; making the single case a list of one means there is one shape to
 * read and one path to test, rather than two that drift.
 */
interface TaskDragPayload {
	tasks: TaskDragEntry[];
}

/** Marks a drag as carrying our tasks. */
export function setTaskDragData(dataTransfer: DataTransfer | null, tasks: readonly Task[]): void {
	if (dataTransfer === null || tasks.length === 0) return;
	const payload: TaskDragPayload = {
		tasks: tasks.map((task) => ({ path: task.path, line: task.line, text: task.cleanText })),
	};
	dataTransfer.setData(TASK_DRAG_MIME, JSON.stringify(payload));
	dataTransfer.effectAllowed = 'move';
}

/** Whether a drag in progress is one of ours. Synchronous, for `canDrop`. */
function carriesTask(evt: DragEvent): boolean {
	return evt.dataTransfer?.types.includes(TASK_DRAG_MIME) === true;
}

/** The tasks in a drop, or an empty list when it is somebody else's drag. */
function readTaskDrag(evt: DragEvent): TaskDragEntry[] {
	const raw = evt.dataTransfer?.getData(TASK_DRAG_MIME);
	if (raw === undefined || raw === '') return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return [];
		const { tasks } = parsed as { tasks?: unknown };
		if (!Array.isArray(tasks)) return [];
		// Every field checked: the payload came off a `DataTransfer`, which anything
		// on the page could have written.
		return tasks.filter((entry: unknown): entry is TaskDragEntry => {
			if (typeof entry !== 'object' || entry === null) return false;
			const { path, line, text } = entry as Partial<TaskDragEntry>;
			return typeof path === 'string' && typeof line === 'number' && typeof text === 'string';
		});
	} catch {
		return [];
	}
}

/**
 * The API when Calendar Plus is installed, enabled and speaking version 1.
 * Anything else is `null`, and `null` is a supported state, not an error.
 */
export function getCalendarPlusApi(app: App): CalendarPlusApi | null {
	const plugins = (app as App & { plugins?: { plugins?: Record<string, unknown> } }).plugins;
	const plugin = plugins?.plugins?.[CALENDAR_PLUS_ID] as { api?: CalendarPlusApi } | undefined;
	return plugin?.api?.version === 1 ? plugin.api : null;
}

/** Opens the plugin's page in the community browser. */
export function openCalendarPlusPage(): void {
	window.open(INSTALL_URL);
}

/* ------------------------------------------------------------------ *
 * Counts
 * ------------------------------------------------------------------ */

/** Completed and still-open tasks of one period. */
interface PeriodCount {
	completed: number;
	open: number;
}

const NO_TASKS: PeriodCount = { completed: 0, open: 0 };

/** At most this many dots of each kind, so a busy day stays readable. */
const MAX_DOTS_PER_KIND = 2;

/**
 * Floor for `valueScale`. Without it a vault whose best day is a single task
 * would paint every one of those days at full intensity.
 */
const MIN_VALUE_SCALE = 4;

/**
 * Everything the source serves, folded out of the index once per change.
 *
 * Two maps rather than one. A **day** cell counts only what belongs to that very
 * day: the tasks written in its own daily note, plus any task whose line carries a
 * completion date. A **period** button — month, quarter, year — legitimately adds
 * the coarser notes inside it, so the tasks of `Cronos/Mensuario/2026-08.md` count
 * towards August. Folding them into one map would spike every first-of-month,
 * since a monthly note is attributed to the 1st.
 */
class TaskCounts {
	private readonly plugin: SimpleTasksPlugin;

	private byDay: Map<string, PeriodCount> | null = null;
	private byDate: Map<string, PeriodCount> | null = null;
	private readonly periods = new Map<string, PeriodCount>();
	private readonly scales = new Map<Granularity, number>();

	constructor(plugin: SimpleTasksPlugin) {
		this.plugin = plugin;
	}

	invalidate(): void {
		this.byDay = null;
		this.byDate = null;
		this.periods.clear();
		this.scales.clear();
	}

	/** The counts of the period `date` falls in, at `granularity`. */
	forPeriod(date: string, granularity: Granularity): PeriodCount {
		this.build();
		if (granularity === 'day') return this.byDay?.get(date) ?? NO_TASKS;
		const range = periodRange(date, granularity);
		const key = `${granularity}:${range.start}`;
		const cached = this.periods.get(key);
		if (cached !== undefined) return cached;
		const total = this.sumRange(range.start, range.end);
		this.periods.set(key, total);
		return total;
	}

	/**
	 * The value that should read as "full" for this granularity: the busiest
	 * period of its kind in the whole index.
	 *
	 * The contract asks for a scale the source itself knows, so that a cell
	 * shades the same in every month. The alternative — letting the calendar
	 * scale against what is on screen — makes three completions look busy in a
	 * quiet month and idle in a loud one.
	 */
	scaleFor(granularity: Granularity): number {
		this.build();
		const cached = this.scales.get(granularity);
		if (cached !== undefined) return cached;
		let peak = 0;
		if (granularity === 'day') {
			for (const count of this.byDay?.values() ?? []) {
				if (count.completed > peak) peak = count.completed;
			}
		} else {
			const totals = new Map<string, number>();
			for (const [date, count] of this.byDate ?? []) {
				const start = periodRange(date, granularity).start;
				const running = (totals.get(start) ?? 0) + count.completed;
				totals.set(start, running);
				if (running > peak) peak = running;
			}
		}
		const scale = Math.max(peak, MIN_VALUE_SCALE);
		this.scales.set(granularity, scale);
		return scale;
	}

	private sumRange(from: string, to: string): PeriodCount {
		let completed = 0;
		let open = 0;
		for (const [date, count] of this.byDate ?? []) {
			if (date < from || date > to) continue;
			completed += count.completed;
			open += count.open;
		}
		return { completed, open };
	}

	private build(): void {
		if (this.byDate !== null) return;
		const byDay = new Map<string, PeriodCount>();
		const byDate = new Map<string, PeriodCount>();
		for (const task of this.plugin.index.all()) {
			if (!task.isTask) continue;
			const day = task.isCompleted ? completionDate(task) : ownDayDate(task);
			if (day !== null) bump(byDay, day, task.isCompleted);
			// A task with no day of its own still belongs to whatever periodic note
			// holds it; one with no periodic note at all belongs to no period.
			const period = day ?? task.noteDate;
			if (period !== null) bump(byDate, period, task.isCompleted);
		}
		this.byDay = byDay;
		this.byDate = byDate;
	}
}

function bump(counts: Map<string, PeriodCount>, date: string, completed: boolean): void {
	const current = counts.get(date) ?? { completed: 0, open: 0 };
	if (completed) current.completed += 1;
	else current.open += 1;
	counts.set(date, current);
}

/**
 * First and last day of the period an ISO date falls in.
 *
 * `moment` handles five of the six granularities and agrees with the calendar
 * about where a week starts, because it is the same locale. Semesters are ours
 * by convention — the same January–June / July–December split `domain/periodic`
 * uses — since moment has no unit for them.
 */
function periodRange(date: string, granularity: Granularity): { start: string; end: string } {
	const at = moment(date, 'YYYY-MM-DD', true);
	if (granularity === 'semester') {
		const first = at.month() < 6 ? 0 : 6;
		const start = at.clone().month(first).startOf('month');
		return {
			start: start.format('YYYY-MM-DD'),
			end: start.clone().add(5, 'months').endOf('month').format('YYYY-MM-DD'),
		};
	}
	return {
		start: at.clone().startOf(granularity).format('YYYY-MM-DD'),
		end: at.clone().endOf(granularity).format('YYYY-MM-DD'),
	};
}

/* ------------------------------------------------------------------ *
 * The source
 * ------------------------------------------------------------------ */

/**
 * What Simple Tasks contributes to a calendar cell.
 *
 * Two shapes, chosen in settings, because the contract offers both and they are
 * good at different things:
 *
 * - **`intensity`** (default) — the number of completions as a `value`, which the
 *   calendar paints as a background shade. A cell in a sidebar is about twenty
 *   pixels of room; a shade costs none of it and says "busier than that one" at a
 *   glance, which is the comparison a calendar is being asked for. What the dots
 *   carried — whether anything is still **open** — is in the tooltip, which the
 *   default hover mode shows, and in the `has-open` class.
 * - **`dots`** — filled markers for completions and hollow ones for what is still
 *   open, capped at {@link MAX_DOTS_PER_KIND} of each. This is the original
 *   Calendar's vocabulary, and it also keeps the `dots` half of the API exercised
 *   by a real consumer rather than only by the built-in sources.
 *
 * The tooltip is the same either way: it is the one channel that never depends on
 * a display setting of the calendar's or of ours.
 */
class TaskCalendarSource implements CalendarSource {
	readonly id = 'simple-tasks';

	private readonly plugin: SimpleTasksPlugin;
	private readonly counts: TaskCounts;

	constructor(plugin: SimpleTasksPlugin, counts: TaskCounts) {
		this.plugin = plugin;
		this.counts = counts;
	}

	/** Resolved on read, so the label follows Obsidian's language. */
	get name(): string {
		return t('calendar.sourceName');
	}

	getMetadata(date: Moment, granularity: Granularity): CellMetadata | null {
		const iso = date.format('YYYY-MM-DD');
		const { completed, open } = this.counts.forPeriod(iso, granularity);
		if (completed === 0 && open === 0) return null;

		const figures: string[] = [];
		if (completed > 0) figures.push(tCount('calendar.completedCount', completed));
		if (open > 0) figures.push(tCount('calendar.openCount', open));

		const metadata: CellMetadata = {
			classes: open > 0 ? ['has-open'] : [],
			tooltip: figures.join(' · '),
		};

		if (this.plugin.settings.calendarDisplay === 'dots') {
			const dots: Dot[] = [];
			for (let i = 0; i < Math.min(completed, MAX_DOTS_PER_KIND); i += 1) {
				dots.push({ className: 'done', color: 'var(--color-green)', isFilled: true });
			}
			for (let i = 0; i < Math.min(open, MAX_DOTS_PER_KIND); i += 1) {
				dots.push({ className: 'open', color: 'var(--text-muted)', isFilled: false });
			}
			metadata.dots = dots;
			return metadata;
		}

		metadata.value = completed;
		metadata.valueScale = this.counts.scaleFor(granularity);
		return metadata;
	}

	/**
	 * Only our own drags, and only onto a period this vault actually has notes
	 * for. Saying yes to anything else would light the cell up for a drop that
	 * `onDrop` is then going to refuse.
	 */
	canDrop(date: Moment, granularity: Granularity, evt: DragEvent): boolean {
		if (!carriesTask(evt)) return false;
		return this.plugin.periodicNotePath(granularity, date.format('YYYY-MM-DD')) !== null;
	}

	onDrop(date: Moment, granularity: Granularity, evt: DragEvent): boolean {
		const tasks = readTaskDrag(evt)
			.map((entry) => this.resolve(entry))
			.filter((task): task is Task => task !== null);
		if (tasks.length === 0) return false;
		// The contract wants a synchronous verdict and the move is a write, so the
		// answer is "yes, it is mine" and the work continues in the background.
		// The index's `changed` event repaints the calendar when it lands.
		void moveTasksToDate(this.plugin, tasks, date.format('YYYY-MM-DD'), granularity);
		return true;
	}

	onContextMenu(date: Moment, granularity: Granularity, menu: Menu): void {
		const iso = date.format('YYYY-MM-DD');
		const day = granularity === 'day' ? iso : periodRange(iso, granularity).start;
		menu.addItem((item) => {
			item
				.setIcon('list-checks')
				.setTitle(
					granularity === 'day'
						? t('calendar.menu.showDay')
						: t('calendar.menu.showPeriod', { date: day })
				)
				.onClick(() => {
					void this.plugin.showAgendaFor(day);
				});
		});
	}

	/**
	 * The dragged task, found again in the index. The line is the fast path; the
	 * text is the fallback, because the index is debounced and the note may have
	 * been edited between the `dragstart` and the drop.
	 */
	private resolve(payload: TaskDragEntry): Task | null {
		const items = this.plugin.index.fileEntry(payload.path)?.items ?? [];
		const atLine = items.find((item) => item.line === payload.line && item.isTask);
		if (atLine !== undefined && atLine.cleanText === payload.text) return atLine;
		const matches = items.filter((item) => item.isTask && item.cleanText === payload.text);
		return matches.length === 1 ? (matches[0] ?? null) : (atLine ?? null);
	}
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/**
 * Repaints are coalesced: index changes arrive per keystroke pause. Short,
 * because this sits *behind* the indexer's own debounce and a repaint of a month
 * is fifty synchronous map lookups.
 */
const REFRESH_DEBOUNCE_MS = 100;

/** The plugin manager fires this on every enable, disable and uninstall. */
const PLUGINS_CHANGED = 'changed';

export class CalendarPlusIntegration {
	private readonly plugin: SimpleTasksPlugin;
	private readonly counts: TaskCounts;
	private readonly source: TaskCalendarSource;

	private api: CalendarPlusApi | null = null;
	private unregister: (() => void) | null = null;

	private readonly refreshSoon = debounce(
		() => {
			this.api?.refresh(this.source.id);
		},
		REFRESH_DEBOUNCE_MS,
		true
	);

	constructor(plugin: SimpleTasksPlugin) {
		this.plugin = plugin;
		this.counts = new TaskCounts(plugin);
		this.source = new TaskCalendarSource(plugin, this.counts);
	}

	/** Whether the source is registered right now. Drives the settings row. */
	get isConnected(): boolean {
		return this.api !== null;
	}

	/**
	 * Repaints the calendar now, undebounced.
	 *
	 * For a setting of ours that changes what the source contributes: the calendar
	 * cannot know about it, and the debounced path exists for index churn, not for
	 * a control the user just moved.
	 */
	refresh(): void {
		this.api?.refresh(this.source.id);
	}

	load(): void {
		const { app } = this.plugin;

		// The unregister returned by `registerSource` is held here rather than
		// handed straight to `plugin.register()`, because it has to be callable
		// again whenever Calendar Plus goes away mid-session. Unloading still runs
		// it: that is what this registration is for.
		this.plugin.register(() => {
			this.detach();
		});

		this.plugin.registerEvent(
			this.plugin.index.on(INDEX_CHANGED, () => {
				this.counts.invalidate();
				this.refreshSoon();
			})
		);

		// `app.plugins` is not in the public typings, but it extends `Events` and
		// triggers `changed` from every enable, disable and uninstall — which is
		// how a Calendar Plus enabled after us gets picked up without a reload.
		const registry: unknown = (app as unknown as { plugins?: unknown }).plugins;
		if (registry instanceof Events) {
			this.plugin.registerEvent(
				registry.on(PLUGINS_CHANGED, () => {
					this.sync();
				})
			);
		}

		app.workspace.onLayoutReady(() => {
			this.sync();
		});
		this.sync();
	}

	/**
	 * Brings the registration in line with reality. Idempotent, and a no-op in
	 * the overwhelmingly common case where nothing changed.
	 */
	sync(): void {
		const api = getCalendarPlusApi(this.plugin.app);
		if (api === this.api) return;
		this.detach();
		if (api === null) return;
		this.api = api;
		this.unregister = api.registerSource(this.source);
	}

	/**
	 * Opens the calendar on today, which is what "see the tasks on the calendar"
	 * means when the provider is there. Returns `false` when it is not, so the
	 * caller can explain itself instead.
	 *
	 * Opening goes through `api.openView()` when the provider offers it. That
	 * method was added to the contract precisely because doing it by hand means
	 * hardcoding the view type — a string that is *not* part of the contract and
	 * could change without a version bump. The manual route is kept as a fallback
	 * for a Calendar Plus older than that addition: the contract version is still
	 * 1, so the version check cannot tell the two apart and only the method's
	 * presence can.
	 *
	 * **`openView()` guarantees the view exists; it does not guarantee the user
	 * can see it.** A calendar sitting in a sidebar tab that is not the active one
	 * stays exactly where it was, and the command then does its whole job with no
	 * visible effect at all — which is precisely how it was reported as dead.
	 * `revealLeaf` is therefore always called afterwards, on every leaf of the
	 * calendar's type, and only then is `revealDate` worth anything.
	 */
	async revealToday(): Promise<boolean> {
		this.sync();
		const { api } = this;
		if (api === null) return false;
		const openView = (api as Partial<Pick<CalendarPlusApi, 'openView'>>).openView;
		if (typeof openView === 'function') await openView.call(api);
		else await this.openViewByType();
		await this.revealLeaves();
		api.revealDate(moment(), 'day');
		return true;
	}

	/**
	 * Brings the calendar to the front of whatever it is docked in.
	 *
	 * The view type is not part of the contract, so this is best-effort by
	 * construction: when the constant no longer matches, nothing is revealed and
	 * the rest of `revealToday` still works. That is the same trade
	 * {@link openViewByType} already makes.
	 */
	private async revealLeaves(): Promise<void> {
		const { workspace } = this.plugin.app;
		for (const leaf of workspace.getLeavesOfType(CALENDAR_PLUS_VIEW_TYPE)) {
			await workspace.revealLeaf(leaf);
		}
	}

	/** Pre-`openView()` fallback: open the leaf ourselves, by view type. */
	private async openViewByType(): Promise<void> {
		const { workspace } = this.plugin.app;
		if (workspace.getLeavesOfType(CALENDAR_PLUS_VIEW_TYPE).length > 0) return;
		const leaf = workspace.getRightLeaf(false);
		if (leaf === null) return;
		await leaf.setViewState({ type: CALENDAR_PLUS_VIEW_TYPE, active: true });
	}

	private detach(): void {
		this.refreshSoon.cancel();
		this.unregister?.();
		this.unregister = null;
		this.api = null;
	}
}
