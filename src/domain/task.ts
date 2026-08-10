/**
 * The task model. Pure types only: nothing here may import a runtime value from
 * `obsidian`, touch `app`, the DOM or the vault. That is what keeps the syntax
 * decision in one place and the parser unit-testable outside Obsidian.
 */

/** A status is identified by the single character between the brackets. */
export interface TaskStatus {
	/** Character inside `[ ]`. Exactly one char. */
	symbol: string;
	/** Human readable name, shown in the UI. */
	name: string;
	/** Whether the task counts as finished for stats and heatmaps. */
	isCompleted: boolean;
	/** Symbol to move to when the checkbox is clicked. */
	nextSymbol: string;
}

/** Priority levels, from most to least urgent. `null` means "unset". */
export type TaskPriority = 'highest' | 'high' | 'medium' | 'low' | 'lowest';

/** Every date field the parser understands, as `YYYY-MM-DD` strings. */
export interface TaskDates {
	created?: string;
	start?: string;
	scheduled?: string;
	due?: string;
	done?: string;
	cancelled?: string;
}

/** A `[[wikilink]]` found on the line. */
export interface TaskLink {
	/** Note name as written, without heading or alias. Empty for `[[#heading]]`. */
	target: string;
	/** Heading part without the leading `#`, if any. */
	heading?: string;
	/** Display alias after `|`, if any. */
	alias?: string;
	/** The whole link as written, including brackets. */
	raw: string;
}

/**
 * The result of parsing one markdown line. Everything the serializer needs to
 * rebuild the line lives here; anything the parser does not understand stays
 * inside `text`, so a round trip can never drop information.
 */
export interface ParsedLine {
	/** Leading whitespace, preserved verbatim. */
	indent: string;
	/** List marker as written: `-`, `*`, `+`, `1.`, `1)`. */
	marker: string;
	/**
	 * `true` when the line carries a `[x]` checkbox. A list item without one is
	 * still a valid node: it acts as a grouping heading for nested tasks.
	 */
	isTask: boolean;
	/** Status character. Empty string when `isTask` is false. */
	status: string;
	/**
	 * Line body with priority and date tokens removed, tags and wikilinks left
	 * in place. This is the round-trippable text: the serializer writes it back
	 * verbatim, so unknown syntax is never lost.
	 */
	text: string;
	/** `text` with tags stripped and whitespace collapsed. For display only. */
	cleanText: string;
	priority: TaskPriority | null;
	dates: TaskDates;
	/** Tags found on the line, with the leading `#`, in document order. */
	tags: string[];
	/** Wikilinks found on the line, in document order. */
	links: TaskLink[];
}

/**
 * A node of the outline, as stored in the index. Covers both real tasks and the
 * grouping list items above them (`isTask: false`).
 */
export interface Task extends ParsedLine {
	/** Stable within a session: `path:line`. */
	id: string;
	/** Vault-relative path of the containing note. */
	path: string;
	/** 0-based line number. */
	line: number;
	/**
	 * Line number of the parent list item, or `null` for a root item.
	 * Derived from `ListItemCache.parent`, never from indentation.
	 */
	parentLine: number | null;
	/** Depth in the outline: 0 for a root list item. */
	depth: number;
	/** Name of the resolved status, from the configured catalog. */
	statusName: string;
	/** Whether the resolved status counts as finished. */
	isCompleted: boolean;
	/** Lines of the direct children, in document order. */
	childLines: number[];
	/** Lines of every ancestor, closest first. */
	ancestorLines: number[];
	/** Tags of the line only. Same as {@link ParsedLine.tags}. */
	ownTags: string[];
	/** Note-level tags: frontmatter plus prose tags outside any list item. */
	noteTags: string[];
	/** Tags of the ancestor list items, when inheritance is enabled. */
	inheritedTags: string[];
	/** Union of own, note and inherited tags, deduplicated and lowercased. */
	tags: string[];
	/** ISO date of the containing periodic note, if it is one. */
	noteDate: string | null;
	/** Granularity of the containing periodic note, if it is one. */
	noteGranularity: PeriodicGranularity | null;
	/**
	 * Date this task is attributed to for agendas and heatmaps:
	 * the done date when set, otherwise the containing periodic note's date.
	 */
	effectiveDate: string | null;
}

/** A task with its subtree, for rendering an outline. */
export interface TaskNode {
	task: Task;
	children: TaskNode[];
}

/**
 * The six periodic-note levels. Declared here (and re-exported by `periodic.ts`)
 * so `task.ts` has no imports at all.
 */
export type PeriodicGranularity = 'day' | 'week' | 'month' | 'quarter' | 'semester' | 'year';
