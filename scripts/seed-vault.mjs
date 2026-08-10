/**
 * Populate the test vault with realistic notes.
 *
 * Mirrors the structure of the real vault this plugin targets: periodic notes at
 * six granularities under `Cronos/`, project notes with deep outlines under
 * `Atenas/`, bold-text groupings inside daily notes, and outline parents that are
 * plain list items rather than tasks.
 *
 * Deterministic: same seed in, same vault out. Safe to re-run — it replaces the
 * folders it manages and leaves everything else alone.
 *
 * Usage:  node scripts/seed-vault.mjs [--vault <path>] [--days 430] [--force]
 */

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------- arguments

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
	const i = args.indexOf(name);
	return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const VAULT = resolve(
	argValue('--vault', join(process.env.HOME, 'dev', 'my-obsidian-plugins'))
);
const DAYS = Number(argValue('--days', '430'));
const FORCE = args.includes('--force');

/*
 * Guard rail. This script deletes folders, and the real vault has thousands of
 * notes in identically named paths. Refuse anything that isn't the test vault
 * unless explicitly forced.
 */
const EXPECTED_VAULT_NAME = 'my-obsidian-plugins';
if (basename(VAULT) !== EXPECTED_VAULT_NAME && !FORCE) {
	console.error(
		`Refusing to seed "${VAULT}".\n` +
			`This script deletes and rewrites Cronos/ and Atenas/, and only expects the\n` +
			`test vault ("${EXPECTED_VAULT_NAME}"). Pass --force if you really mean it.`
	);
	process.exit(1);
}
if (!existsSync(join(VAULT, '.obsidian'))) {
	console.error(`No .obsidian folder in "${VAULT}" — is that a vault?`);
	process.exit(1);
}

// ------------------------------------------------------------------ helpers

