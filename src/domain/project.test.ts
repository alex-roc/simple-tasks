import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseLine } from './parse-line.ts';
import { outlineByLine, projectLabel, resolveProject } from './project.ts';
import type { Task } from './task.ts';

/**
 * Project resolution over the shape the user's daily notes actually have. The
 * fixtures are built by running the **real parser** over real lines rather than
 * hand-writing `links`, so a change to how wikilinks are read shows up here.
 */

const PATH = 'Cronos/Diario/2026-08-09.md';

/** Indexes a block of markdown the way `index/indexer.ts` does, by `parent`. */
function outline(markdown: string, path = PATH): Task[] {
	const rawLines = markdown.split('\n').filter((line) => line.trim() !== '');
	const items: Task[] = [];
	// Tabs only, as the notes are written; the indexer gets `parent` from the
	// metadata cache, which is not available here.
	const stack: { indent: number; line: number }[] = [];
	for (const [line, raw] of rawLines.entries()) {
		const parsed = parseLine(raw);
		if (parsed === null) continue;
		const indent = parsed.indent.length;
		while (stack.length > 0 && (stack.at(-1)?.indent ?? 0) >= indent) stack.pop();
		const ancestorLines = [...stack].reverse().map((entry) => entry.line);
		items.push({
			...parsed,
			id: `${path}:${String(line)}`,
			path,
			line,
			parentLine: ancestorLines[0] ?? null,
			depth: ancestorLines.length,
			statusName: parsed.isTask ? 'Todo' : '',
			isCompleted: parsed.isTask && parsed.status !== ' ',
			childLines: [],
			ancestorLines,
			ownTags: parsed.tags,
			noteTags: [],
			inheritedTags: [],
			noteDate: null,
			noteGranularity: null,
			effectiveDate: null,
		});
		stack.push({ indent, line });
	}
	for (const item of items) {
		item.childLines = items.filter((c) => c.parentLine === item.line).map((c) => c.line);
	}
	return items;
}

function projectOf(items: readonly Task[], text: string): string | null {
	const task = items.find((item) => item.cleanText.includes(text));
	assert.ok(task !== undefined, `no line matching "${text}"`);
	return resolveProject(task, outlineByLine(items))?.key ?? null;
}

describe('projectLabel', () => {
	it('drops folders and the extension', () => {
		assert.equal(projectLabel('Atenas/censos-explora'), 'censos-explora');
		assert.equal(projectLabel('censos-explora.md'), 'censos-explora');
		assert.equal(projectLabel('censos-explora'), 'censos-explora');
	});
});

describe('resolveProject', () => {
	// The real shape of a daily note, verbatim from the vault.
	const note = outline(`
- [ ] Preguntar sobre notificaciones por google workspace
- 🎯 [[Plataforma Cursos Lab]]
	- [x] Mejor analítica y descarga de inscritos
	- [x] Estudiantes, navegación por temas a la derecha
- 🎯 [[censos-explora]]
	- [x] Revisar a detalle y ajustes
	- [ ] Preparar PAD
		- Revisión de Codex
	- [ ] Comparación con REDATAM
`);

	it('files a task under the link of its nearest ancestor', () => {
		assert.equal(projectOf(note, 'Mejor analítica'), 'plataforma cursos lab');
		assert.equal(projectOf(note, 'Revisar a detalle'), 'censos-explora');
		assert.equal(projectOf(note, 'Comparación con REDATAM'), 'censos-explora');
	});

	it('leaves a task with no linked ancestor without a project', () => {
		assert.equal(projectOf(note, 'Preguntar sobre notificaciones'), null);
	});

	it('walks past ancestors that have no link, to the nearest one that does', () => {
		const items = outline(`
- 🎯 [[censos-explora]]
	- Pendientes de la semana
		- [ ] Preparar PAD
`);
		assert.equal(projectOf(items, 'Preparar PAD'), 'censos-explora');
	});

	it("prefers the task's own line over any ancestor", () => {
		const items = outline(`
- 🎯 [[Plataforma Cursos Lab]]
	- [x] Avanzar [[BiciDatos#BiciDatos Flutter]]
`);
		const task = items.find((item) => item.cleanText.includes('Avanzar'));
		const project = resolveProject(task as Task, outlineByLine(items));
		assert.equal(project?.key, 'bicidatos');
		assert.equal(project?.own, true);
		assert.equal(project?.heading, 'BiciDatos Flutter');
	});

	it('reads a link to a section as the note it lives in', () => {
		const items = outline(`
- 🎯 [[BiciDatos#Flutter]]
	- [ ] Ajustar el mapa
- 🎯 [[BiciDatos]]
	- [ ] Escribir el informe
`);
		assert.equal(projectOf(items, 'Ajustar el mapa'), 'bicidatos');
		assert.equal(projectOf(items, 'Escribir el informe'), 'bicidatos');
	});

	it('ignores the alias and keeps the target', () => {
		const items = outline(`
- 🎯 [[censos-explora|el censo de 2024]]
	- [ ] Preparar PAD
`);
		const project = resolveProject(items[1] as Task, outlineByLine(items));
		assert.equal(project?.key, 'censos-explora');
		assert.equal(project?.label, 'censos-explora');
	});

	it('takes the first link when a line carries several', () => {
		const items = outline('- [ ] Cruzar [[censos-explora]] con [[BiciDatos]]');
		assert.equal(projectOf(items, 'Cruzar'), 'censos-explora');
	});

	it('is not fooled by a link to a heading of the same note', () => {
		const items = outline(`
- 🎯 [[censos-explora]]
	- [ ] Ver [[#Pendientes]]
`);
		// `[[#Pendientes]]` has no target, so the ancestor still decides.
		assert.equal(projectOf(items, 'Ver'), 'censos-explora');
	});

	it('does not read an embed as a project', () => {
		const items = outline('- [ ] Revisar ![[grafico.png]]');
		assert.equal(projectOf(items, 'Revisar'), null);
	});

	it('groups the same project written in different cases together', () => {
		const items = outline(`
- [ ] Uno [[censos-explora]]
- [ ] Dos [[Censos-Explora]]
`);
		assert.equal(projectOf(items, 'Uno'), projectOf(items, 'Dos'));
	});

	it('keeps the note the link was written in, for resolving it later', () => {
		const items = outline('- [ ] Avanzar [[BiciDatos]]', 'Atenas/otra.md');
		const project = resolveProject(items[0] as Task, outlineByLine(items));
		assert.equal(project?.sourcePath, 'Atenas/otra.md');
		assert.equal(project?.target, 'BiciDatos');
	});

	it('resolves a folder path to the note name', () => {
		const items = outline('- [ ] Avanzar [[Atenas/BiciDatos]]');
		const project = resolveProject(items[0] as Task, outlineByLine(items));
		assert.equal(project?.key, 'bicidatos');
		assert.equal(project?.target, 'Atenas/BiciDatos');
	});

	it('returns nothing when the outline is not available', () => {
		const items = outline(`
- 🎯 [[censos-explora]]
	- [ ] Preparar PAD
`);
		assert.equal(resolveProject(items[1] as Task, new Map()), null);
	});
});
