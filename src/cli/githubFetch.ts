import * as https from 'node:https';

/**
 * Faz 34: shared by `skillFetcher.ts` and `jarDownloader.ts` - both hit
 * `api.github.com`/`objects.githubusercontent.com`/`github.com` release
 * asset redirects, both need the same User-Agent requirement and manual
 * redirect handling. Pure - no `vscode` import.
 */
const USER_AGENT = 'proof-vscode';

/**
 * A corporate proxy/firewall that silently drops a connection (rather than
 * refusing it) leaves Node's `http`/`https` request with no socket activity
 * at all - no `error`, no `data`, no `end` ever fires, so without this the
 * returned promise (and any `vscode.window.withProgress` awaiting it) hangs
 * forever with no way to dismiss it. `setTimeout` on a `ClientRequest` is an
 * *idle* timeout, reset by any socket activity, not a total-request-time
 * cap, so it does not cut off a large, slow-but-progressing jar download.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

export function httpsGetBuffer(url: string, redirectsLeft = 5, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
			const status = res.statusCode ?? 0;
			if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
				res.resume();
				resolve(httpsGetBuffer(new URL(res.headers.location, url).toString(), redirectsLeft - 1, timeoutMs));
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
		});
		req.on('error', reject);
		req.setTimeout(timeoutMs, () => {
			req.destroy(new Error(`timed out after ${timeoutMs}ms contacting ${url} - check your network/proxy connection`));
		});
	});
}

export async function httpsGetText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
	return (await httpsGetBuffer(url, 5, timeoutMs)).toString('utf8');
}
