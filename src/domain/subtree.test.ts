import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	cutRange,
	endOfNote,
	endOfSection,
	findHeading,
	findHeadings,
	indentWidth,
	insertBlock,
	locateTaskLine,
	reindentBlock,
	subtreeRange,
} from './subtree.ts';

/**
 * The line surgery behind `actions/move-task.ts`. This is the file where a bug
 * silently eats a subtask, so it gets the most tests in the repo: every case
 * here corresponds to a shape that exists in the test vault.
 *
 * Runs under `node --test`: `subtree.ts` imports only `parse-line.ts`, and
 * neither touches `obsidian` at runtime.
 */

/** Shorthand: a note as an array of lines. */
function note(...lines: string[]): string[] {
	return lines;
}

/** Every line index in `lines` that looks like a list item, as the index would report. */
function itemsOf(lines: readonly string[]): Set<number> {
	const out = new Set<number>();
	for (const [i, line] of lines.entries()) {
		if (/^[ \t]*(?:[-*+]|\d+[.)])[ \t]/u.test(line)) out.add(i);
	}
	return out;
}

describe('indentWidth', () => {
	it('counts a tab as four columns so tabs and spaces are comparable', () => {
		assert.equal(indentWidth(''), 0);
		assert.equal(indentWidth('\t'), 4);
		assert.equal(indentWidth('    '), 4);
		assert.equal(indentWidth('\t  '), 6);
	});
});

describe('subtreeRange', () => {
	const lines = note(
		'- [ ] Entrega #dev', // 0
		'\t- [x] Escribir el diseño de la interfaz', // 1
		'\t- [ ] Coordinar los datos de la encuesta', // 2
		'\t\t- [ ] Publicar la migración del servidor ⏬', // 3
		'\t\t- [ ] Documentar el borrador del capítulo', // 4
		'\t- [ ] Coordinar el pipeline de limpieza', // 5
		'- [ ] Otra raíz', // 6
		'\t- [ ] Su hija' // 7
	);
	const items = itemsOf(lines);

	it('takes the root and every descendant, and stops at the next root', () => {
		const range = subtreeRange(lines, 0, new Set([1, 2, 3, 4, 5]), items);
		assert.deepEqual(range, { start: 0, end: 5 });
	});

	it('takes a middle branch with its own children only', () => {
		const range = subtreeRange(lines, 2, new Set([3, 4]), items);
		assert.deepEqual(range, { start: 2, end: 4 });
	});

	it('takes a leaf as a single line', () => {
		assert.deepEqual(subtreeRange(lines, 5, new Set(), items), { start: 5, end: 5 });
	});

	it('stops at a sibling even when the index reports no descendants', () => {
		assert.deepEqual(subtreeRange(lines, 6, new Set([7]), items), { start: 6, end: 7 });
	});

	it('carries the continuation lines that hang off the last descendant', () => {
		const withProse = note(
			'- [ ] Raíz', // 0
			'\t- [ ] Hija', // 1
			'\t  una explicación que sigue', // 2
			'', // 3
			'\t  y otro párrafo indentado', // 4
			'', // 5
			'- [ ] Siguiente raíz' // 6
		);
		const range = subtreeRange(withProse, 0, new Set([1]), itemsOf(withProse));
		// Line 4 joins; the blank line 5 that separates it from the next root does not.
		assert.deepEqual(range, { start: 0, end: 4 });
	});

	it('never swallows a trailing blank line', () => {
		const trailing = note('- [ ] Raíz', '\t- [ ] Hija', '', '');
		assert.deepEqual(subtreeRange(trailing, 0, new Set([1]), itemsOf(trailing)), {
			start: 0,
			end: 1,
		});
	});

	it('stops at unindented prose', () => {
		const prose = note('- [ ] Raíz', '\t- [ ] Hija', 'Texto normal de la nota');
		assert.deepEqual(subtreeRange(prose, 0, new Set([1]), itemsOf(prose)), { start: 0, end: 1 });
	});

	it('handles the two-items-on-one-line shape as one line', () => {
		// `- * Dirección del Lab` is a `-` item whose content is a `*` sublist.
		// The index keeps one item per line, so the root is line 0 and its whole
		// outline follows it.
		const weekly = note(
			'- * Dirección del Lab', // 0
			'\t- Coordinación', // 1
			'\t- Fundación', // 2
			'\t\t- [x] Presupuestar la migración', // 3
			'- * Sociólogo digital', // 4
			'\t- Doctorado' // 5
		);
		assert.deepEqual(subtreeRange(weekly, 0, new Set([1, 2, 3]), itemsOf(weekly)), {
			start: 0,
			end: 3,
		});
	});
});

