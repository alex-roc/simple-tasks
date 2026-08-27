# Simple Tasks — conventions for agents

General Obsidian plugin knowledge (API patterns, the `eslint-plugin-obsidianmd`
rules, CSS/theme rules, submission requirements, the CLI dev loop) lives in the
`obsidian-plugin-dev` skill. **Read that skill first.** This file covers only what
is specific to this project.

Two documentation trees, and they are not interchangeable:

- **`docs/` is public, in English, and committed.** It is what a user arriving
  from the community catalog reads: the user guide, the commands and CLI, the
  settings reference. Keep it in step with the features.
- **`dev-docs/` is internal, in Spanish, and gitignored.** It is the project's
  architecture memory — decisions, measured numbers, edge cases — plus the QA
  script. This file references it throughout; those paths resolve in the author's
  working copy, not in a fresh clone.

## What this plugin is

Task management on top of plain markdown checkboxes. The vault is the source of
truth; the plugin keeps an in-memory index over it and never introduces a
parallel store of task state.

Deliberate non-goals:

- **No dependency on any other task plugin.** Not on its config, not on its
  architecture, not as design inspiration. The status catalog, the settings and
  the write syntax are ours.
- **No query language.** Filtering is delegated to Bases, which already does it
  better. We contribute a Bases *view*, not a DSL.
- **No Dataview.** Modern Obsidian primitives replace it: `metadataCache.listItems`,
  `registerBasesView`, `registerCliHandler`.

## Environment

- Package manager: **pnpm**. Never `npm install` or `yarn`.
- `pnpm dev` watches and rebuilds. The reload happens inside Obsidian, via the
  **Hot Reload** plugin watching `main.js` — the build never calls the Obsidian
  CLI, because those calls steal window focus (see Verification).
- The repo is symlinked into the test vault at
  `~/dev/my-obsidian-plugins/.obsidian/plugins/simple-tasks`, so the `main.js`
  built at the repo root is what Obsidian loads. Nothing to copy.
- `pnpm seed` regenerates the test vault contents. Safe to re-run.
- **Never develop against the real vault** (`DiarioZK`). Test only in
  `my-obsidian-plugins`.

## Architecture

```
src/
  main.ts            # lifecycle only: wires index, views, commands, CLI, CM6
  domain/            # pure logic, no Obsidian UI imports — unit-testable
  index/             # the task index, its incremental updates and derived stats
  actions/           # every mutation of markdown lives here
  i18n/              # en / es dictionaries and t()
  ui/views/          # agenda, heatmap, Bases
  ui/popover/        # one popover, two triggers
  ui/components/     # task row (delegated), heatmap grid, per-render scope
  ui/modals/         # date, note+heading and tag pickers
  integrations/      # optional cross-plugin wiring (Periodic Calendar)
  cli/               # registerCliHandler handlers
```

Capabilities newer than `minAppVersion` (1.10.0) are **probed, never assumed**:
`'registerBasesView' in this` and, for `registerCliHandler` (1.12.2), a locally
declared interface — writing the method name directly makes
`obsidianmd/no-unsupported-api` an error that cannot be silenced inline. Details
in `dev-docs/bases-and-cli.md`.

Rules that matter here:

- **`domain/` stays pure.** Parsing and serializing a task line must not touch
  `app`, the DOM or the vault. That is what makes it testable and what keeps the
  syntax decision in one place. The only runtime import from `obsidian`
  tolerated there is `moment` — a date library, and only in `periodic.ts` and
  `template.ts`, which is why those two are the domain modules `pnpm test` does
  not cover directly. The reasoning is in `dev-docs/domain-and-index.md`.
- **Relative imports carry the `.ts` extension.** That is what lets `pnpm test`
  run the domain modules through Node's native type stripping, with no test
  framework and no build step. `allowImportingTsExtensions` is on for it.
- **All markdown writes go through `actions/`, using `vault.process(file, fn)`** —
  atomic, and no race with an open editor. Never `vault.modify` on a file the
  user may be editing.
- **All reads of task text go through the index**, never an ad-hoc file scan.
- **One serializer.** Every write of a task line goes through
  `domain/serialize-line.ts`. Never format a date or a priority inline elsewhere.
