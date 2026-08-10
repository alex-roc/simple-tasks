# Commands, Bases and CLI

## Ribbon

Two icons: **Open task heatmap** and **Open task agenda**.

## Command palette

Four commands are always available:

| Command | What it does |
|---|---|
| **Open heatmap** | Opens the heatmap view. |
| **Open agenda** | Opens the agenda view on the day it last showed. |
| **Open today's agenda** | Opens the agenda on today. |
| **Show tasks on the calendar** | Opens the Calendar Plus calendar with the task counts on it, bringing it to the front even if it was already open behind another sidebar tab. Without Calendar Plus installed it explains what it would add instead of failing. |

Four more appear **only when the cursor is on a task line**, and are absent from
the palette otherwise:

| Command | What it does |
|---|---|
| **Cycle task status** | Moves the task to the *next* symbol of its status, as configured in the status catalog. |
| **Show task actions** | Opens the actions popover on the task under the cursor — the keyboard route to everything the hover menu offers. Focus moves into the popover and comes back to the line when it closes. |
| **Move task to tomorrow** | Moves the task, with its whole subtree, to tomorrow's note. |
| **Set task due date** | Asks for a date and writes it to the date field chosen in the settings. |

## Bases view

Simple Tasks registers a **Tasks** view for [Bases](https://help.obsidian.md/bases).
Bases selects the *notes* with its own native filters; the view shows the *tasks*
of those notes. Create a `.base` file, add a view, and pick **Tasks**.

Three options in the view's config menu:

- **Group by** — note, project, tag or status, each group showing its progress.
- **Show completed tasks** — on by default.
- **Outline depth** — how deep into the task tree to render.

The same hover popover works from there, so the Bases view is a place to *see*
tasks, not a second way to edit them.

## Terminal commands

Three commands through [Obsidian's own CLI](https://help.obsidian.md/cli), which
needs Obsidian 1.12.2 or newer. Each takes `format=json|text` and defaults to
text, so the output is readable by eye and pipeable into a script.

### `simple-tasks:stats`

Task counts, completions by period, current and best streak, level and XP,
active days, busiest day and top tags.

```bash
obsidian simple-tasks:stats
obsidian simple-tasks:stats format=json | jq '.streak.current'
```

### `simple-tasks:today`

The agenda of a day.

| Flag | Meaning |
|---|---|
| `date=<YYYY-MM-DD>` | Day to show. Defaults to today. |
| `tag=<tag>` | Keep only the tasks carrying this tag. |
| `wide=true` | Also read the week, month, quarter, semester and year notes. |
| `open=true` | Leave the completed tasks out. |

```bash
obsidian simple-tasks:today
obsidian simple-tasks:today date=2026-08-05 open=true format=json | jq '.tasks[].text'
```

### `simple-tasks:move`

Moves a task, with its whole subtree, to a date or to a note.

| Flag | Meaning |
|---|---|
| `task=<path:line>` | The task to move, as a vault-relative path and a 1-based line. Required. |
| `date=<YYYY-MM-DD>` | Destination day. |
| `note=<path>` | Destination note, as a vault-relative path. |
| `heading=<heading>` | Heading of the destination note to file it under. |
| `granularity=<day\|week\|month>` | Which periodic note `date` refers to. Defaults to day. |

Pass either `date=` or `note=`, not both.

```bash
obsidian simple-tasks:move task="Projects/report.md:13" date=2026-08-05
obsidian simple-tasks:move task="Projects/report.md:13" note="Inbox.md" heading="Pending"
```

Add `vault="<name>"` as the first parameter to pick a vault; without it the CLI
uses the last one that had focus.

## With Calendar Plus

When the **Calendar Plus** plugin is installed and enabled, Simple Tasks
registers itself as one of its sources and the calendar gains:

- **Task counts on every cell** — completions shade the day, still-open tasks
  show as hollow dots, and the tooltip gives both numbers. The header's week,
  month, quarter, semester and year buttons carry the totals of their period.
- **Drag a task onto a day** — pick it up in the agenda, drop it on a calendar
  cell, and the task moves to that period's note with its whole subtree. Cells
  light up only for tasks: the drag carries its own MIME type, so nothing else is
  offered a target it would refuse.
- **"Show the tasks of this day"** in a cell's context menu, which opens the
  agenda on that date.

The integration is checked at load and re-checked when plugins are enabled or
disabled, so installing Calendar Plus afterwards does not need a reload of
Simple Tasks. When it is absent, nothing is announced at startup: the
**Show tasks on the calendar** command explains what it would add, and the
settings tab carries a status row.
