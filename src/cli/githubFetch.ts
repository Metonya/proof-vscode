import * as https from 'node:https';

/**
 * Faz 34: shared by `skillFetcher.ts` and `jarDownloader.ts` - both hit
 * `api.github.com`/`objects.githubusercontent.com`/`github.com` release
 * asset redirects, both need the same User-Agent requirement and manual
 * redirect handling. Pure - no `vscode` import.
 */
const USER_AGENT = 'proof-vscode';

export function httpsGetBuffer(url: string, redirectsLeft = 5): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
			const status = res.statusCode ?? 0;
			if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
				res.resume();
				resolve(httpsGetBuffer(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
				return;
			}
			if (status !== 200) {
				res.resume();
				reject(new Error(`HTTP ${status} for ${url}`));
				return;
			}
			const chunks: Buffer[] = [];
			res.on('data', (chunk: Buffer) => chunks.push(chunk));
			res.on('end', () => resolve(Buffer.concat(chunks)));
			res.on('error', reject);
		}).on('error', reject);
	});
}

export async function httpsGetText(url: string): Promise<string> {
	return (await httpsGetBuffer(url)).toString('utf8');
}
