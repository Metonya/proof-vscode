/**
 * Pure: infers a Maven module binding from a discovered JaCoCo report path.
 * Never touches the filesystem or `vscode` - the caller (`ui/commands.ts`)
 * does the actual glob search; this only interprets its results.
 *
 * Why this exists (Faz 29, §7.8): `coverdict.reportPath` is resolved
 * relative to the VS Code workspace root. That is correct for a
 * single-module repo, but breaks the moment someone opens a multi-module
 * Maven checkout at its aggregator root instead of the module directory
 * that actually has a report - the aggregator pom has none of its own. The
 * gson dogfood hit exactly this. Requiring the user to find and reopen the
 * right subfolder by hand is not a fix; the extension finds it instead.
 */

const JACOCO_SUFFIX = '/target/site/jacoco/jacoco.xml';
const JACOCO_AT_ROOT = 'target/site/jacoco/jacoco.xml';

export interface DiscoveredModule {
	/**
	 * Always `'root'` - the same id `MODULE_ID` in `ui/commands.ts` hardcodes
	 * everywhere else (state keys, `--per-test-classpath`/`--mutation-classpath`
	 * bindings, tree-view lookups). Only the module's *root path* varies with
	 * discovery; a run-dependent id would desync analyze's `--module` binding
	 * from every other flow that assumes `'root'`, and nothing here needs a
	 * descriptive id - it is never shown as a label, only used as a CLI token.
	 */
	id: 'root';
	/** Repo-relative module root, forward-slash. `'.'` means the report is directly at the workspace root - no `--module` binding is needed at all in that case. */
	root: string;
	/** Repo-relative report path, forward-slash - always what gets passed to `--report`. */
	reportPath: string;
}

/**
 * `repoRelativeReportPath` must already be relative to the workspace root
 * and use forward slashes (see `toRepoRelativePosix`). Only reports found
 * at the standard Maven+JaCoCo layout (`<module>/target/site/jacoco/jacoco.xml`)
 * are attributed to a module root; anything else binds at the repo root
 * rather than guessing at an unfamiliar layout.
 */
export function describeModuleForReport(repoRelativeReportPath: string): DiscoveredModule {
	if (repoRelativeReportPath === JACOCO_AT_ROOT || !repoRelativeReportPath.endsWith(JACOCO_SUFFIX)) {
		return { id: 'root', root: '.', reportPath: repoRelativeReportPath };
	}
	const root = repoRelativeReportPath.slice(0, -JACOCO_SUFFIX.length);
	return { id: 'root', root, reportPath: repoRelativeReportPath };
}

/** Converts an absolute filesystem path to a repo-relative, forward-slash path. Platform-agnostic (D-22): never assumes `/` is already there. */
export function toRepoRelativePosix(absolutePath: string, repoRoot: string): string {
	const normalizedAbs = absolutePath.replaceAll('\\', '/');
	const normalizedRoot = repoRoot.replaceAll('\\', '/').replace(/\/$/, '');
	return normalizedAbs.startsWith(normalizedRoot + '/')
		? normalizedAbs.slice(normalizedRoot.length + 1)
		: normalizedAbs;
}

