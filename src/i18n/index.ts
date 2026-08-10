import { getLanguage } from 'obsidian';
import en from './en.ts';
import type { Translations } from './en.ts';
import es from './es.ts';
import { pickLocale, pluralKey, translate } from './translate.ts';
import type { PluralKey, TranslationKey, TranslationParams } from './translate.ts';

/**
 * Translation lookup for the whole plugin.
 *
 * The interface is **English by default and Spanish when Obsidian is in
 * Spanish**. The language comes from `getLanguage()`, never from
 * `localStorage.getItem('language')` — reading that key directly is what rule 28
 * of `eslint-plugin-obsidianmd` forbids, and it is also the private detail
 * `getLanguage()` exists to hide. There is deliberately no language setting:
 * Obsidian's own is authoritative.
 *
 * Every visible string in the plugin goes through here, including the ones the
 * earlier phases wrote inline: settings, heatmap, stats, commands, notices and
 * `aria-label`s. A string that is not in `en.ts` is a string that cannot be
 * translated, so there are none left.
 *
 * This file is the only part of `i18n/` that touches `obsidian`; the fallback
 * and interpolation rules live in `translate.ts` so they can be unit-tested.
 */

export type { Translations } from './en.ts';
export type { PluralKey, TranslationKey, TranslationParams } from './translate.ts';

const LOCALES: Readonly<Record<string, Partial<Translations>>> = {
	es,
};

/**
 * Resolved once and cached: Obsidian cannot change its language without a
 * restart, and `t()` is called on every render of every row.
 */
let active: Partial<Translations> | null = null;

function locale(): Partial<Translations> {
	active ??= pickLocale(getLanguage(), LOCALES);
	return active;
}

/**
 * Forces a language, or clears the cache when given nothing. Exists so an
 * `obs eval` check can exercise a locale without restarting the app.
 */
export function setLanguage(code: string | null): void {
	active = code === null ? null : pickLocale(code, LOCALES);
}

/**
 * The translated string for a key, falling back to English. The key itself is
 * never shown: `en.ts` is exhaustive by construction, since `TranslationKey` is
 * derived from it.
 */
export function t(key: TranslationKey, params?: TranslationParams): string {
	return translate(locale(), en, key, params);
}

/**
 * Count-dependent lookup: picks `<key>_one` or `<key>_other` and passes `count`
 * as a parameter.
 */
export function tCount(key: PluralKey, count: number, params?: TranslationParams): string {
	return t(pluralKey(key, count), { count, ...params });
}
