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

/**
 * Faz 21: bir dosya test kaynağı mı, production kaynağı mı - CLI'ın kendi
 * `inputs.modules[].testRoots`/`sourceRoots` beyanına göre.
 *
 * Neden gerekli: PIT tabanlı L2 toplayıcısı test sınıflarını da
 * `perTest.entries`'e yazıyor (gerçek playground koşusunda doğrulandı,
 * 2026-08-28: 10 test sınıfının onunu da kendi satırlarını "kapsıyor"
 * olarak listeliyor). Bu yüzden "bu sınıfın satır kaydı var mı" sorusu
 * yön seçmek için kullanılamaz - bir test dosyası için de `found` döner
 * ve `ui/treeViews/lineTestsView.ts` production yönüne kilitlenirdi.
 * Yön kararı artık yol tabanlı.
 *
 * `'unknown'` gerçek bir cevaptır, "production" için kibar bir yedek
 * değil (hard rule 3a): modül beyanı yoksa ya da dosya hiçbir beyan
 * edilmiş kökün altında değilse çağıran bunu bilerek ele almalıdır.
 */
export type SourceKind = 'test' | 'production' | 'unknown';

export function classifySourcePath(
	repoRelativePath: string,
	modules: readonly { sourceRoots: readonly string[]; testRoots: readonly string[] }[],
): SourceKind {
	// testRoots önce bakılır: bir kök diğerinin alt dizini olarak
	// beyan edilmişse (örn. sourceRoot `src`, testRoot `src/test/java`)
	// daha özel olan kazanmalı.
	for (const module of modules) {
		if (module.testRoots.some((root) => isUnderRoot(repoRelativePath, root))) {
			return 'test';
		}
	}
	for (const module of modules) {
		if (module.sourceRoots.some((root) => isUnderRoot(repoRelativePath, root))) {
			return 'production';
		}
	}
	return 'unknown';
}

function isUnderRoot(repoRelativePath: string, root: string): boolean {
	const prefix = root.endsWith('/') ? root : `${root}/`;
	return repoRelativePath.startsWith(prefix);
}
