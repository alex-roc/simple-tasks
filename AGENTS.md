# Simple Tasks — conventions for agents

General Obsidian plugin knowledge (API patterns, the 36 `eslint-plugin-obsidianmd`
rules, CSS/theme rules, submission requirements, the CLI dev loop) lives in the
`obsidian-plugin-dev` skill. **Read that skill first.** This file covers only what
is specific to this project.

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
- `pnpm dev` watches, rebuilds and reloads the plugin in the running Obsidian
  through the official CLI. `OBSIDIAN_VAULT` picks the vault (default
  `my-obsidian-plugins`), `OBSIDIAN_RELOAD=0` disables the reload.
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
  ui/                # views, popover, components
  integrations/      # optional cross-plugin wiring (Calendar Plus)
  cli/               # registerCliHandler handlers
```

Rules that matter here:

- **`domain/` stays pure.** Parsing and serializing a task line must not touch
  `app`, the DOM or the vault. That is what makes it testable and what keeps the
  syntax decision in one place.
- **All markdown writes go through `actions/`, using `vault.process(file, fn)`** —
  atomic, and no race with an open editor. Never `vault.modify` on a file the
  user may be editing.
- **All reads of task text go through the index**, never an ad-hoc file scan.
- **One serializer.** Every write of a task line goes through
  `domain/serialize-line.ts`. Never format a date or a priority inline elsewhere.

## The task model

- Statuses come from our own configurable catalog. Defaults use the symbols
  already present in the target vault (`[ ]`, `[/]`, `[x]`, `[-]`, `[>]`) so
  existing notes are recognized on first run — a deliberate default, not
  inherited behavior.
- The parser is **tolerant on read**: it recognizes priority (`🔺⏫🔼🔽⏬`) and
  date (`📅⏳🛫➕✅`) emoji already written in old notes. Dropping this would
  silently lose information from thousands of existing tasks.
- Writing uses a single syntax, selectable in settings, defaulting to those same
  emoji so the vault doesn't end up with two dialects.

## Hierarchy

`metadataCache.getFileCache(f).listItems` gives `task` (the status char) and
`parent` (the parent's start line). Build the tree from `parent` — never by
counting indentation. A list item **without** `task` is a valid grouping node: it
acts as a heading for the tasks nested under it.

When moving a task, the whole subtree moves with it, reindented to the
destination. This is the operation most likely to corrupt notes: verify it
against the git-tracked test vault by inspecting the actual diff.

## Completion dates

The plugin never writes a completion date into the user's markdown unless the
line already carries that syntax. Date resolution order:

1. A completion date written on the line, if present.
2. The date of the periodic note containing the task (`Cronos/Diario/YYYY-MM-DD.md`).
3. The plugin's own completion log in `data.json`, recorded when it observes a
   task transition to a done status.

## Verification

Never mark work done on a build alone. After each change:

```bash
pnpm build && pnpm lint
obsidian vault="my-obsidian-plugins" dev:errors      # must be empty
obsidian vault="my-obsidian-plugins" dev:console level=error
obsidian vault="my-obsidian-plugins" dev:screenshot path=/tmp/st.png
```

For index correctness, use Obsidian's own CLI as an independent oracle — it
counts tasks without going through our code:

```bash
obsidian vault="my-obsidian-plugins" tasks total
obsidian vault="my-obsidian-plugins" eval code="app.plugins.plugins['simple-tasks'].index.all().length"
```

The numbers must match. Same for `tasks done` / `tasks todo`.

## Styling

`styles.css` uses **only** Obsidian CSS variables — no literal colors, ever.
Verify in both light and dark themes. Animations must respect
`@media (prefers-reduced-motion: reduce)`.