/** Mulberry32: tiny seeded PRNG, so the generated vault is reproducible. */
function makeRandom(seed) {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rand = makeRandom(20260801);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const intBetween = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** ISO week number and its week-year, matching `YYYY-Www` note names. */
function isoWeek(date) {
	const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const day = (d.getDay() + 6) % 7; // Monday = 0
	d.setDate(d.getDate() - day + 3); // Thursday of this week
	const week = 1 + Math.round((d - new Date(d.getFullYear(), 0, 4)) / 604800000);
	return { year: d.getFullYear(), week };
}

function write(relPath, content) {
	const full = join(VAULT, relPath);
	mkdirSync(join(full, '..'), { recursive: true });
	writeFileSync(full, content, 'utf8');
	written++;
}
let written = 0;

// -------------------------------------------------------------- vocabulary

const TAGS = [
	'#lab',
	'#doctorado',
	'#docencia',
	'#consultoria',
	'#dev',
	'#escritura',
	'#datos',
	'#personal',
];

const PRIORITIES = ['🔺', '⏫', '🔼', '🔽', '⏬'];

/** Status characters the plugin's default catalog recognizes. */
const OPEN_STATUSES = [' ', ' ', ' ', '/', '>'];
const CLOSED_STATUSES = ['x', 'x', 'x', 'x', '-'];

const PROJECTS = [
	'plataforma de datos abiertos',
	'curso de métodos digitales',
	'artículo sobre ciudades intermedias',
	'app de transporte urbano',
	'observatorio de precios',
	'paquete de microdatos',
];

const VERBS = [
	'Revisar',
	'Escribir',
	'Enviar',
	'Coordinar',
	'Corregir',
	'Preparar',
	'Analizar',
	'Publicar',
	'Documentar',
	'Reunirme por',
	'Presupuestar',
	'Cerrar',
];

const OBJECTS = [
	'el borrador del capítulo',
	'la propuesta técnica',
	'los datos de la encuesta',
	'el informe mensual',
	'la presentación del taller',
	'el pipeline de limpieza',
	'las gráficas de resultados',
	'el convenio institucional',
	'la revisión de literatura',
	'el diseño de la interfaz',
	'las pruebas de campo',
	'la migración del servidor',
];

/** A task line body: text, an optional wikilink, tag and priority. */
function taskText({ withLink = 0.3, withTag = 0.35, withPriority = 0.25 } = {}) {
	let text = `${pick(VERBS)} ${pick(OBJECTS)}`;
	if (chance(withLink)) text += ` de [[${pick(PROJECTS)}]]`;
	if (chance(withTag)) text += ` ${pick(TAGS)}`;
	if (chance(withPriority)) text += ` ${pick(PRIORITIES)}`;
	return text;
}

function task(status, text, depth = 0) {
	return `${'\t'.repeat(depth)}- [${status}] ${text}`;
}

// --------------------------------------------------------- daily note bodies

/**
 * Completion volume per day, shaped into streaks and quiet stretches so the
 * heatmap and the streak counters have something real to show.
 */
function dailyVolume(dayIndex) {
	const wave = Math.sin(dayIndex / 17) + Math.sin(dayIndex / 5) * 0.5;
	const base = 2 + wave * 2;
    // Occasional burst days, and days off.
	if (chance(0.05)) return intBetween(8, 13);
	if (chance(0.12)) return 0;
	return Math.max(0, Math.round(base + (rand() - 0.5) * 2));
}

function dailyNote(date, dayIndex) {
	const done = dailyVolume(dayIndex);
	const open = intBetween(0, 4);

	const blocks = { Mañana: [], Tarde: [], Noche: [] };
	const names = Object.keys(blocks);

	for (let i = 0; i < done; i++) {
		blocks[pick(names)].push(task(pick(CLOSED_STATUSES), taskText()));
	}
	for (let i = 0; i < open; i++) {
		const where = pick(names);
		blocks[where].push(task(pick(OPEN_STATUSES), taskText()));
		// Some tasks carry subtasks; the parent aggregates their progress.
		if (chance(0.25)) {
			const subs = intBetween(2, 3);
			for (let s = 0; s < subs; s++) {
				blocks[where].push(
					task(chance(0.5) ? 'x' : ' ', taskText({ withLink: 0.1, withTag: 0.1 }), 1)
				);
			}
		}
	}

	const taskSection = names
		.map((n) => `**${n}**\n${blocks[n].join('\n')}${blocks[n].length ? '\n' : ''}- [ ] `)
		.join('\n');

	return `---
tipoNota:
  - diario
pProductividad: ${intBetween(1, 5)}
pTranquilidad: ${intBetween(1, 5)}
fechaCreacion: ${iso(date)}
---
# Diario
## Mañana
### Estado

### ¿Quién soy?

## Tareas

${taskSection}
## Noche

### Evaluación

### Decisiones
Malas:
-
Buenas:
-
### Agradecimientos

# Captura
`;
}

// -------------------------------------------------- weekly note (deep outline)

/**
 * Weekly notes group tasks under plain list items — parents with no checkbox.
 * This is the "outline heading" case the index has to handle.
 */
const ROLES = [
	{
		name: '* Dirección del Lab',
		areas: ['Coordinación', 'Fundación', 'Investigación', 'Comunicación'],
	},
	{
		name: '* Sociólogo digital',
		areas: ['Doctorado', 'Consultorías', 'Docencia', 'Aprendizaje'],
	},
	{ name: '* Ingeniero informático', areas: ['UMSS', 'UNIR', 'Infraestructura'] },
];

function weeklyNote(year, week) {
	const lines = [];
	for (const role of ROLES) {
		lines.push(`- ${role.name}`);
		for (const area of role.areas) {
			lines.push(`\t- ${area}`);
			const n = intBetween(0, 3);
			for (let i = 0; i < n; i++) {
				const status = chance(0.45) ? pick(CLOSED_STATUSES) : pick(OPEN_STATUSES);
				lines.push(task(status, taskText({ withLink: 0.4 }), 2));
			}
		}
	}
	return `---
tipoNota:
  - semanario
---
# Prospectiva

# Tareas semanales

${lines.join('\n')}
`;
}

// ------------------------------------------------- coarser periodic notes

function coarseNote(tipo, title) {
	const lines = [];
	const n = intBetween(3, 6);
	for (let i = 0; i < n; i++) {
		const status = chance(0.4) ? pick(CLOSED_STATUSES) : pick(OPEN_STATUSES);
		lines.push(task(status, taskText({ withLink: 0.6, withPriority: 0.5 })));
		if (chance(0.4)) {
			for (let s = 0; s < intBetween(2, 4); s++) {
				lines.push(task(chance(0.4) ? 'x' : ' ', taskText({ withLink: 0.2 }), 1));
			}
		}
	}
	return `---
tipoNota:
  - ${tipo}
---
# ${title}

## Objetivos

${lines.join('\n')}
`;
}

// ------------------------------------------------------------ project notes

function projectNote(name) {
	const lines = [];
	const phases = ['Diseño', 'Implementación', 'Pruebas', 'Entrega'];
	for (const phase of phases) {
		// A task acting as a heading for its own subtasks.
		const parentDone = chance(0.4);
		lines.push(task(parentDone ? 'x' : pick(OPEN_STATUSES), `${phase} ${pick(TAGS)}`));
		for (let i = 0; i < intBetween(2, 5); i++) {
			const status = parentDone ? 'x' : chance(0.5) ? pick(CLOSED_STATUSES) : pick(OPEN_STATUSES);
			lines.push(task(status, taskText({ withLink: 0.15 }), 1));
			if (chance(0.3)) {
				for (let s = 0; s < intBetween(2, 3); s++) {
					lines.push(task(chance(0.5) ? 'x' : ' ', taskText({ withLink: 0.05, withTag: 0.1 }), 2));
				}
			}
		}
	}
	return `---
tipoNota:
  - proyecto
estado: activo
---
# ${name}

Notas de trabajo del proyecto.

## Pendientes

${lines.join('\n')}

## Referencias

- [[${pick(PROJECTS)}]]
`;
}

// --------------------------------------------------------------- templates

const TEMPLATES = {
	'_plantillas/diario.md': `---
tipoNota:
  - diario
pProductividad:
pTranquilidad:
fechaCreacion: {{date}}
---
# Diario
## Tareas

**Mañana**
- [ ]
**Tarde**
- [ ]
**Noche**
- [ ]
`,
	'_plantillas/semanario.md': `---
tipoNota:
  - semanario
---
# Prospectiva

# Tareas semanales

`,
	'_plantillas/mensuario.md': `---
tipoNota:
  - mensuario
---
# Objetivos del mes

`,
	'_plantillas/trimestrario.md': `---
tipoNota:
  - trimestrario
---
# Objetivos del trimestre

`,
	'_plantillas/semestrario.md': `---
tipoNota:
  - semestrario
---
# Objetivos del semestre

`,
	'_plantillas/anuario.md': `---
tipoNota:
  - anuario
---
# Objetivos del año

`,
};

// ------------------------------------------------------------ configuration

/** Match the real vault's periodic note layout, so paths behave the same. */
const PERIODIC = {
	daily: { folder: 'Cronos/Diario', template: '_plantillas/diario.md' },
	weekly: { folder: 'Cronos/Semanario', template: '_plantillas/semanario.md' },
	monthly: { folder: 'Cronos/Mensuario', template: '_plantillas/mensuario.md' },
	quarterly: { folder: 'Cronos/Trimestriario', template: '_plantillas/trimestrario.md' },
	yearly: { folder: 'Cronos/Anuario', template: '_plantillas/anuario.md' },
};

function writeConfig() {
	write(
		'.obsidian/daily-notes.json',
		JSON.stringify({ folder: PERIODIC.daily.folder, template: '_plantillas/diario' }, null, 2)
	);

	const periodicData = { showGettingStartedBanner: false };
	for (const [key, cfg] of Object.entries(PERIODIC)) {
		periodicData[key] = { format: '', folder: cfg.folder, template: cfg.template, enabled: true };
	}
	write('.obsidian/plugins/periodic-notes/data.json', JSON.stringify(periodicData, null, 2));

	// Enable our two plugins; keep anything already enabled (e.g. the original calendar).
	const cpPath = join(VAULT, '.obsidian', 'community-plugins.json');
	const existing = existsSync(cpPath) ? JSON.parse(readFileSync(cpPath, 'utf8')) : [];
	const wanted = ['calendar-plus', 'simple-tasks'];
	const merged = [...new Set([...existing, ...wanted])];
	write('.obsidian/community-plugins.json', JSON.stringify(merged, null, 2));
}

// -------------------------------------------------------------------- main

console.log(`Seeding ${VAULT} (${DAYS} days)…`);

// Only the folders this script owns.
for (const folder of ['Cronos', 'Atenas', '_plantillas']) {
	rmSync(join(VAULT, folder), { recursive: true, force: true });
}

const today = new Date();
today.setHours(0, 0, 0, 0);

const weeks = new Set();
const months = new Set();
const quarters = new Set();
const semesters = new Set();
const years = new Set();

for (let i = DAYS; i >= 0; i--) {
	const date = addDays(today, -i);
	// Real vaults have gaps: not every day gets a note.
	if (chance(0.12)) continue;

	write(`${PERIODIC.daily.folder}/${iso(date)}.md`, dailyNote(date, DAYS - i));

	const { year, week } = isoWeek(date);
	weeks.add(`${year}-W${pad(week)}`);
	months.add(`${date.getFullYear()}-${pad(date.getMonth() + 1)}`);
	quarters.add(`${date.getFullYear()}-Q${Math.floor(date.getMonth() / 3) + 1}`);
	semesters.add(`${date.getFullYear()}-S${date.getMonth() < 6 ? 1 : 2}`);
	years.add(String(date.getFullYear()));
}

for (const name of weeks) {
	const [y, w] = name.split('-W');
	write(`${PERIODIC.weekly.folder}/${name}.md`, weeklyNote(Number(y), Number(w)));
}
for (const name of months) {
	write(`${PERIODIC.monthly.folder}/${name}.md`, coarseNote('mensuario', `Mes ${name}`));
}
for (const name of quarters) {
	write(`${PERIODIC.quarterly.folder}/${name}.md`, coarseNote('trimestrario', `Trimestre ${name}`));
}
for (const name of semesters) {
	write(`Cronos/Semestrario/${name}.md`, coarseNote('semestrario', `Semestre ${name}`));
}
for (const name of years) {
	write(`${PERIODIC.yearly.folder}/${name}.md`, coarseNote('anuario', `Año ${name}`));
}

for (const name of PROJECTS) {
	write(`Atenas/${name}.md`, projectNote(name));
}

for (const [path, content] of Object.entries(TEMPLATES)) {
	write(path, content);
}

writeConfig();

console.log(`Done: ${written} files.`);
console.log(
	`  ${PERIODIC.daily.folder}: daily notes with bold-text groupings\n` +
		`  ${PERIODIC.weekly.folder}: 3-level outlines whose parents are plain list items\n` +
		`  Atenas/: project notes with tasks acting as headings for subtasks`
);
console.log('\nReload the vault to pick it up:  obsidian vault="my-obsidian-plugins" reload');
