import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchSkillFiles } from '../../../cli/skillFetcher';

/** Real shape from the GitHub Trees API (`recursive=1`), trimmed to what `fetchSkillFiles` actually reads. */
function fakeTreeResponse(paths: readonly string[]): string {
	return JSON.stringify({
		sha: 'abc123',
		tree: [
			{ path: 'README.md', type: 'blob' },
			{ path: 'skills', type: 'tree' },
			{ path: 'skills/proof-java', type: 'tree' },
			...paths.map((path) => ({ path, type: 'blob' })),
		],
	});
}

test('fetchSkillFiles: filters the tree to skills/proof-java/** blobs and strips the prefix', async () => {
	const paths = ['skills/proof-java/SKILL.md', 'skills/proof-java/reference/rules.md', 'skills/proof-java/reference/invocations.md'];
	const fetchedUrls: string[] = [];
	const files = await fetchSkillFiles(
		async () => fakeTreeResponse(paths),
		async (url) => {
			fetchedUrls.push(url);
			return Buffer.from(`content of ${url}`, 'utf8');
		},
	);
	assert.deepEqual(
		files.map((f) => f.relativePath).sort(),
		['SKILL.md', 'reference/invocations.md', 'reference/rules.md'],
	);
	assert.ok(fetchedUrls.every((u) => u.startsWith('https://raw.githubusercontent.com/Metonya/proof-java/main/skills/proof-java/')), 'must fetch raw content from the exact tree paths, not guessed URLs');
});

test('fetchSkillFiles: a tree with no skills/proof-java/** entries throws rather than silently installing nothing', async () => {
	await assert.rejects(
		fetchSkillFiles(async () => fakeTreeResponse([]), async () => Buffer.from('')),
		/no files found/,
	);
});

test('fetchSkillFiles: non-blob entries (directories) under skills/proof-java are excluded, not fetched as files', async () => {
	const raw = JSON.stringify({
		tree: [
			{ path: 'skills/proof-java/reference', type: 'tree' },
			{ path: 'skills/proof-java/SKILL.md', type: 'blob' },
		],
	});
	const fetchedUrls: string[] = [];
	const files = await fetchSkillFiles(
		async () => raw,
		async (url) => {
			fetchedUrls.push(url);
			return Buffer.from('x');
		},
	);
	assert.equal(files.length, 1);
	assert.equal(files[0].relativePath, 'SKILL.md');
});

test('fetchSkillFiles: malformed JSON from the tree endpoint is a clear error, not a thrown parse exception leaking upward unexplained', async () => {
	await assert.rejects(
		fetchSkillFiles(async () => 'not json', async () => Buffer.from('')),
		/valid JSON/,
	);
});

test('fetchSkillFiles: a response with no "tree" array is rejected with a clear error', async () => {
	await assert.rejects(
		fetchSkillFiles(async () => JSON.stringify({ sha: 'abc' }), async () => Buffer.from('')),
		/unexpected response shape/,
	);
});
