import { Component } from 'obsidian';

/**
 * A child component that owns everything registered during **one** render.
 *
 * `Component.registerDomEvent` ties a listener to the component's lifetime, and
 * a view lives far longer than the elements it draws. Registering the toolbar's
 * handlers against the view itself therefore accumulates one dead closure per
 * button per repaint — measured in this project at 284 registrations per agenda
 * repaint before the fix, on a view that repaints on every index change.
 *
 * The rule this encodes: **anything registered while building throwaway DOM
 * belongs to a throwaway component.** Call it at the top of a render, keep the
 * returned component in a field, and hand it the `previous` one so it is
 * unloaded first.
 *
 * ```ts
 * private scope: Component | null = null;
 *
 * private render(): void {
 *     this.scope = renderScope(this, this.scope);
 *     // …build DOM, registering through `this.scope`
 * }
 * ```
 *
 * It is the right tool for a **bounded** set of heterogeneous handlers — a
 * toolbar, the popover's buttons. For an unbounded list of identical rows,
 * delegation is better still, because it holds no listeners at all: see
 * `components/task-row-list.ts`.
 */
export function renderScope(owner: Component, previous: Component | null): Component {
	if (previous !== null) owner.removeChild(previous);
	return owner.addChild(new Component());
}
