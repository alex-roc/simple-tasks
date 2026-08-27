/**
 * English strings — the source of truth for every key in the plugin.
 *
 * Adding a key here is what makes it exist: `TranslationKey` is derived from
 * this object, so a key missing from `es.ts` is a fallback (fine) but a key
 * missing from here is a type error (not fine).
 *
 * Conventions:
 *
 * - **Sentence case**, enforced by `obsidianmd/ui/sentence-case-locale-module`,
 *   which is why the eslint config uses `recommendedWithLocalesEn`.
 * - Placeholders are `{name}` and are substituted by `t()`.
 * - Count-dependent strings come in `_one` / `_other` pairs and are read with
 *   `tCount()`; never build a plural by concatenating an "s".
 */
const en = {
	/* ------------------------------------------------------------------ common */
	'common.today': 'Today',
	'common.tomorrow': 'Tomorrow',
	'common.cancel': 'Cancel',
	'common.save': 'Save',
	'common.dayCount_one': '{count} day',
	'common.dayCount_other': '{count} days',
	'common.activeDayCount_one': '{count} active day',
	'common.activeDayCount_other': '{count} active days',

	/* ---------------------------------------------------------------- commands */
	'command.openHeatmap': 'Open heatmap',
	'command.openAgenda': 'Open agenda',
	'command.agendaToday': "Open today's agenda",
	'command.cycleStatus': 'Cycle task status',
	'command.taskActions': 'Show task actions',
	'command.moveToTomorrow': 'Move task to the next day',
	'command.setDueDate': 'Set task due date',
	'command.showInCalendar': 'Show tasks on the calendar',
	'ribbon.heatmap': 'Open task heatmap',
	'ribbon.agenda': 'Open task agenda',

	/* ------------------------------------------------------------------- views */
	'view.heatmap.title': 'Task heatmap',
	'view.agenda.title': 'Task agenda',

	/* ----------------------------------------------------------------- heatmap */
	'heatmap.gridLabel': 'Tasks completed per day',
	'heatmap.empty': 'No days to show yet.',
	'heatmap.less': 'Less',
	'heatmap.more': 'More',
	'heatmap.dayEmpty': 'Nothing completed on {date}',
	'heatmap.dayCount_one': '{count} task completed on {date}',
	'heatmap.dayCount_other': '{count} tasks completed on {date}',

	/* ---------------------------------------------------------------- calendar */
	'calendar.sourceName': 'Simple Tasks',
	'calendar.completedCount_one': '{count} task completed',
	'calendar.completedCount_other': '{count} tasks completed',
	'calendar.openCount_one': '{count} task open',
	'calendar.openCount_other': '{count} tasks open',
	'calendar.menu.showDay': 'Show the tasks of this day',
	'calendar.menu.showPeriod': 'Show the tasks of {date}',
	'calendar.missing.title': 'Periodic Calendar is not installed',
	'calendar.missing.body':
		'Simple Tasks can put its task counts on the Periodic Calendar calendar, accept tasks dragged from the agenda onto a day, and add an entry to a day’s context menu. That needs the Periodic Calendar plugin.',
	'calendar.missing.note':
		'Everything else keeps working without it: the heatmap, the agenda, the statistics and the task actions.',
	'calendar.missing.install': 'Install Periodic Calendar',
	'calendar.nothingToShow': 'No task carries a date yet, so the calendar has nothing to show.',

	/* ------------------------------------------------------------------- stats */
	'stats.level': 'Level {count}',
	'stats.xpProgress': '{current} of {total} XP towards level {next}',
	'stats.xpSummary': '{xp} XP · {remaining} to next',
	'stats.today': 'Today',
	'stats.thisWeek': 'This week',
	'stats.currentStreak': 'Current streak',
	'stats.bestStreak': 'Best streak',
	'stats.thisMonth': 'This month',
	'stats.perActiveDay': 'Per active day',
	'stats.completedOver': '{count} completed over {days}.',
	'stats.busiestDay': 'Busiest day: {date} with {count}.',
	'stats.topTags': 'Top tags',

	/* ------------------------------------------------------------------ agenda */
	'agenda.previousDay': 'Previous day',
	'agenda.nextDay': 'Next day',
	'agenda.goToToday': 'Go to today',
	'agenda.pickDay': 'Pick a day',
	'agenda.openDailyNote': 'Open the daily note',
	'agenda.groupBy': 'Group by',
	'agenda.groupBy.note': 'Note',
	'agenda.groupBy.project': 'Project',
	'agenda.groupBy.tag': 'Tag',
	'agenda.groupBy.status': 'Status',
	'agenda.groupBy.none': 'Nothing',
	'agenda.hideCompleted': 'Hide completed',
	'agenda.showCompleted': 'Show completed',
	'agenda.empty': 'Nothing scheduled for this day.',
	'agenda.untagged': 'No tag',
	'agenda.noProject': 'No project',
	'agenda.summary': '{open} open of {total}',
	'agenda.groupProgress': '{completed} of {total} completed',
	'agenda.detailCount_one': '{count} detail',
	'agenda.detailCount_other': '{count} details',
	'agenda.selectedCount_one': '{count} selected',
	'agenda.selectedCount_other': '{count} selected',
	'agenda.taskActions': 'Actions for {task}',
	'agenda.setStatus': 'Change the status of {task}',
	'agenda.openNote': 'Open the note {note}',

	/* ------------------------------------------------------------------- bases */
	'bases.viewName': 'Tasks',
	'bases.showCompleted': 'Show completed tasks',
	'bases.maxDepth': 'Outline depth',
	'bases.empty': 'No tasks in the notes this base selects.',
	'bases.noteCount_one': '{count} note',
	'bases.noteCount_other': '{count} notes',

	/* --------------------------------------------------------------------- cli */
	'cli.stats.desc': 'Show task counts, streaks and level',
	'cli.today.desc': 'Show the tasks of a day',
	'cli.move.desc': 'Move a task to a date or a note',
	'cli.flag.format': 'Output format, json or text. Defaults to text',
	'cli.flag.date': 'Day to show, as YYYY-MM-DD. Defaults to today',
	'cli.flag.tag': 'Keep only the tasks carrying this tag',
	'cli.flag.wide': 'Also read the week, month, quarter, semester and year notes',
	'cli.flag.open': 'Leave the completed tasks out',
	'cli.flag.task': 'Task to move, as path:line with a 1-based line',
	'cli.flag.toDate': 'Destination day, as YYYY-MM-DD',
	'cli.flag.toNote': 'Destination note, as a vault-relative path',
	'cli.flag.heading': 'Heading of the destination note to file it under',
	'cli.flag.granularity': 'Periodic note the date refers to. Defaults to day',
	'cli.stats.tasks': '{total} tasks in {notes} notes, {open} open',
	'cli.stats.completed': 'Completed: {today} today, {week} this week, {month} this month, {total} in total',
	'cli.stats.streak': 'Streak: {current} days now, {best} at best',
	'cli.stats.level': 'Level {level} · {xp} XP · {into} of {span} into this level',
	'cli.stats.activity': '{days} active days, {average} per active day',
	'cli.stats.busiest': 'Busiest day: {date} with {count}',
	'cli.stats.tags': 'Top tags: {tags}',
	'cli.today.header': '{date} · {open} open of {total}',
	'cli.today.empty': 'Nothing scheduled for {date}.',
	'cli.move.done': 'Moved "{text}" to {path}:{line} ({lines}).',
	'cli.error.date': 'The date {value} is not a valid YYYY-MM-DD day.',
	'cli.error.taskFlag': 'Pass the task to move as task=path:line.',
	'cli.error.noTask': 'No indexed task at {task}.',
	'cli.error.destination': 'Pass a destination, either date= or note=.',
	'cli.error.twoDestinations': 'Pass date= or note=, not both.',
	'cli.error.moveFailed': 'The move could not be completed.',

	/* ----------------------------------------------------------------- popover */
	'popover.label': 'Task actions',
	'popover.status': 'Status',
	'popover.priority': 'Priority',
	'popover.moveTo': 'Move to',
	'popover.due': 'Due',
	'popover.tags': 'Tags',
	'popover.setStatus': 'Set status to {name}',
	'popover.setPriority': 'Set priority to {name}',
	'popover.clearPriority': 'Clear the priority',
	'popover.moveToToday': 'Move to today ({date})',
	'popover.moveToTomorrow': 'Move to the day after this task’s own day ({date})',
	'popover.moveToDate': 'Move to another date…',
	'popover.moveToNote': 'Move to a note…',
	'popover.dueToday': 'Set the due date to today ({date})',
	'popover.dueTomorrow': 'Set the due date to tomorrow ({date})',
	'popover.dueDate': 'Set another due date…',
	'popover.dueClear': 'Remove the due date',
	'popover.addTag': 'Add a tag…',
	'popover.removeTag': 'Remove {tag}',
	'popover.openNote': 'Open the note at this line',
	'popover.noTags': 'No tags on this line.',
	'popover.close': 'Close',
	'popover.lineActions': 'Task actions for this line',

	/* ---------------------------------------------------------------- priority */
	'priority.highest': 'Highest',
	'priority.high': 'High',
	'priority.medium': 'Medium',
	'priority.low': 'Low',
	'priority.lowest': 'Lowest',

	/* ------------------------------------------------------------------ modals */
	'modal.date.title': 'Pick a date',
	'modal.date.label': 'Date',
	'modal.note.title': 'Move to a note',
	'modal.note.placeholder': 'Type the name of a note…',
	'modal.heading.title': 'Move under a heading',
	'modal.heading.placeholder': 'Type or pick a heading…',
	'modal.heading.endOfNote': 'End of the note',
	'modal.heading.create': 'Create the heading "{heading}"',
	'modal.tag.title': 'Add a tag',
	'modal.tag.placeholder': 'Type a tag…',
	'modal.tag.create': 'Add the new tag {tag}',
	'modal.tag.usage_one': '{count} task',
	'modal.tag.usage_other': '{count} tasks',

	/* ----------------------------------------------------------------- actions */
	'action.notFound': 'That task is no longer at that line; the note may have changed.',
	'action.noFile': 'The note {path} could not be opened.',
	'action.notPeriodic': 'Notes for that period are not configured in this vault.',
	'action.moved': 'Moved {count} to {path}.',
	'action.movedLines_one': '{count} line',
	'action.movedLines_other': '{count} lines',
	'action.movedTasks': 'Moved {count} to {path}.',
	'action.taskCount_one': '{count} task',
	'action.taskCount_other': '{count} tasks',
	'action.movedSkipped': '{count} were left where they were.',
	'action.movedNone': 'None of the selected tasks could be moved.',
	'action.moveFailed': 'The move could not be completed, so the note was left unchanged.',
	'action.sameDestination': 'The task is already there.',

	/* ---------------------------------------------------------------- settings */
	'settings.statuses.name': 'Statuses',
	'settings.statuses.desc':
		'The characters this plugin understands between the brackets. Whether a status counts as completed drives stats and the completion heatmap; the next symbol is where a click moves the task.',
	'settings.statuses.blank': '[ ] (space)',
	'settings.statuses.namePlaceholder': 'Name',
	'settings.statuses.nextPlaceholder': 'Next',
	'settings.statuses.completedTooltip': 'Counts as completed',
	'settings.statuses.remove': 'Remove status',
	'settings.statuses.add': 'Add status',
	'settings.statuses.restore': 'Restore defaults',
	'settings.statuses.newName': 'New status',
	'settings.writing.name': 'Writing',
	'settings.writing.desc':
		'Reading always accepts both dialects; this only affects what gets written.',
	'settings.syntax.name': 'Metadata syntax',
	'settings.syntax.desc':
		'How priority and dates are written back into a line: as emoji (⏫ 📅 2026-01-01) or as inline fields in double-colon syntax.',
	'settings.syntax.emoji': 'Emoji',
	'settings.syntax.inlineField': 'Inline fields',
	'settings.index.name': 'Index',
	'settings.inheritTags.name': 'Inherit tags from parent items',
	'settings.inheritTags.desc':
		'A task also carries the tags of the list items above it in the outline. Tags of the note itself are always included.',
	'settings.excludeTemplates.name': 'Skip template notes',
	'settings.excludeTemplates.desc':
		'Leave out tasks living in the notes the vault registers as templates for daily and periodic notes.',
	'settings.excludedFolders.name': 'Excluded folders',
	'settings.excludedFolders.desc':
		'One vault-relative folder per line. Their notes are never indexed.',
	'settings.excludedFolders.placeholder': 'Archivo/2019',
	'settings.actions.name': 'Actions',
	'settings.actions.desc': 'What the hover popover and the agenda do when they write a line.',
	'settings.moveHeading.name': 'Heading for moved tasks',
	'settings.moveHeading.desc':
		'When a task is moved to a note or a date, it is filed under this heading. The heading is created if it does not exist. Leave empty to append at the end of the note.',
	'settings.moveHeading.placeholder': 'Tareas',
	'settings.dueField.name': 'Date field used when rescheduling',
	'settings.dueField.desc': 'Which date the popover writes when you pick a new one.',
	'settings.dueField.due': 'Due',
	'settings.dueField.scheduled': 'Scheduled',
	'settings.dueField.start': 'Start',
	'settings.hoverPopover.name': 'Popover on hover in the editor',
	'settings.hoverPopover.desc':
		'Show the task actions when the pointer rests on a task line in a note. Turn it off to use the command instead.',
	'settings.heatmap.name': 'Heatmap view',
	'settings.heatmap.desc':
		'What that view shows next to the calendar grid. Everything here is off by default except the level, so the view opens as a heatmap and nothing else.',
	'settings.heatmapLevel.name': 'Level and experience',
	'settings.heatmapLevel.desc':
		'The level reached, its progress bar and how much experience is left to the next one.',
	'settings.heatmapTiles.name': 'Streak cards',
	'settings.heatmapTiles.desc':
		'Six cards: today, this week, the current and best streaks, this month and the average per active day.',
	'settings.heatmapSummary.name': 'Summary',
	'settings.heatmapSummary.desc':
		'How much was completed over how many active days, and which day was the busiest.',
	'settings.heatmapTopTags.name': 'Top tags',
	'settings.heatmapTopTags.desc': 'The tags carried by the most completed tasks.',
	'settings.periodic.name': 'Semester notes',
	'settings.periodic.desc':
		'Daily, weekly, monthly, quarterly and yearly notes are read from the vault configuration. Semesters have no such configuration, so they are set here.',
	'settings.semesterFolder.name': 'Folder',
	'settings.semesterFolder.desc':
		'Leave empty to infer it from the folder the other periodic notes share.',
	'settings.semesterFormat.name': 'Filename format',
	'settings.semesterFormat.desc':
		'A moment format in which the letter s stands for the semester, 1 or 2.',
	'settings.calendar.name': 'Periodic Calendar',
	'settings.calendar.desc':
		'An optional integration. When that plugin is present, its calendar shows the tasks of each period and accepts tasks dragged onto a day.',
	'settings.calendar.status': 'Status',
	'settings.calendar.connected': 'Connected: the calendar is showing your tasks.',
	'settings.calendar.missing': 'Not installed. Everything else in Simple Tasks works without it.',
	'settings.calendarDisplay.name': 'How the calendar shows tasks',
	'settings.calendarDisplay.desc':
		'The shading tints each day by how much you completed in it, which costs the cell no room. The dots mark completed and still-open tasks instead, one per task. Hovering a day gives both figures either way.',
	'settings.calendarDisplay.intensity': 'Background intensity',
	'settings.calendarDisplay.dots': 'Dots',
};

/** Every key the plugin can ask for. Other locales fill a subset of it. */
export type Translations = Record<keyof typeof en, string>;

export default en;
