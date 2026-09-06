/**
 * Pure: infers a Maven module binding from a discovered JaCoCo report path.
 * Never touches the filesystem or `vscode` - the caller (`ui/commands.ts`)
 * does the actual glob search; this only interprets its results.
 *
 * Why this exists (Faz 29, §7.8): `proof.reportPath` is resolved
 * relative to the VS Code workspace root. That is correct for a
 * single-module repo, but breaks the moment someone opens a multi-module
 * Maven checkout at its aggregator root instead of the module directory
 * that actually has a report - the aggregator pom has none of its own. The
 * gson dogfood hit exactly this. Requiring the user to find and reopen the
 * right subfolder by hand is not a fix; the extension finds it instead.
 *
 * A second, sharper distinction was needed after the first version shipped
 * (same-day user feedback): a directory holding several *unrelated* repos
 * side by side (`coverdict-corpus`) is not the same shape as one
 * multi-module project (`gson`), even though both produce several
 * `jacoco.xml` candidates - `isProjectRoot`/`describeSiblingProjects`
 * below are what tell them apart, so unrelated repos are never offered as
 * if picking among them were a real choice.
 */

/**
 * Faz "Gradle support" G1: every known "report path ends here" convention
 * this extension can attribute to a module root, tried in order. Maven's
 * own default report goal always lands at the first path; Gradle's
 * `jacocoTestReport` task (XML off by default - see `docs/CLI-REFERENCE.md`
 * or the Gradle hint in `doctor`) lands at the second, for a plain Java
 * module using the task's own default name. Deliberately not attempting
 * Android/AGP's variant-named paths (`build/reports/coverage/test/<variant>/...`)
 * here - the variant segment makes a single fixed suffix meaningless, and a
 * wrong guess would silently bind the wrong module; `proof.reportPath` set
 * by hand is still the correct path there.
 */
const KNOWN_REPORT_SUFFIXES = [
	'/target/site/jacoco/jacoco.xml',
	'/build/reports/jacoco/test/jacocoTestReport.xml',
] as const;
const JACOCO_AT_ROOT = 'target/site/jacoco/jacoco.xml';
const GRADLE_JACOCO_AT_ROOT = 'build/reports/jacoco/test/jacocoTestReport.xml';

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
	if (repoRelativeReportPath === JACOCO_AT_ROOT || repoRelativeReportPath === GRADLE_JACOCO_AT_ROOT) {
		return { id: 'root', root: '.', reportPath: repoRelativeReportPath };
	}
	const suffix = KNOWN_REPORT_SUFFIXES.find((s) => repoRelativeReportPath.endsWith(s));
	if (!suffix) {
		return { id: 'root', root: '.', reportPath: repoRelativeReportPath };
	}
	const root = repoRelativeReportPath.slice(0, -suffix.length);
	return { id: 'root', root, reportPath: repoRelativeReportPath };
}

/**
 * Faz 30: binds every discovered report to a real, distinct module id -
 * the multi-module counterpart to `describeModuleForReport`'s single-report
 * `id: 'root'` shorthand. IDs only need to be *stable within one run* (they
 * are CLI tokens, matched back up against `--per-test-classpath`/
 * `--mutation-classpath`/`--*-target` by `ui/preflight.ts`, never shown to
 * the user as a label) - derived from the module's own directory name so a
 * log line or an Output entry naming an id is still recognizable, with a
 * numeric suffix on a real collision (two modules whose root ends in the
 * same segment) rather than silently merging them.
 */
export function bindModules(repoRelativeReportPaths: readonly string[]): readonly { id: string; root: string; reportPath: string }[] {
	const roots = repoRelativeReportPaths.map((reportPath) => describeModuleForReport(reportPath).root);
	return assignIds(roots).map((assigned, i) => ({ ...assigned, reportPath: repoRelativeReportPaths[i] }));
}

/**
 * Faz 31: a pom.xml's own repo-relative path directly names its module
 * root - unlike a jacoco.xml, no report has to exist first (real gson
 * shape: `test-jpms/pom.xml` -> root `test-jpms`, root `pom.xml` -> `.`).
 * This is what lets `ui/preflight.ts` discover real module roots *before*
 * ever offering to run tests, not just after a report is already bound.
 */
export function describeModuleForPom(repoRelativePomPath: string): { root: string } {
	const suffix = '/pom.xml';
	return { root: repoRelativePomPath === 'pom.xml' ? '.' : repoRelativePomPath.slice(0, -suffix.length) };
}

/** The pom.xml counterpart to `bindModules` - same id-assignment rule, different discovery input. */
export function discoverModuleRootsFromPoms(repoRelativePomPaths: readonly string[]): readonly { id: string; root: string }[] {
	return assignIds(repoRelativePomPaths.map((pomPath) => describeModuleForPom(pomPath).root));
}

