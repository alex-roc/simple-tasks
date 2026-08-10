# User guide

Simple Tasks reads the checkboxes you already write. It adds views, a hover
menu and statistics on top of them, and it never introduces a second place where
task state is kept — if you delete the plugin, your tasks are exactly as they
were.

Nothing here changes how you write. A task is a list item with a checkbox:

```markdown
- [ ] Draft the report 🔺 📅 2026-08-20 #work
	- [x] Collect the figures
	- [ ] Ask Ana for the chart
```

## Statuses

Out of the box the plugin understands five:

| Symbol | Meaning | Counts as completed |
|---|---|---|
| `[ ]` | Todo | no |
| `[/]` | In progress | no |
| `[x]` | Done | **yes** |
| `[-]` | Cancelled | no |
| `[>]` | Rescheduled | no |

That cancelled and rescheduled do **not** count as completed is deliberate: the
statistics and the heatmap measure work that closed, not boxes that were
touched.

The catalog is fully editable in the settings. Each status has a symbol, a name,
a flag for whether it counts as completed, and a *next* symbol — the status a
click moves it to, which is what makes clicking cycle through your own sequence
rather than a fixed one. Add statuses, remove them, or restore the defaults.

## Priorities and dates

The plugin reads and writes five priorities and six date fields. Both dialects
are recognised when reading, whichever one you have been using:

| Field | Emoji | Inline field |
|---|---|---|
| Priority | `🔺` `⏫` `🔼` `🔽` `⏬` | `[priority:: high]` |
| Created | `➕` | `[created:: 2026-08-09]` |
| Start | `🛫` | `[start:: 2026-08-09]` |
| Scheduled | `⏳` | `[scheduled:: 2026-08-09]` |
| Due | `📅` (also `🗓`) | `[due:: 2026-08-09]` |
| Done | `✅` | `[completion:: 2026-08-09]` |
| Cancelled | `❌` | `[cancelled:: 2026-08-09]` |

Writing uses one dialect, chosen in the settings and defaulting to emoji, so a
vault does not end up with two.

Anything the plugin does not recognise stays in the text, untouched: recurrence
rules, block references, ids, dependencies and any other syntax you write pass
through a rewrite unchanged.

## Outline hierarchy

A task with subtasks is a tree and is treated as one. Moving it takes its
children along, and its progress aggregates theirs.

A list item **without** a checkbox works as a group heading for the tasks nested
under it — which is what a plain `- Research` above three tasks already means:

```markdown
- Research
	- [ ] Read the paper
	- [x] Summarise it
```

With one exception. An item without a checkbox that has **no task anywhere below
it** is not a heading — it is a note *on* the task it hangs from. The two are
told apart by what they contain, never by a marker you have to write, and the
agenda folds these away under their task, dimmed and expandable:

```markdown
- [ ] Prepare the review
	- Ask for last year's numbers   ← a detail: folded
	- Bring the printed draft       ← a detail: folded
```

## Projects, from the links you already write

A task's project comes from the `[[wikilinks]]` in your notes. There is no new
syntax and nothing to mark up. A task belongs to:

1. the **first wikilink on its own line**, if it has one —
   `- [x] Push the release [[BiciDatos#Flutter]]` belongs to *BiciDatos*;
2. failing that, the nearest **ancestor** that has one — the three tasks under
   `- 🎯 [[Course platform]]` all belong to that project;
3. failing that, **No project**, which sorts last.

A link to a section counts as the note, so `[[BiciDatos#Flutter]]` and
`[[BiciDatos]]` are the same project. An alias changes nothing either:
`[[census-explorer|the census]]` is *census-explorer*. A bare `[[#Section]]`
and an `![[embed]]` name no project and are ignored.

Unlike a tag, **a task has exactly one project**: it is a place in the outline,
and a task is in one place.

## Tags

Tags are read from three places: the task line itself, the note's own tags, and
the outline ancestors. If `- Research #lab` has tasks under it, all of them are
`#lab` without repeating it on every line. Inheritance can be switched off in the
settings.

## The views

### Agenda

A sidebar view with everything that belongs to a day. It gathers the tasks of
that day's daily note, and any task due that day wherever it lives; a toggle
widens it to also read the week, month, quarter, semester and year notes whose
span covers the day.

- **Group by note, project, tag or status**, or not at all. Every group title
  carries its progress (`1 of 3 completed`), counting only real tasks —
  checkbox-less items are structure, not work.
- **Group titles that open something are clickable, and the rest are not.**
  Grouped by note, the title opens that note at its first task of the day;
  grouped by project, it opens the project note, and stays inert if that note
  does not exist yet. Grouped by tag or status there is nothing to open, so the
  title does not respond to the mouse and does not take focus.
- **Move through the days** with the previous/next buttons, jump to today, or
  pick a date. The header opens the day's note.
