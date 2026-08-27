import * as path from 'node:path';

/**
 * Repo-relative <-> absolute filesystem path, plain strings only - `model/`
 * never imports `vscode` (Plan.md Bölüm 2's first invariant); `ui/`
 * wraps the result in `vscode.Uri.file(...)` at the boundary. coverdict's
 * own paths are always forward-slash and repo-relative (D-22), so this is
 * the one place that path math happens at all.
 */

export function toAbsolutePath(workspaceRoot: string, repoRelativePath: string): string {
	return path.join(workspaceRoot, ...repoRelativePath.split('/'));
}

export function toRepoRelativePath(workspaceRoot: string, absolutePath: string): string | undefined {
	const relative = path.relative(workspaceRoot, absolutePath);
	if (relative.startsWith('..') || path.isAbsolute(relative)) {
		return undefined; // outside the workspace root
	}
	return relative.split(path.sep).join('/');
}
