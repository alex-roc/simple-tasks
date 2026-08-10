import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	CompletionLog,
	MAX_ENTRIES,
	blockIdOf,
	completionKeys,
	detectCompletions,
	isKeyUnder,
	isoDaysBefore,
	keyNotePath,
	normalizeTaskText,
	planCompletionTransfers,
	relocateKeys,
	remapKeyPath,
} from './completion-log.ts';
import type { KeyableTask, RelocatableTask } from './completion-log.ts';

function task(cleanText: string, isTask = true, path = 'Atenas/ideas.md'): KeyableTask {
	return { path, cleanText, isTask };
}

/** A task as `move-task` hands it over: the index's own shape, narrowed. */
function movable(
	cleanText: string,
	extra: Partial<RelocatableTask> = {},
	path = 'Atenas/ideas.md'
): RelocatableTask {
	return {
		path,
		cleanText,
		isTask: true,
		isCompleted: true,
		dates: {},
		effectiveDate: null,
		...extra,
	};
}

const NO_LOG = (): string | null => null;

describe('task identity', () => {
	it('ignores case and collapsed whitespace, so reformatting keeps the key', () => {
		assert.equal(normalizeTaskText('  Escribir   el   Informe '), 'escribir el informe');
	});

	it('keys a line by its block reference when it has one', () => {
		assert.equal(blockIdOf('Escribir el informe ^abc-123'), 'abc-123');
		assert.equal(blockIdOf('Escribir el informe'), null);
		const [key] = completionKeys([task('Escribir el informe ^abc-123')]);
		assert.equal(key, 'Atenas/ideas.md::^abc-123');
	});

	it('does not include the block reference in the normalized text', () => {
		assert.equal(normalizeTaskText('Escribir el informe ^abc-123'), 'escribir el informe');
	});

	it('gives grouping items no key at all', () => {
		assert.deepEqual(completionKeys([task('Proyectos', false)]), [null]);
	});

	it('survives the task moving: the key does not mention the line', () => {
		const before = completionKeys([task('Uno'), task('Dos')]);
		const after = completionKeys([task('Cero'), task('Uno'), task('Dos')]);
		assert.equal(before[0], after[1]);
		assert.equal(before[1], after[2]);
	});

	it('keeps two identical lines apart with an occurrence ordinal', () => {
		const keys = completionKeys([task('Revisar'), task('Revisar')]);
		assert.notEqual(keys[0], keys[1]);
		assert.equal(keys[0], 'Atenas/ideas.md::0::revisar');
		assert.equal(keys[1], 'Atenas/ideas.md::1::revisar');
	});
});

describe('relocateKeys', () => {
	const source = [
		task('Contexto', false),
		task('Escribir el informe'),
		task('Revisar'),
		task('Otra cosa'),
	];

	it('rewrites the note path, which is the whole bug it exists for', () => {
		const moved = relocateKeys(source, [1], 'Cronos/Diario/2026-08-01.md', []);
		assert.deepEqual(moved, [
			{
				index: 1,
				from: 'Atenas/ideas.md::0::escribir el informe',
				to: 'Cronos/Diario/2026-08-01.md::0::escribir el informe',
			},
		]);
	});

	it('carries the whole subtree, skipping the grouping items', () => {
		const moved = relocateKeys(source, [0, 1, 2], 'Otra.md', []);
		assert.deepEqual(
			moved.map((m) => m.index),
			[1, 2]
		);
		assert.deepEqual(
			moved.map((m) => m.to),
			['Otra.md::0::escribir el informe', 'Otra.md::0::revisar']
		);
	});

	it('counts past the identical tasks the destination already has', () => {
		const destination = [task('Revisar', true, 'Otra.md'), task('Revisar', true, 'Otra.md')];
		const [moved] = relocateKeys(source, [2], 'Otra.md', destination);
		assert.equal(moved?.to, 'Otra.md::2::revisar');
	});

	it('keeps two identical moved tasks apart in the destination too', () => {
		const twins = [task('Revisar'), task('Revisar')];
		const moved = relocateKeys(twins, [0, 1], 'Otra.md', []);
		assert.deepEqual(
			moved.map((m) => m.to),
			['Otra.md::0::revisar', 'Otra.md::1::revisar']
		);
	});

	it('uses the block reference when the line carries one, so the ordinal cannot drift', () => {
		const withBlock = [task('Escribir el informe ^abc-123')];
		const [moved] = relocateKeys(withBlock, [0], 'Otra.md', [task('Escribir el informe ^abc-123')]);
		assert.equal(moved?.from, 'Atenas/ideas.md::^abc-123');
		assert.equal(moved?.to, 'Otra.md::^abc-123');
	});

	it('reads the moved lines in document order whatever order it is given them', () => {
		const moved = relocateKeys([task('Revisar'), task('Revisar')], [1, 0], 'Otra.md', []);
		assert.deepEqual(
			moved.map((m) => m.index),
			[0, 1]
		);
	});
});

