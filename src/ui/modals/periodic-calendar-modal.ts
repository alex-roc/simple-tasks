import { Modal, Setting } from 'obsidian';
import type { App } from 'obsidian';
import { openPeriodicCalendarPage } from '../../integrations/periodic-calendar.ts';
import { t } from '../../i18n/index.ts';

/**
 * What the user sees when they ask for the calendar and Periodic Calendar is not
 * there.
 *
 * Deliberately **on demand only**: nothing is announced at startup. A plugin
 * that greets a new user with a notice about a plugin they did not ask for is
 * advertising, and the catalog reviewers say so too. The explanation belongs
 * exactly where the missing feature was requested — here, and as a status row
 * in the settings tab.
 */
export class PeriodicCalendarMissingModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t('calendar.missing.title'));
		this.contentEl.createEl('p', { text: t('calendar.missing.body') });
		this.contentEl.createEl('p', {
			cls: 'mod-warning',
			text: t('calendar.missing.note'),
		});

		new Setting(this.contentEl)
			.addButton((button) =>
				button
					.setButtonText(t('calendar.missing.install'))
					.setCta()
					.onClick(() => {
						openPeriodicCalendarPage();
						this.close();
					})
			)
			.addButton((button) =>
				button.setButtonText(t('common.cancel')).onClick(() => {
					this.close();
				})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
