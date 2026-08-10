import { moment } from 'obsidian';
import type { CliData, CliFlags } from 'obsidian';
import { collectAgenda, sortTasks } from '../domain/agenda.ts';
import type { PeriodicGranularity, Task } from '../domain/task.ts';
import { t, tCount } from '../i18n/index.ts';
import type SimpleTasksPlugin from '../main.ts';

/**
 * The plugin's own commands for Obsidian's CLI: `obsidian simple-tasks:stats`,
 * `simple-tasks:today` and `simple-tasks:move`.
 *
 * ## Feature detection, not a version bump
 *
 * `registerCliHandler` arrived in **1.12.2** and `manifest.json` declares
 * `minAppVersion: 1.10.0`, so the capability is probed rather than assumed. The
 * probe goes through a locally declared interface: writing
 * `this.registerCliHandler` against the published typings makes
 * `obsidianmd/no-unsupported-api` an error at the declared minimum, and that
 * rule cannot be silenced inline (`no-restricted-disable`). The local interface
 * is not a cast to shut the compiler up — it is the shape being probed for, and
 * a version without it simply registers nothing.
 *
 * ## The output is an interface, not a log
 *
 * Every command takes `format=json|text`. `text` is for a human reading a
 * terminal; `json` is a stable document meant to be piped into `jq`, which is
 * why **its keys are English identifiers and are never translated** — a script
 * that broke when the user switched Obsidian to Spanish would be useless.
 * Everything a human reads goes through `i18n/`, including the flag
 * descriptions `obsidian help` prints.
 *
 * ## No second source of truth
 *
 * `stats` folds the same `plugin.stats` the heatmap panel shows, `today` calls
 * the same `collectAgenda()` the agenda view calls, and `move` goes through
 * `plugin.actions`. A command that recomputed any of it would eventually
 * disagree with the interface.
 */

/** 1.12.2+. Declared here so the probe is not an unsupported-API call. */
interface CliCapablePlugin {
	registerCliHandler(
		command: string,
		description: string,
		flags: CliFlags | null,
		handler: (params: CliData) => string | Promise<string>
	): void;
}

/** Present on every command; the reason each handler is scriptable. */
function formatFlag(): CliFlags {
	return { format: { value: '<json|text>', description: t('cli.flag.format') } };
}

/** Whether the caller asked for machine-readable output. */
function wantsJson(params: CliData): boolean {
	return params.format === 'json';
}

function json(payload: unknown): string {
	return JSON.stringify(payload, null, 2);
}

/**
 * Registers the three commands, or nothing at all on an Obsidian without the
 * CLI API. Returns whether they were registered, which is what the check in
 * `dev-docs` asserts.
 */
export function registerCliCommands(plugin: SimpleTasksPlugin): boolean {
	const host = plugin as unknown as Partial<CliCapablePlugin>;
	const register = host.registerCliHandler;
	if (typeof register !== 'function') return false;

	const add: CliCapablePlugin['registerCliHandler'] = (command, description, flags, handler) => {
		register.call(plugin, command, description, flags, handler);
	};

	add('simple-tasks:stats', t('cli.stats.desc'), formatFlag(), (params) =>
		statsCommand(plugin, params)
	);

	add(
		'simple-tasks:today',
		t('cli.today.desc'),
		{
			...formatFlag(),
			date: { value: '<YYYY-MM-DD>', description: t('cli.flag.date') },
			tag: { value: '<tag>', description: t('cli.flag.tag') },
			wide: { description: t('cli.flag.wide') },
			open: { description: t('cli.flag.open') },
		},
		(params) => todayCommand(plugin, params)
	);

	add(
		'simple-tasks:move',
		t('cli.move.desc'),
		{
			...formatFlag(),
			task: { value: '<path:line>', description: t('cli.flag.task'), required: true },
			date: { value: '<YYYY-MM-DD>', description: t('cli.flag.toDate') },
			note: { value: '<path>', description: t('cli.flag.toNote') },
			heading: { value: '<heading>', description: t('cli.flag.heading') },
			granularity: { value: '<day|week|month>', description: t('cli.flag.granularity') },
		},
		async (params) => moveCommand(plugin, params)
	);

	return true;
}

/* ------------------------------------------------------------------ *
 * simple-tasks:stats
 * ------------------------------------------------------------------ */

