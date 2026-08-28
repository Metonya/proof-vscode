import * as vscode from 'vscode';

import { fqcnToRootRelativePath, toAbsolutePath } from '../model/pathIndex';

/**
 * Faz 15b: resolve a test class's own source file. Prefers a `Finding`'s
 * own `path` (CLI-verified, exact - `finding.path` is only ever set for a
 * real oracle-quality issue on that test) when the caller already has one;
 * otherwise tries each declared test root and keeps the first candidate
 * that actually exists on disk. Returns `undefined` rather than guessing
 * (hard rule 3a) - a hover link that might open the wrong file is worse
 * than no link at all.
 */
export async function locateTestFile(workspaceRoot: string, testRoots: readonly string[], outerClassName: string, findingPath: string | undefined): Promise<string | undefined> {
	if (findingPath) {
		return findingPath;
	}
	for (const testRoot of testRoots) {
		const candidate = fqcnToRootRelativePath(testRoot, outerClassName);
		try {
			await vscode.workspace.fs.stat(vscode.Uri.file(toAbsolutePath(workspaceRoot, candidate)));
			return candidate;
		} catch {
			// doesn't exist under this root - try the next one, never guess
		}
	}
	return undefined;
}
