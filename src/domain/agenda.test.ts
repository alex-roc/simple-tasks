import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	buildAgendaTree,
	collectAgenda,
	detailLines,
	flattenNodes,
	groupTasks,
	sortTasks,
} from './agenda.ts';
import type { AgendaSource, GroupOptions } from './agenda.ts';
import { parseLinks } from './parse-line.ts';
import type { PeriodicGranularity, Task, TaskDates, TaskPriority } from './task.ts';

/**
 * Grouping and outline reconstruction for the agenda. Pure over `Task`, so the
 * fixtures below are hand-built rather than indexed — the point is the fold,
 * not the parsing.
 */

interface Fixture {
	line: number;
	text?: string;
	status?: string;
	completed?: boolean;
	priority?: TaskPriority | null;
	tags?: string[];
	ancestors?: number[];
	isTask?: boolean;
	path?: string;
	dates?: TaskDates;
}

function task(fixture: Fixture): Task {
	const path = fixture.path ?? 'Cronos/Diario/2026-08-01.md';
	const text = fixture.text ?? `Tarea ${String(fixture.line)}`;
	return {
		indent: '',
		marker: '-',
		isTask: fixture.isTask ?? true,
		status: fixture.status ?? ' ',
		text,
		cleanText: text,
		priority: fixture.priority ?? null,
		dates: fixture.dates ?? {},
		tags: fixture.tags ?? [],
		// Parsed from the text, so a fixture writes a wikilink the way a note does.
		links: parseLinks(text),
		id: `${path}:${String(fixture.line)}`,
		path,
		line: fixture.line,
		parentLine: fixture.ancestors?.[0] ?? null,
		depth: fixture.ancestors?.length ?? 0,
		statusName: 'Todo',
		isCompleted: fixture.completed ?? false,
		childLines: [],
		ancestorLines: fixture.ancestors ?? [],
		ownTags: fixture.tags ?? [],
		noteTags: [],
		inheritedTags: [],
		noteDate: null,
		noteGranularity: null,
		effectiveDate: null,
	};
}

const options: GroupOptions = {
	untaggedLabel: 'No tag',
	noProjectLabel: 'No project',
	statusName: (symbol: string) => `Status ${symbol}`,
	itemsOf: () => [],
};

/** Grouping options whose outline is one note's list items, as the index gives it. */
function withOutline(items: readonly Task[]): GroupOptions {
	return { ...options, itemsOf: () => items };
}

describe('sortTasks', () => {
	it('puts open tasks before completed ones, then sorts by priority', () => {
		const tasks = [
			task({ line: 0, completed: true, priority: 'highest' }),
			task({ line: 1, priority: 'low' }),
			task({ line: 2, priority: 'highest' }),
			task({ line: 3 }),
		];
		assert.deepEqual(
			sortTasks(tasks).map((t) => t.line),
			[2, 3, 1, 0]
		);
	});

	it('is stable across renders: same path then line breaks every tie', () => {
		const tasks = [
			task({ line: 5, path: 'b.md' }),
			task({ line: 2, path: 'a.md' }),
			task({ line: 1, path: 'b.md' }),
		];
		assert.deepEqual(
			sortTasks(tasks).map((t) => t.id),
			['a.md:2', 'b.md:1', 'b.md:5']
		);
	});
});

describe('groupTasks', () => {
	it('groups by note', () => {
		const groups = groupTasks(
			[task({ line: 0, path: 'a.md' }), task({ line: 1, path: 'b.md' }), task({ line: 2, path: 'a.md' })],
			'note',
			options
		);
		assert.deepEqual(
			groups.map((g) => [g.key, g.tasks.length]),
			[
				['a.md', 2],
				['b.md', 1],
			]
		);
	});

	it('lists a multi-tagged task under each of its tags', () => {
		const groups = groupTasks([task({ line: 0, tags: ['#lab', '#dev'] })], 'tag', options);
		assert.deepEqual(
			groups.map((g) => g.key),
			['#dev', '#lab']
		);
	});

	it('puts the untagged group last', () => {
		const groups = groupTasks(
			[task({ line: 0 }), task({ line: 1, tags: ['#zeta'] })],
			'tag',
			options
		);
		assert.deepEqual(
			groups.map((g) => g.label),
			['#zeta', 'No tag']
		);
	});

	it('resolves status names through the catalog', () => {
		const groups = groupTasks([task({ line: 0, status: 'x' })], 'status', options);
		assert.deepEqual(
			groups.map((g) => g.label),
			['Status x']
		);
	});

	it('collapses to a single unlabelled group when grouping is off', () => {
		const groups = groupTasks([task({ line: 0 }), task({ line: 1 })], 'none', options);
		assert.equal(groups.length, 1);
		assert.equal(groups[0]?.label, '');
		assert.equal(groups[0]?.tasks.length, 2);
	});

	it('returns nothing for no tasks', () => {
		assert.deepEqual(groupTasks([], 'none', options), []);
	});

	it('counts how many of a group are completed', () => {
		const groups = groupTasks(
			[
				task({ line: 0, completed: true, status: 'x' }),
				task({ line: 1 }),
				task({ line: 2 }),
				// A grouping node is structure, not work: it never enters the pair.
				task({ line: 3, isTask: false }),
			],
			'note',
			options
		);
		assert.equal(groups[0]?.completed, 1);
		assert.equal(groups[0]?.total, 3);
	});
});

