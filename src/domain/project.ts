import type { Task, TaskLink } from './task.ts';

/**
 * Which project a task belongs to, read from the `[[wikilinks]]` the vault
 * already contains.
 *
 * The outline of a daily note encodes the project of every task, and it does so
 * without any syntax of ours:
 *
 * ```markdown
 * - [ ] Preguntar sobre notificaciones          → no project
 * - 🎯 [[Plataforma Cursos Lab]]
 *   - [x] Mejor analítica                       → Plataforma Cursos Lab
 * - [x] Avanzar [[BiciDatos#BiciDatos Flutter]] → BiciDatos
 * ```
 *
 * So the resolution is deliberately **read-only over what is already written**:
 * nothing is added to a line, and the user is never asked to mark anything.
 *
 * Pure module: no `obsidian` import, no DOM, no vault. Resolving the project
 * *note* to a file is the caller's job (`metadataCache.getFirstLinkpathDest`),
 * which is why {@link TaskProject} carries the link as written plus the note it
 * was written in.
 */

/** The project a task belongs to. */
export interface TaskProject {
	/**
	 * Grouping identity: the note name, lowercased and without extension. A link
	 * to a section resolves to the same key as a link to the note, so
	 * `[[BiciDatos#Flutter]]` and `[[BiciDatos]]` are one project.
	 */
	key: string;
	/** Link target exactly as written, for resolving it to a file. */
	target: string;
	/** What the group is titled with: the note name, without folders. */
	label: string;
	/** Section the link pointed at, if any. Shown as a nuance, never grouped by. */
	heading?: string;
	/** Note the link was written in, so a relative linkpath can be resolved. */
	sourcePath: string;
	/** Line the link was written on: the task's own, or an ancestor's. */
	line: number;
	/** Whether the link was on the task's own line rather than an ancestor's. */
	own: boolean;
}

/**
 * The first link on a line that can name a project.
 *
 * Two kinds are skipped, and both matter in real notes:
 *
 * - **`[[#Section]]`** — an empty target is a jump inside the same note, not a
 *   reference to a project.
 * - **`![[embed]]`** — a transclusion. `- [ ] Revisar ![[grafico.png]]` embeds a
 *   picture in the task; it does not file the task under "grafico.png".
 *
 * An alias changes nothing: `[[censos-explora|el censo]]` is the same project as
 * `[[censos-explora]]`, because the target is what identifies the note.
 */
function projectLink(links: readonly TaskLink[]): TaskLink | null {
	for (const link of links) {
		if (link.raw.startsWith('!')) continue;
		if (link.target === '') continue;
		return link;
	}
	return null;
}

/** Note name as a human reads it: no folders, no `.md`. */
export function projectLabel(target: string): string {
	const slash = target.lastIndexOf('/');
	const name = slash === -1 ? target : target.slice(slash + 1);
	return name.toLowerCase().endsWith('.md') ? name.slice(0, -3) : name;
}

function projectOf(task: Task, link: TaskLink, own: boolean, sourcePath: string): TaskProject {
	const label = projectLabel(link.target);
	const project: TaskProject = {
		key: label.toLowerCase(),
		target: link.target,
		label,
		sourcePath,
		line: task.line,
		own,
	};
	if (link.heading !== undefined) project.heading = link.heading;
	return project;
}

/**
 * The project of a task, or `null` when nothing in its branch names one.
 *
 * 1. The first usable wikilink on the task's **own line**. A task can name its
 *    own project even when it hangs from nothing.
 * 2. Otherwise the first usable wikilink of the **nearest ancestor** that has
 *    one, walking up the outline. `ancestorLines` is already ordered closest
 *    first, so the first hit is the nearest.
 * 3. Otherwise nothing.
 *
 * The task's own line wins over an ancestor's on purpose: a task filed under
 * `[[Plataforma Cursos Lab]]` that says `- [x] Avanzar [[BiciDatos]]` is about
 * BiciDatos, and the more specific statement is the one the user wrote last.
 *
 * @param itemsByLine every list item of the containing note, keyed by line. The
 *   index already holds it (`FileEntry.items`); passing it in is what keeps this
 *   module free of any index dependency.
 */
export function resolveProject(
	task: Task,
	itemsByLine: ReadonlyMap<number, Task>
): TaskProject | null {
	const own = projectLink(task.links);
	if (own !== null) return projectOf(task, own, true, task.path);

	for (const line of task.ancestorLines) {
		const ancestor = itemsByLine.get(line);
		if (ancestor === undefined) continue;
		const link = projectLink(ancestor.links);
		if (link !== null) return projectOf(ancestor, link, false, ancestor.path);
	}
	return null;
}

/** Line → item, the shape {@link resolveProject} walks ancestors with. */
export function outlineByLine(items: readonly Task[]): Map<number, Task> {
	const out = new Map<number, Task>();
	for (const item of items) out.set(item.line, item);
	return out;
}
