import { parseLine } from './parse-line.ts';

/**
 * The pure line surgery behind `actions/move-task.ts`.
 *
 * Moving a task is the operation most likely to corrupt a note, so every
 * decision it makes — where the subtree ends, how it is reindented, where it
 * lands in the destination — is taken here, in a module that touches no vault,
 * no `app` and no DOM, and is therefore unit-testable with `node --test`.
 *
 * Two invariants the callers rely on:
 *
 * 1. **Boundaries come from the index, not from indentation.** The caller
 *    supplies the root line and the lines of its descendants, which the index
 *    derived from `ListItemCache.parent`. Indentation is only used to decide
 *    whether *non-list* lines (a wrapped paragraph, an indented code block)
 *    belong to the subtree, which is the one thing `parent` cannot answer.
 * 2. **Relative indentation is preserved.** The block is re-anchored by
 *    replacing the root's own indent prefix on every line, so a two-level
 *    subtree stays two levels deep at the destination.
 */

/** Columns a tab is worth when comparing indentation depth. */
const TAB_WIDTH = 4;

/** Inclusive line range, 0-based. */
export interface LineRange {
	start: number;
	end: number;
}

/** Leading whitespace of a line, verbatim. */
export function leadingWhitespace(line: string): string {
	const match = /^[ \t]*/u.exec(line);
	return match?.[0] ?? '';
}

/** Visual width of an indent, counting a tab as {@link TAB_WIDTH} columns. */
export function indentWidth(indent: string): number {
	let width = 0;
	for (const char of indent) width += char === '\t' ? TAB_WIDTH : 1;
	return width;
}

function isBlank(line: string): boolean {
	return line.trim() === '';
}

/**
 * The range a subtree occupies in the file.
 *
 * Starts at `root` and runs to the last descendant, then keeps going while the
 * following lines are continuations: blank lines or lines indented deeper than
 * the root that the index does not know as list items. It stops at the first
 * list item that is not part of the subtree — a sibling or an uncle — and never
 * swallows the blank lines that separate the subtree from what follows.
 *
 * @param lines every line of the note
 * @param root 0-based line of the item being moved
 * @param descendants lines of every item below it, from the index
 * @param itemLines every list-item line in the note, from the index
 */
export function subtreeRange(
	lines: readonly string[],
	root: number,
	descendants: ReadonlySet<number>,
	itemLines: ReadonlySet<number>
): LineRange {
	let end = root;
	for (const line of descendants) {
		if (line > end && line < lines.length) end = line;
	}

	const rootWidth = indentWidth(leadingWhitespace(lines[root] ?? ''));
	// A blank line only joins the subtree when something indented follows it, which
	// falls out of only ever moving `end` onto a real continuation: the trailing
	// separator between this subtree and the next stays with the source note.
	for (let i = end + 1; i < lines.length; i += 1) {
		const line = lines[i] ?? '';
		if (itemLines.has(i)) break;
		if (isBlank(line)) continue;
		if (indentWidth(leadingWhitespace(line)) <= rootWidth) break;
		end = i;
	}

	return { start: root, end };
}

/**
 * Re-anchors a block under a new indent, preserving the relative depth inside
 * it. The root's own leading whitespace is what gets replaced; every other line
 * keeps whatever it had beyond that.
 *
 * The `- * Título` shape survives this untouched: the outer `- ` is not
 * whitespace, so it travels with the line as content, and the children — which
 * really are indented — shift by exactly the same amount as the root.
 */
export function reindentBlock(block: readonly string[], targetIndent: string): string[] {
	const rootPrefix = leadingWhitespace(block[0] ?? '');
	return block.map((line) => {
		if (isBlank(line)) return '';
		const own = leadingWhitespace(line);
		return `${targetIndent}${relativeIndent(own, rootPrefix)}${line.slice(own.length)}`;
	});
}

/**
 * The part of an indent that is deeper than the root's. Falls back to dropping
 * by visual width when the two do not share a prefix, which is what happens in
 * a note that mixes tabs and spaces.
 */
function relativeIndent(own: string, rootPrefix: string): string {
	if (own.startsWith(rootPrefix)) return own.slice(rootPrefix.length);
	const target = indentWidth(rootPrefix);
	let dropped = 0;
	let i = 0;
	while (i < own.length && dropped < target) {
		dropped += own[i] === '\t' ? TAB_WIDTH : 1;
		i += 1;
	}
	return own.slice(i);
}

export interface CutResult {
	/** The note without the block. */
	remaining: string[];
	/** The block itself, verbatim. */
	block: string[];
}

/** Removes an inclusive line range and hands it back. */
export function cutRange(lines: readonly string[], range: LineRange): CutResult {
	return {
		remaining: [...lines.slice(0, range.start), ...lines.slice(range.end + 1)],
		block: lines.slice(range.start, range.end + 1),
	};
}

/* ------------------------------------------------------------------ *
 * Headings
 * ------------------------------------------------------------------ */

/** An ATX heading found in a note. */
export interface HeadingRef {
	/** 0-based line of the `#` line. */
	line: number;
	/** 1-6. */
	level: number;
	/** Heading text without the hashes. */
	text: string;
}