- **Hide or show completed tasks**, and the checkboxes are live: clicking one
  writes to the note.

### Heatmap

A year at a glance, one cell per day, shaded by how many tasks you completed.
Hovering a cell tells you the date and the count; clicking a day opens its
agenda.

By default the view shows the grid and your level, and nothing else. Three more
sections — streak cards, a summary, and your top tags — are individual toggles
in the settings, so the view holds what you want to look at and no filler. With
all of them off the grid takes the full width, with no empty panel beside it.

The level and its XP are derived from your completed tasks, weighted by
priority, and the levels widen as they go. It is a reading of your own notes, not
a score kept anywhere.

## Actions

Hover any task — in the plugin's views or **in any note**, in live preview or
reading view — and one popover appears with everything you can do to it:

- **Status** — jump to any status in your catalog.
- **Priority** — set one of the five, or clear it.
- **Move to** — today, tomorrow, another date, or another note and heading. The
  whole subtree moves with the task, reindented to its destination. If the
  destination note does not exist yet it is created from its template.
- **Due** — today, tomorrow, another date, or remove it. Which date field this
  writes is a setting: due, scheduled or start.
- **Tags** — add one (with a picker that shows how many tasks already use each)
  or remove one that is on the line.
- **Open the note at this line.**

The popover is keyboard accessible. In the agenda and in the Bases view every
task row is a tab stop: Tab to one and press Enter or Space, and the popover opens
with the focus already on its first button. Tab and Shift+Tab then cycle *inside*
it and cannot fall out, Escape closes it, and the focus goes back exactly where it
was — the row you came from, or the line in the editor if you opened it with
**Show task actions**. Hovering a second task replaces the popover instead of
stacking another one.

**On a phone or a tablet** there is no hover, so the same popover has two other
ways in:

- **Long press a task row** in the agenda or the Bases view.
- **In a note**, put the cursor on a task line: a small ⋮ button appears at the
  end of that line, and pressing it opens the popover. It appears with the cursor
  and does nothing on its own — it never covers what you are typing, and it does
  not move the text.

Both are mobile only. On the desktop, right-clicking a task and the active line
keep behaving exactly as Obsidian makes them behave.

With the cursor on a task line, the palette also offers **Cycle task status**,
**Move task to tomorrow** and **Set task due date**. On a line that is not a
task, those commands do not appear at all.

Every write goes through one serializer and one atomic write, so nothing races
with the editor when the note is open in front of you. If the line has changed
since the plugin last read it, the action stops and tells you rather than write
to a line it cannot identify.

## A burst when you finish something

Completing a task fires a short particle burst over the line you ticked. It fires
for **every** way a task gets completed, including the native checkbox in the
note itself — live preview, reading view, or typing the `x` by hand.

Three things it deliberately does not do:

- A parent task whose subtasks are still open closes nothing, so it gets no
  burst. The last remaining child gets it.
- If the note is not on screen, nothing is drawn: an edit made outside Obsidian
  or arriving through sync does not throw a party.
- An edit that completes several tasks at once fires one burst, not one per task.

Switch it off in Settings → Actions → *Celebrate completions*. It stays still on
its own if your system asks for reduced motion.

## Completion dates

**The plugin never adds a completion date to your markdown** unless the line
already carries that syntax. To know which day a task closed it uses, in order:

1. the completion date written on the line, if it has one;
2. the date of the periodic note containing the task — which is why a
   long-standing `Daily/` folder shows up in the heatmap from the first day you
   enable the plugin, with no migration;
3. its own completion log, kept in the plugin's `data.json` and recorded when it
   observes a task change to a completed status. This covers the tasks that live
   outside periodic notes.

Only tasks with a date precise to the day shade the heatmap. Tasks from weekly
or monthly notes count in the totals but do not invent activity on the 1st of
the month.

## Appearance

`styles.css` uses only Obsidian's own CSS variables, so both views follow your
theme in light and dark mode, whichever theme you use.

With the **Style Settings** plugin installed you also get controls for the
heatmap's colour, cell size, cell gap and density, and for the colour, spread
and size of the completion particles. Nothing about that is required.

## Language

The interface is available in English and Spanish and follows Obsidian's own
language setting — there is nothing to choose, and anything not translated falls
back to English.

## With Calendar Plus

Everything above works on its own. When the **Calendar Plus** plugin is
installed, Simple Tasks registers itself as one of its sources and the calendar
gains task counts on every cell, drag-and-drop of a task onto a day, and a
context-menu entry that opens the agenda for that day. See
[commands-and-cli.md](commands-and-cli.md#with-calendar-plus) for the detail.

Calendar Plus is entirely optional: nothing is announced at startup when it is
missing, and the settings tab carries a status row saying whether the two found
each other.