- **Re-locate before writing.** The index is debounced 400 ms, so `task.line`
  can be stale. Every action finds its line again *inside* the `vault.process`
  callback with `domain/subtree.ts:locateTaskLine()`, and aborts with a notice
  rather than write to a line it cannot identify.
- **No visible string is written inline.** Everything the user can read goes
  through `i18n/`, including `aria-label`s, notices and command names — see
  below.
- **Never call `registerDomEvent` on a view while rendering.** It ties the
  listener to the *view*, which outlives the element by every repaint to come.
  Rows go through `ui/components/task-row-list.ts`, which delegates to the
  container; anything else built per render registers against a
  `ui/components/render-scope.ts` child instead. This was a real leak in both
  list views, measured and tabulated in `dev-docs/actions-and-ui.md`.

## Two ways a task gets finished, and only two

Every route **through the plugin** — the agenda checkbox, both popovers, the
Bases view, the `Cycle task status` command — ends in
`actions/cycle-status.ts:setTaskStatus()`. Anything that must happen "when a
task is finished through us" belongs **there and nowhere else**; a sixth such
trigger inherits it for free.

The other way is **the editor**, and no code of ours runs on it: clicking the
native checkbox in live preview or reading view, or typing the `x` by hand, is
Obsidian writing the line. Nothing observes that, on purpose — see the next
section. If a feature ever needs to know, it re-derives from the index after the
`changed` event; it must not accumulate state from what it saw.

## The task model

- Statuses come from our own configurable catalog. Defaults use the symbols
  already present in the target vault (`[ ]`, `[/]`, `[x]`, `[-]`, `[>]`) so
  existing notes are recognized on first run — a deliberate default, not
  inherited behavior.
- The parser is **tolerant on read**: it recognizes priority (`🔺⏫🔼🔽⏬`) and
  date (`➕🛫⏳📅✅❌`, plus `🗓` as an alias for `📅`) emoji already written in old
  notes. Dropping this would silently lose information from thousands of
  existing tasks. That list is `DATE_EMOJI` in `domain/parse-line.ts`, in the
  order `DATE_ORDER` writes them.
- Writing uses a single syntax, selectable in settings, defaulting to those same
  emoji so the vault doesn't end up with two dialects.

## Hierarchy