describe('planCompletionTransfers', () => {
	/**
	 * The bug this whole mechanism exists for: a completion recorded in 2025,
	 * moved to another note today, must not be re-dated to today.
	 */
	it('carries the recorded date across, instead of letting it be re-minted', () => {
		const items = [movable('Escribir el informe')];
		const moves = planCompletionTransfers(items, [0], 'Atenas/archivo.md', [], (key) =>
			key === 'Atenas/ideas.md::0::escribir el informe' ? '2025-11-03' : null
		);
		assert.deepEqual(moves, [
			{
				from: 'Atenas/ideas.md::0::escribir el informe',
				to: 'Atenas/archivo.md::0::escribir el informe',
				date: '2025-11-03',
			},
		]);
	});

	it('preserves the day of a task leaving a periodic note, which has no entry yet', () => {
		const items = [movable('Escribir el informe', { effectiveDate: '2025-11-03' })];
		const [move] = planCompletionTransfers(items, [0], 'Atenas/archivo.md', [], NO_LOG);
		assert.equal(move?.date, '2025-11-03');
	});

	it('leaves alone a task that carries its own completion date on the line', () => {
		const items = [movable('Escribir el informe', { dates: { done: '2025-11-03' } })];
		assert.deepEqual(planCompletionTransfers(items, [0], 'Otra.md', [], NO_LOG), []);
	});

	it('says nothing about an open task, or one with no date to preserve', () => {
		const open = [movable('Pendiente', { isCompleted: false, effectiveDate: '2025-11-03' })];
		assert.deepEqual(planCompletionTransfers(open, [0], 'Otra.md', [], NO_LOG), []);
		const undated = [movable('Sin fecha')];
		assert.deepEqual(planCompletionTransfers(undated, [0], 'Otra.md', [], NO_LOG), []);
	});

	it('carries the completed children of the subtree, not only its root', () => {
		const items = [
			movable('Proyecto', { isTask: false, isCompleted: false }),
			movable('Hija hecha', { effectiveDate: '2025-11-03' }),
			movable('Hija abierta', { isCompleted: false, effectiveDate: '2025-11-03' }),
			movable('Nieta hecha', { effectiveDate: '2025-11-04' }),
			movable('Fuera del subarbol', { effectiveDate: '2025-11-05' }),
		];
		const moves = planCompletionTransfers(items, [0, 1, 2, 3], 'Cronos/Diario/2026-08-01.md', [], NO_LOG);
		assert.deepEqual(moves, [
			{
				from: 'Atenas/ideas.md::0::hija hecha',
				to: 'Cronos/Diario/2026-08-01.md::0::hija hecha',
				date: '2025-11-03',
			},
			{
				from: 'Atenas/ideas.md::0::nieta hecha',
				to: 'Cronos/Diario/2026-08-01.md::0::nieta hecha',
				date: '2025-11-04',
			},
		]);
	});

	it('is a no-op when the key would not change, so a same-note move touches nothing', () => {
		const items = [movable('Escribir el informe', { effectiveDate: '2025-11-03' })];
		assert.deepEqual(planCompletionTransfers(items, [0], 'Atenas/ideas.md', [], NO_LOG), []);
	});

	/** What the log then does with the plan, and what the indexer tries next. */
	it('leaves the destination dated correctly and the source key gone', () => {
		const log = new CompletionLog();
		log.record('Atenas/ideas.md::0::escribir el informe', '2025-11-03', true);
		const items = [movable('Escribir el informe')];
		for (const move of planCompletionTransfers(items, [0], 'Atenas/archivo.md', [], (key) =>
			log.get(key)
		)) {
			log.record(move.to, move.date, true);
			log.forget(move.from);
		}
		assert.equal(log.get('Atenas/ideas.md::0::escribir el informe'), null);
		assert.equal(log.get('Atenas/archivo.md::0::escribir el informe'), '2025-11-03');
		// The indexer's "appeared already completed" rule runs next and must not win.
		assert.equal(log.record('Atenas/archivo.md::0::escribir el informe', '2026-08-01', false), false);
		assert.equal(log.get('Atenas/archivo.md::0::escribir el informe'), '2025-11-03');
	});
});

