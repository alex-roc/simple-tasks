# Simple Tasks

Task management on the markdown checkboxes you already write. Your notes are the
only source of truth: there is no separate task database, no query language to
learn, and no new syntax to adopt. Enable the plugin and the tasks already in
your vault appear in an agenda, in a completion heatmap and behind a hover menu
that can edit them.

It is meant for people who keep tasks inside their notes — in daily notes, under
project headings, nested in an outline — and want to see and act on them without
moving them anywhere else. Disable the plugin and your notes are exactly as they
were.

<!-- SCREENSHOT 1 — hero image, widest impression first: the heatmap view open in
     the main pane with a year of activity and the level line visible. -->

## What it does

- **Daily agenda** — a sidebar view with everything that belongs to a day: its
  daily note, the wider periodic notes that cover it, and any task due that day.
  Group by note, project, tag or status, each group showing how many of its
  tasks are done. The outline hierarchy stays visible and the checkboxes are
  live.
- **Completion heatmap** — a year at a glance, one cell per day. Click a day to
  open its agenda. Streak cards, a summary and your top tags are each a toggle,
  so the view holds what you want to look at and nothing else.
- **Figures you can check by opening a note** — a day counts the tasks completed
  in that day's own note, plus anything whose line carries a `✅ date`. The plugin
  keeps no record of its own and never guesses a date: if your markdown does not
  say when a task closed, no day claims it. `data.json` holds your settings and
  nothing else.
- **Hover actions** — one popover on any task, in the plugin's views *and* over
  task lines in a note: change status, set a priority, add or remove tags, set a
  due date, or move the task — with its whole subtree — to another day, note or
  heading, creating the note from its template if it does not exist yet. Every
  task row is a tab stop, Enter opens the popover with focus inside it, Tab
  cannot fall out of it, Escape closes it and focus goes back where it was. On
  mobile, where there is no hover, a long press on a row opens the same popover,
  and a task line the cursor is on grows a ⋮ button at its end — and *only* those,
  so a tap never opens a card you did not ask for.
- **Relative to the task, not to the clock** — "move to the next day" on a task in
  Monday's note means Tuesday, whatever day you are reading it on. That is the
  gesture of reviewing a day that has passed, and the button shows the date it
  resolved to whenever that is not tomorrow.
- **Several tasks at once** — **select the lines in the note** the way you select
  any text, then hover one of them: the same popover appears and every action in it
  applies to all of them. It works the same way in the agenda, by dragging across
  its rows. Include the line the tasks hang off — the project, the moment — and a
  move carries the whole block instead of leaving an empty title behind. A task
  selected with its own ancestor is skipped, the moves run bottom-up so no line
  shifts under the batch, and one notice says how many arrived.
- **Projects from the links you already write** — a task belongs to the first
  `[[wikilink]]` on its own line, or failing that to the nearest ancestor that
  has one, so `- 🎯 [[census-explorer]]` files everything nested under it with no
  new syntax.
- **Outline hierarchy as a first-class citizen** — a parent task aggregates its
  children's progress, and a checkbox-less list item acts as a heading for the
  tasks under it. One with *no* task below it is not a heading but a note on its
  parent task, and the agenda folds it away.
- **Your own statuses** — a configurable catalog (todo, in progress, done,
  cancelled, rescheduled…), each with its own symbol and its own click cycle.
  Cancelled does not count as completed, because the heatmap measures work that
  closed, not boxes that were ticked.
- **Tags from three places** — the task line, the note, and inherited from the
  outline ancestors.
- **Bases view** — filter *notes* with the native Bases interface, see their
  *tasks*, grouped and depth-capped from the Bases toolbar.
- **Terminal commands** — `simple-tasks:stats`, `simple-tasks:today` and
  `simple-tasks:move` through Obsidian's official CLI, each with
  `format=json|text` so the output can be piped into a script.
- **English and Spanish** — the interface follows Obsidian's own language
  setting.

<!-- SCREENSHOT 2 — the agenda view in the sidebar, grouped by project, with the
     progress counters on the group titles and a nested subtask visible. -->

<!-- SCREENSHOT 3 — the hover popover open over a task line in a note (live
     preview), showing the status, priority, move, due and tag sections. -->

## Installation

### From the community catalog

Once it is listed: Settings → Community plugins → Browse → search for
**Simple Tasks**. It is not in the catalog yet, so until then use BRAT.