describe('groupTasks by project', () => {
	/** The user's daily note: a wikilink on the item that titles each block. */
	const items = [
		task({ line: 0, text: 'Preguntar sobre notificaciones' }),
		task({ line: 1, isTask: false, text: '🎯 [[Plataforma Cursos Lab]]' }),
		task({ line: 2, text: 'Mejor analítica', status: 'x', completed: true, ancestors: [1] }),
		task({ line: 3, text: 'Integración con WhatsApp', status: 'x', completed: true, ancestors: [1] }),
		task({ line: 4, isTask: false, text: '🎯 [[censos-explora]]' }),
		task({ line: 5, text: 'Revisar a detalle', status: 'x', completed: true, ancestors: [4] }),
		task({ line: 6, text: 'Preparar PAD', ancestors: [4] }),
		task({ line: 7, text: 'Comparación con REDATAM', ancestors: [4] }),
	];
	const tasks = items.filter((item) => item.isTask);

	it('files each task under the project of its block, unlinked ones last', () => {
		const groups = groupTasks(tasks, 'project', withOutline(items));
		assert.deepEqual(
			groups.map((group) => [group.label, group.completed, group.total]),
			// Alphabetical, case-insensitively, with the unlinked tasks last.
			[
				['censos-explora', 1, 3],
				['Plataforma Cursos Lab', 2, 2],
				['No project', 0, 1],
			]
		);
	});

	it('carries the link and the note it was written in, for opening the project', () => {
		const groups = groupTasks(tasks, 'project', withOutline(items));
		assert.deepEqual(groups[0]?.link, {
			target: 'censos-explora',
			sourcePath: 'Cronos/Diario/2026-08-01.md',
		});
		// Nothing to open for the tasks that belong to no project.
		assert.equal(groups[2]?.link, undefined);
	});

	it('puts a task in exactly one project, unlike a tag', () => {
		const groups = groupTasks(tasks, 'project', withOutline(items));
		assert.equal(
			groups.reduce((sum, group) => sum + group.tasks.length, 0),
			tasks.length
		);
	});

	it('files a section link under its note, so the group is not split', () => {
		const own = [
			task({ line: 0, text: 'Avanzar [[BiciDatos#BiciDatos Flutter]]' }),
			task({ line: 1, text: 'Escribir [[BiciDatos]]' }),
		];
		const groups = groupTasks(own, 'project', withOutline(own));
		assert.deepEqual(
			groups.map((group) => [group.label, group.total]),
			[['BiciDatos', 2]]
		);
	});
});

describe('collectAgenda', () => {
	const DAY = '2026-08-01';

	/** A fake index: each query answers from its own list, as `TaskIndex` does. */
	function source(parts: Partial<Record<keyof AgendaSource, Task[]>>): AgendaSource {
		return {
			coveringDate: (_date: string, granularities?: readonly PeriodicGranularity[]) =>
				granularities === undefined ? (parts.coveringDate ?? []) : (parts.coveringDate ?? []).slice(0, 1),
			byDate: () => parts.byDate ?? [],
			all: () => parts.all ?? [],
			byTag: () => parts.byTag ?? [],
		};
	}

	it('unions the three sources without repeating a task', () => {
		const shared = task({ line: 0 });
		const tasks = collectAgenda(
			source({ coveringDate: [shared], byDate: [shared], all: [shared] }),
			{ date: DAY }
		);
		assert.deepEqual(
			tasks.map((t) => t.id),
			[shared.id]
		);
	});

	it('pulls in a task due that day from anywhere in the vault', () => {
		const elsewhere = task({ line: 9, path: 'Atenas/proyecto.md', dates: { due: DAY } });
		const other = task({ line: 10, path: 'Atenas/proyecto.md', dates: { due: '2026-08-02' } });
		const tasks = collectAgenda(source({ all: [elsewhere, other] }), { date: DAY });
		assert.deepEqual(
			tasks.map((t) => t.line),
			[9]
		);
	});

	it('narrows the periodic scope to the daily note unless asked to widen it', () => {
		const day = task({ line: 0 });
		const week = task({ line: 1, path: 'Cronos/Semanas/2026-W31.md' });
		const parts = { coveringDate: [day, week] };
		assert.equal(collectAgenda(source(parts), { date: DAY }).length, 1);
		assert.equal(collectAgenda(source(parts), { date: DAY, widePeriods: true }).length, 2);
	});

	it('intersects with the tag filter instead of adding to it', () => {
		const tagged = task({ line: 0, tags: ['#lab'] });
		const plain = task({ line: 1 });
		const tasks = collectAgenda(
			source({ coveringDate: [tagged, plain], byTag: [tagged] }),
			{ date: DAY, widePeriods: true, tag: '#lab' }
		);
		assert.deepEqual(
			tasks.map((t) => t.line),
			[0]
		);
	});

	it('drops completed tasks on request', () => {
		const parts = { coveringDate: [task({ line: 0, completed: true }), task({ line: 1 })] };
		assert.equal(collectAgenda(source(parts), { date: DAY, widePeriods: true }).length, 2);
		assert.equal(
			collectAgenda(source(parts), { date: DAY, widePeriods: true, hideCompleted: true }).length,
			1
		);
	});
});