describe('key paths', () => {
	it('reads the note path out of both key shapes', () => {
		assert.equal(keyNotePath('Atenas/ideas.md::0::uno'), 'Atenas/ideas.md');
		assert.equal(keyNotePath('Atenas/ideas.md::^abc'), 'Atenas/ideas.md');
	});

	it('matches a folder only on a path boundary', () => {
		assert.equal(isKeyUnder('Notes/a.md::0::x', 'Notes'), true);
		assert.equal(isKeyUnder('Notes.md::0::x', 'Notes'), false);
		// The trap a raw `startsWith` on the key falls into.
		assert.equal(isKeyUnder('Notes2/a.md::0::x', 'Notes'), false);
	});

	it('remaps only the keys that really live under the renamed path', () => {
		assert.equal(remapKeyPath('Notes/a.md::0::x', 'Notes', 'Ideas'), 'Ideas/a.md::0::x');
		assert.equal(remapKeyPath('Notes2/a.md::0::x', 'Notes', 'Ideas'), null);
	});
});

describe('detectCompletions', () => {
	it('records nothing on a first sight, however much is already done', () => {
		const current = new Map([
			['a', true],
			['b', true],
		]);
		assert.deepEqual(detectCompletions(null, current), { transitioned: [], appeared: [] });
	});

	it('separates a real transition from a line that turned up already done', () => {
		const previous = new Map([
			['a', false],
			['b', true],
		]);
		const current = new Map([
			['a', true],
			['b', true],
			['c', true],
		]);
		assert.deepEqual(detectCompletions(previous, current), {
			transitioned: ['a'],
			appeared: ['c'],
		});
	});

	it('ignores tasks that are still open', () => {
		const previous = new Map([['a', true]]);
		const current = new Map([['a', false]]);
		assert.deepEqual(detectCompletions(previous, current), { transitioned: [], appeared: [] });
	});
});

