import { moment } from 'obsidian';

/**
 * Expansion of the handful of placeholders Obsidian's own daily-note and
 * Periodic Notes templates use. Pure apart from `moment`, for the same reason
 * `periodic.ts` is: the formats are the vault's, so the dates have to be
 * formatted by the same library that produced the filenames.
 *
 * Supported: `{{date}}`, `{{time}}`, `{{title}}`, and the `{{date:FORMAT}}` /
 * `{{time:FORMAT}}` variants. Anything else is left untouched — a template full
 * of Templater syntax must come out the other side unharmed, because Templater
 * itself will run over the created note afterwards.
 */

export interface TemplateContext {
	/** The note's own date, `YYYY-MM-DD`. */
	date: string;
	/** Default format for a bare `{{date}}`: the granularity's own format. */
	dateFormat: string;
	/** Default format for a bare `{{time}}`. */
	timeFormat?: string;
	/** Basename of the note being created. */
	title: string;
}

const PLACEHOLDER = /\{\{(date|time|title)(?::([^}]*))?\}\}/giu;

const DEFAULT_TIME_FORMAT = 'HH:mm';

export function fillTemplate(template: string, context: TemplateContext): string {
	const when = moment(context.date, 'YYYY-MM-DD', true);
	return template.replace(PLACEHOLDER, (whole, rawName: string, rawFormat?: string) => {
		const name = rawName.toLowerCase();
		if (name === 'title') return context.title;
		// `{{date}}` is the note's own date; `{{time}}` is the clock, as in
		// Obsidian's daily notes — a note created for next Friday still records
		// the moment it was created.
		const value = name === 'date' ? when : moment();
		if (!value.isValid()) return whole;
		const fallback =
			name === 'date' ? context.dateFormat : (context.timeFormat ?? DEFAULT_TIME_FORMAT);
		const format = rawFormat === undefined || rawFormat.trim() === '' ? fallback : rawFormat;
		return value.format(format);
	});
}
