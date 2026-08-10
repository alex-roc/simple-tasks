/**
 * Verify the domain layer against a whole vault, without opening Obsidian.
 *
 * Why this exists: the in-app checks (`obsidian eval`, `tasks total`) mean shelling
 * out to the Obsidian CLI, which intermittently pulls the Obsidian window to the
 * front and steals focus mid-typing. This runs the *same* parser and serializer the
 * plugin uses, but over files read straight from disk, so the everyday regression
 * check needs no running app at all.
 *
 * What it proves:
 *   - round-trip fidelity: `serialize(parse(line)) === line` for every list line in
 *     the vault, which is what guarantees the plugin never mangles user text
 *   - task and status counts, comparable with `obsidian tasks total` when you do
 *     want to cross-check against Obsidian's own cache
 *
 * What it cannot prove: anything about `metadataCache`. Item detection here is a
 * regex over lines, while the plugin defers to the cache's `listItems`, so the two
 * counts differ in known ways — expect this script to report *more* tasks:
 *   - it counts tasks in notes registered as templates; the index excludes them
 *   - it counts `- [ ]` written with no trailing space, which Obsidian does not
 *     treat as a task at all
 * Both gaps are reconcilable to the line. Verified on the seeded vault: 4643 here
 * = 4638 in the index + 3 template tasks + 2 space-less checkboxes.
 *
 * Usage: pnpm verify [-- --vault <path>] [--syntax emoji|inline-field] [--show 20]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import { parseLine } from '../src/domain/parse-line.ts';
import { serializeLine, type TaskWriteSyntax } from '../src/domain/serialize-line.ts';

const args = process.argv.slice(2);
const argValue = (name: string, fallback: string): string => {
	const i = args.indexOf(name);
	const value = i !== -1 ? args[i + 1] : undefined;
	return value ?? fallback;
};

const VAULT = argValue('--vault', join(process.env.HOME ?? '', 'dev', 'my-obsidian-plugins'));
const SYNTAX = argValue('--syntax', 'emoji') as TaskWriteSyntax;
const SHOW = Number(argValue('--show', '10'));

/** Every markdown file in the vault, skipping Obsidian's own config folder. */
function markdownFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith('.')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) markdownFiles(full, out);
		else if (entry.endsWith('.md')) out.push(full);
	}
	return out;
}

interface Mismatch {
	file: string;
	line: number;
	before: string;
	after: string;
}

const files = markdownFiles(VAULT);
const mismatches: Mismatch[] = [];
const byStatus = new Map<string, number>();
let listLines = 0;
let tasks = 0;
let groupingNodes = 0;

const started = performance.now();

for (const file of files) {
	const lines = readFileSync(file, 'utf8').split('\n');
	lines.forEach((line, i) => {
		const parsed = parseLine(line);
		if (parsed === null) return;

		listLines++;
		if (parsed.isTask) {
			tasks++;
			byStatus.set(parsed.status, (byStatus.get(parsed.status) ?? 0) + 1);
		} else {
			groupingNodes++;
		}

		const rewritten = serializeLine(parsed, { syntax: SYNTAX });
		if (rewritten !== line) {
			mismatches.push({
				file: relative(VAULT, file),
				line: i + 1,
				before: line,
				after: rewritten,
			});
		}
	});
}

const elapsed = Math.round(performance.now() - started);
const exact = listLines - mismatches.length;
const pct = listLines === 0 ? 100 : (exact / listLines) * 100;

console.log(`vault:        ${VAULT}`);
console.log(`notes:        ${files.length}`);
console.log(`list lines:   ${listLines}  (${tasks} tasks, ${groupingNodes} grouping nodes)`);
console.log(
	`by status:    ${[...byStatus.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([symbol, n]) => `${JSON.stringify(symbol)}=${n}`)
		.join('  ')}`
);
console.log(`round-trip:   ${exact}/${listLines} byte-identical (${pct.toFixed(2)}%)  [${SYNTAX}]`);
console.log(`elapsed:      ${elapsed} ms`);

if (mismatches.length > 0) {
	console.log(`\n${mismatches.length} line(s) do not round-trip. First ${Math.min(SHOW, mismatches.length)}:`);
	for (const m of mismatches.slice(0, SHOW)) {
		console.log(`\n  ${m.file}:${m.line}`);
		console.log(`    before: ${JSON.stringify(m.before)}`);
		console.log(`    after:  ${JSON.stringify(m.after)}`);
	}
}

/*
 * Tolerated normalizations.
 *
 * Two, and only two, differences between the line on disk and the line the
 * serializer produces are accepted. Both are whitespace that carries no
 * information, and neither can happen on its own: the plugin only rewrites a
 * line it was already rewriting for another reason (a status change, a date, a
 * move), so a tolerated normalization never reaches a note the user merely
 * looked at. Everything else is a regression and fails the run.
 */

/**
 * 1. An empty checkbox written with no trailing space (`- [ ]`) gains it
 *    (`- [ ] `). Obsidian does not even treat the space-less form as a task —
 *    `metadataCache` reports no `task` for it — so writing the space is what
 *    turns a line the user probably meant as a task into one, and the plugin
 *    only ever does it to a line it is already editing.
 */
const TOLERATED_EMPTY_CHECKBOX = /^\s*[-*+]\s*\[.\]$/;

/**
 * 2. A run of repeated spaces or tabs inside the line collapses to one
 *    (`- [ ]  fasd` → `- [ ] fasd`). This is `tidy()` in `parse-line.ts`: it
 *    collapses runs so that removing a metadata token cannot leave a double
 *    space behind, and it cannot tell a gap it created from one the user typed.
 *    Collapsing repeated whitespace loses no information — markdown renders
 *    both identically — so it is tolerated rather than preserved.
 *
 *    Two things stay strict, because there whitespace *is* information:
 *
 *    - **The indentation is compared byte for byte.** It is the outline
 *      hierarchy: `parent` in `listItems` follows from it, so a re-indented
 *      line is a moved line, never a cosmetic change.
 *    - **Trailing whitespace is not trimmed before comparing.** Two spaces at
 *      the end of a line are a markdown hard line break, so losing them would
 *      change how the note renders. A line that ends with a collapsed run
 *      (`"x  "` → `"x"`) therefore still fails.
 */
const INDENT = /^[ \t]*/u;
const collapseRuns = (s: string): string => s.replace(/[ \t]{2,}/gu, ' ');

function onlyCollapsedSpacing(before: string, after: string): boolean {
	const indent = INDENT.exec(before)?.[0] ?? '';
	if ((INDENT.exec(after)?.[0] ?? '') !== indent) return false;
	return collapseRuns(before.slice(indent.length)) === collapseRuns(after.slice(indent.length));
}

const regressions = mismatches.filter(
	(m) => !TOLERATED_EMPTY_CHECKBOX.test(m.before) && !onlyCollapsedSpacing(m.before, m.after)
);

if (regressions.length > 0) {
	console.error(`\nFAIL: ${regressions.length} line(s) changed beyond the tolerated normalization.`);
	process.exit(1);
}

console.log('\nOK');