describe('CompletionLog', () => {
	it('round trips through JSON and drops anything that is not a date', () => {
		const log = new CompletionLog();
		log.record('a', '2026-01-15', true);
		const revived = CompletionLog.fromJSON(
			JSON.parse(JSON.stringify({ ...log.toJSON(), entries: { ...log.toJSON().entries, b: 7 } }))
		);
		assert.equal(revived.get('a'), '2026-01-15');
		assert.equal(revived.get('b'), null);
	});

	it('overwrites on a transition but only fills a gap otherwise', () => {
		const log = new CompletionLog();
		assert.equal(log.record('a', '2026-01-15', false), true);
		assert.equal(log.record('a', '2026-03-01', false), false);
		assert.equal(log.get('a'), '2026-01-15');
		assert.equal(log.record('a', '2026-03-01', true), true);
		assert.equal(log.get('a'), '2026-03-01');
	});

	it('rejects a malformed date instead of storing it', () => {
		const log = new CompletionLog();
		assert.equal(log.record('a', 'ayer', true), false);
		assert.equal(log.size, 0);
	});

	it('follows a note rename and a folder rename', () => {
		const log = new CompletionLog();
		log.record('Atenas/ideas.md::0::uno', '2026-01-15', true);
		log.record('Atenas/sub/otra.md::0::dos', '2026-01-15', true);
		assert.equal(log.renamePath('Atenas', 'Ideas'), 2);
		assert.equal(log.get('Ideas/ideas.md::0::uno'), '2026-01-15');
		assert.equal(log.get('Ideas/sub/otra.md::0::dos'), '2026-01-15');
	});

	it('leaves a sibling whose name merely starts the same alone', () => {
		const log = new CompletionLog();
		log.record('Notes/a.md::0::uno', '2026-01-15', true);
		log.record('Notes2/a.md::0::dos', '2026-01-15', true);
		log.record('Notes.md::0::tres', '2026-01-15', true);
		assert.equal(log.renamePath('Notes', 'Ideas'), 1);
		assert.equal(log.get('Ideas/a.md::0::uno'), '2026-01-15');
		assert.equal(log.get('Notes2/a.md::0::dos'), '2026-01-15');
		assert.equal(log.get('Notes.md::0::tres'), '2026-01-15');
	});

	/**
	 * The rename half of the bug `relocateKeys` fixes for moves. It needs no fix:
	 * `vault.on('rename')` reaches the log *before* the renamed note is
	 * re-indexed, so by the time the diff runs the entry is already under the new
	 * path and the task is never seen as "appeared already completed".
	 */
	it('keeps a rename from re-dating a completion, because the key follows the note', () => {
		const log = new CompletionLog();
		const before = 'Atenas/ideas.md::0::escribir el informe';
		const after = 'Atenas/informes.md::0::escribir el informe';
		log.record(before, '2025-11-03', true);
		log.renamePath('Atenas/ideas.md', 'Atenas/informes.md');
		assert.equal(log.get(after), '2025-11-03');
		// What the indexer does next: the key turns up completed, and the gap-fill
		// rule must not move the date it already has.
		assert.equal(log.record(after, '2026-08-01', false), false);
		assert.equal(log.get(after), '2025-11-03');
	});

	it('forgets a deleted folder', () => {
		const log = new CompletionLog();
		log.record('Atenas/ideas.md::0::uno', '2026-01-15', true);
		log.record('Cronos/diario.md::0::dos', '2026-01-15', true);
		assert.equal(log.forgetPath('Atenas'), 1);
		assert.equal(log.size, 1);
	});

	it('prunes by age', () => {
		const log = new CompletionLog();
		log.record('old', isoDaysBefore('2026-08-01', 500), true);
		log.record('new', isoDaysBefore('2026-08-01', 10), true);
		assert.equal(log.prune('2026-08-01'), 1);
		assert.equal(log.get('new'), isoDaysBefore('2026-08-01', 10));
		assert.equal(log.get('old'), null);
	});

	it('caps the total, keeping the newest', () => {
		const log = new CompletionLog();
		for (let i = 0; i < MAX_ENTRIES + 10; i += 1) {
			log.record(`k${String(i)}`, isoDaysBefore('2026-08-01', i % 300), true);
		}
		log.prune('2026-08-01');
		assert.equal(log.size, MAX_ENTRIES);
	});
});

describe('isoDaysBefore', () => {
	it('crosses a month and a leap day', () => {
		assert.equal(isoDaysBefore('2024-03-01', 1), '2024-02-29');
		assert.equal(isoDaysBefore('2026-01-01', 1), '2025-12-31');
	});
});
