import type { TaskNode } from './task.ts';

/**
 * What a completion is worth celebrating.
 *
 * Pure on purpose: *whether* to fire the burst and *how big* it is are the only
 * interesting decisions here, and they are unit-tested without a DOM. The
 * animation itself lives in `ui/celebrate.ts`.
 *
 * ## Completing a parent is not completing a leaf
 *
 * A task is not a row, it is the root of a subtree, and the subtree is the unit
 * of work. So the rule is proportional, and the interesting case falls out of
 * it rather than being special-cased:
 *
 * - **A leaf** closes one task and gets the base burst.
 * - **A parent whose descendants are all done** closes the whole branch and
 *   gets a burst that grows with it. This is the moment worth marking: it is
 *   the only one where a piece of work actually ended.
 * - **A parent with pending children closes nothing**, so it gets nothing.
 *   Ticking it is bookkeeping — a promise that the branch is done, made while
 *   it is not — and rewarding it would celebrate the same work twice: once now
 *   and once when the last child finally lands. The user still sees the
 *   checkbox change; what they do not get is applause for an inconsistent
 *   state.
 *
 * Grouping list items (no checkbox) are never counted: they are headings, not
 * work. Their children still are.
 */

export interface CelebrationPlan {
	/** Tasks this completion closes: the task itself plus its done descendants. */
	closed: number;
	/** Descendant tasks still open. Anything above zero cancels the burst. */
	pending: number;
	/** Whether the burst fires at all. */
	celebrate: boolean;
	/** Particles to emit. Zero whenever {@link celebrate} is false. */
	particles: number;
}

/** Particles for a single leaf task. */
export const BASE_PARTICLES = 10;

/** Extra particles per additional task closed by the same click. */
export const PARTICLES_PER_TASK = 2;

/**
 * Ceiling on the particle count. A 200-task branch is still a 24-particle
 * burst: past this it stops reading as feedback and starts costing frames.
 */
export const MAX_PARTICLES = 24;

/**
 * Decides what to do about a task that just moved into a completed status.
 *
 * @param node the task's subtree as the index knows it, or `null` when the
 * index has no tree for that line — treated as a leaf, which is the safe
 * reading: it celebrates a single completion rather than suppressing one.
 */
export function planCelebration(node: TaskNode | null): CelebrationPlan {
	let closed = 1;
	let pending = 0;

	const walk = (nodes: readonly TaskNode[]): void => {
		for (const child of nodes) {
			if (child.task.isTask) {
				if (child.task.isCompleted) closed += 1;
				else pending += 1;
			}
			// Recurse through grouping items too: a heading has no checkbox but the
			// tasks nested under it are still part of this branch.
			walk(child.children);
		}
	};
	if (node !== null) walk(node.children);

	const celebrate = pending === 0;
	return {
		closed,
		pending,
		celebrate,
		particles: celebrate
			? Math.min(MAX_PARTICLES, BASE_PARTICLES + (closed - 1) * PARTICLES_PER_TASK)
			: 0,
	};
}

/**
 * Where one particle flies: an angle around the circle and how far along it
 * goes. Deterministic in `index`, jittered by `seed`, so a burst is spread
 * evenly instead of clumping the way independent random angles do.
 *
 * Returned as unit offsets (`-1`…`1`); the CSS multiplies them by a distance,
 * which is what keeps the travel adjustable from a stylesheet.
 */
export interface Particle {
	dx: number;
	dy: number;
	/** `0`…`1`, scaled to the animation duration by the caller. */
	delay: number;
	/** `0.6`…`1`, so the burst is not a ring of identical dots. */
	scale: number;
}

export function particleField(count: number, seed: number): Particle[] {
	const out: Particle[] = [];
	for (let i = 0; i < count; i += 1) {
		// Evenly spaced angles plus a bounded wobble: a real random angle leaves
		// visible gaps and clumps at this particle count.
		const wobble = pseudoRandom(seed + i) - 0.5;
		const angle = ((i + wobble * 0.8) / count) * Math.PI * 2;
		const reach = 0.55 + pseudoRandom(seed + i * 7 + 1) * 0.45;
		out.push({
			dx: round(Math.cos(angle) * reach),
			dy: round(Math.sin(angle) * reach),
			delay: round(pseudoRandom(seed + i * 13 + 2) * 0.25),
			scale: round(0.6 + pseudoRandom(seed + i * 31 + 3) * 0.4),
		});
	}
	return out;
}

/* ------------------------------------------------------------------ *
 * Ruling on a completion once
 * ------------------------------------------------------------------ */

/**
 * A completion has two possible observers and must be ruled on by exactly one.
 *
 * `actions/cycle-status.ts` knows the moment a status changes, and the indexer
 * sees the same change ~400 ms later when it diffs the note — which is the only
 * way a checkbox ticked in the editor is ever noticed. Both call the
 * celebration; whichever arrives first records its verdict here and the other
 * finds it and stands down.
 *
 * A verdict is recorded even when the answer was "do not celebrate": the
 * decision belongs to the completion, not to the observer that happened to see
 * it, or a parent with pending children would be silently celebrated by the
 * second hook after the first one refused.
 *
 * Entries expire, so the ledger only ever holds the last few seconds of
 * activity and there is nothing to clear on unload.
 */
export class CompletionLedger {
	private readonly seen = new Map<string, number>();

	/**
	 * How long a verdict stands.
	 *
	 * Assigned in the body rather than declared as a constructor parameter
	 * property: `pnpm test` runs this file through Node's type *stripping*, which
	 * cannot desugar `constructor(private readonly x: number)` — it fails the
	 * whole module with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
	 */
	private readonly ttlMs: number;

	constructor(ttlMs: number) {
		this.ttlMs = ttlMs;
	}

	/** Identity two observers can agree on. A status flip never moves a line. */
	static mark(path: string, line: number): string {
		return `${path}:${String(line)}`;
	}

	/** Whether this completion has already been ruled on and not yet expired. */
	has(mark: string, now: number): boolean {
		const at = this.seen.get(mark);
		return at !== undefined && now - at <= this.ttlMs;
	}

	/** Records a verdict, sweeping the expired ones on the way through. */
	record(mark: string, now: number): void {
		for (const [key, at] of this.seen) {
			if (now - at > this.ttlMs) this.seen.delete(key);
		}
		this.seen.set(mark, now);
	}

	/** Live entries. The assertion a "does it leak" check needs. */
	get size(): number {
		return this.seen.size;
	}
}

/** `0`…`1` from an integer. Deterministic, so the field is testable. */
function pseudoRandom(n: number): number {
	const x = Math.sin(n * 12.9898) * 43758.5453;
	return x - Math.floor(x);
}

function round(value: number): number {
	return Math.round(value * 1000) / 1000;
}
