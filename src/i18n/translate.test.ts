import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import en from './en.ts';
import es from './es.ts';
import { baseLanguage, interpolate, pickLocale, pluralKey, translate } from './translate.ts';

/**
 * The fallback rules, plus a completeness check over the real dictionaries.
 * `translate.ts` imports nothing from `obsidian`, which is the whole reason it
 * exists as a separate file from `index.ts`.
 */

const LOCALES = { es };

describe('baseLanguage', () => {
	it('drops the region and lowercases', () => {
		assert.equal(baseLanguage('es'), 'es');
		assert.equal(baseLanguage('es-ES'), 'es');
		assert.equal(baseLanguage('ES'), 'es');
		assert.equal(baseLanguage('pt-BR'), 'pt');
	});
});

describe('pickLocale', () => {
	it('finds Spanish from any Spanish region code', () => {
		assert.equal(pickLocale('es-419', LOCALES), es);
	});

	it('gives an empty dictionary for a language we do not ship', () => {
		// Empty, not undefined: every lookup then falls through to English, and a
		// raw key can never reach the screen.
		assert.deepEqual(pickLocale('ja', LOCALES), {});
		assert.deepEqual(pickLocale('en', LOCALES), {});
	});
});

describe('interpolate', () => {
	it('substitutes named placeholders', () => {
		assert.equal(interpolate('{a} of {b}', { a: 1, b: 2 }), '1 of 2');
	});

	it('leaves a placeholder it was given no value for', () => {
		assert.equal(interpolate('{a} of {b}', { a: 1 }), '1 of {b}');
	});

	it('is a no-op without params, so braces in text survive', () => {
		assert.equal(interpolate('{{date}}'), '{{date}}');
	});
});

describe('translate', () => {
	it('prefers the locale', () => {
		assert.equal(translate(es, en, 'common.today'), 'Hoy');
	});

	it('falls back to English key by key, not dictionary by dictionary', () => {
		const partial = { 'common.today': 'Hoy' };
		assert.equal(translate(partial, en, 'common.today'), 'Hoy');
		assert.equal(translate(partial, en, 'common.tomorrow'), en['common.tomorrow']);
	});

	it('interpolates whichever language answered', () => {
		assert.equal(translate(es, en, 'stats.level', { count: 4 }), 'Nivel 4');
		assert.equal(translate({}, en, 'stats.level', { count: 4 }), 'Level 4');
	});
});

describe('pluralKey', () => {
	it('uses _one only for exactly one', () => {
		assert.equal(pluralKey('common.dayCount', 1), 'common.dayCount_one');
		assert.equal(pluralKey('common.dayCount', 0), 'common.dayCount_other');
		assert.equal(pluralKey('common.dayCount', 2), 'common.dayCount_other');
		assert.equal(pluralKey('common.dayCount', -1), 'common.dayCount_one');
	});
});

describe('the shipped dictionaries', () => {
	const keys = Object.keys(en);

	it('has no Spanish key that English does not know', () => {
		assert.deepEqual(
			Object.keys(es).filter((key) => !keys.includes(key)),
			[]
		);
	});

	it('translates every key, so nothing silently falls back', () => {
		assert.deepEqual(
			keys.filter((key) => !(key in es)),
			[]
		);
	});

	it('pairs every plural key', () => {
		const singulars = keys.filter((key) => key.endsWith('_one'));
		assert.notEqual(singulars.length, 0);
		for (const key of singulars) {
			const other = `${key.slice(0, -'_one'.length)}_other`;
			assert.ok(keys.includes(other), `missing ${other}`);
			assert.ok(other in es, `missing Spanish ${other}`);
		}
	});

	it('leaves no empty string, which would render as a blank control', () => {
		for (const [key, value] of Object.entries(en)) {
			assert.notEqual(value.trim(), '', key);
		}
	});

	it('keeps the placeholders of the English string in the Spanish one', () => {
		const placeholders = (text: string): string[] =>
			[...text.matchAll(/\{(\w+)\}/gu)].map((m) => m[1] ?? '').sort();
		for (const [key, value] of Object.entries(en)) {
			const translated = es[key as keyof typeof es];
			if (translated === undefined) continue;
			assert.deepEqual(placeholders(translated), placeholders(value), key);
		}
	});
});
