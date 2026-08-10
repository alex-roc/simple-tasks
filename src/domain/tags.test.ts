import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addTag, hasTag, normalizeTag, removeTag } from './tags.ts';

describe('normalizeTag', () => {
	it('accepts a tag with or without the hash', () => {
		assert.equal(normalizeTag('lab'), '#lab');
		assert.equal(normalizeTag('#lab'), '#lab');
		assert.equal(normalizeTag('  ##lab '), '#lab');
		assert.equal(normalizeTag('  '), '');
	});
});

describe('hasTag', () => {
	it('does not confuse a tag with a nested child of it', () => {
		assert.equal(hasTag('Revisar #lab', '#lab'), true);
		assert.equal(hasTag('Revisar #lab/infra', '#lab'), false);
		assert.equal(hasTag('Revisar #lab/infra', '#lab/infra'), true);
		assert.equal(hasTag('Revisar #laboratorio', '#lab'), false);
	});
});

describe('addTag', () => {
	it('appends at the end of the body', () => {
		assert.equal(addTag('Revisar el informe', 'lab'), 'Revisar el informe #lab');
	});

	it('is idempotent', () => {
		assert.equal(addTag('Revisar #lab', '#lab'), 'Revisar #lab');
	});

	it('handles an empty body', () => {
		assert.equal(addTag('', 'lab'), '#lab');
	});
});

describe('removeTag', () => {
	it('keeps the surrounding words readable', () => {
		assert.equal(removeTag('Revisar #lab hoy', '#lab'), 'Revisar hoy');
		assert.equal(removeTag('Revisar el informe #lab', '#lab'), 'Revisar el informe');
		assert.equal(removeTag('#lab al principio', '#lab'), 'al principio');
	});

	it('leaves nested children alone', () => {
		assert.equal(removeTag('Revisar #lab #lab/infra', '#lab'), 'Revisar #lab/infra');
	});

	it('removes every occurrence', () => {
		assert.equal(removeTag('#lab uno #lab dos', 'lab'), 'uno dos');
	});

	it('is a no-op for a tag that is not there', () => {
		assert.equal(removeTag('Revisar el informe', '#dev'), 'Revisar el informe');
	});
});