function statsCommand(plugin: SimpleTasksPlugin, params: CliData): string {
	const { stats } = plugin.stats.get();
	const index = plugin.index.stats();

	if (wantsJson(params)) {
		return json({
			notes: index.notes,
			tasks: { total: index.tasks, completed: index.completed, open: index.tasks - index.completed },
			byStatus: index.byStatus,
			completed: {
				today: stats.completedToday,
				yesterday: stats.completedYesterday,
				thisWeek: stats.completedThisWeek,
				thisMonth: stats.completedThisMonth,
				total: stats.completedTotal,
			},
			streak: { current: stats.currentStreak, best: stats.bestStreak },
			activeDays: stats.activeDays,
			perActiveDay: stats.perActiveDay,
			busiestDay: stats.busiestDay,
			level: {
				level: stats.level,
				xp: stats.xp,
				xpIntoLevel: stats.xpIntoLevel,
				xpForLevel: stats.xpForLevel,
			},
			topTags: stats.topTags,
		});
	}

	const lines = [
		t('cli.stats.tasks', {
			total: index.tasks,
			open: index.tasks - index.completed,
			notes: index.notes,
		}),
		t('cli.stats.completed', {
			today: stats.completedToday,
			week: stats.completedThisWeek,
			month: stats.completedThisMonth,
			total: stats.completedTotal,
		}),
		t('cli.stats.streak', { current: stats.currentStreak, best: stats.bestStreak }),
		t('cli.stats.level', {
			level: stats.level,
			xp: stats.xp,
			into: stats.xpIntoLevel,
			span: stats.xpForLevel,
		}),
		t('cli.stats.activity', { days: stats.activeDays, average: stats.perActiveDay }),
	];
	if (stats.busiestDay !== null) {
		lines.push(
			t('cli.stats.busiest', { date: stats.busiestDay.date, count: stats.busiestDay.count })
		);
	}
	if (stats.topTags.length > 0) {
		const tags = stats.topTags.map((tag) => `${tag.tag} ${String(tag.count)}`).join(', ');
		lines.push(t('cli.stats.tags', { tags }));
	}
	return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * simple-tasks:today
 * ------------------------------------------------------------------ */

const ISO = 'YYYY-MM-DD';

function todayCommand(plugin: SimpleTasksPlugin, params: CliData): string {
	const requested = params.date;
	if (requested !== undefined && !moment(requested, ISO, true).isValid()) {
		return t('cli.error.date', { value: requested });
	}
	const date = requested ?? moment().format(ISO);

	const tasks = sortTasks(
		collectAgenda(plugin.index, {
			date,
			widePeriods: params.wide === 'true',
			tag: params.tag ?? null,
			hideCompleted: params.open === 'true',
		})
	);

	if (wantsJson(params)) {
		return json({
			date,
			total: tasks.length,
			open: tasks.filter((task) => !task.isCompleted).length,
			tasks: tasks.map(describe),
		});
	}

	if (tasks.length === 0) return t('cli.today.empty', { date });
	const lines = [
		t('cli.today.header', {
			date,
			open: tasks.filter((task) => !task.isCompleted).length,
			total: tasks.length,
		}),
	];
	for (const task of tasks) {
		const priority = task.priority === null ? '' : ` ${task.priority}`;
		lines.push(
			`[${task.status}] ${task.cleanText}${priority}  ${task.path}:${String(task.line + 1)}`
		);
	}
	return lines.join('\n');
}

/** One task as a script would want it: identity, state and the raw metadata. */
function describe(task: Task): Record<string, unknown> {
	return {
		id: `${task.path}:${String(task.line + 1)}`,
		path: task.path,
		// 1-based, matching what every editor and the `task=` flag show.
		line: task.line + 1,
		status: task.status,
		statusName: task.statusName,
		completed: task.isCompleted,
		text: task.cleanText,
		priority: task.priority,
		tags: task.tags,
		dates: task.dates,
		effectiveDate: task.effectiveDate,
	};
}

/* ------------------------------------------------------------------ *
 * simple-tasks:move
 * ------------------------------------------------------------------ */

const GRANULARITIES: readonly PeriodicGranularity[] = [
	'day',
	'week',
	'month',
	'quarter',
	'semester',
	'year',
];

async function moveCommand(plugin: SimpleTasksPlugin, params: CliData): Promise<string> {
	const reference = params.task;
	if (reference === undefined) return t('cli.error.taskFlag');

	const task = resolveTask(plugin, reference);
	if (task === null) return t('cli.error.noTask', { task: reference });

	const date = params.date;
	const note = params.note;
	if (date === undefined && note === undefined) return t('cli.error.destination');
	if (date !== undefined && note !== undefined) return t('cli.error.twoDestinations');

	let moved;
	if (date !== undefined) {
		if (!moment(date, ISO, true).isValid()) return t('cli.error.date', { value: date });
		const granularity = GRANULARITIES.find((g) => g === params.granularity) ?? 'day';
		moved = await plugin.actions.moveToDate(task, date, granularity);
	} else {
		moved = await plugin.actions.move(task, {
			path: note ?? '',
			heading: params.heading ?? null,
		});
	}

	if (moved === null) {
		// The action already told the user through a notice; the CLI caller is not
		// looking at the window, so it is repeated here as the command's answer.
		return wantsJson(params) ? json({ ok: false, task: describe(task) }) : t('cli.error.moveFailed');
	}
	if (wantsJson(params)) {
		return json({
			ok: true,
			from: { path: task.path, line: task.line + 1 },
			to: { path: moved.path, line: moved.line + 1, lines: moved.lines },
			text: task.cleanText,
		});
	}
	return t('cli.move.done', {
		text: task.cleanText,
		path: moved.path,
		line: moved.line + 1,
		lines: tCount('action.movedLines', moved.lines),
	});
}

/**
 * A task from a `path:line` reference, as `today` prints it — 1-based, because
 * that is the number a human reads in the editor and pastes back.
 *
 * The line is the fast path; when it does not hold a task the note is searched
 * for a single line with that text, which is the same tolerance
 * `locateTaskLine()` applies before a write.
 */
function resolveTask(plugin: SimpleTasksPlugin, reference: string): Task | null {
	const cut = reference.lastIndexOf(':');
	if (cut === -1) return null;
	const path = reference.slice(0, cut);
	const line = Number.parseInt(reference.slice(cut + 1), 10);
	if (!Number.isFinite(line)) return null;
	const items = plugin.index.fileEntry(path)?.items ?? [];
	return items.find((item) => item.isTask && item.line === line - 1) ?? null;
}
