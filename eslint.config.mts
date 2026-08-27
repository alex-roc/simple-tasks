import obsidianmd from 'eslint-plugin-obsidianmd';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

/** Names that are capitalized because they are names, not because of style. */
const BRANDS = [
	'Obsidian',
	'Simple Tasks',
	'Periodic Calendar',
	'Style Settings',
	'Bases',
	// Not brands but the same problem: tokens a CLI user types verbatim, which the
	// sentence-case rule reads as miscapitalized words. `format=json` is an
	// argument, not prose, and rewriting it would document the wrong flag.
	'json',
	'text',
	'YYYY-MM-DD',
];

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		// Node-side dev tooling, not plugin code: outside the TS project.
		'scripts/**',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	// `recommendedWithLocalesEn` instead of `recommended`: it adds the sentence-case
	// checks for locale modules, which is where every visible string now lives
	// (`src/i18n/en.ts`). With plain `recommended` the extraction would have quietly
	// removed the whole UI from the linter's reach.
	...obsidianmd.configs.recommendedWithLocalesEn,
	// The type-aware half of what community.obsidian.md runs, which the obsidianmd
	// config does not bring along with `recommendedWithLocalesEn`. Without it the
	// repo linted clean while the directory's scan reported a hundred and thirty
	// `no-unsafe-*` warnings on the plugin's public scorecard — every one of them
	// from `moment` being untyped here, which is the sort of thing a linter is for.
	// The floating-promise exemption for tests below must stay *after* this.
	...tseslint.configs.recommendedTypeChecked,
	{
		// Proper nouns the sentence-case rules must leave alone. They have to be
		// declared twice: the inline check and the locale-module check take their
		// own options, and a brand missing from either one is flagged there.
		rules: {
			'obsidianmd/ui/sentence-case': ['warn', { brands: BRANDS }],
			'obsidianmd/ui/sentence-case-locale-module': ['warn', { brands: BRANDS }],
		},
	},
	{
		// `getSettingDefinitions()` needs Obsidian 1.13.0 and renders nothing before
		// it. `minAppVersion` here is 1.10.0, so `display()` is the only settings API
		// that works across the supported range. Revisit when minAppVersion moves.
		rules: {
			'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
		},
	},
	{
		// Unit tests run under `node --test` and are never bundled into main.js, so
		// the mobile and floating-promise rules do not apply to them.
		files: ['src/**/*.test.ts'],
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'@typescript-eslint/no-floating-promises': 'off',
		},
	},
);
