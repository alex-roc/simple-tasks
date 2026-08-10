/**
 * Adding and removing a tag from the round-trippable body of a task line.
 *
 * Pure, and deliberately conservative: the body is written back verbatim by the
 * serializer, so these functions are the only sanctioned way to change it. They
 * touch nothing but the tag they were asked about.
 */

/** Normalizes user input to a tag with exactly one leading `#`. */
export function normalizeTag(tag: string): string {
	const trimmed = tag.trim().replace(/^#+/u, '');
	return trimmed === '' ? '' : `#${trimmed}`;
}

/**
 * A tag ends where a tag character stops. Written without a lookbehind on
 * purpose: iOS below 16.4 does not support them, and this file ships to mobile.
 */
function tagPattern(tag: string): RegExp {
	const escaped = tag.replace(/[.*+?^${}()|[\]\\/-]/gu, '\\$&');
	return new RegExp(`(^|[\\s([{"'])${escaped}(?![\\p{L}\\p{N}_/-])`, 'giu');
}

/** Whether the body already carries exactly this tag (not a nested child of it). */
export function hasTag(text: string, tag: string): boolean {
	const normalized = normalizeTag(tag);
	if (normalized === '') return false;
	return tagPattern(normalized).test(text);
}

/** Appends a tag at the end of the body, unless it is already there. */
export function addTag(text: string, tag: string): string {
	const normalized = normalizeTag(tag);
	if (normalized === '' || hasTag(text, normalized)) return text;
	return text === '' ? normalized : `${text} ${normalized}`;
}

/**
 * Removes a tag, keeping the character that preceded it so `Revisar #lab hoy`
 * becomes `Revisar hoy` and not `Revisarhoy`. `#lab/infra` survives a removal
 * of `#lab`: they are different tags.
 */
export function removeTag(text: string, tag: string): string {
	const normalized = normalizeTag(tag);
	if (normalized === '') return text;
	return text
		.replace(tagPattern(normalized), (_whole, prefix: string) => (prefix === '' ? '' : ' '))
		.replace(/[ \t]{2,}/gu, ' ')
		.trim();
}
