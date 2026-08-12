# Simple Tasks documentation

Simple Tasks manages tasks that live as ordinary markdown checkboxes in your
notes. There is no separate database and no query language: your notes are the
only place task state is kept, and everything the plugin shows is derived from
them.

- **[User guide](user-guide.md)** — the concepts and every feature: statuses,
  outline hierarchy, projects, tags, the views, the hover actions, the heatmap
  and how completion dates are worked out.
- **[Commands, Bases and CLI](commands-and-cli.md)** — every command in the
  palette, the Bases view, and the three terminal commands.
- **[Settings reference](settings.md)** — every setting, what it changes, and
  what it defaults to.

## Getting started in two minutes

1. Enable the plugin. Nothing is written to your vault, and nothing needs
   configuring: the default statuses are `[ ]`, `[/]`, `[x]`, `[-]` and `[>]`,
   which is what most vaults already contain.
2. Run **Open today's agenda** from the command palette (or click the agenda
   icon in the ribbon). You should see the tasks of today, with their outline
   hierarchy.
3. Hover any task line — in the agenda or in a note — and the actions popover
   appears: change the status, set a priority or a due date, add a tag, or move
   the task to another day or note. On a phone, long press the row instead, or
   put the cursor on the task line and press the ⋮ button that appears at its end.
4. To act on several tasks at once, press and drag across their rows in the agenda
   to paint a selection, then hover one of them: the same popover appears and now
   writes to all of them.
5. Run **Open heatmap** to see a year of completed work at a glance.

If your statuses, folders or periodic-note layout differ from the defaults, the
[settings reference](settings.md) is the place to adjust them.

## Requirements

Obsidian **1.10.0** or newer, desktop or mobile. The three terminal commands
additionally need Obsidian **1.12.2**, where the CLI gained plugin commands;
everything else works without them.
