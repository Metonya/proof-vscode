import * as vscode from 'vscode';

/**
 * Shared by `skillInstaller.ts` and `jarDownloaderUi.ts`: both run a plain
 * `cli/**` fetch (no `vscode` import, so no way to accept a cancellation
 * token itself) under a cancellable progress notification. Racing the fetch
 * against the token lets the user dismiss the notification immediately
 * instead of waiting out `githubFetch.ts`'s own idle timeout - that timeout
 * still runs in the background and cleans up the socket either way.
 */
export const CANCELLED: unique symbol = Symbol('proof-java: user cancelled the download');

export function raceAgainstCancellation<T>(promise: Promise<T>, token: vscode.CancellationToken): Promise<T> {
	if (token.isCancellationRequested) {
		return Promise.reject(CANCELLED);
	}
	return new Promise<T>((resolve, reject) => {
		const sub = token.onCancellationRequested(() => reject(CANCELLED));
		promise.then(
			(value) => { sub.dispose(); resolve(value); },
			(err) => { sub.dispose(); reject(err); },
		);
	});
}
