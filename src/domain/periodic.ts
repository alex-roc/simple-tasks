import type { PeriodicGranularity } from './task.ts';

/**
 * Periodic note ⇄ date resolution for the six granularities, driven by the
 * configuration that already lives in the vault.
 *
 * ## Why this file uses `window.moment`
 *
 * `domain/` must not touch `app`, the DOM or the vault, and this file does none
 * of those things: reading the config files is delegated to callbacks the caller
 * supplies. It does use `moment` — a pure date library — deliberately: the weekly
 * default format is `gggg-[W]ww`, whose week numbering depends on the active
 * locale, and using *the same* moment instance Periodic Notes uses is the only
 * way to be guaranteed to agree with the filenames actually on disk.
 * Reimplementing locale week math would be a guess dressed up as purity.
 *
 * It reads it off the **global**, not from `import { moment } from 'obsidian'`,
 * and that is not a style choice. Obsidian's typings declare the re-export as
 * `typeof import('moment')`; where the `moment` package is not resolvable — the
 * community directory's scanner is one such environment — that import silently
 * degrades to `any`, and every date expression downstream becomes an unsafe-call
 * warning published on the plugin's scorecard. Measured: 130-odd of them, all
 * from this one import. `window.moment` is typed by the `moment` package itself,
 * so where it is missing the build fails loudly instead of going `any` quietly.
 * It is read inside functions, never at module load, so importing this file
 * outside Obsidian — `node --test` — still costs nothing.
 *
 * ## Semesters
 *
 * The Periodic Notes plugin has no semester granularity, so this level is ours
 * by convention:
 *
 * - Default format `YYYY-[S]S`, where `S` is `1` for January–June and `2` for
 *   July–December (`Cronos/Semestrario/2025-S1.md`).
 * - The folder is not in any vault config file. If the setting is empty, a note
 *   is recognized as a semester note when its basename parses with the semester
 *   format **and** it lives under the folder the other periodic levels share
 *   (`Cronos` here). The first folder resolved that way is remembered via
 *   {@link rememberSemesterFolder} so path *generation* works too.
 * - `S` is not a moment token (moment reads it as fractional seconds), so the
 *   format is expanded into two bracket-escaped literal variants before moment
 *   ever sees it.
 */

export type { PeriodicGranularity } from './task.ts';

/** Coarse to fine is not the order here: this is the natural reading order. */
export const GRANULARITIES: readonly PeriodicGranularity[] = [
	'day',
	'week',
	'month',
	'quarter',
	'semester',
	'year',
];

/**
 * What an empty `format` in the vault config means. Matches the Periodic Notes
 * defaults, except `semester`, which is ours.
 */
export const DEFAULT_FORMATS: Readonly<Record<PeriodicGranularity, string>> = {
	day: 'YYYY-MM-DD',
	week: 'gggg-[W]ww',
	month: 'YYYY-MM',
	quarter: 'YYYY-[Q]Q',
	semester: 'YYYY-[S]S',
	year: 'YYYY',
};

/** Key used by the Periodic Notes plugin for each granularity we share. */
const PERIODIC_NOTES_KEYS: Readonly<Partial<Record<PeriodicGranularity, string>>> = {
	day: 'daily',
	week: 'weekly',
	month: 'monthly',
	quarter: 'quarterly',
	year: 'yearly',
};

export interface PeriodicLevel {
	enabled: boolean;
	/** Vault-relative folder. Empty means the vault root (or unknown). */
	folder: string;
	/** moment format string. Never empty once resolved. */
	format: string;
	/** Vault-relative template path, or empty. */
	template: string;
}

export type PeriodicConfig = Record<PeriodicGranularity, PeriodicLevel>;

/** A note recognized as periodic, with the span it covers. */
export interface PeriodicRef {
	granularity: PeriodicGranularity;
	/** First day of the period, `YYYY-MM-DD`. */
	start: string;
	/** Last day of the period, `YYYY-MM-DD`. */
	end: string;
}

const ISO = 'YYYY-MM-DD';

function emptyLevel(): PeriodicLevel {
	return { enabled: false, folder: '', format: '', template: '' };
}

export function emptyPeriodicConfig(): PeriodicConfig {
	return {
		day: emptyLevel(),
		week: emptyLevel(),
		month: emptyLevel(),
		quarter: emptyLevel(),
		semester: emptyLevel(),
		year: emptyLevel(),
	};
}

/* ------------------------------------------------------------------ *
 * Loading the vault's own configuration.
 * ------------------------------------------------------------------ */

