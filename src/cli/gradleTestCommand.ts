/**
 * Pure: turns an optional module scope into the Gradle task paths "Run
 * Tests" should ask for. The Gradle sibling of `mavenTestCommand.ts`, and
 * the same reason for existing separately from `ui/gradleTestTask.ts`: the
 * argv is the part worth unit-testing, the terminal plumbing is not.
 *
 * Two things differ from Maven and are easy to get wrong:
 *
 * - **Every task path is project-qualified, the root one included.** An
 *   unqualified `test` matches that task in the current project *and every
 *   subproject*, so `[':test']` (root only) and `['test']` (everything) are
 *   genuinely different commands. The same distinction bit the CLI's own
 *   `GradleClasspathFixer.taskPathFor`, where the unqualified form silently
 *   produced another module's classpath.
 * - **There is no `-am` analogue, and none is needed.** Gradle already
 *   builds whatever the requested tasks depend on, project dependencies
 *   included; Maven's `-pl ... -am` exists because its reactor does not.
 */

export interface GradleTestCommandInput {
	/**
	 * Repo-relative module roots (`.`, `core`, `modules/service-a`), or
	 * `undefined`/empty for an unscoped run. Unscoped keeps the historical
	 * `['test', 'jacocoTestReport']` argv exactly - the shape already
	 * verified end to end against a real single-module Gradle project.
	 */
	moduleRoots?: readonly string[];
}

const TEST_TASK = 'test';
const JACOCO_REPORT_TASK = 'jacocoTestReport';

/**
 * `cli/runner.ts` spawns the wrapper with `shell: true` (Windows `.bat`
 * launchers cannot be spawned directly since Node's CVE-2024-27980 fix) and
 * Gradle takes one task path per argument, so a module root is shell text.
 * `include("my module")` is legal Gradle, so this is a real input, not a
 * hypothetical: rather than quote per-platform, an unrepresentable root
 * drops scoping entirely (see `buildGradleTestArgs`) - a slower correct run
 * beats a mangled one.
 */
const SHELL_SAFE_MODULE_ROOT = /^[A-Za-z0-9_.\-/]+$/;

export function isShellSafeModuleRoot(moduleRoot: string): boolean {
	return SHELL_SAFE_MODULE_ROOT.test(moduleRoot);
}

/** `.` -> `:test`; `core` -> `:core:test`; `modules/service-a` -> `:modules:service-a:test`. */
function taskPathFor(moduleRoot: string, taskName: string): string {
	if (moduleRoot === '.' || moduleRoot === '') {
		return `:${taskName}`;
	}
	return `:${moduleRoot.replaceAll('/', ':')}:${taskName}`;
}

/**
 * @returns the argv for `gradlew`. Scoping is dropped (an unscoped, whole-
 * build run) when any root is not shell-safe - callers that can show UI
 * should say so with `unsafeModuleRoots` first.
 */
export function buildGradleTestArgs(input: GradleTestCommandInput): string[] {
	const roots = input.moduleRoots ?? [];
	if (roots.length === 0 || roots.some((root) => !isShellSafeModuleRoot(root))) {
		return [TEST_TASK, JACOCO_REPORT_TASK];
	}
	return roots.flatMap((root) => [taskPathFor(root, TEST_TASK), taskPathFor(root, JACOCO_REPORT_TASK)]);
}

/** The roots `buildGradleTestArgs` would refuse to scope to - so a caller can name them in a warning instead of silently running the whole build. */
export function unsafeModuleRoots(moduleRoots?: readonly string[]): readonly string[] {
	return (moduleRoots ?? []).filter((root) => !isShellSafeModuleRoot(root));
}
