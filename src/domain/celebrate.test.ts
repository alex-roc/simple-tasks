import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	BASE_PARTICLES,
	CompletionLedger,
	MAX_PARTICLES,
	PARTICLES_PER_TASK,
	particleField,
	planCelebration,
} from './celebrate.ts';
import type { Task, TaskNode } from './task.ts';

/**
 * The celebration decision. The interesting assertion is the parent one: what
 * gets applause and what does not is a product decision, and this is where it
 * is pinned down.
 */

/** A task node with only the fields the planner reads. */
function node(options: { task?: boolean; done?: boolean; children?: TaskNode[] }): TaskNode {
	const task = {
		isTask: options.task ?? true,
		isCompleted: options.done ?? false,
	} as Task;
	return { task, children: options.children ?? [] };
}

describe('planCelebration', () => {
	it('celebrates a leaf with the base burst', () => {
		const plan = planCelebration(node({}));
		assert.equal(plan.celebrate, true);
		assert.equal(plan.closed, 1);
		assert.equal(plan.pending, 0);
		assert.equal(plan.particles, BASE_PARTICLES);
	});

	it('treats an unknown line as a leaf rather than suppressing the burst', () => {
		const plan = planCelebration(null);
		assert.equal(plan.celebrate, true);
		assert.equal(plan.particles, BASE_PARTICLES);
	});

	it('stays silent for a parent whose children are still open', () => {
		const plan = planCelebration(node({ children: [node({}), node({ done: true })] }));
		assert.equal(plan.celebrate, false);
		assert.equal(plan.pending, 1);
		assert.equal(plan.particles, 0);
	});

	it('celebrates a parent that closes its whole branch, in proportion to it', () => {
		const plan = planCelebration(
			node({ children: [node({ done: true }), node({ done: true })] })
		);
		assert.equal(plan.celebrate, true);
		assert.equal(plan.closed, 3);
		assert.equal(plan.particles, BASE_PARTICLES + 2 * PARTICLES_PER_TASK);
	});

	it('sees a pending task nested under a grouping item', () => {
		// A list item without a checkbox is a heading, not work: it must not be
		// counted, but it must not hide the open task underneath it either.
		const plan = planCelebration(node({ children: [node({ task: false, children: [node({})] })] }));
		assert.equal(plan.celebrate, false);
		assert.equal(plan.closed, 1);
		assert.equal(plan.pending, 1);
	});

	it('counts descendants at any depth', () => {
		const plan = planCelebration(
			node({ children: [node({ done: true, children: [node({ done: true })] })] })
		);
		assert.equal(plan.closed, 3);
		assert.equal(plan.pending, 0);
	});

	it('caps the burst so a huge branch cannot flood the DOM', () => {
		const children = Array.from({ length: 200 }, () => node({ done: true }));
		assert.equal(planCelebration(node({ children })).particles, MAX_PARTICLES);
	});
});

describe('particleField', () => {
	it('emits exactly the requested number of particles', () => {
		assert.equal(particleField(10, 1).length, 10);
		assert.equal(particleField(0, 1).length, 0);
	});

	it('is deterministic, so a burst can be asserted', () => {
		assert.deepEqual(particleField(6, 42), particleField(6, 42));
	});

	it('keeps every offset inside the unit circle and every delay bounded', () => {
		for (const particle of particleField(24, 7)) {
			assert.ok(Math.hypot(particle.dx, particle.dy) <= 1, 'offset outside the unit circle');
			assert.ok(particle.delay >= 0 && particle.delay <= 0.25, 'delay out of range');
			assert.ok(particle.scale >= 0.6 && particle.scale <= 1, 'scale out of range');
		}
	});

	it('spreads the particles around the circle instead of clumping', () => {
		// Every quadrant gets at least one particle: the evenly-spaced angles are
		// what buys this, and a naive random angle would fail it regularly.
		const quadrants = new Set(
			particleField(12, 3).map((p) => `${String(p.dx >= 0)}:${String(p.dy >= 0)}`)
		);
		assert.equal(quadrants.size, 4);
	});
});

describe('CompletionLedger', () => {
	const TTL = 4000;

	it('lets the second observer of one completion stand down', () => {
		const ledger = new CompletionLedger(TTL);
		const mark = CompletionLedger.mark('Cronos/Diario/2026-08-09.md', 12);
		assert.equal(ledger.has(mark, 1000), false);
		ledger.record(mark, 1000);
		// The indexer sees the same change one debounce later.
		assert.equal(ledger.has(mark, 1400), true);
	});

	it('keeps two tasks of the same note apart', () => {
		const ledger = new CompletionLedger(TTL);
		ledger.record(CompletionLedger.mark('Nota.md', 3), 1000);
		assert.equal(ledger.has(CompletionLedger.mark('Nota.md', 4), 1000), false);
	});

	it('keeps the same line of two notes apart', () => {
		const ledger = new CompletionLedger(TTL);
		ledger.record(CompletionLedger.mark('A.md', 3), 1000);
		assert.equal(ledger.has(CompletionLedger.mark('B.md', 3), 1000), false);
	});

	it('lets a genuine re-completion through once the verdict expires', () => {
		const ledger = new CompletionLedger(TTL);
		const mark = CompletionLedger.mark('Nota.md', 3);
		ledger.record(mark, 1000);
		assert.equal(ledger.has(mark, 1000 + TTL), true);
		assert.equal(ledger.has(mark, 1000 + TTL + 1), false);
	});

	it('sweeps expired verdicts instead of growing forever', () => {
		const ledger = new CompletionLedger(TTL);
		for (let i = 0; i < 50; i += 1) ledger.record(CompletionLedger.mark('Nota.md', i), 1000 + i);
		assert.equal(ledger.size, 50);
		// One completion much later: everything older than the window goes with it.
		ledger.record(CompletionLedger.mark('Nota.md', 99), 1000 + TTL + 100);
		assert.equal(ledger.size, 1);
	});
});
