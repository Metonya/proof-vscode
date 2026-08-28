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

/**
 * Faz 15b: an outer FQCN (nested-class suffix already stripped by the
 * caller) to a repo-relative `.java` path under one `sourceRoot`/`testRoot` -
 * mirrors coverdict-cli's `ChangedClassTargets.forEachMappedFile` exactly
 * (dot-to-slash, `.java` suffix). Used to locate a test's own source file
 * when no `Finding` already carries its path (a test with no coverdict
 * finding at all) - the caller tries each declared root and keeps the
 * first one that exists on disk (`ui/testFileLocator.ts`, since existence
 * checks need `vscode.workspace.fs`, not this pure module).
 */
export function fqcnToRootRelativePath(root: string, fqcn: string): string {
	const prefix = root.endsWith('/') ? root : `${root}/`;
	return `${prefix}${fqcn.replaceAll('.', '/')}.java`;
}

/**
 * The reverse of {@link fqcnToRootRelativePath}: a repo-relative `.java`
 * path to its FQCN, given the module's `sourceRoots`. Used to build a
 * `className -> path` index straight from `fileCoverage.files[]` (a
 * complete, already-filtered listing of production files) so a test's
 * hover can jump to the exact production file it covers without a
 * filesystem probe.
 */
export function classNameFromPath(repoRelativePath: string, sourceRoots: readonly string[]): string | undefined {
	if (!repoRelativePath.endsWith('.java')) {
		return undefined;
	}
	for (const sourceRoot of sourceRoots) {
		const prefix = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`;
		if (repoRelativePath.startsWith(prefix)) {
			return repoRelativePath.slice(prefix.length, -'.java'.length).replaceAll('/', '.');
		}
	}
	return undefined;
}
