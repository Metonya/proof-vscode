import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import type { ModuleReportBinding } from '../cli/argsBuilder';
import { type DoctorResult, runDoctor } from '../cli/doctorRunner';
import { interpretMavenFailure } from '../cli/mavenErrorInterpreter';
import { parseDoctorProgressLine } from '../cli/progressParser';
import { bindModules, describeSiblingProjects, discoverModuleRootsFromPoms, isProjectRoot, moduleForPath, PROJECT_ROOT_MARKER_FILES, toRepoRelativePosix } from '../cli/reportDiscovery';
import { runMavenInstallTask, runTestsTask } from './mavenTestTask';
import { resolveWorkspaceEnv } from './workspaceEnv';

/**
 * Faz 30 (§7.8 follow-ups, gson dogfood): everything the extension needs
 * to work out *before* it can run `analyze` at all - which module(s) to
 * bind, and (for L2/L3) whether their classpath lists exist. Replaces
 * `resolveReportBinding`/`ensurePerTestClasspath`, which resolved only a
 * single module and generated classpath via a broken hand-rolled Maven
 * invocation (`cli/classpathBuilder.ts`, deleted this same commit) instead
 * of delegating to the CLI's own `doctor` subcommand.
 */

export interface ReportBinding {
	/** Set only for the true bare single-module fast path (the configured/default report exists exactly where expected) - argv-identical to pre-Faz-29 behavior, no doctor process, no glob. */
	reportPath?: string;
	/** Faz 30: one or more real modules, bound via repeated --module/--report. Always used for anything discovered rather than configured directly. */
	modules?: readonly ModuleReportBinding[];
	/** Every bound module's id+root, regardless of which field above is set - callers resolving a target file's module (`moduleForPath`) use this. */
	allModules: readonly { id: string; root: string }[];
}

/** Impure: a plain existence check against `PROJECT_ROOT_MARKER_FILES` (the pure definition lives in `reportDiscovery.ts` so both this check and its test share one list). */
function projectMarkersPresentAt(dir: string): boolean {
	return PROJECT_ROOT_MARKER_FILES.some((marker) => fs.existsSync(path.join(dir, marker)));
}

/** A directory "looks like a project" for sibling-detection purposes if it has a build-system marker of its own, or is simply a separate git checkout (a repo that has not been built with proof-java's supported build tools yet is still a real, distinct project - listing it by name costs nothing and is more honest than silently skipping it). */
function looksLikeASeparateProject(dir: string): boolean {
	return projectMarkersPresentAt(dir) || fs.existsSync(path.join(dir, '.git'));
}

/** The workspace root has no build-system marker of its own - list whatever independent projects sit one level down, by name, and never pick one (hard rule 3a). */
function reportNotAProjectRoot(folder: vscode.WorkspaceFolder, configuredReportPath: string): void {
	let siblingEntries: fs.Dirent[];
	try {
		siblingEntries = fs.readdirSync(folder.uri.fsPath, { withFileTypes: true });
	} catch {
		siblingEntries = [];
	}
	const siblingProjects = siblingEntries
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
		.map((entry) => entry.name)
		.filter((name) => looksLikeASeparateProject(path.join(folder.uri.fsPath, name)))
		.sort((a, b) => a.localeCompare(b));
	if (siblingProjects.length > 0) {
		vscode.window.showErrorMessage(describeSiblingProjects(siblingProjects));
		return;
	}
	void offerToOpenSetting(`Proof: report file not found: ${configuredReportPath}. Run the tests with JaCoCo first, or fix the proof.reportPath setting.`, 'proof.reportPath');
}

interface RunTestsModuleQuickPickItem extends vscode.QuickPickItem {
	moduleRoot: string;
}

/** A real, checkable fact (not a relevance guess) shown next to a module in the picker - `undefined` when the module has an ordinary `src/main/java`. */
function describeMissingMainSource(workspaceRoot: string, moduleRoot: string): string | undefined {
	const dir = moduleRoot === '.' ? workspaceRoot : path.join(workspaceRoot, moduleRoot);
	return fs.existsSync(path.join(dir, 'src/main/java')) ? undefined : 'no src/main/java';
}