### With BRAT

Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, then run
**BRAT: Add a beta plugin for testing** and enter:

```
alex-roc/simple-tasks
```

BRAT installs the latest release and keeps it updated.

### Manually

Download `main.js`, `manifest.json` and `styles.css` from the
[latest release](https://github.com/alex-roc/simple-tasks/releases/latest) into
`<vault>/.obsidian/plugins/simple-tasks/`, then enable the plugin.

## Usage

Enable the plugin and run **Open today's agenda**. The tasks already in your
vault are there — the default statuses are `[ ]`, `[/]`, `[x]`, `[-]` and `[>]`,
so nothing needs configuring first. Hover a task, in the agenda or in any note,
to get the actions popover.

The full documentation is in **[`docs/`](docs/)**:

- **[User guide](docs/user-guide.md)** — the concepts and every feature.
- **[Commands, Bases and CLI](docs/commands-and-cli.md)** — the palette, the
  Bases view, the terminal commands.
- **[Settings reference](docs/settings.md)** — every setting and its default.

## Requirements

Obsidian **1.10.0** or newer, desktop or mobile. The three terminal commands
additionally need Obsidian **1.12.2**, where the CLI gained plugin commands;
capabilities newer than 1.10.0 are probed, so nothing breaks without them.

## Optional: Periodic Calendar

Everything works on its own. When the **Periodic Calendar** plugin is installed,
Simple Tasks registers itself as one of its sources: **every day is shaded by how
much you closed in its note**, so the calendar becomes a second heatmap in the
sidebar you already have open, with the figures on hover — dots instead of the
shading if you prefer them. The month, quarter and year buttons add up the notes
of those periods too. It also accepts tasks dragged from the agenda onto a day, and gains
a context-menu entry that opens the agenda for that day. Nothing is announced at
startup when it is absent — [details](docs/commands-and-cli.md#with-periodic-calendar).

<!-- SCREENSHOT 4 — optional, only if Periodic Calendar is installed: the calendar with
     the cells shaded by completions, mid-drag of a task onto a day. -->

## Theming

`styles.css` uses only Obsidian's CSS variables, so both views follow your theme
in light and dark mode. With the **Style Settings** plugin you also get controls
for the heatmap's colour, cell size, gap, density and roundness.

## Contributing

Issues and pull requests are welcome. Building needs **pnpm** and **Node
22.18+**:

```bash
pnpm install
pnpm dev      # watch and rebuild
pnpm build    # type-check and produce a production main.js
pnpm lint
pnpm test     # domain unit tests, run by Node's own test runner
```

`pnpm test` needs no test framework: the `domain/` modules import nothing from
`obsidian` at runtime, so `node --test` runs the TypeScript directly through
native type stripping — which is why relative imports carry an explicit `.ts`
extension. `pnpm seed` populates a scratch vault with realistic notes and
`pnpm verify` runs the real parser and serializer over every list line of it,
failing if one stops round-tripping byte-for-byte.

### Running a local build in your own vault

BRAT installs from a published release, which means a tag and a release for every
change you want to try. To run a local build instead, copy `.env.local.example` to
`.env.local` and name your vaults there — vault roots, not plugin folders:

```bash
VAULT_TEST=/Users/you/dev/my-obsidian-plugins
VAULT_REAL=/Users/you/Library/…/YourVault
VAULT_DEFAULT=TEST
```

Then:

```bash
pnpm dev                          # watch, reinstalling on every save
pnpm dev --vault=real             # the same, in another vault
pnpm install:vault --vault=real   # one production build, installed there
```

Each install copies `main.js`, `manifest.json` and `styles.css` into
`<vault>/.obsidian/plugins/simple-tasks`, plus the `.hotreload` marker that lets
[Hot Reload](https://github.com/pjeby/hot-reload) reload the plugin without
restarting Obsidian. The plugin folder comes from the manifest id, so the same
`.env.local` works for every plugin you develop.

Two deliberate choices. `pnpm build` never writes to a vault — that is the CI
path, and installing only happens when you ask for it. And installs copy rather
than symlink, because a symlink would put this repo's `node_modules` and `.git`
inside a vault that iCloud, Dropbox or Syncthing is watching; if a vault already
reaches the repo through a symlink, the install is skipped instead.

Conventions for the codebase are in [`AGENTS.md`](AGENTS.md).

## License

[MIT](LICENSE) © Alex Ojeda Copa
