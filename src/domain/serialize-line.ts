import { DATE_EMOJI, DATE_FIELD_KEYS, DATE_ORDER, PRIORITY_EMOJI } from './parse-line.ts';
import type { ParsedLine, TaskDates } from './task.ts';

/**
 * The only place a task line is ever formatted. Every write in the plugin goes
 * through here, so the vault never ends up with two dialects.
 *
 * Pure module: no `obsidian` runtime import, no DOM, no vault.
 */

/**
 * Dialect used when writing. Reading accepts both regardless of this setting.
 *
 * - `emoji`: `- [ ] Task #tag ⏫ 📅 2026-01-01` — the default, matching what the
 *   vault already contains.
 * - `inline-field`: `- [ ] Task #tag [priority:: high] [due:: 2026-01-01]` —
 *   plain markdown, for users who do not want emoji in their notes.
 */
export type TaskWriteSyntax = 'emoji' | 'inline-field';

/** Fields the serializer needs. A full {@link ParsedLine} satisfies it. */
export type SerializableLine = Pick<
	ParsedLine,
	'indent' | 'marker' | 'isTask' | 'status' | 'text' | 'priority' | 'dates'
>;

export interface SerializeOptions {
	syntax?: TaskWriteSyntax;
}

/**
 * The canonical form is:
 *
 * ```text
 * {indent}{marker} [{status}] {text}{ priority}{ dates in DATE_ORDER}
 * ```
 *
 * `text` is written back verbatim, so tags, wikilinks and any syntax the parser
 * did not recognize keep their original position. The checkbox always carries a
 * trailing space, which is what an empty task (`- [ ] `) looks like in the vault.
 *
 * Idempotent: a line already in canonical form comes back byte-identical. A line
 * whose metadata was in a different order comes back reordered but semantically
 * identical, and stable from the second pass on.
 */
export function serializeLine(line: SerializableLine, options: SerializeOptions = {}): string {
	const syntax = options.syntax ?? 'emoji';
	const checkbox = line.isTask ? `[${line.status === '' ? ' ' : line.status}] ` : '';
	const parts: string[] = [];
	if (line.text !== '') parts.push(line.text);
	if (line.priority !== null) parts.push(formatPriority(line.priority, syntax));
	for (const key of DATE_ORDER) {
		const value = line.dates[key];
		if (value === undefined) continue;
		parts.push(formatDate(key, value, syntax));
	}
	return `${line.indent}${line.marker} ${checkbox}${parts.join(' ')}`;
}

function formatPriority(priority: NonNullable<ParsedLine['priority']>, syntax: TaskWriteSyntax) {
	return syntax === 'emoji' ? PRIORITY_EMOJI[priority] : `[priority:: ${priority}]`;
}

function formatDate(key: keyof TaskDates, value: string, syntax: TaskWriteSyntax) {
	return syntax === 'emoji'
		? `${DATE_EMOJI[key]} ${value}`
		: `[${DATE_FIELD_KEYS[key]}:: ${value}]`;
}

/** Convenience for callers that only need to swap the status character. */
export function withStatus<T extends SerializableLine>(line: T, status: string): T {
	return { ...line, isTask: true, status };
}
