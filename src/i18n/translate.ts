import type { Translations } from './en.ts';

/**
 * The pure half of `i18n/`: choosing a locale, falling back and substituting
 * placeholders. Split from `index.ts` because that file imports `getLanguage`
 * from `obsidian`, which would keep `node --test` out — and the fallback rules
 * are exactly the part worth testing.
 */

/** Values substituted into `{placeholders}`. */
export type TranslationParams = Record<string, string | number>;

/** Every key the plugin can ask for. */
export type TranslationKey = keyof Translations;

/** Keys that exist in a `_one` / `_other` pair. Derived, so it cannot drift. */
export type PluralKey = TranslationKey extends infer K
	? K extends `${infer Base}_one`
		? Base
		: never
	: never;

/** Base language of an ISO code, so `es-ES` and `ES` both find `es`. */
export function baseLanguage(code: string): string {
	const dash = code.indexOf('-');
	return (dash === -1 ? code : code.slice(0, dash)).toLowerCase();
}

/**
 * The dictionary for a language code. An unknown language gets an empty one,
 * which means every lookup falls through to English — never a raw key.
 */
export function pickLocale(
	code: string,
	locales: Readonly<Record<string, Partial<Translations>>>
): Partial<Translations> {
	return locales[baseLanguage(code)] ?? {};
}

/** Replaces `{name}` with `params.name`, leaving unknown placeholders alone. */
export function interpolate(template: string, params?: TranslationParams): string {
	if (params === undefined) return template;
	return template.replace(/\{(\w+)\}/gu, (whole, name: string) => {
		const value = params[name];
		return value === undefined ? whole : String(value);
	});
}

/** Looks a key up in the locale, falling back to English key by key. */
export function translate(
	locale: Partial<Translations>,
	fallback: Translations,
	key: TranslationKey,
	params?: TranslationParams
): string {
	return interpolate(locale[key] ?? fallback[key], params);
}

/**
 * `_one` for exactly one, `_other` for everything else. English and Spanish
 * share that split, which is why a full plural-rules table would be dead weight.
 */
export function pluralKey(key: PluralKey, count: number): TranslationKey {
	return `${key}${Math.abs(count) === 1 ? '_one' : '_other'}` as TranslationKey;
}
