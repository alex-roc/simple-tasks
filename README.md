# Simple Tasks

Task management for Obsidian built on plain markdown checkboxes. No query
language, no separate task database: your notes stay the source of truth.

> Status: in development (0.1.0). Not yet published to the community catalog.

## What it does

- **Completion heatmap** — a year at a glance, one cell per day, so you can see
  the shape of your work.
- **Hover actions** — a popover on any task, both in the plugin's own views and
  over task lines in the editor: change status, set priority, move it to another
  date, note or heading.
- **Outline hierarchy as a first-class citizen** — a parent task aggregates its
  children's progress, and a plain list item can act as a group heading for the
  tasks under it.
- **Tag grouping** — tags are read from the task line, from the note, and
  inherited from the outline ancestors.
- **Multiple statuses** — a configurable catalog (pending, in progress, done,
  cancelled, rescheduled…), each with its own symbol and click cycle.
- **Progress panel** — tasks done today, current and best streak, top tags.
- **Bases view** — filter notes with the native Bases UI and see their tasks.
- **CLI commands** — `simple-tasks:stats`, `simple-tasks:today`,
  `simple-tasks:move` through Obsidian's official CLI.

Works on its own. With **Calendar Plus** installed it also contributes per-day
task counts to the calendar and lets you drag tasks between days.

## Development

Requires Node 20+, pnpm, and Obsidian 1.12+ for the CLI-based dev loop.

```bash
pnpm install
pnpm seed          # populate the test vault with realistic notes
pnpm dev           # watch + auto-reload the plugin in Obsidian
pnpm build         # type-check and produce a production main.js
pnpm lint
```

`pnpm dev` reloads the plugin in the running Obsidian after every successful
rebuild via `obsidian plugin:reload`. It targets the `my-obsidian-plugins` vault
by default; override with `OBSIDIAN_VAULT`, or set `OBSIDIAN_RELOAD=0` to
disable it.

See `AGENTS.md` for conventions and `dev-docs/` for architecture notes.

## License

MIT
