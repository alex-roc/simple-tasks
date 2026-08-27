import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

/**
 * Re-tags the version commit without the `v`, right after `pnpm version` made it.
 *
 * The catalog matches a release to `manifest.json` by an exact tag, so the tag
 * has to read `0.4.4` and not `v0.4.4`. `.npmrc` says `tag-version-prefix=""`
 * for exactly that — and **pnpm does not read it**: it is an npm option, so
 * `pnpm version` cheerfully writes `v0.4.4` anyway. That mismatch was caught by
 * hand on three consecutive releases before it became this file.
 *
 * Runs from the `postversion` hook, when the commit and the wrong tag both
 * exist. It moves the tag; it does not push. Pushing stays a decision.
 */

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const wrong = `v${version}`;

const tags = git('tag', '--list').split('\n');
if (!tags.includes(wrong)) {
	// Either npm honoured the prefix or somebody tagged by hand. Nothing to fix.
	console.log(`Tag ${version} left as it is.`);
	process.exit(0);
}

git('tag', '-d', wrong);
git('tag', '-a', version, '-m', version);
console.log(`Tag ${wrong} → ${version}`);
