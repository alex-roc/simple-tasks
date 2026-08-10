# Settings reference

Settings → Community plugins → **Simple Tasks**. Nothing here needs to be
touched for the plugin to work; the defaults are chosen to fit a vault that
already uses plain checkboxes.

## Statuses

The characters the plugin understands between the brackets. Each row is one
status, with four controls:

| Control | Meaning |
|---|---|
| Name | What the status is called in the interface. |
| Next | The symbol a click moves the task to, which is what defines your click cycle. |
| Counts as completed | Whether the status feeds the statistics and shades the heatmap. |
| Remove | Deletes the status from the catalog. |

**Add status** appends a new one; **Restore defaults** brings back `[ ]`, `[/]`,
`[x]`, `[-]` and `[>]`. Editing a name or the completed flag rebuilds the index,
so the views update immediately without touching any note.

A status the catalog does not contain is still read from your notes — the plugin
never silently rewrites an unknown symbol — it just has no name and no cycle.

## Writing

Reading always accepts both dialects; this section only affects what gets
written.

- **Metadata syntax** — `Emoji` (default) writes `⏫ 📅 2026-01-01`;
  `Inline fields` writes `[priority:: high] [due:: 2026-01-01]`.

## Actions

What the hover popover and the agenda do when they write a line.

- **Heading for moved tasks** — a moved task is filed under this heading in its
  destination note, and the heading is created if it does not exist. Empty
  (default) appends at the end of the note.
- **Date field used when rescheduling** — which date the popover writes when you
  pick one: `Due` (default), `Scheduled` or `Start`.
- **Popover on hover in the editor** — on by default. Shows the task actions
  when the pointer rests on a task line in a note. Turn it off to use the
  **Show task actions** command instead; the popover in the plugin's own views is
  unaffected, and so is the ⋮ button that mobile puts at the end of the task line
  the cursor is on.
- **Celebrate completions** — on by default. The particle burst when a task is
  finished. Nothing moves when your system asks for reduced motion.

## Heatmap view

What the heatmap view shows next to the grid. Everything here is off by default
except the level, so the view opens as a heatmap and nothing else. All four
update the open view immediately.

- **Level and experience** — on by default. The level reached, its progress bar
  and how much experience is left to the next one.
- **Streak cards** — six cards: today, this week, the current and best streaks,
  this month, and the average per active day.
- **Summary** — how much was completed over how many active days, and which day
  was the busiest.
- **Top tags** — the tags carried by the most completed tasks.

## Index

- **Inherit tags from parent items** — on by default. A task also carries the
  tags of the list items above it in the outline. The note's own tags are always
  included, whatever this is set to.
- **Skip template notes** — on by default. Leaves out tasks living in the notes
  the vault registers as templates for daily and periodic notes, so an unfilled
  template does not add phantom tasks to your counts.
- **Excluded folders** — one vault-relative folder per line. Their notes are
  never indexed. Useful for an archive you do not want in the statistics.

Changing any of these rebuilds the index.

## Semester notes

Daily, weekly, monthly, quarterly and yearly notes are read from the vault's own
configuration — core **Daily notes** or the **Periodic Notes** plugin, whichever
you use — so there is nothing to configure twice. Semesters have no such
configuration, which is the only reason these two settings exist.

- **Folder** — empty (default) infers it from the folder the other periodic
  notes share.
- **Filename format** — a moment format in which `S` stands for the semester,
  1 or 2. Defaults to `YYYY-[S]S`.

## Calendar Plus

Not a setting but a status row: whether Simple Tasks and the optional
[Calendar Plus](commands-and-cli.md#with-calendar-plus) plugin found each other.
It is re-read every time the tab is opened, so enabling that plugin and coming
back shows it connected. When it is missing, a button opens its page in the
community plugin browser.

## Where the settings are stored

In the plugin's own `data.json`, alongside the completion log described in the
[user guide](user-guide.md#completion-dates). Nothing is written into your notes.
