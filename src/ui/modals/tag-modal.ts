import { SuggestModal } from 'obsidian';
import type { App } from 'obsidian';
import { normalizeTag } from '../../domain/tags.ts';
import { t, tCount } from '../../i18n/index.ts';
import type { TaskIndex } from '../../index/task-index.ts';

/**
 * Picks a tag from the ones the index already knows, or accepts a new one.
 *
 * The candidate list comes from `TaskIndex.tagCounts()` rather than from
 * `metadataCache.getTags()`: those are the tags that are actually *on tasks*,
 * which is what a task tag picker should offer first.
 */

interface TagChoice {
	tag: string;
	hint: string;
}

export class TagSuggestModal extends SuggestModal<TagChoice> {
	private readonly index: TaskIndex;
	private readonly onChoose: (tag: string) => void;
	private readonly exclude: ReadonlySet<string>;

	constructor(
		app: App,
		index: TaskIndex,
		options: { exclude?: readonly string[] },
		onChoose: (tag: string) => void
	) {
		super(app);
		this.index = index;
		this.onChoose = onChoose;
		this.exclude = new Set((options.exclude ?? []).map((tag) => tag.toLowerCase()));
		this.setTitle(t('modal.tag.title'));
		this.setPlaceholder(t('modal.tag.placeholder'));
	}

	getSuggestions(query: string): TagChoice[] {
		const needle = normalizeTag(query).toLowerCase();
		const out: TagChoice[] = [];
		for (const [tag, count] of this.index.tagCounts()) {
			if (this.exclude.has(tag.toLowerCase())) continue;
			if (needle !== '' && !tag.toLowerCase().includes(needle.slice(1))) continue;
			out.push({ tag, hint: tCount('modal.tag.usage', count) });
		}
		out.sort((a, b) => a.tag.localeCompare(b.tag));

		const exact = out.some((choice) => choice.tag.toLowerCase() === needle);
		if (needle !== '' && !exact) {
			out.unshift({ tag: needle, hint: t('modal.tag.create', { tag: needle }) });
		}
		return out;
	}

	renderSuggestion(choice: TagChoice, el: HTMLElement): void {
		el.createDiv({ text: choice.tag });
		el.createDiv({ cls: 'simple-tasks-suggestion-hint', text: choice.hint });
	}

	onChooseSuggestion(choice: TagChoice): void {
		this.onChoose(choice.tag);
	}
}