/**
 * Matches `include` and any same-purpose wrapper function whose name starts
 * with it (`includeProject(...)`), excluding real Gradle APIs that are not
 * subprojects of this build:
 *
 * - `includeBuild` - a composite build, a separate Gradle root with its own
 *   lifecycle.
 * - `includeFlat` - a project whose directory is a *sibling* of the root
 *   (`../name`), which a repo-relative path cannot express at all.
 * - `includeGroup`/`includeModule`/`includeVersion` (and their `ByRegex` /
 *   `AndSubgroups` variants) - `RepositoryContentDescriptor` methods used
 *   inside `repositories { content { } }` to filter which artifacts a
 *   repository may serve. Google's own Now in Android settings file has
 *   `includeGroupByRegex("com\\.android.*")`, which this read as a project
 *   until it did not.
 *
 * The first two exclusions are prefix-exact (the trailing `\b` keeps a user
 * wrapper like `includeFlattenedModules(...)` matched); the content-filter
 * names are matched more broadly, since every real variant continues the
 * word.
 *
 * Deliberately identical to `GradleProjectScanner.java`'s own INCLUDE_KEYWORD
 * in the CLI: the two run on the same settings files and must agree about
 * which modules exist. Matched per line rather than over the whole text (a
 * repeated group over an unbounded string is the catastrophic-backtracking
 * shape both sides avoid).
 */
const GRADLE_INCLUDE_KEYWORD = /\binclude(?!Build\b)(?!Flat\b)(?!Group)(?!Module)(?!Version)[A-Za-z]*\b/;
const GRADLE_QUOTED_ARG = /['"]([^'"]+)['"]/g;

/**
 * Raw Gradle project paths (`:core`, `:modules:service-a`) as they are
 * literally written in a `settings.gradle(.kts)`. A wrapper function's own
 * *definition* line (`fun includeProject(name: String, ...)`) carries no
 * quoted argument, so it contributes nothing - only real call sites do.
 * Anything computed rather than written literally is invisible here, the
 * same best-effort posture the CLI's scanner documents.
 */
export function parseSettingsGradleProjectPaths(settingsText: string): readonly string[] {
	const paths: string[] = [];
	for (const line of settingsText.split('\n')) {
		if (!GRADLE_INCLUDE_KEYWORD.test(line)) {
			continue;
		}
		for (const match of line.matchAll(GRADLE_QUOTED_ARG)) {
			paths.push(match[1]);
		}
	}
	return paths;
}

/**
 * The `settings.gradle(.kts)` counterpart to `discoverModuleRootsFromPoms` -
 * same id-assignment rule, different discovery input.
 *
 * Gradle's root project is not declared by an `include(...)` at all, and
 * whether it is a real module worth running tests in is a filesystem fact
 * (does it have test sources of its own?) this pure function cannot see -
 * hence `includeRootProject`, decided by `ui/preflight.ts`. Passing it here
 * rather than prepending afterwards keeps every id coming from one
 * assignment pass, so a subproject literally named `root` still collides
 * safely into `root-2` instead of shadowing the root project.
 */
export function discoverModuleRootsFromSettingsGradle(settingsText: string, includeRootProject = false): readonly { id: string; root: string }[] {
	const roots: string[] = includeRootProject ? ['.'] : [];
	for (const gradlePath of parseSettingsGradleProjectPaths(settingsText)) {
		const root = (gradlePath.startsWith(':') ? gradlePath.slice(1) : gradlePath).replaceAll(':', '/');
		if (root.length === 0 || isEscapingRepoRoot(root) || !isPlausibleDirectoryPath(root) || roots.includes(root)) {
			continue;
		}
		roots.push(root);
	}
	return assignIds(roots);
}

/**
 * A quoted string on an `include`-ish line is not automatically a directory
 * name: a glob or regex character means the line was something else (a
 * dependency filter, a version pattern), and those characters are not even
 * legal in a Windows path. The CLI's own scanner carries the identical
 * check - there it stops an `InvalidPathException` from killing the whole
 * `doctor` run, here it stops a nonsense row appearing in the module picker.
 */
