import { Modal, Setting, moment } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../../i18n/index.ts';

/**
 * A one-field date prompt.
 *
 * `<input type="date">` on purpose: it is the platform's own date picker, so it
 * is keyboard accessible, localized and touch friendly without a line of code
 * here, and it gives back `YYYY-MM-DD` — the format the whole plugin speaks.
 */
export class DatePickerModal extends Modal {
	private value: string;
	private readonly onPick: (date: string) => void;
	private submitted = false;
	/** A field rather than a local: a `let` assigned inside the `addText`
	 * callback is narrowed to `never` by the compiler. */
	private inputEl: HTMLInputElement | null = null;

	constructor(app: App, initial: string | null, onPick: (date: string) => void) {
		super(app);
		this.value = initial ?? moment().format('YYYY-MM-DD');
		this.onPick = onPick;
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle(t('modal.date.title'));

		new Setting(contentEl).setName(t('modal.date.label')).addText((text) => {
			text.inputEl.type = 'date';
			text.setValue(this.value).onChange((value) => {
				this.value = value;
			});
			this.inputEl = text.inputEl;
		});

		new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText(t('common.cancel')).onClick(() => {
					this.close();
				})
			)
			.addButton((button) =>
				button
					.setButtonText(t('common.save'))
					.setCta()
					.onClick(() => {
						this.submit();
					})
			);

		// Enter is what a one-field prompt should answer to.
		this.scope.register([], 'Enter', () => {
			this.submit();
			return false;
		});
		this.inputEl?.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		if (this.submitted) return;
		if (!moment(this.value, 'YYYY-MM-DD', true).isValid()) return;
		this.submitted = true;
		this.close();
		this.onPick(this.value);
	}
}
