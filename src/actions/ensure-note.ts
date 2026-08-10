import { Notice, TFile, normalizePath } from 'obsidian';
import type { PeriodicGranularity } from '../domain/periodic.ts';
import { fillTemplate } from '../domain/template.ts';
import { t } from '../i18n/index.ts';
import type SimpleTasksPlugin from '../main.ts';
import { openTaskAt } from './open-task.ts';

/**
 * Creating the note a task is being sent to.
 *
 * Shared by `move-task.ts` and by the views that open a day, so there is one
 * answer to "what does a note that does not exist yet look like": the folder is
 * created, and a **periodic** note is filled from the template the vault itself
 * declares — core Daily notes' `template`, or the Periodic Notes entry for that
 * granularity. Moving a task to next Friday and finding an empty file where
 * every other Friday has a structure is the bug this prevents.
 */

export interface NoteRequest {
	/** Vault-relative path, with the `.md` extension. */
	path: string;
	/** Date of the note, when it is a periodic one. Drives the template. */
	date?: string;
	granularity?: PeriodicGranularity;
}

/** Returns the note, creating it (and its folder, and its content) if needed. */
export async function ensureNote(
	plugin: SimpleTasksPlugin,
	request: NoteRequest
): Promise<TFile | null> {
	const { vault } = plugin.app;
	const path = normalizePath(request.path);
	const existing = vault.getFileByPath(path);
	if (existing instanceof TFile) return existing;

	const slash = path.lastIndexOf('/');
	const folder = slash === -1 ? '' : path.slice(0, slash);
	if (folder !== '' && vault.getFolderByPath(folder) === null) {
		await vault.createFolder(folder);
	}
	return vault.create(path, await initialContent(plugin, request, path));
}

/** The periodic note for a date, created from its template when missing. */
export async function ensurePeriodicNote(
	plugin: SimpleTasksPlugin,
	granularity: PeriodicGranularity,
	date: string
): Promise<TFile | null> {
	const path = plugin.periodicNotePath(granularity, date);
	if (path === null) {
		new Notice(t('action.notPeriodic'));
		return null;
	}
	return ensureNote(plugin, { path, date, granularity });
}

/** Opens the periodic note for a date, creating it if it is not there yet. */
export async function openPeriodicNote(
	plugin: SimpleTasksPlugin,
	granularity: PeriodicGranularity,
	date: string
): Promise<void> {
	const file = await ensurePeriodicNote(plugin, granularity, date);
	if (file === null) return;
	await openTaskAt(plugin.app, file.path, 0);
}

async function initialContent(
	plugin: SimpleTasksPlugin,
	request: NoteRequest,
	path: string
): Promise<string> {
	const { granularity, date } = request;
	if (granularity === undefined || date === undefined) return '';
	const level = plugin.periodicLevel(granularity);
	if (level === null || level.template === '') return '';
	const template = plugin.app.vault.getFileByPath(normalizePath(level.template));
	if (!(template instanceof TFile)) return '';
	const raw = await plugin.app.vault.cachedRead(template);
	return fillTemplate(raw, { date, dateFormat: level.format, title: basename(path) });
}

function basename(path: string): string {
	const slash = path.lastIndexOf('/');
	const name = slash === -1 ? path : path.slice(slash + 1);
	return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}