`metadataCache.getFileCache(f).listItems` gives `task` (the status char) and
`parent` (the parent's start line). Build the tree from `parent` — never by
counting indentation. A list item **without** `task` is a valid grouping node: it
acts as a heading for the tasks nested under it.

**Except when it holds no task at all.** A checkbox-less item whose whole subtree
contains no task is not a heading, it is a note *on* the task above it — the
`- Revisión de Codex` under `- [ ] Preparar PAD`. The two are told apart by what
they contain, never by a marker the user would have to write:
`domain/agenda.ts:detailLines()` is the only definition, and the agenda folds
what it returns instead of spending a row on it.

**The outline also carries the project of a task.** The first `[[wikilink]]` on
the task's own line, or failing that the nearest ancestor's, is what
`- 🎯 [[censos-explora]]` means in the user's daily notes. It is resolved in
`domain/project.ts` and used as a fourth way to group the agenda. Two rules keep
it honest: a link to a section is the note (`[[BiciDatos#Flutter]]` does not
split the group), and the *file* behind the link is resolved by the view with
`metadataCache.getFirstLinkpathDest()` — `domain/` never learns what a `TFile`
is.

`parent` is a line number, so the index is line-based: **one indexed item per
line**. Markdown can put two list items on one line (`- * Título` is a `-` item
containing a `*` sublist, and the cache reports both), and three other edge cases
bite too. They are all documented in `dev-docs/domain-and-index.md` — read that
before touching `index/indexer.ts`.

**A selection may hold grouping nodes, and a move must respect that.** Both
selection gestures — the editor's text selection and the agenda's painting —
include checkbox-less items, so a block selected with its title moves as a block:
`planBulkMove()` sees the title as the ancestor of the tasks under it and moves it
once. Writes to a line (status, priority, due date, tags) still go to real tasks
only; the split is `targets` vs `moveTargets` in `ui/popover/task-popover.ts`.

When moving a task, the whole subtree moves with it, reindented to the
destination. This is the operation most likely to corrupt notes: verify it
against the git-tracked test vault by inspecting the actual diff. The decisions
are pure and live in `domain/subtree.ts`, which is where the tests are;
`actions/move-task.ts` is only the I/O around them.

**`Task.indent` is not always whitespace.** On `- * Título` the indexed item is
the inner `*` one and its `indent` is the literal `"- "`. Anything that re-parses
a line must strip `task.indent` first, exactly as the indexer did — parsing the
whole line yields the wrong text and matches nothing.

## Interface language

Four binding rules; how the module is built, and why the eslint config uses
`recommendedWithLocalesEn`, is in `dev-docs/actions-and-ui.md`.

- **Every visible string goes through `i18n/`** — labels, notices, command
  names, `aria-label`s. No exceptions, or the linter stops seeing the interface.
- **The language comes from `getLanguage()`**, never from `localStorage` (rule 28
  of the linter). There is deliberately no language setting: Obsidian's own is
  authoritative.
- **`src/i18n/en.ts` is the source of truth.** `TranslationKey` is derived from
  it, so a missing key is a type error; `es.ts` is a `Partial` falling back per
  key. Sentence case in both.
- **Command ids are never translated**, only their `name`.

## Completion dates: from the vault or from nowhere

`index/stats.ts:completionDate()` is the single answer to "what day did this
close", and it has exactly two sources: a completion date written on the line,
and the task living in that day's own daily note. Everything else returns `null`
and is counted on no day at all.

**Never date a completion by observing it.** Version 0.2.0 kept a log in
`data.json` of the day it first saw each task completed, keyed by
`path::ordinal::text`. It was removed after it filed 212 completions spanning
years onto one day in a real vault. The failure is structural, not a bug to fix:
a task turns up "already completed" whenever its key shifts — text edited, note
synced from another device, a `cachedRead` that disagreed with the offsets in
`metadataCache` — and none of those mean today. A guard against the initial scan
does not help, because every one of those events happens long after it.

The rule this leaves: **the plugin owns no fact the vault does not state.** A
missing day is a correct answer. Anything that wants more precision writes the
date into the markdown, which `cycle-status.ts` only ever does on lines that
already carry that syntax.

Details in `dev-docs/heatmap-and-stats.md`.

## Optional integrations

`integrations/` is the only place allowed to know another plugin exists, and
everything in it is optional by construction:

- **The contract is a copied file.** `integrations/periodic-calendar-api.ts` is a
  verbatim copy of the provider's published types. Never import from another
  repository — the plugin must build, lint and test where that plugin is not
  installed.
- **Check the version, degrade in the open.** `api.version === 1` or nothing
  happens. The absence of the provider is a supported state, explained *where
  the user asked for the feature* (a command, a settings row) and **never** as a
  notice at startup.
- **The provider may arrive later.** Re-check on `workspace.onLayoutReady` and
  on the plugin manager's `changed` event; keep the re-check idempotent and
  cheap. Details in `dev-docs/periodic-calendar-integration.md`.

## Persisting to `data.json`

`saveData()` replaces the whole file, so **`SimpleTasksPlugin.persist()` is the
only place in the codebase allowed to call it**, and it always writes the
complete document. Anything new that needs persisting is added there, never saved
on its own — a second writer would silently erase whatever the first one had
stored.

What belongs in there is **the settings, and nothing else**. The file used to
carry a completion log too, and that state turned out to be the plugin's only
source of wrong numbers. Derived data is recomputed from the index (`StatsCache`
memoizes, invalidated by the index's own event); it is never stored.

## Verification

**Do not call the Obsidian CLI in a loop.** Those calls intermittently pull the
Obsidian window to the front and steal focus while the user is typing — measured
at roughly 1 in 3 runs for `dev:errors` and `tasks`. Over a session it makes the
machine unusable. Everyday checks must run without the app:

```bash
pnpm build && pnpm lint    # types + the obsidianmd rules
pnpm test                  # domain unit tests, no app needed
pnpm verify                # parser + serializer over the whole test vault, no app needed
```

`pnpm verify` runs the *same* parser and serializer the plugin uses, over files read
from disk, and fails if a line stops round-tripping byte-for-byte — except for the
two normalizations it tolerates by design: `- [ ]` gaining its trailing space, and a
run of repeated spaces or tabs collapsing to one (`tidy()` cannot tell a gap it
created from one the user typed). Both are whitespace that carries no information,
and both only ever reach a note the plugin was already rewriting. The indentation
and the trailing whitespace of a line stay strict, because there whitespace *is*
information — the outline hierarchy and markdown hard line breaks. That
is the regression net for `domain/`: 6002 real list lines in ~51 ms. Its counts are also
comparable with Obsidian's, which is how the index was cross-checked. The three
numbers and how they reconcile are tabulated in `dev-docs/domain-and-index.md`;
the short version is that the index and `obsidian tasks total` agree exactly
(**4638**), and `pnpm verify` counts 5 more because it parses from disk.

**Re-measure before quoting a number.** Every count in this file and in
`dev-docs/` describes the seeded test vault, which is deterministic — `pnpm seed`
reproduces it exactly — but **a change to `scripts/seed-vault.mjs` moves every
one of them at once**. That is how the previous set went stale: the docs still
said 484 notes and 4 635 tasks long after the seed produced 485 and 4 638. A
stale figure a reader believes is worse than no figure.

`plugin.actions` is public for the same reason `plugin.index` is: it is how a
write — a status change, a move — can be exercised from `obs eval` and then
checked against `git -C ~/dev/my-obsidian-plugins diff`, which is the only real
regression test `move-task` has.

Reloading is automatic: the **Hot Reload** plugin watches `main.js` from inside
Obsidian, so `pnpm dev` never shells out. A `.hotreload` file marks this repo.

Only when a change is actually visual or runtime-dependent, and then **batched into
one pass, not sprinkled through the work**:

```bash
obs dev:errors                    # `obs` = wrapper with a default vault and a timeout
obs dev:screenshot path=/tmp/st.png
obs eval code="app.plugins.plugins['simple-tasks'].index.stats()"
```

`eval` and `plugin:reload` measured 0/3 on stealing focus, `dev:errors` and `tasks`
1/3 — so prefer `eval` when you need to ask the running app something.

## Styling

`styles.css` uses **only** Obsidian CSS variables — no literal colors, ever.
Verify in both light and dark themes. Animations must respect
`@media (prefers-reduced-motion: reduce)`.

**The plugin's views are set at the UI scale**, not at the note's. `.simple-tasks-agenda`
declares `font-size: var(--font-ui-small)` and everything inside inherits it; without
it a view inherits `--font-text-size` — the size a note's *body* is read at — and a
sidebar list becomes a wall of text whose every title wraps three times, next to a
toolbar that was already at the UI scale. Any new view starts the same way.

**Touch targets go through `--st-touch-target`**, declared on `.simple-tasks-agenda`
and `.simple-tasks-bases` as `0px` and raised to 44px by *both* `body.is-mobile` and
`@media (pointer: coarse)`. Both are needed: `pointer: coarse` is the right question
but is **not emulated** — under `dev:mobile on` it stays false, so a rule written
only against it has never been seen to run. Never hardcode 44px in a new rule; read
the variable, so desktop keeps paying nothing. The reasoning, the measurements and
the one place this cannot reach (the heatmap's 12px day cells) are in
`dev-docs/actions-and-ui.md`.

## Reaching the popover without a pointer

There are three routes and they are not interchangeable — a change to one does not
cover the others:

- **hover** in the plugin's views and in the editor (`ui/popover/editor-hover.ts`);
- **keyboard**: the row is a tab stop, Enter opens with focus inside, and the
  `Show task actions` command covers the editor;
- **touch, mobile only**: a long press on a row (`contextmenu` in
  `ui/components/task-row-list.ts`) and a ⋮ button on the task line the cursor is
  on (`ui/popover/editor-line-actions.ts`).

Both mobile routes are behind `Platform.isMobile` on purpose: on the desktop, right
click and the active line already mean something that is not ours. And the popover's
`returnFocusTo` defaults to whatever had focus when it opened, restored **only if
the popover held it** — the two halves of a real focus bug, both measured, both
written up in `dev-docs/actions-and-ui.md`.
