import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import type { ModuleReportBinding } from '../cli/argsBuilder';
import { type DoctorResult, runDoctor } from '../cli/doctorRunner';
import { interpretMavenFailure } from '../cli/mavenErrorInterpreter';
import { parseDoctorProgressLine } from '../cli/progressParser';
import { bindModules, describeSiblingProjects, isProjectRoot, PROJECT_ROOT_MARKER_FILES, toRepoRelativePosix } from '../cli/reportDiscovery';
import { runMavenInstallTask, runTestsTask } from './mavenTestTask';

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

/** A directory "looks like a project" for sibling-detection purposes if it has a build-system marker of its own, or is simply a separate git checkout (a repo that has not been built with coverdict's supported build tools yet is still a real, distinct project - listing it by name costs nothing and is more honest than silently skipping it). */
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
	void offerToOpenSetting(`coverdict: rapor dosyası bulunamadı: ${configuredReportPath}. Önce testleri JaCoCo ile çalıştırın, ya da coverdict.reportPath ayarını düzeltin.`, 'coverdict.reportPath');
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
		'coverdict: bu projede henüz bir JaCoCo raporu yok. Testleri JaCoCo ile şimdi çalıştıralım mı? Maven kendi terminalinde çalışacak, çıktısını göreceksiniz.',
		'Testleri Çalıştır',
		'Vazgeç',
	);
	if (choice !== 'Testleri Çalıştır') {
		return false;
	}
	const success = await runTestsTask(folder, output);
	if (success === false) {
		vscode.window.showErrorMessage('coverdict: Maven başarısız oldu - terminaldeki çıktıya bakın. Tarama başlatılmadı.');
	}
	return success === true;
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
		void offerToOpenSetting(`coverdict: rapor dosyası bulunamadı: ${configuredReportPath}. Önce testleri JaCoCo ile çalıştırın, ya da coverdict.reportPath ayarını düzeltin.`, 'coverdict.reportPath');
		return undefined;
	}

	const repoRelativePaths = found.map((uri) => toRepoRelativePosix(uri.fsPath, folder.uri.fsPath));
	const bound = bindModules(repoRelativePaths);

	const summary = bound.length === 1 ? bound[0].root : `${bound.length} modül (${bound.map((m) => m.root).join(', ')})`;
	output.appendLine(`coverdict: coverdict.reportPath (${configuredReportPath}) bulunamadı - ${summary} otomatik bağlanıldı.`);
	void vscode.window.showInformationMessage(`coverdict: ${summary} otomatik bağlanıldı. Kalıcı yapmak için coverdict.reportPath ayarını düzeltin.`);

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
async function runDoctorFixWithProgress(javaExecutable: string, jarPath: string, workspaceRoot: string, output: vscode.OutputChannel, moduleCount: number): Promise<DoctorResult> {
	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'coverdict: classpath listeleri üretiliyor (doctor --fix)', cancellable: true },
		(progress, token) => new Promise<DoctorResult>((resolve, reject) => {
			runDoctor(javaExecutable, jarPath, workspaceRoot, {
				onStderrLine: (line) => {
					output.appendLine(line);
					const fixing = parseDoctorProgressLine(line);
					if (fixing) {
						progress.report({ increment: 100 / moduleCount, message: `${fixing.moduleId} · classpath üretiliyor` });
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
	const file = kind === 'perTest' ? 'target/coverdict-per-test-classpath.txt' : 'target/coverdict-mutation-classpath.txt';
	return root === '.' ? file : `${root}/${file}`;
}

interface ClasspathCheck {
	classpaths: readonly { moduleId: string; path: string }[];
	missingModuleRoots: readonly string[];
}

/**
 * Checks what already exists - never generates anything itself. The
 * `coverdict.perTestClasspathPath` escape hatch (unchanged setting/default
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
	const escapeHatchPath = vscode.workspace.getConfiguration('coverdict', folder).get<string>('perTestClasspathPath') || 'target/coverdict-classpath.txt';

	let check = checkClasspaths(workspaceRoot, modules, kind, escapeHatchPath);
	if (check.missingModuleRoots.length === 0) {
		return check.classpaths;
	}

	if (!projectMarkersPresentAt(workspaceRoot)) {
		vscode.window.showErrorMessage(
			`coverdict: derin tarama classpath listesi olmadan çalışamaz - bu yüzden tarama hiç başlatılmadı. Bu klasör bir Maven projesi değil, otomatik üretim yalnızca Maven'da mümkün. ${escapeHatchPath} ayarına elle ürettiğiniz bir liste verin.`,
		);
		return undefined;
	}

	const choice = await vscode.window.showInformationMessage(
		`coverdict: derin tarama için classpath listesi gerekli (${check.missingModuleRoots.length} modülde yok: ${check.missingModuleRoots.join(', ')}). Maven ile şimdi üretilsin mi?`,
		'Üret',
		'Vazgeç',
	);
	if (choice !== 'Üret') {
		vscode.window.showErrorMessage('coverdict: derin tarama classpath listesi olmadan çalışamaz - bu yüzden tarama hiç başlatılmadı.');
		return undefined;
	}

	const doctorResult = await runDoctorFixWithProgress(javaExecutable, jarPath, workspaceRoot, output, modules.length);
	output.appendLine(doctorResult.stdout);

	check = checkClasspaths(workspaceRoot, modules, kind, escapeHatchPath);
	if (check.classpaths.length === 0) {
		return handleClasspathGenerationFailure({ folder, jarPath, javaExecutable, output, modules, kind, escapeHatchPath }, doctorResult.stdout + doctorResult.stderr);
	}
	if (check.missingModuleRoots.length > 0) {
		vscode.window.showWarningMessage(`coverdict: şu modüller için derin kanıt toplanamayacak (classpath üretilemedi): ${check.missingModuleRoots.join(', ')}. Coverage yine de hesaplanacak.`);
	}
	return check.classpaths;
}

const CLASSPATH_UNAVAILABLE_PREFIX = 'coverdict: derin tarama classpath listesi olmadan çalışamaz - bu yüzden tarama hiç başlatılmadı.';

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
	const reasonSuffix = interpretation ? ` Sebep: ${interpretation.detail}` : ' Ayrıntı için Output → coverdict kanalına bakın.';

	if (interpretation?.kind !== 'unresolvedReactorSibling') {
		vscode.window.showErrorMessage(`${CLASSPATH_UNAVAILABLE_PREFIX}${reasonSuffix}`);
		return undefined;
	}

	const choice = await vscode.window.showErrorMessage(`${CLASSPATH_UNAVAILABLE_PREFIX}${reasonSuffix}`, 'mvn install -DskipTests Çalıştır');
	if (choice !== 'mvn install -DskipTests Çalıştır' || !(await runMavenInstallTask(folder, output))) {
		vscode.window.showErrorMessage(CLASSPATH_UNAVAILABLE_PREFIX);
		return undefined;
	}

	const workspaceRoot = folder.uri.fsPath;
	const retried = await runDoctorFixWithProgress(javaExecutable, jarPath, workspaceRoot, output, modules.length);
	output.appendLine(retried.stdout);

	const check = checkClasspaths(workspaceRoot, modules, kind, escapeHatchPath);
	if (check.classpaths.length === 0) {
		const retryInterpretation = interpretMavenFailure(retried.stdout + retried.stderr);
		const retryReasonSuffix = retryInterpretation ? ` Sebep: ${retryInterpretation.detail}` : ' Ayrıntı için Output → coverdict kanalına bakın.';
		vscode.window.showErrorMessage(`${CLASSPATH_UNAVAILABLE_PREFIX}${retryReasonSuffix}`);
		return undefined;
	}
	if (check.missingModuleRoots.length > 0) {
		vscode.window.showWarningMessage(`coverdict: şu modüller için derin kanıt toplanamayacak (classpath üretilemedi): ${check.missingModuleRoots.join(', ')}. Coverage yine de hesaplanacak.`);
	}
	return check.classpaths;
}

/** A blocking configuration problem: shows the reason and a button that opens Settings scrolled to the offending key, instead of a bare error + a manual search. */
export async function offerToOpenSetting(message: string, settingId: string): Promise<void> {
	const choice = await vscode.window.showErrorMessage(message, 'Ayarı Aç');
	if (choice === 'Ayarı Aç') {
		await vscode.commands.executeCommand('workbench.action.openSettings', settingId);
	}
}
