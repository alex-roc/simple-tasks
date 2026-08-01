import { Plugin } from 'obsidian';

/**
 * Scaffold entry point. Phase 1 replaces this with the real lifecycle:
 * task index, views, commands, CLI handlers and the CodeMirror extension.
 */
export default class SimpleTasksPlugin extends Plugin {
	async onload() {
		console.log('[simple-tasks] loaded');
	}
}