function isPlausibleDirectoryPath(candidate: string): boolean {
	return !/[*?"<>|]/.test(candidate) && ![...candidate].some((c) => c.charCodeAt(0) < 0x20);
}

/** Pure segment check, the TypeScript twin of the CLI's `RepoPaths.isEscapingRepoRoot` - an absolute path, or one that climbs above the repo root once `.`/`..` collapse, is never a module of this repo. */
function isEscapingRepoRoot(normalizedPath: string): boolean {
	if (normalizedPath.startsWith('/') || /^[A-Za-z]:/.test(normalizedPath)) {
		return true;
	}
	let depth = 0;
	for (const segment of normalizedPath.split('/')) {
		if (segment === '' || segment === '.') {
			continue;
		}
		if (segment === '..') {
			depth--;
			if (depth < 0) {
				return true;
			}
		} else {
			depth++;
		}
	}
	return false;
}

/** Shared by `bindModules`/`discoverModuleRootsFromPoms`: base id from the root's own last path segment, a numeric suffix on a real collision rather than silently merging two modules. */
function assignIds(roots: readonly string[]): readonly { id: string; root: string }[] {
	const usedIds = new Set<string>();
	return roots.map((root) => {
		const base = root === '.' ? 'root' : sanitizeModuleId(root.split('/').pop() ?? 'module');
		let id = base;
		let suffix = 2;
		while (usedIds.has(id)) {
			id = `${base}-${suffix++}`;
		}
		usedIds.add(id);
		return { id, root };
	});
}

/** picocli's `<id>=<value>` parsing splits on the first `=`; also kept free of characters that would make an Output log line or a shell-quoted arg confusing. */
function sanitizeModuleId(raw: string): string {
	const cleaned = raw.replaceAll(/[^A-Za-z0-9_.-]/g, '-');
	return cleaned.length > 0 ? cleaned : 'module';
}

/**
 * Which bound module a repo-relative path falls under - longest-root-prefix
 * wins (a nested module's own root must outrank its parent's), `root: '.'`
 * is the lowest-priority fallback since it matches everything. `undefined`
 * means the path is not under any bound module's root at all - callers
 * must not guess a target's module in that case (hard rule 3a).
 */
export function moduleForPath(repoRelativePath: string, modules: readonly { id: string; root: string }[]): string | undefined {
	let best: { id: string; prefixLength: number } | undefined;
	for (const m of modules) {
		if (m.root === '.') {
			best ??= { id: m.id, prefixLength: 0 };
			continue;
		}
		const prefix = `${m.root}/`;
		if (repoRelativePath.startsWith(prefix) && (!best || prefix.length > best.prefixLength)) {
			best = { id: m.id, prefixLength: prefix.length };
		}
	}
	return best?.id;
}

/** Converts an absolute filesystem path to a repo-relative, forward-slash path. Platform-agnostic (D-22): never assumes `/` is already there. */
export function toRepoRelativePosix(absolutePath: string, repoRoot: string): string {
	const normalizedAbs = absolutePath.replaceAll('\\', '/');
	const normalizedRoot = repoRoot.replaceAll('\\', '/').replace(/\/$/, '');
	return normalizedAbs.startsWith(normalizedRoot + '/')
		? normalizedAbs.slice(normalizedRoot.length + 1)
		: normalizedAbs;
}

/**
 * Filenames whose presence at a directory means "this directory is itself
 * one Maven/Gradle project" (single- or multi-module - a reactor's own
 * submodules are still part of the *same* project). The caller checks
 * these against the real filesystem; this file only names them, so both
 * the workspace-root check and the sibling-project check below agree on
 * one definition.
 */
export const PROJECT_ROOT_MARKER_FILES = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'] as const;

/**
 * The real bug the first version of this discovery had (caught by the
 * user, 2026-08-29): globbing for `**\/target/site/jacoco/jacoco.xml`
 * across the *whole* workspace conflates two completely different shapes -
 * "this folder is one multi-module project, pick which module" (gson: a
 * real root `pom.xml` declaring `<modules>gson, test-jpms, ...</modules>`,
 * where every candidate genuinely belongs together) and "this folder just
 * happens to contain several unrelated repos side by side"
 * (`coverdict-corpus`: no pom.xml/build.gradle of its own at all - `gson`,
 * `dropwizard`, `assertj` are independent checkouts that only share a
 * parent directory). Presenting both shapes as one flat "pick a jacoco.xml"
 * list is exactly the "saçma" the user called out - there is no principled
 * way to choose among unrelated repos, and pretending there is violates
 * hard rule 3a.
 *
 * `presentMarkers` is whatever subset of `PROJECT_ROOT_MARKER_FILES` the
 * caller found at a given directory (a plain existence check, done in
 * `ui/commands.ts` since this file never touches the filesystem).
 */
export function isProjectRoot(presentMarkers: readonly string[]): boolean {
	return PROJECT_ROOT_MARKER_FILES.some((marker) => presentMarkers.includes(marker));
}

/**
 * The message shown when the workspace root is not itself a project (per
 * `isProjectRoot`) and one or more of its immediate children are. Lists the
 * candidates by name only - it never picks one, because there is no honest
 * way to prefer one independent repo over another.
 */
export function describeSiblingProjects(projectDirNames: readonly string[]): string {
	return `Proof: this folder is not itself a single project - found ${projectDirNames.length} different project(s) inside it: ${projectDirNames.join(', ')}. Open the project you want to analyze as a separate workspace root in VS Code (File > Open Folder).`;
}