const ATX_HEADING = /^(#{1,6})[ \t]+(.*)$/u;
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/u;

/**
 * Every ATX heading in a note, skipping fenced code blocks so a `# comment`
 * inside a shell snippet is never mistaken for one. Frontmatter is skipped too:
 * a `---` block at the very top can contain anything.
 */
export function findHeadings(lines: readonly string[]): HeadingRef[] {
	const out: HeadingRef[] = [];
	let fence: string | null = null;
	let start = 0;
	if (lines[0]?.trim() === '---') {
		const close = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
		if (close !== -1) start = close + 1;
	}
	for (let i = start; i < lines.length; i += 1) {
		const line = lines[i] ?? '';
		const fenceMatch = FENCE.exec(line);
		if (fence !== null) {
			if (fenceMatch !== null && (fenceMatch[1] ?? '').startsWith(fence)) fence = null;
			continue;
		}
		if (fenceMatch !== null) {
			fence = fenceMatch[1] ?? null;
			continue;
		}
		const match = ATX_HEADING.exec(line);
		if (match === null) continue;
		out.push({ line: i, level: (match[1] ?? '').length, text: (match[2] ?? '').trim() });
	}
	return out;
}

/** Case-insensitive match on the heading text, first occurrence wins. */
export function findHeading(lines: readonly string[], heading: string): HeadingRef | null {
	const needle = heading.trim().toLowerCase();
	return findHeadings(lines).find((h) => h.text.toLowerCase() === needle) ?? null;
}

/**
 * Where new content should go inside a heading's section: after its last
 * non-blank line, before the next heading of the same level or higher. Blank
 * lines at the end of the section are left where they are, below the insertion.
 */
export function endOfSection(lines: readonly string[], heading: HeadingRef): number {
	const headings = findHeadings(lines);
	const next = headings.find((h) => h.line > heading.line && h.level <= heading.level);
	const limit = next?.line ?? lines.length;
	let end = limit;
	while (end > heading.line + 1 && isBlank(lines[end - 1] ?? '')) end -= 1;
	return end;
}

/** Last non-blank line of the note, plus one. Where an append belongs. */
export function endOfNote(lines: readonly string[]): number {
	let end = lines.length;
	while (end > 0 && isBlank(lines[end - 1] ?? '')) end -= 1;
	return end;
}

/* ------------------------------------------------------------------ *
 * Insertion
 * ------------------------------------------------------------------ */

export interface InsertTarget {
	/** Heading to file the block under. `null` appends at the end of the note. */
	heading: string | null;
	/** Level used when the heading has to be created. */
	headingLevel?: number;
}

export interface InsertResult {
	lines: string[];
	/** 0-based line the block ended up on, for a follow-up "open at line". */
	insertedAt: number;
}

/**
 * Inserts a block into a note, creating the destination heading when it is
 * missing. An empty note gets the block (and the heading) without a leading
 * blank line; everything else is separated from what precedes it.
 */
export function insertBlock(
	lines: readonly string[],
	block: readonly string[],
	target: InsertTarget
): InsertResult {
	const working = [...lines];

	if (target.heading === null) {
		const at = endOfNote(working);
		return spliceAt(working, at, block, at > 0);
	}

	const existing = findHeading(working, target.heading);
	if (existing !== null) {
		const at = endOfSection(working, existing);
		// A heading immediately followed by its content needs no extra blank line.
		return spliceAt(working, at, block, false);
	}

	const level = '#'.repeat(clampLevel(target.headingLevel ?? 2));
	const at = endOfNote(working);
	const preamble = at > 0 ? ['', `${level} ${target.heading.trim()}`] : [`${level} ${target.heading.trim()}`];
	working.splice(at, 0, ...preamble);
	return spliceAt(working, at + preamble.length, block, false);
}

function spliceAt(
	lines: string[],
	at: number,
	block: readonly string[],
	separate: boolean
): InsertResult {
	const payload = separate ? ['', ...block] : [...block];
	lines.splice(at, 0, ...payload);
	return { lines, insertedAt: at + (separate ? 1 : 0) };
}

function clampLevel(level: number): number {
	return Math.min(Math.max(Math.round(level), 1), 6);
}

/* ------------------------------------------------------------------ *
 * Relocating a task after the note moved under us
 * ------------------------------------------------------------------ */

/**
 * The line a task is really on right now.
 *
 * The index is debounced, so between an edit and the next scan `task.line` can
 * be stale and point at a neighbour. Writing to the wrong line is exactly the
 * failure mode that loses data, so every action re-locates its task in the
 * content it is about to modify:
 *
 * - the expected line still carries the same text → use it;
 * - otherwise, look for that text in the whole note and accept it only when it
 *   is **unique**;
 * - two matches or none → `null`, and the caller aborts with a notice rather
 *   than guessing.
 */
export function locateTaskLine(
	lines: readonly string[],
	expectedLine: number,
	text: string,
	indent = ''
): number | null {
	if (matches(lines[expectedLine], text, indent)) return expectedLine;
	let found: number | null = null;
	for (let i = 0; i < lines.length; i += 1) {
		if (!matches(lines[i], text, indent)) continue;
		if (found !== null) return null;
		found = i;
	}
	return found;
}

/**
 * Whether a line carries this task's text.
 *
 * Two readings are accepted, because the index does not always parse a line
 * from column zero. On `- * Dirección del Lab` the indexed item is the inner
 * `*` one and its `indent` is the literal `"- "`, so parsing the whole line
 * would yield `* Dirección del Lab` and never match. Stripping the task's own
 * prefix first reproduces exactly what the indexer did.
 */
function matches(line: string | undefined, text: string, indent: string): boolean {
	if (line === undefined) return false;
	if (parseLine(line)?.text === text) return true;
	if (indent === '' || !line.startsWith(indent)) return false;
	return parseLine(line.slice(indent.length))?.text === text;
}
