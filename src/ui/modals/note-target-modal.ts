import { FuzzySuggestModal, SuggestModal, TFile } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../../i18n/index.ts';

/**
 * Choosing where a task should go: a note, then a heading inside it.
 *
 * Two steps rather than one combined picker, because the heading list can only
 * exist once the note is known. Headings come from
 * `metadataCache.getFileCache(file).headings`, which Obsidian already parsed —
 * no second markdown parser, and code fences are handled for free.
 */

/** Where inside the destination note the subtree should land. */
export interface NoteTarget {
	file: TFile;
	/** `null` appends at the end of the note. */
	heading: string | null;
	/** Level to use if the heading does not exist yet. */
	headingLevel: number;
}

/** Asks for a note, then for a heading, then calls back once. */
export function pickNoteTarget(
	app: App,
	onPick: (target: NoteTarget) => void,
	options: { exclude?: string } = {}
): void {
	new NoteSuggestModal(app, options.exclude ?? null, (file) => {
		new HeadingSuggestModal(app, file, (heading, headingLevel) => {
			onPick({ file, heading, headingLevel });
		}).open();
	}).open();
}

class NoteSuggestModal extends FuzzySuggestModal<TFile> {
	private readonly exclude: string | null;
	private readonly onChoose: (file: TFile) => void;

	constructor(app: App, exclude: string | null, onChoose: (file: TFile) => void) {
		super(app);
		this.exclude = exclude;
		this.onChoose = onChoose;
		this.setTitle(t('modal.note.title'));
		this.setPlaceholder(t('modal.note.placeholder'));
	}

	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles().filter((file) => file.path !== this.exclude);
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}
}

interface HeadingChoice {
	/** Heading text, or `null` for the end of the note. */
	heading: string | null;
	level: number;
	/** Shown as the primary line. */
	label: string;
	/** Shown muted below it. */
	hint: string;
}

class HeadingSuggestModal extends SuggestModal<HeadingChoice> {
	private readonly file: TFile;
	private readonly onChoose: (heading: string | null, level: number) => void;

	constructor(app: App, file: TFile, onChoose: (heading: string | null, level: number) => void) {
		super(app);
		this.file = file;
		this.onChoose = onChoose;
		this.setTitle(t('modal.heading.title'));
		this.setPlaceholder(t('modal.heading.placeholder'));
	}

	getSuggestions(query: string): HeadingChoice[] {
		const needle = query.trim().toLowerCase();
		const cache = this.app.metadataCache.getFileCache(this.file);
		const existing: HeadingChoice[] = (cache?.headings ?? [])
			.filter((h) => needle === '' || h.heading.toLowerCase().includes(needle))
			.map((h) => ({
				heading: h.heading,
				level: h.level,
				label: h.heading,
				hint: '#'.repeat(h.level),
			}));

		const out: HeadingChoice[] = [
			{ heading: null, level: 2, label: t('modal.heading.endOfNote'), hint: this.file.path },
			...existing,
		];

		// A heading that does not exist yet is a legitimate destination: the move
		// creates it. Only offer it when the query is not already an exact match.
		const exact = existing.some((choice) => choice.label.toLowerCase() === needle);
		if (needle !== '' && !exact) {
			out.push({
				heading: query.trim(),
				level: 2,
				label: t('modal.heading.create', { heading: query.trim() }),
				hint: '##',
			});
		}
		return out;
	}

	renderSuggestion(choice: HeadingChoice, el: HTMLElement): void {
		el.createDiv({ text: choice.label });
		el.createDiv({ cls: 'simple-tasks-suggestion-hint', text: choice.hint });
	}

	onChooseSuggestion(choice: HeadingChoice): void {
		this.onChoose(choice.heading, choice.level);
	}
}