describe('buildAgendaTree', () => {
	// The shape of a weekly note: grouping items without a checkbox above the tasks.
	const items = [
		task({ line: 0, isTask: false, text: '* Dirección del Lab' }),
		task({ line: 1, isTask: false, text: 'Fundación', ancestors: [0] }),
		task({ line: 2, text: 'Presupuestar', ancestors: [1, 0] }),
		task({ line: 3, text: 'Escribir', ancestors: [1, 0] }),
		task({ line: 4, isTask: false, text: 'Investigación', ancestors: [0] }),
		task({ line: 5, text: 'Enviar', ancestors: [4, 0] }),
	];

	it('pulls in the grouping ancestors of the matched tasks', () => {
		const roots = buildAgendaTree(items, [items[2] as Task]);
		assert.equal(roots.length, 1);
		assert.equal(roots[0]?.task.line, 0);
		assert.equal(roots[0]?.matched, false);
		assert.equal(roots[0]?.children.length, 1);
		assert.equal(roots[0]?.children[0]?.task.line, 1);
		assert.deepEqual(
			flattenNodes(roots).map((n) => [n.task.line, n.matched]),
			[
				[0, false],
				[1, false],
				[2, true],
			]
		);
	});

	it('drops a branch whose tasks all failed the filter', () => {
		const roots = buildAgendaTree(items, [items[5] as Task]);
		assert.deepEqual(
			flattenNodes(roots).map((n) => n.task.line),
			[0, 4, 5]
		);
	});

	it('promotes a task whose ancestors are not in the note snapshot', () => {
		// The index only handed us the leaf: it becomes a root rather than vanishing.
		const roots = buildAgendaTree([items[2] as Task], [items[2] as Task]);
		assert.deepEqual(
			roots.map((n) => n.task.line),
			[2]
		);
	});

	it('returns nothing when nothing matched', () => {
		assert.deepEqual(buildAgendaTree(items, []), []);
	});
});

describe('detailLines', () => {
	/**
	 * Both kinds of checkbox-less item in one note: line 0 titles tasks, lines 3
	 * and 4 are notes on the task above them.
	 */
	const items = [
		task({ line: 0, isTask: false, text: '🎯 [[censos-explora]]' }),
		task({ line: 1, text: 'Revisar a detalle', ancestors: [0] }),
		task({ line: 2, text: 'Preparar PAD', ancestors: [0] }),
		task({ line: 3, isTask: false, text: 'Revisión de Codex', ancestors: [2, 0] }),
		task({ line: 4, isTask: false, text: 'Guía a partir del PAD', ancestors: [2, 0] }),
		task({ line: 5, text: 'Comparación con REDATAM', ancestors: [0] }),
	];

	it('folds the checkbox-less lines that have no task below them', () => {
		assert.deepEqual(
			detailLines(items, 2).map((line) => [line.task.line, line.depth]),
			[
				[3, 0],
				[4, 0],
			]
		);
	});

	it('leaves a grouping node alone: it has tasks under it', () => {
		assert.deepEqual(detailLines(items, 0), []);
	});

	it('finds nothing under a task whose children are all tasks', () => {
		assert.deepEqual(detailLines(items, 1), []);
	});

	it('keeps a nested note as detail, with its depth', () => {
		const nested = [
			task({ line: 0, text: 'Preparar PAD' }),
			task({ line: 1, isTask: false, text: 'Revisión de Codex', ancestors: [0] }),
			task({ line: 2, isTask: false, text: 'la parte de metodología', ancestors: [1, 0] }),
		];
		assert.deepEqual(
			detailLines(nested, 0).map((line) => [line.task.line, line.depth]),
			[
				[1, 0],
				[2, 1],
			]
		);
	});

	it('does not fold a heading that has a task deeper down', () => {
		const deep = [
			task({ line: 0, text: 'Preparar PAD' }),
			task({ line: 1, isTask: false, text: 'Fase dos', ancestors: [0] }),
			task({ line: 2, text: 'Escribir el guion', ancestors: [1, 0] }),
		];
		assert.deepEqual(detailLines(deep, 0), []);
	});
});
