import { readFileSync, writeFileSync } from 'fs';

const targetVersion = process.env.npm_package_version;

// read minAppVersion from manifest.json and bump version to target version
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
// The trailing newline is not decoration: without it every release leaves two
// files with no final newline, and every editor that adds one back makes a diff.
writeFileSync('manifest.json', `${JSON.stringify(manifest, null, '\t')}\n`);

// update versions.json with target version and minAppVersion from manifest.json
// but only if the target version is not already in versions.json
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
if (!(targetVersion in versions)) {
	versions[targetVersion] = minAppVersion;
	writeFileSync('versions.json', `${JSON.stringify(versions, null, '\t')}\n`);
}
