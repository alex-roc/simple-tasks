import { TFile } from 'obsidian';
import type { App } from 'obsidian';

/**
 * Opens a note with the cursor on one line — the "take me to it" every task UI
 * needs, and the reason the agenda and the popover do not have to duplicate
 * leaf handling.
 *
 * `eState.line` is what Obsidian's own search results use to scroll a file to a
 * position, so this behaves exactly like clicking a search hit.
 */
export async function openTaskAt(app: App, path: string, line: number): Promise<void> {
	const file = app.vault.getFileByPath(path);
	if (!(file instanceof TFile)) return;
	const leaf = app.workspace.getLeaf(false);
	await leaf.openFile(file, { eState: { line } });
}
