import type { TaskStatus } from './task.ts';

/**
 * Our own status catalog. The defaults use the symbols already present in the
 * target vault so existing notes are recognized on first run — a deliberate
 * default, not behaviour inherited from another plugin. Users can edit, add and
 * remove entries in settings.
 *
 * `isCompleted` means "finished", not "no longer actionable": a cancelled or
 * rescheduled task is not a completion, so it never lands on the heatmap.
 */
export const DEFAULT_STATUSES: readonly TaskStatus[] = [
	{ symbol: ' ', name: 'Todo', isCompleted: false, nextSymbol: '/' },
	{ symbol: '/', name: 'In progress', isCompleted: false, nextSymbol: 'x' },
	{ symbol: 'x', name: 'Done', isCompleted: true, nextSymbol: ' ' },
	{ symbol: '-', name: 'Cancelled', isCompleted: false, nextSymbol: ' ' },
	{ symbol: '>', name: 'Rescheduled', isCompleted: false, nextSymbol: ' ' },
];

/** Fallback for a symbol that is not in the catalog. */
export function unknownStatus(symbol: string): TaskStatus {
	// Obsidian itself treats any character other than a space as checked, so an
	// unconfigured symbol is counted as finished rather than silently ignored.
	return {
		symbol,
		name: symbol === ' ' ? 'Todo' : `Unknown (${symbol})`,
		isCompleted: symbol !== ' ',
		nextSymbol: symbol === ' ' ? 'x' : ' ',
	};
}

/** Look a symbol up in the catalog, falling back to {@link unknownStatus}. */
export function resolveStatus(catalog: readonly TaskStatus[], symbol: string): TaskStatus {
	return catalog.find((s) => s.symbol === symbol) ?? unknownStatus(symbol);
}

/** The symbol a click should move this task to. */
export function nextStatusSymbol(catalog: readonly TaskStatus[], symbol: string): string {
	return resolveStatus(catalog, symbol).nextSymbol;
}

/** Whether a symbol counts as finished under the given catalog. */
export function isCompletedSymbol(catalog: readonly TaskStatus[], symbol: string): boolean {
	return resolveStatus(catalog, symbol).isCompleted;
}

/** A fresh, mutable copy of the defaults, safe to hand to the settings store. */
export function cloneDefaultStatuses(): TaskStatus[] {
	return DEFAULT_STATUSES.map((s) => ({ ...s }));
}

/**
 * Drops entries that cannot work (empty or multi-character symbols, duplicates)
 * and repoints dangling `nextSymbol` values. Settings are user-editable and also
 * arrive from `data.json`, so they are never trusted as-is.
 */
export function sanitizeStatuses(input: readonly TaskStatus[]): TaskStatus[] {
	const seen = new Set<string>();
	const out: TaskStatus[] = [];
	for (const s of input) {
		// A status symbol is exactly one character; `[ ]` is the pending one.
		const symbol = s.symbol === '' ? ' ' : s.symbol.charAt(0);
		if (seen.has(symbol)) continue;
		seen.add(symbol);
		out.push({
			symbol,
			name: s.name.trim() === '' ? unknownStatus(symbol).name : s.name.trim(),
			isCompleted: Boolean(s.isCompleted),
			nextSymbol: s.nextSymbol === '' ? ' ' : s.nextSymbol.charAt(0),
		});
	}
	if (out.length === 0) return cloneDefaultStatuses();
	for (const s of out) {
		if (!seen.has(s.nextSymbol)) s.nextSymbol = out[0]?.symbol ?? ' ';
	}
	return out;
}