/**
 * Faz 31: the real, general fix behind the gson `test-jpms` failure (JPMS
 * `module-info.java` can never resolve a sibling module before `package`)
 * - a first-ever "run tests" click had no way to know which module(s) the
 * user actually cares about, so it always ran the whole reactor, including
 * sibling modules proof-java never needed and that can have their own
 * unrelated toolchain requirements (JPMS/native-image/ProGuard/...).
 *
 * Module discovery here is a blind `pom.xml` glob (every `pom.xml` under
 * the workspace root), deliberately mirroring `resolveReportBinding`'s own
 * jacoco.xml glob rather than
 * calling `doctor` - `doctor` would give real module ids for free, but its
 * only output is prose (no `--json`), and this codebase's own rule
 * (`cli/progressParser.ts`) is that doctor's prose is never parsed for
 * control flow. `-pl` accepts a relative directory path, not just an
 * artifactId (verified this session), so the glob's raw roots are enough.
 *
 * `undefined` return means "don't run at all" - the user dismissed the
 * picker (Escape, or unchecked every module), a real decline distinct
 * from "run everything" (empty `moduleRoots` inside a defined result).
 */
export async function resolveRunTestsModuleScope(folder: vscode.WorkspaceFolder): Promise<{ moduleRoots: readonly string[] | undefined } | undefined> {
	const pomUris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/pom.xml'), '**/node_modules/**', 50);
	if (pomUris.length <= 1) {
		return { moduleRoots: undefined };
	}
	const modules = discoverModuleRootsFromPoms(pomUris.map((uri) => toRepoRelativePosix(uri.fsPath, folder.uri.fsPath)));

	// A real, non-guessed signal: the file the user is actually looking at,
	// mapped to its containing module via the same longest-prefix logic
	// `--*-target` resolution already uses. Silent, no prompt - this is not
	// picking among options, it is reading a fact already in front of the user.
	const activeDocument = vscode.window.activeTextEditor?.document;
	if (activeDocument?.languageId === 'java') {
		const relative = toRepoRelativePosix(activeDocument.fileName, folder.uri.fsPath);
		const matchedId = moduleForPath(relative, modules);
		const matched = modules.find((m) => m.id === matchedId);
		if (matched && matched.root !== '.') {
			return { moduleRoots: [matched.root] };
		}
	}

	// No usable active-file signal - ask, defaulting to everything checked
	// (today's whole-reactor behavior, unchanged if the user just confirms).
	// This is not the QuickPick pattern the user rejected earlier (that one
	// picked *which report to trust* among reports that all equally
	// belonged to the same run); this is *which modules to actually build*,
	// a real action decision where different modules can have genuinely
	// conflicting toolchain requirements.
	const items: RunTestsModuleQuickPickItem[] = modules.map((m) => ({
		label: m.root === '.' ? '. (workspace root)' : m.root,
		picked: true,
		description: describeMissingMainSource(folder.uri.fsPath, m.root),
		moduleRoot: m.root,
	}));
	const picked = await vscode.window.showQuickPick(items, {
		canPickMany: true,
		title: 'Proof: which module(s) should the tests run in?',
		placeHolder: `${modules.length} module(s) found - all selected by default, uncheck any you don't need`,
	});
	if (!picked || picked.length === 0) {
		return undefined;
	}
	return { moduleRoots: picked.length === modules.length ? undefined : picked.map((p) => p.moduleRoot) };
}

/**
 * Faz 30 (§7.8): the user's explicit ask - offer to run the tests
 * ourselves rather than just naming the missing file. Returns whether the
 * task ran and succeeded (`true` = caller should re-discover); a decline,
 * a failed Maven run, or a declined argLine modal all return `false` and
 * have already shown their own message.
 */
async function offerToRunTestsNow(folder: vscode.WorkspaceFolder, output: vscode.OutputChannel): Promise<boolean> {
	const choice = await vscode.window.showInformationMessage(
		'Proof: this project has no JaCoCo report yet. Run the tests with JaCoCo now? Maven will run in its own terminal, you\'ll see its output.',
		'Run Tests',
		'Cancel',
	);
	if (choice !== 'Run Tests') {
		return false;
	}
	const scope = await resolveRunTestsModuleScope(folder);
	if (!scope) {
		return false;
	}
	const result = await runTestsTask(folder, output, scope.moduleRoots);
	if (result && !result.success) {
		const interpretation = interpretMavenFailure(result.capturedOutput);
		const reasonSuffix = interpretation ? ` Reason: ${interpretation.detail}` : ' See the terminal output for detail.';
		vscode.window.showErrorMessage(`Proof: Maven failed.${reasonSuffix} Scan not started.`);
	}
	return result?.success === true;
}

/**
 * Resolves which module(s) to bind for coverage. Never guesses among
 * unrelated repos (hard rule 3a): a workspace root with no build-system
 * marker of its own lists whatever independent projects it finds one level
 * down, by name, and stops - it never picks one. A workspace root that IS
 * a real project binds *every* JaCoCo report found under it (the "hepsinden
 * içerik al, listeden seçtirme" fix - no `showQuickPick` left at all).
 */
export async function resolveReportBinding(folder: vscode.WorkspaceFolder, configuredReportPath: string, output: vscode.OutputChannel, alreadyOfferedRunTests = false): Promise<ReportBinding | undefined> {
	if (fs.existsSync(path.join(folder.uri.fsPath, configuredReportPath))) {
		return { reportPath: configuredReportPath, allModules: [{ id: 'root', root: '.' }] };
	}

	if (!isProjectRoot(PROJECT_ROOT_MARKER_FILES.filter((m) => fs.existsSync(path.join(folder.uri.fsPath, m))))) {
		reportNotAProjectRoot(folder, configuredReportPath);
		return undefined;
	}

	// Past this point the workspace root is itself a real (single- or
	// multi-module) project, so every jacoco.xml found below genuinely
	// belongs to it - a gson-shaped case, not a coverdict-corpus-shaped one.
	const found = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/target/site/jacoco/jacoco.xml'), '**/node_modules/**', 50);
	if (found.length === 0) {
		if (!alreadyOfferedRunTests && await offerToRunTestsNow(folder, output)) {
			return resolveReportBinding(folder, configuredReportPath, output, true);
		}
		void offerToOpenSetting(`Proof: report file not found: ${configuredReportPath}. Run the tests with JaCoCo first, or fix the proof.reportPath setting.`, 'proof.reportPath');
		return undefined;
	}

	const repoRelativePaths = found.map((uri) => toRepoRelativePosix(uri.fsPath, folder.uri.fsPath));
	const bound = bindModules(repoRelativePaths);

	const summary = bound.length === 1 ? bound[0].root : `${bound.length} module(s) (${bound.map((m) => m.root).join(', ')})`;
	output.appendLine(`Proof: proof.reportPath (${configuredReportPath}) not found - automatically bound ${summary}.`);
	void vscode.window.showInformationMessage(`Proof: automatically bound ${summary}. Fix the proof.reportPath setting to make this permanent.`);

	return { modules: bound, allModules: bound };
}

/**
 * Runs `doctor --fix` under a cancellable progress notification, reporting
 * one increment per module it actually attempts to fix (`parseDoctorProgressLine`).
 * `doctor` never prints how many modules there are in total, so the bar's
 * denominator is `moduleCount` (the caller's own bound-module count) rather
 * than anything the CLI claims - a module already usable is skipped without
 * a line, so the bar can legitimately finish under 100%, never over.
 */
async function runDoctorFixWithProgress(javaExecutable: string, jarPath: string, folder: vscode.WorkspaceFolder, output: vscode.OutputChannel, moduleCount: number): Promise<DoctorResult> {
	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Proof: generating classpath list(s) (doctor --fix)', cancellable: true },
		(progress, token) => new Promise<DoctorResult>((resolve, reject) => {
			runDoctor(javaExecutable, jarPath, folder.uri.fsPath, {
				env: resolveWorkspaceEnv(folder),
				onStderrLine: (line) => {
					output.appendLine(line);
					const fixing = parseDoctorProgressLine(line);
					if (fixing) {
						progress.report({ increment: 100 / moduleCount, message: `${fixing.moduleId} · generating classpath` });
					}
				},
				fix: true,
				onStart: (cancel) => token.onCancellationRequested(cancel),
			}).then(resolve, reject);
		}),
	);
}

export type ClasspathKind = 'perTest' | 'mutation';

function classpathRelPath(root: string, kind: ClasspathKind): string {
	const file = kind === 'perTest' ? 'target/proof-per-test-classpath.txt' : 'target/proof-mutation-classpath.txt';
	return root === '.' ? file : `${root}/${file}`;
}

interface ClasspathCheck {
	classpaths: readonly { moduleId: string; path: string }[];
	missingModuleRoots: readonly string[];
}

/**
 * Checks what already exists - never generates anything itself. The
 * `proof.perTestClasspathPath` escape hatch (unchanged setting/default
 * from before Faz 30) only applies when there is exactly one bound module,
 * since a single scalar path cannot meaningfully override N modules' files.
 */
function checkClasspaths(workspaceRoot: string, modules: readonly { id: string; root: string }[], kind: ClasspathKind, escapeHatchPath: string): ClasspathCheck {
	const classpaths: { moduleId: string; path: string }[] = [];
	const missingModuleRoots: string[] = [];
	for (const m of modules) {
		const relPath = modules.length === 1 && fs.existsSync(path.join(workspaceRoot, escapeHatchPath))
			? escapeHatchPath
			: classpathRelPath(m.root, kind);
		if (fs.existsSync(path.join(workspaceRoot, relPath))) {
			classpaths.push({ moduleId: m.id, path: relPath });
		} else {
			missingModuleRoots.push(m.root);
		}
	}
	return { classpaths, missingModuleRoots };
}

/**
 * Resolves the classpath list(s) L2/L3 need, one per bound module.
 * Generates missing ones via a single `doctor --fix` call (fixes every
 * usable module in the reactor in one pass, D-65) rather than the old
 * per-run `mvn -q dependency:build-classpath` at the workspace root with
 * no `-pl`/`-am` and no prior `install` - the exact shape that failed on
 * gson's `test-jpms` (an unresolved reactor sibling).
 *
 * Returns `undefined` only when nothing could be resolved at all - the
 * caller must not proceed, and this function has already said why. A
 * partial result (some modules missing) is still returned, with a warning
 * already shown - L1 coverage stays complete even when L2/L3 cannot reach
 * every module.
 */
export async function resolveEvidenceClasspaths(
	folder: vscode.WorkspaceFolder,
	jarPath: string,
	javaExecutable: string,
	output: vscode.OutputChannel,
	modules: readonly { id: string; root: string }[],
	kind: ClasspathKind,
): Promise<readonly { moduleId: string; path: string }[] | undefined> {
	const workspaceRoot = folder.uri.fsPath;
	const escapeHatchPath = vscode.workspace.getConfiguration('proof', folder).get<string>('perTestClasspathPath') || 'target/proof-classpath.txt';

	let check = checkClasspaths(workspaceRoot, modules, kind, escapeHatchPath);
	if (check.missingModuleRoots.length === 0) {
		return check.classpaths;
	}

	if (!projectMarkersPresentAt(workspaceRoot)) {
		vscode.window.showErrorMessage(
			`Proof: Deep Scan can't run without a classpath list - the scan was never started. This folder isn't a Maven project, and automatic generation only works with Maven. Point ${escapeHatchPath} at a list you've generated by hand.`,
		);
		return undefined;
	}

	const choice = await vscode.window.showInformationMessage(
		`Proof: Deep Scan needs a classpath list (missing for ${check.missingModuleRoots.length} module(s): ${check.missingModuleRoots.join(', ')}). Generate it with Maven now?`,
		'Generate',
		'Cancel',
	);
	if (choice !== 'Generate') {
		vscode.window.showErrorMessage('Proof: Deep Scan can\'t run without a classpath list - the scan was never started.');
		return undefined;
	}

	const doctorResult = await runDoctorFixWithProgress(javaExecutable, jarPath, folder, output, modules.length);
	output.appendLine(doctorResult.stdout);

	check = checkClasspaths(workspaceRoot, modules, kind, escapeHatchPath);
	if (check.classpaths.length === 0) {
		return handleClasspathGenerationFailure({ folder, jarPath, javaExecutable, output, modules, kind, escapeHatchPath }, doctorResult.stdout + doctorResult.stderr);
	}
	if (check.missingModuleRoots.length > 0) {
		vscode.window.showWarningMessage(`Proof: deep evidence won't be collected for these modules (classpath couldn't be generated): ${check.missingModuleRoots.join(', ')}. Coverage will still be computed.`);
	}
	return check.classpaths;
}

const CLASSPATH_UNAVAILABLE_PREFIX = 'Proof: Deep Scan can\'t run without a classpath list - the scan was never started.';

interface ClasspathGenerationContext {
	folder: vscode.WorkspaceFolder;
	jarPath: string;
	javaExecutable: string;
	output: vscode.OutputChannel;
	modules: readonly { id: string; root: string }[];
	kind: ClasspathKind;
	escapeHatchPath: string;
}

/**
 * `doctor --fix` produced nothing usable. Interprets the real Maven failure
 * text (`cli/mavenErrorInterpreter.ts`) rather than showing a bare "failed" -
 * an unrecognized shape still says so honestly (hard rule 3a) instead of
 * inventing a cause. `unresolvedReactorSibling` (D-67) gets one extra step:
 * offer to `mvn install -DskipTests` and retry `doctor --fix` once.
 */
async function handleClasspathGenerationFailure(ctx: ClasspathGenerationContext, rawOutput: string): Promise<readonly { moduleId: string; path: string }[] | undefined> {
	const { folder, jarPath, javaExecutable, output, modules, kind, escapeHatchPath } = ctx;
	const interpretation = interpretMavenFailure(rawOutput);
	const reasonSuffix = interpretation ? ` Reason: ${interpretation.detail}` : ' See the Output → proof-java channel for detail.';

	if (interpretation?.kind !== 'unresolvedReactorSibling') {
		vscode.window.showErrorMessage(`${CLASSPATH_UNAVAILABLE_PREFIX}${reasonSuffix}`);
		return undefined;
	}

	const choice = await vscode.window.showErrorMessage(`${CLASSPATH_UNAVAILABLE_PREFIX}${reasonSuffix}`, 'Run mvn install -DskipTests');
	if (choice !== 'Run mvn install -DskipTests' || !(await runMavenInstallTask(folder, output)).success) {
		vscode.window.showErrorMessage(CLASSPATH_UNAVAILABLE_PREFIX);
		return undefined;
	}

	const workspaceRoot = folder.uri.fsPath;
	const retried = await runDoctorFixWithProgress(javaExecutable, jarPath, folder, output, modules.length);
	output.appendLine(retried.stdout);

	const check = checkClasspaths(workspaceRoot, modules, kind, escapeHatchPath);
	if (check.classpaths.length === 0) {
		const retryInterpretation = interpretMavenFailure(retried.stdout + retried.stderr);
		const retryReasonSuffix = retryInterpretation ? ` Reason: ${retryInterpretation.detail}` : ' See the Output → proof-java channel for detail.';
		vscode.window.showErrorMessage(`${CLASSPATH_UNAVAILABLE_PREFIX}${retryReasonSuffix}`);
		return undefined;
	}
	if (check.missingModuleRoots.length > 0) {
		vscode.window.showWarningMessage(`Proof: deep evidence won't be collected for these modules (classpath couldn't be generated): ${check.missingModuleRoots.join(', ')}. Coverage will still be computed.`);
	}
	return check.classpaths;
}

/** A blocking configuration problem: shows the reason and a button that opens Settings scrolled to the offending key, instead of a bare error + a manual search. */
export async function offerToOpenSetting(message: string, settingId: string): Promise<void> {
	const choice = await vscode.window.showErrorMessage(message, 'Open Setting');
	if (choice === 'Open Setting') {
		await vscode.commands.executeCommand('workbench.action.openSettings', settingId);
	}
}

/** Faz 34: the specific "no jar at all" case both `runExportReport` and `runAnalyzeCore` hit - a direct download is one click closer to working than sending the user to a setting they still have to fill in by hand. */
export async function offerToDownloadJar(): Promise<void> {
	const choice = await vscode.window.showErrorMessage(
		'Proof: proof-java.jar not found. Download the latest release, or set the proof.jarPath setting if you already have one.',
		'Download proof-java.jar',
		'Open Setting',
	);
	if (choice === 'Download proof-java.jar') {
		await vscode.commands.executeCommand('proof.downloadJar');
	} else if (choice === 'Open Setting') {
		await vscode.commands.executeCommand('workbench.action.openSettings', 'proof.jarPath');
	}
}
