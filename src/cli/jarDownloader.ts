import * as crypto from 'node:crypto';

import { httpsGetBuffer, httpsGetText } from './githubFetch';

/**
 * Faz 34 (user request): "give me something that makes downloading the jar
 * convenient, like the skill". Downloads `proof-java.jar` from proof-java's
 * latest GitHub Release - `release.yml` (that repo's own CI) already
 * publishes it alongside a `SHA-256SUMS` file every tag, so this verifies
 * the download against that checksum rather than trusting the bytes GitHub
 * happened to serve. Pure - no `vscode` import, unit-tested with fake
 * fetchText/fetchBuffer.
 */

const JAR_REPO = 'Metonya/proof-java';
const JAR_ASSET_NAME = 'proof-java.jar';
const CHECKSUMS_ASSET_NAME = 'SHA-256SUMS';

export interface JarDownloadResult {
	content: Buffer;
	version: string;
}

interface ReleaseAsset {
	name: string;
	browser_download_url: string;
}

export async function downloadLatestJar(fetchText = httpsGetText, fetchBuffer = httpsGetBuffer): Promise<JarDownloadResult> {
	const raw = await fetchText(`https://api.github.com/repos/${JAR_REPO}/releases/latest`);
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (e) {
		throw new Error(`GitHub's release response wasn't valid JSON: ${(e as Error).message}`);
	}
	if (!isRecord(json) || typeof json.tag_name !== 'string' || !Array.isArray(json.assets)) {
		throw new Error('unexpected response shape from the GitHub API (no tag_name/assets)');
	}
	const assets = json.assets.filter((a): a is ReleaseAsset => isRecord(a) && typeof a.name === 'string' && typeof a.browser_download_url === 'string');

	const jarAsset = assets.find((a) => a.name === JAR_ASSET_NAME);
	if (!jarAsset) {
		throw new Error(`the latest release (${json.tag_name}) has no "${JAR_ASSET_NAME}" asset`);
	}
	const content = await fetchBuffer(jarAsset.browser_download_url);

	const checksumsAsset = assets.find((a) => a.name === CHECKSUMS_ASSET_NAME);
	if (checksumsAsset) {
		const expected = parseSha256Sums(await fetchText(checksumsAsset.browser_download_url), JAR_ASSET_NAME);
		if (expected) {
			const actual = crypto.createHash('sha256').update(content).digest('hex');
			if (actual !== expected) {
				throw new Error(`downloaded "${JAR_ASSET_NAME}" does not match its published SHA-256 checksum (expected ${expected}, got ${actual}) - the download may be corrupted or tampered with`);
			}
		}
		// No entry for the jar in SHA-256SUMS: still install it (hard rule
		// 3a would say "don't guess a checksum", not "refuse a legitimate
		// asset because a side-file's format changed") - just nothing to
		// verify against.
	}

	return { content, version: json.tag_name };
}

/**
 * `SHA-256SUMS` format (coreutils `sha256sum` output): `<hex digest> *<filename>`
 * in binary mode, `<hex digest>  <filename>` in text mode, one per line.
 *
 * The filename group requires a leading non-space on purpose (SonarQube
 * typescript:S5852). `(.+)\s*$` after `\s+` is an ambiguous pattern - `.`
 * matches whitespace too, so the engine has many ways to split the same run
 * of spaces between the three parts, which is the shape that turns
 * super-linear. Anchoring the group to a real filename character leaves
 * exactly one way to match, and the trailing `\s*` was dead weight anyway
 * since every line is trimmed before it gets here.
 */
function parseSha256Sums(raw: string, fileName: string): string | undefined {
	for (const line of raw.split('\n')) {
		const match = /^([0-9a-f]{64})\s+\*?(\S.*)$/.exec(line.trim());
		if (match?.[2] === fileName) {
			return match[1];
		}
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
