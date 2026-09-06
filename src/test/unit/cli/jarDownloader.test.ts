import * as assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { test } from 'node:test';

import { downloadLatestJar } from '../../../cli/jarDownloader';

/** Real shape from `GET /repos/Metonya/proof-java/releases/latest`, trimmed to what `downloadLatestJar` actually reads. */
function fakeReleaseResponse(assetNames: readonly string[]): string {
	return JSON.stringify({
		tag_name: 'v0.1.0',
		assets: assetNames.map((name) => ({ name, browser_download_url: `https://github.com/Metonya/proof-java/releases/download/v0.1.0/${name}` })),
	});
}

test('downloadLatestJar: fetches the jar asset and returns its content plus the release tag', async () => {
	const jarBytes = Buffer.from('fake jar bytes');
	const fetched: string[] = [];
	const result = await downloadLatestJar(
		async () => fakeReleaseResponse(['proof-java.jar']),
		async (url) => {
			fetched.push(url);
			return jarBytes;
		},
	);
	assert.equal(result.version, 'v0.1.0');
	assert.deepEqual(result.content, jarBytes);
	assert.deepEqual(fetched, ['https://github.com/Metonya/proof-java/releases/download/v0.1.0/proof-java.jar']);
});

test('downloadLatestJar: verifies the download against a real SHA-256SUMS asset when present', async () => {
	const jarBytes = Buffer.from('fake jar bytes');
	const digest = crypto.createHash('sha256').update(jarBytes).digest('hex');
	const sums = `${digest} *proof-java.jar\nabc123 *NOTICE\n`;

	const result = await downloadLatestJar(
		async (url) => (url.includes('SHA-256SUMS') ? sums : fakeReleaseResponse(['proof-java.jar', 'SHA-256SUMS'])),
		async () => jarBytes,
	);
	assert.deepEqual(result.content, jarBytes);
});

test('downloadLatestJar: a checksum mismatch is a hard failure, not a silent install', async () => {
	const jarBytes = Buffer.from('fake jar bytes');
	const sums = `${'deadbeef'.repeat(8)} *proof-java.jar\n`;

	await assert.rejects(
		downloadLatestJar(
			async (url) => (url.includes('SHA-256SUMS') ? sums : fakeReleaseResponse(['proof-java.jar', 'SHA-256SUMS'])),
			async () => jarBytes,
		),
		/does not match its published SHA-256 checksum/,
	);
});

test('downloadLatestJar: no SHA-256SUMS asset at all - installs the jar anyway, nothing to verify against', async () => {
	const jarBytes = Buffer.from('fake jar bytes');
	const result = await downloadLatestJar(
		async () => fakeReleaseResponse(['proof-java.jar']),
		async () => jarBytes,
	);
	assert.deepEqual(result.content, jarBytes);
});

test('downloadLatestJar: a release with no proof-java.jar asset is a clear error', async () => {
	await assert.rejects(
		downloadLatestJar(async () => fakeReleaseResponse(['LICENSE', 'NOTICE']), async () => Buffer.from('')),
		/has no "proof-java\.jar" asset/,
	);
});

test('downloadLatestJar: malformed JSON from the release endpoint is a clear error', async () => {
	await assert.rejects(
		downloadLatestJar(async () => 'not json', async () => Buffer.from('')),
		/valid JSON/,
	);
});

test('downloadLatestJar: a response missing tag_name/assets is rejected with a clear error', async () => {
	await assert.rejects(
		downloadLatestJar(async () => JSON.stringify({ id: 1 }), async () => Buffer.from('')),
		/unexpected response shape/,
	);
});