export interface LoadPeriodicOptions {
	/** `app.vault.configDir` — passed in so this module never hardcodes it. */
	configDir: string;
	/** Reads a vault-relative path. Rejects or returns null when missing. */
	read: (path: string) => Promise<string | null>;
	/** Semester convention from our own settings. */
	semester?: { folder: string; format: string };
}

export interface PeriodicSetup {
	config: PeriodicConfig;
	/**
	 * Notes the vault declares as templates, vault-relative with a `.md`
	 * extension. Used to keep template tasks out of the index.
	 */
	templatePaths: string[];
}

function normalizeFolder(folder: unknown): string {
	if (typeof folder !== 'string') return '';
	return folder.replace(/^\/+|\/+$/gu, '');
}

function normalizeTemplate(template: unknown): string {
	if (typeof template !== 'string') return '';
	const trimmed = template.replace(/^\/+|\/+$/gu, '');
	if (trimmed === '') return '';
	return trimmed.toLowerCase().endsWith('.md') ? trimmed : `${trimmed}.md`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

async function readJson(
	read: LoadPeriodicOptions['read'],
	path: string
): Promise<Record<string, unknown> | null> {
	try {
		const raw = await read(path);
		if (raw === null || raw.trim() === '') return null;
		return asRecord(JSON.parse(raw));
	} catch {
		// A missing or malformed config file is normal, not an error worth surfacing.
		return null;
	}
}

/**
 * Reads core Daily notes and the Periodic Notes plugin, in that order, so the
 * plugin's richer configuration wins where both are present.
 */
export async function loadPeriodicConfig(options: LoadPeriodicOptions): Promise<PeriodicSetup> {
	const config = emptyPeriodicConfig();
	const templates = new Set<string>();

	const daily = await readJson(options.read, `${options.configDir}/daily-notes.json`);
	if (daily !== null) {
		config.day = {
			enabled: true,
			folder: normalizeFolder(daily['folder']),
			format: typeof daily['format'] === 'string' ? daily['format'] : '',
			template: normalizeTemplate(daily['template']),
		};
	}

	const periodic = await readJson(
		options.read,
		`${options.configDir}/plugins/periodic-notes/data.json`
	);
	if (periodic !== null) {
		for (const granularity of GRANULARITIES) {
			const key = PERIODIC_NOTES_KEYS[granularity];
			if (key === undefined) continue;
			const level = asRecord(periodic[key]);
			if (level === null) continue;
			config[granularity] = {
				enabled: level['enabled'] !== false,
				folder: normalizeFolder(level['folder']),
				format: typeof level['format'] === 'string' ? level['format'] : '',
				template: normalizeTemplate(level['template']),
			};
		}
	}

	// Semesters exist only by our convention.
	config.semester = {
		enabled: true,
		folder: normalizeFolder(options.semester?.folder),
		format: options.semester?.format ?? '',
		template: '',
	};

	for (const granularity of GRANULARITIES) {
		const level = config[granularity];
		if (level.format.trim() === '') level.format = DEFAULT_FORMATS[granularity];
		if (level.template !== '') templates.add(level.template);
	}

	return { config, templatePaths: [...templates] };
}

/* ------------------------------------------------------------------ *
 * Semester format expansion.
 * ------------------------------------------------------------------ */

/** Semester number (1 or 2) of a month index (0-11). */
function semesterOfMonth(month: number): 1 | 2 {
	return month < 6 ? 1 : 2;
}

/**
 * Replaces the first `S` token outside a `[...]` escape with a bracket-escaped
 * literal, producing a format string moment can handle. Returns `null` when the
 * format carries no `S` token at all.
 */
function expandSemesterFormat(format: string, semester: 1 | 2): string | null {
	let out = '';
	let escaped = false;
	let replaced = false;
	for (const char of format) {
		if (char === '[') escaped = true;
		else if (char === ']') escaped = false;
		if (!escaped && !replaced && char === 'S') {
			out += `[${String(semester)}]`;
			replaced = true;
			continue;
		}
		out += char;
	}
	return replaced ? out : null;
}

/* ------------------------------------------------------------------ *
 * Path → date.
 * ------------------------------------------------------------------ */

function basename(path: string): string {
	const slash = path.lastIndexOf('/');
	const name = slash === -1 ? path : path.slice(slash + 1);
	return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}

function parentFolder(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash === -1 ? '' : path.slice(0, slash);
}

/** Longest shared folder prefix, at segment granularity. */
function commonFolder(folders: readonly string[]): string {
	const real = folders.filter((f) => f !== '');
	if (real.length === 0) return '';
	let prefix = real[0]?.split('/') ?? [];
	for (const folder of real.slice(1)) {
		const parts = folder.split('/');
		let i = 0;
		while (i < prefix.length && i < parts.length && prefix[i] === parts[i]) i += 1;
		prefix = prefix.slice(0, i);
	}
	return prefix.join('/');
}

function isUnder(path: string, folder: string): boolean {
	if (folder === '') return true;
	return path === folder || path.startsWith(`${folder}/`);
}

function spanFor(start: ReturnType<typeof window.moment>, granularity: PeriodicGranularity): PeriodicRef {
	const from = start.clone();
	const to = start.clone();
	switch (granularity) {
		case 'day':
			break;
		case 'week':
			from.startOf('week');
			to.startOf('week').add(6, 'days');
			break;
		case 'month':
			from.startOf('month');
			to.endOf('month');
			break;
		case 'quarter':
			from.startOf('quarter');
			to.endOf('quarter');
			break;
		case 'semester':
			from.month(semesterOfMonth(from.month()) === 1 ? 0 : 6).startOf('month');
			to.month(semesterOfMonth(to.month()) === 1 ? 5 : 11).endOf('month');
			break;
		case 'year':
			from.startOf('year');
			to.endOf('year');
			break;
	}
	return { granularity, start: from.format(ISO), end: to.format(ISO) };
}

function parseSemester(name: string, format: string): PeriodicRef | null {
	for (const semester of [1, 2] as const) {
		const expanded = expandSemesterFormat(format, semester);
		if (expanded === null) return null;
		const parsed = window.moment(name, expanded, true);
		if (!parsed.isValid()) continue;
		parsed.month(semester === 1 ? 0 : 6).date(1);
		return spanFor(parsed, 'semester');
	}
	return null;
}

/**
 * Resolves the period a note covers, or `null` when it is not a periodic note.
 *
 * Matching requires both the folder and a strict parse of the basename, so a
 * `2025-05` monthly note is never mistaken for a daily one.
 */
export function resolvePeriodicNote(config: PeriodicConfig, path: string): PeriodicRef | null {
	const name = basename(path);
	const folder = parentFolder(path);
	const semesterScope = commonFolder(
		GRANULARITIES.filter((g) => g !== 'semester' && config[g].enabled).map(
			(g) => config[g].folder
		)
	);

	for (const granularity of GRANULARITIES) {
		const level = config[granularity];
		if (!level.enabled) continue;

		if (granularity === 'semester') {
			// The folder is either configured or inferred from where the rest live.
			const scope = level.folder === '' ? semesterScope : level.folder;
			if (level.folder === '' ? !isUnder(path, scope) : folder !== level.folder) continue;
			const ref = parseSemester(name, level.format);
			if (ref !== null) return ref;
			continue;
		}

		if (folder !== level.folder) continue;
		const parsed = window.moment(name, level.format, true);
		if (!parsed.isValid()) continue;
		return spanFor(parsed, granularity);
	}
	return null;
}

/**
 * Records the folder a semester note was found in, so path generation works
 * without the user filling the setting in. No-op once the folder is known.
 */
export function rememberSemesterFolder(config: PeriodicConfig, path: string): void {
	if (config.semester.folder !== '') return;
	config.semester.folder = parentFolder(path);
}

/* ------------------------------------------------------------------ *
 * Date → path.
 * ------------------------------------------------------------------ */

/**
 * Path of the note for a date at a given granularity, or `null` when the level
 * is disabled or its folder is still unknown (semesters, before one is seen).
 */
export function periodicNotePath(
	config: PeriodicConfig,
	granularity: PeriodicGranularity,
	date: string | Date
): string | null {
	const level = config[granularity];
	if (!level.enabled) return null;
	const m = typeof date === 'string' ? window.moment(date, ISO, true) : window.moment(date);
	if (!m.isValid()) return null;

	let format = level.format;
	if (granularity === 'semester') {
		if (level.folder === '') return null;
		const expanded = expandSemesterFormat(format, semesterOfMonth(m.month()));
		if (expanded === null) return null;
		format = expanded;
	}
	const name = m.format(format);
	return level.folder === '' ? `${name}.md` : `${level.folder}/${name}.md`;
}

/** The period a date belongs to at a given granularity. */
export function periodOf(granularity: PeriodicGranularity, date: string): PeriodicRef | null {
	const m = window.moment(date, ISO, true);
	if (!m.isValid()) return null;
	return spanFor(m, granularity);
}