describe('reindentBlock', () => {
	it('re-anchors a nested subtree at the top level, keeping relative depth', () => {
		const block = note(
			'\t- [ ] Coordinar los datos de la encuesta',
			'\t\t- [ ] Publicar la migración del servidor ⏬',
			'\t\t\t- [ ] Nieta'
		);
		assert.deepEqual(reindentBlock(block, ''), [
			'- [ ] Coordinar los datos de la encuesta',
			'\t- [ ] Publicar la migración del servidor ⏬',
			'\t\t- [ ] Nieta',
		]);
	});

	it('pushes a top-level subtree deeper without touching its shape', () => {
		const block = note('- [ ] Raíz', '\t- [ ] Hija', '\t\t- [ ] Nieta');
		assert.deepEqual(reindentBlock(block, '\t\t'), [
			'\t\t- [ ] Raíz',
			'\t\t\t- [ ] Hija',
			'\t\t\t\t- [ ] Nieta',
		]);
	});

	it('is the identity when the target indent equals the root indent', () => {
		const block = note('  - [ ] Raíz', '    - [ ] Hija');
		assert.deepEqual(reindentBlock(block, '  '), block);
	});

	it('keeps the outer marker of a two-items-on-one-line root', () => {
		const block = note('- * Dirección del Lab', '\t- Coordinación', '\t\t- [x] Una tarea');
		assert.deepEqual(reindentBlock(block, '\t'), [
			'\t- * Dirección del Lab',
			'\t\t- Coordinación',
			'\t\t\t- [x] Una tarea',
		]);
	});

	it('blanks out a blank line instead of indenting whitespace', () => {
		const block = note('- [ ] Raíz', '   ', '\t- [ ] Hija');
		assert.deepEqual(reindentBlock(block, '\t'), ['\t- [ ] Raíz', '', '\t\t- [ ] Hija']);
	});

	it('falls back to dropping by width when tabs and spaces are mixed', () => {
		// The root is indented with a tab, the child with four spaces plus two: no
		// shared prefix, so the four columns of the root are dropped by width.
		const block = note('\t- [ ] Raíz', '      - [ ] Hija');
		assert.deepEqual(reindentBlock(block, ''), ['- [ ] Raíz', '  - [ ] Hija']);
	});

	it('never de-indents a child above its new root', () => {
		const block = note('\t\t- [ ] Raíz', '\t- [ ] Algo menos indentado');
		assert.deepEqual(reindentBlock(block, ''), ['- [ ] Raíz', '- [ ] Algo menos indentado']);
	});
});

describe('cutRange', () => {
	it('removes the range and hands it back untouched', () => {
		const lines = note('a', 'b', 'c', 'd');
		const cut = cutRange(lines, { start: 1, end: 2 });
		assert.deepEqual(cut.block, ['b', 'c']);
		assert.deepEqual(cut.remaining, ['a', 'd']);
		// The input is not mutated: the caller may still need it for a rollback.
		assert.deepEqual(lines, ['a', 'b', 'c', 'd']);
	});
});

describe('findHeadings', () => {
	const lines = note(
		'---',
		'tipoNota:',
		'  - diario',
		'---',
		'# Diario',
		'## Tareas',
		'- [ ] Algo',
		'```bash',
		'# esto es un comentario, no un encabezado',
		'```',
		'### Detalle',
		'texto del detalle',
		'',
		'## Noche'
	);

	it('skips frontmatter and fenced code', () => {
		assert.deepEqual(
			findHeadings(lines).map((h) => [h.line, h.level, h.text]),
			[
				[4, 1, 'Diario'],
				[5, 2, 'Tareas'],
				[10, 3, 'Detalle'],
				[13, 2, 'Noche'],
			]
		);
	});

	it('matches a heading case-insensitively', () => {
		assert.equal(findHeading(lines, 'tareas')?.line, 5);
		assert.equal(findHeading(lines, 'No existe'), null);
	});

	it('ends a section at the next heading of the same level or higher', () => {
		const tareas = findHeading(lines, 'Tareas');
		assert.notEqual(tareas, null);
		// `### Detalle` is deeper, so it stays *inside* the section; `## Noche` is
		// what closes it, and the blank line before it is not part of the content.
		assert.equal(endOfSection(lines, tareas as NonNullable<typeof tareas>), 12);
	});

	it('ignores the trailing blank lines of a note when appending', () => {
		assert.equal(endOfNote(note('a', 'b', '', '')), 2);
		assert.equal(endOfNote(note()), 0);
	});
});

