import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseLine } from './parse-line.ts';
import { serializeLine } from './serialize-line.ts';
import type { TaskWriteSyntax } from './serialize-line.ts';

/**
 * Runs with `node --test`: these modules import nothing from `obsidian` at
 * runtime, so Node's native type stripping is enough — no test framework, no
 * build step.
 */

function roundTrip(line: string, syntax: TaskWriteSyntax = 'emoji'): string {
	const parsed = parseLine(line);
	assert.notEqual(parsed, null, `not recognized as a list item: ${line}`);
	return serializeLine(parsed as NonNullable<typeof parsed>, { syntax });
}

describe('canonical lines survive a round trip byte for byte', () => {
	const canonical = [
		'- [ ] Corregir el informe mensual de [[paquete de microdatos]]',
		'- [x] Escribir la revisión de literatura #escritura 🔽',
		'\t\t- [x] Publicar los datos de la encuesta de [[curso de métodos digitales]] 🔺',
		'  - [>] Analizar el borrador del capítulo de [[artículo sobre ciudades#intro|el capítulo]] #datos ⏫',
		'- [/] Presupuestar el convenio institucional',
		'- [ ] ',
		'- [-] Tarea cancelada ⏬ ➕ 2026-01-01 🛫 2026-01-02 ⏳ 2026-01-03 📅 2026-01-04 ✅ 2026-01-05 ❌ 2026-01-06',
		'- * Dirección del Lab',
		'\t- Coordinación',
		'1. [ ] Numbered task 📅 2026-03-01',
		'+ [ ] Plus marker #lab/infra',
		'- [ ] Deja intacto lo que no entiende 🔁 every week 🆔 abc123 ^bloque',
	];

	for (const line of canonical) {
		it(JSON.stringify(line), () => {
			assert.equal(roundTrip(line), line);
		});
	}
});

describe('non-canonical metadata order is normalized, then stable', () => {
	const cases: [input: string, expected: string][] = [
		// Dates written out of order come back in the canonical order.
		[
			'- [x] Cerrar el informe ✅ 2026-01-05 📅 2026-01-04',
			'- [x] Cerrar el informe 📅 2026-01-04 ✅ 2026-01-05',
		],
		// Priority written before the text moves after it.
		['- [ ] ⏫ Revisar el pipeline', '- [ ] Revisar el pipeline ⏫'],
		// A date in the middle of the sentence moves to the end.
		[
			'- [ ] Entregar 📅 2026-02-01 el informe',
			'- [ ] Entregar el informe 📅 2026-02-01',
		],
		// The tolerated calendar alias is normalized to the canonical due emoji.
		['- [ ] Revisar 🗓️ 2026-02-01', '- [ ] Revisar 📅 2026-02-01'],
		// Inline fields are read even when the write syntax is emoji.
		[
			'- [ ] Migrar el servidor [due:: 2026-04-01] [priority:: high]',
			'- [ ] Migrar el servidor ⏫ 📅 2026-04-01',
		],
		// Trailing whitespace is dropped.
		['- [x] Cerrar la revisión   ', '- [x] Cerrar la revisión'],
	];

	for (const [input, expected] of cases) {
		it(JSON.stringify(input), () => {
			const once = roundTrip(input);
			assert.equal(once, expected);
			assert.equal(roundTrip(once), once, 'second pass must be a fixed point');
		});
	}
});

describe('the inline-field dialect round trips too', () => {
	const canonical = [
		'- [ ] Migrar el servidor [priority:: high] [due:: 2026-04-01]',
		'- [x] Cerrar el informe [completion:: 2026-01-05]',
	];
	for (const line of canonical) {
		it(JSON.stringify(line), () => {
			assert.equal(roundTrip(line, 'inline-field'), line);
		});
	}

	it('converts emoji to inline fields without losing anything', () => {
		const out = roundTrip('- [x] Cerrar 🔺 📅 2026-01-04 ✅ 2026-01-05', 'inline-field');
		assert.equal(
			out,
			'- [x] Cerrar [priority:: highest] [due:: 2026-01-04] [completion:: 2026-01-05]'
		);
		assert.equal(roundTrip(out, 'inline-field'), out);
	});
});

describe('parsing', () => {
	it('keeps the checkbox out of a line that merely starts with a wikilink', () => {
		const parsed = parseLine('- [[una nota]] con texto');
		assert.equal(parsed?.isTask, false);
		assert.equal(parsed?.text, '[[una nota]] con texto');
	});

	it('reads a list item without a checkbox as a grouping node', () => {
		const parsed = parseLine('\t- Coordinación #lab');
		assert.equal(parsed?.isTask, false);
		assert.deepEqual(parsed?.tags, ['#lab']);
		assert.equal(parsed?.cleanText, 'Coordinación');
	});

	it('does not read a heading inside a wikilink as a tag', () => {
		const parsed = parseLine('- [ ] Ver [[nota#sección|alias]] y #real');
		assert.deepEqual(parsed?.tags, ['#real']);
	});

	it('ignores metadata inside inline code', () => {
		const parsed = parseLine('- [ ] Usar `📅 2026-01-01` como ejemplo');
		assert.deepEqual(parsed?.dates, {});
		assert.equal(parsed?.text, 'Usar `📅 2026-01-01` como ejemplo');
	});

	it('rejects all-numeric tags', () => {
		assert.deepEqual(parseLine('- [ ] Costó #2026 pesos')?.tags, []);
	});

	it('extracts wikilink parts', () => {
		const parsed = parseLine('- [ ] Ver [[nota#sección|alias]]');
		assert.deepEqual(parsed?.links, [
			{ target: 'nota', heading: 'sección', alias: 'alias', raw: '[[nota#sección|alias]]' },
		]);
	});

	it('separates clean text from the metadata', () => {
		const parsed = parseLine('- [x] Escribir la revisión #escritura 🔽 📅 2026-01-04');
		assert.equal(parsed?.cleanText, 'Escribir la revisión');
		assert.equal(parsed?.text, 'Escribir la revisión #escritura');
		assert.equal(parsed?.priority, 'low');
		assert.deepEqual(parsed?.dates, { due: '2026-01-04' });
	});

	it('returns null for a line that is not a list item', () => {
		assert.equal(parseLine('# Tareas semanales'), null);
		assert.equal(parseLine('**Mañana**'), null);
	});
});