describe('insertBlock', () => {
	const block = note('- [ ] Movida', '\t- [ ] Su hija');

	it('appends at the end of the note, separated by a blank line', () => {
		// The note ends with a newline, which shows up as a trailing empty line: the
		// block goes before it, so the file still ends the way it did.
		const result = insertBlock(note('# Nota', '', 'Texto.', ''), block, { heading: null });
		assert.deepEqual(result.lines, [
			'# Nota',
			'',
			'Texto.',
			'',
			'- [ ] Movida',
			'\t- [ ] Su hija',
			'',
		]);
		assert.equal(result.insertedAt, 4);
	});

	it('files under an existing heading, at the end of its section', () => {
		const lines = note('# Diario', '## Tareas', '- [ ] Ya estaba', '', '## Noche', 'x');
		const result = insertBlock(lines, block, { heading: 'Tareas' });
		assert.deepEqual(result.lines, [
			'# Diario',
			'## Tareas',
			'- [ ] Ya estaba',
			'- [ ] Movida',
			'\t- [ ] Su hija',
			'',
			'## Noche',
			'x',
		]);
		assert.equal(result.insertedAt, 3);
	});

	it('creates a heading that does not exist yet, at the end of the note', () => {
		const result = insertBlock(note('# Diario', 'Texto.'), block, {
			heading: 'Tareas',
			headingLevel: 2,
		});
		assert.deepEqual(result.lines, [
			'# Diario',
			'Texto.',
			'',
			'## Tareas',
			'- [ ] Movida',
			'\t- [ ] Su hija',
		]);
		assert.equal(result.insertedAt, 4);
	});

	it('does not open an empty note with a blank line', () => {
		const result = insertBlock(note(''), block, { heading: null });
		assert.deepEqual(result.lines, ['- [ ] Movida', '\t- [ ] Su hija', '']);
		assert.equal(result.insertedAt, 0);
	});

	it('clamps an absurd heading level rather than writing seven hashes', () => {
		const result = insertBlock(note('x'), block, { heading: 'H', headingLevel: 99 });
		assert.equal(result.lines[2], '###### H');
	});

	it('leaves the input array alone', () => {
		const lines = note('# Diario');
		insertBlock(lines, block, { heading: null });
		assert.deepEqual(lines, ['# Diario']);
	});
});

describe('locateTaskLine', () => {
	const lines = note(
		'# Nota',
		'- [ ] Revisar el informe',
		'- [x] Otra cosa',
		'- [ ] Revisar el informe'
	);

	it('uses the expected line when the text still matches', () => {
		assert.equal(locateTaskLine(lines, 1, 'Revisar el informe'), 1);
	});

	it('follows a task that shifted, when the text is unique', () => {
		const shifted = note('nuevo encabezado', ...lines.slice(0, 3));
		assert.equal(locateTaskLine(shifted, 3, 'Otra cosa'), 3);
		assert.equal(locateTaskLine(shifted, 99, 'Otra cosa'), 3);
	});

	it('refuses to guess when the text is ambiguous', () => {
		// Two identical lines and the expected one no longer matches: writing to
		// either would be a coin flip, so the caller must abort.
		assert.equal(locateTaskLine(lines, 0, 'Revisar el informe'), null);
	});

	it('returns null when the text is gone entirely', () => {
		assert.equal(locateTaskLine(lines, 1, 'Ya no existe'), null);
	});

	it('finds an item that shares its line with an outer one', () => {
		// `- * Dirección del Lab` is a `-` item holding a `*` sublist. The index
		// keeps the inner item, whose `indent` is the literal `"- "`, so parsing
		// the whole line yields `* Dirección del Lab` and would never match.
		const weekly = note('# Tareas semanales', '- * Dirección del Lab', '\t- Coordinación');
		assert.equal(locateTaskLine(weekly, 1, 'Dirección del Lab'), null);
		assert.equal(locateTaskLine(weekly, 1, 'Dirección del Lab', '- '), 1);
		assert.equal(locateTaskLine(weekly, 99, 'Dirección del Lab', '- '), 1);
	});

	it('matches on the round-trippable text, ignoring status and metadata', () => {
		const withMeta = note('- [x] Revisar el informe 📅 2026-01-01');
		assert.equal(locateTaskLine(withMeta, 0, 'Revisar el informe'), 0);
	});
});
