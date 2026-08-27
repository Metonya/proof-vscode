import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { buildAnalyzeArgs, type DiffMode } from '../cli/argsBuilder';
import { locateJar } from '../cli/jarLocator';
import { run } from '../cli/runner';
import { detectClassName } from '../model/classNameDetector';
import { testsForClass } from '../model/lineIndex';
import { toRepoRelativePath } from '../model/pathIndex';
import {
	getCoverageState,
	getPerTestState,
	isGutterVisible,
	setCoverageState,
	setGutterVisible,
	setPerTestState,
	setUsingFallback,
} from '../model/store';
import { parseVerdict } from '../verdict/parse';
import type { FileCoverageBlock, MetricSet, VerdictDocument } from '../verdict/types';
import { applyExcludedDecorations, applyFallbackCoverage, clearFallbackCoverage, type FallbackDecorationTypes } from './decorationFallback';
import { hasNativeCoverageApi, publishFileCoverage, readPartialLineMode, resetCoverageController } from './coverageProvider';
import { refreshLineTestsPanelIfOpen, showLineTestsPanel, type PanelContent } from './panelView';
import { showCoverageSummary, showNoFileCoverageWarning } from './statusBar';

/** F3's own module id - single-module shorthand only, same scope limit as F1's argsBuilder (multi-module lands with F8). */
const MODULE_ID = 'root';

/**
 * F1/F2 (Plan.md Bölüm 7): the manual "run coverdict on this workspace"
 * gesture - `withProgress` cancellable, `--out` written to extension
 * storage (never the repo, so it can never become an untracked file the
 * next diff sees). Always requests `--file-coverage` - painting the gutter
 * is F2's whole point, and the payload-size reason it is opt-in on the CLI
 * (Plan.md Faz 1) does not apply to a single-workspace, on-demand run here.
 *
 * `controller` is mutable and re-assigned by `resetController` (F4's hide
 * path, verified by hand: an empty `TestRun` does NOT clear a prior run's
 * Explorer file-percentage badges - only disposing and rebuilding the whole
 * `TestController` does). Every read of `sinks.controller` happens at call
 * time, never captured early, so a reset is visible everywhere immediately.
 */
export interface CoverageSinks {
	context: vscode.ExtensionContext;
	controller: vscode.TestController;
	excludedDecorationType: vscode.TextEditorDecorationType;
	fallbackDecorationTypes: FallbackDecorationTypes;
	statusBarItem: vscode.StatusBarItem;
}

export function registerAnalyzeCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('coverdict.analyze', () => runAnalyze(context, output, sinks));
}

/** F3: a diff-mode run with --per-test-report, superset of the plain scan (still paints the gutter with the same fileCoverage data). */
export function registerAnalyzePerTestCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('coverdict.analyzePerTest', () => runAnalyzePerTest(context, output, sinks));
}

/** F4: toggles the gutter for the last analyze run's data - no re-scan, just republish or clear what is already in model/store. */
export function registerToggleCoverageCommand(sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('coverdict.toggleCoverageGutter', () => toggleCoverageGutter(sinks));
}

/** F3: opens (or reveals) the line->tests panel for the currently active editor. */
export function registerShowLineTestsCommand(): vscode.Disposable {
	return vscode.commands.registerCommand('coverdict.showLineTests', () => showLineTestsPanel(computePanelContent()));
}

/** Called from extension.ts on active-editor change, to keep an already-open panel in sync without a new command invocation. */
export function refreshLineTestsPanelForActiveEditor(): void {
	refreshLineTestsPanelIfOpen(computePanelContent());
}

/** Restores the last run's coverage from storage without invoking the CLI - see restoreLastCoverage in extension.ts. */
export function republishCoverage(sinks: CoverageSinks, workspaceRoot: string, fileCoverage: FileCoverageBlock, overall: MetricSet): void {
	setCoverageState({ workspaceRoot, fileCoverage, overall });
	paintCoverage(sinks, workspaceRoot, fileCoverage);
	applyExcludedDecorations(sinks.excludedDecorationType, workspaceRoot, fileCoverage.excluded);
	showCoverageSummary(sinks.statusBarItem, overall, true);
}

function toggleCoverageGutter(sinks: CoverageSinks): void {
	const state = getCoverageState();
	if (!state?.fileCoverage) {
		vscode.window.showInformationMessage('coverdict: no coverage data yet - run "coverdict: Analyze" first.');
		return;
	}

	const nextVisible = !isGutterVisible();
	setGutterVisible(nextVisible);

	if (nextVisible) {
		paintCoverage(sinks, state.workspaceRoot, state.fileCoverage);
		showCoverageSummary(sinks.statusBarItem, state.overall, true);
	} else {
		resetController(sinks);
		clearFallbackCoverage(sinks.fallbackDecorationTypes);
		applyExcludedDecorations(sinks.excludedDecorationType, state.workspaceRoot, []);
		sinks.statusBarItem.text = '$(eye-closed) coverdict';
		sinks.statusBarItem.tooltip = 'coverdict: gutter hidden (click to show)';
	}
}

async function runAnalyze(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): Promise<void> {
	const parsed = await runAnalyzeCore(context, output, { kind: 'no-vcs' });
	if (!parsed) {
		return;
	}
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return; // runAnalyzeCore already bailed out for this - unreachable in practice, satisfies the type checker
	}
	publishCoverage(folder, sinks, parsed.fileCoverage, parsed.coverage.overall);
}

/**
 * F3: --uncommitted (a diff is required for --per-test-report) plus a
 * prompted --per-test-classpath list file. Still paints the gutter with the
 * same fileCoverage data (a superset run, one CLI invocation) and stores L2
 * evidence for the panel.
 */
async function runAnalyzePerTest(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): Promise<void> {
	const classpathPath = await vscode.window.showInputBox({
		prompt: 'Per-test classpath list file (one jar/output-dir path per line, relative to the workspace root)',
		value: 'mutation-classpath.txt',
	});
	if (!classpathPath) {
		return;
	}

	const parsed = await runAnalyzeCore(context, output, { kind: 'uncommitted' }, { classpathModuleId: MODULE_ID, classpathPath });
	if (!parsed) {
		return;
	}
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return;
	}

	publishCoverage(folder, sinks, parsed.fileCoverage, parsed.coverage.overall);
	setPerTestState({ moduleId: MODULE_ID, perTest: parsed.perTest, warnings: parsed.warnings });
	if (!parsed.perTest) {
		vscode.window.showWarningMessage('coverdict: no perTest evidence in this run - check the output channel for PER_TEST_* warnings.');
	}
	showLineTestsPanel(computePanelContent());
}

/**
 * Shared by both commands: locate the jar, prompt for the report path, spawn
 * the CLI, read and parse `--out`. Returns `undefined` after already showing
 * the user why (hard rule 3a's exit-3-still-writes-a-document handling
 * included) - callers never need their own error UI for this part.
 */
async function runAnalyzeCore(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	diffMode: DiffMode,
	perTest?: { classpathModuleId: string; classpathPath: string },
): Promise<VerdictDocument | undefined> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showErrorMessage('coverdict: open a folder first.');
		return undefined;
	}

	const jarPath = locateJar(folder);
	if (!jarPath) {
		vscode.window.showErrorMessage('coverdict: could not find coverdict.jar. Set coverdict.jarPath, or build one at coverdict-cli/target/coverdict.jar.');
		return undefined;
	}

	const reportPath = await vscode.window.showInputBox({
		prompt: 'JaCoCo XML report path (relative to the workspace root)',
		value: 'target/site/jacoco/jacoco.xml',
	});
	if (!reportPath) {
		return undefined;
	}

	const storageRoot = context.storageUri ?? context.globalStorageUri;
	await vscode.workspace.fs.createDirectory(storageRoot);
	const outUri = vscode.Uri.joinPath(storageRoot, 'verdict-current.json');

	const config = vscode.workspace.getConfiguration('coverdict', folder);
	const javaExecutable = config.get<string>('javaExecutable') || 'java';
	const coverageExclusions = config.get<string[]>('coverageExclusions') ?? [];
	const args = buildAnalyzeArgs({
		repo: folder.uri.fsPath,
		diffMode,
		reportPath,
		outPath: outUri.fsPath,
		fileCoverage: true,
		coverageExclusions,
		perTest,
	});

	output.show(true);
	output.appendLine(`coverdict: java -jar ${jarPath} ${args.join(' ')}`);

	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'coverdict: analyzing', cancellable: true },
		async (_progress, token) => {
			const handle = run({ javaExecutable, jarPath, args, onStderrLine: (line) => output.appendLine(line) });
			token.onCancellationRequested(() => handle.cancel());

			const result = await handle.result;
			output.appendLine(result.stdout);

			// exit 3 (incomplete) still writes a real document - read it rather
			// than treating it as a failure (hard rule 3a, mirrored from the CLI).
			if (result.exitCode !== 0 && result.exitCode !== 3) {
				vscode.window.showErrorMessage(`coverdict: analyze failed (exit ${result.exitCode}).`);
				return undefined;
			}

			let raw: string;
			try {
				raw = await fs.promises.readFile(outUri.fsPath, 'utf8');
			} catch (e) {
				vscode.window.showErrorMessage(`coverdict: could not read the verdict file: ${(e as Error).message}`);
				return undefined;
			}

			const parsed = parseVerdict(raw);
			if (!parsed.ok) {
				vscode.window.showErrorMessage(`coverdict: could not parse the verdict file: ${parsed.error}`);
				return undefined;
			}

			// All three modes (jacoco-line, strict-line, sonar-compatible) are
			// already in the verdict - zero new analysis to show them side by
			// side (Plan.md Bölüm 4, 2026-08-27: jacoco-line and sonar-compatible
			// are genuinely different numbers, not a rounding artifact).
			const overall = parsed.value.coverage.overall;
			vscode.window.showInformationMessage(
				`coverdict: ${parsed.value.analysis.status} - jacoco-line ${percentText(overall['jacoco-line'].percent)}`
				+ ` · strict-line ${percentText(overall['strict-line'].percent)}`
				+ ` · sonar-compatible ${percentText(overall['sonar-compatible'].percent)}`,
			);
			// Plan.md Bölüm 6's manual checklist reads this line before trusting
			// what got painted - "native coverage API: yes|no" is the whole
			// point, kept as an exact grep-able phrase.
			output.appendLine(`coverdict: native coverage API: ${hasNativeCoverageApi() ? 'yes' : 'no'}`);

			return parsed.value;
		},
	);
}

function percentText(percent: number | null): string {
	return percent === null ? 'n/a' : `${percent}%`;
}

/**
 * F2's four states: painted from `fileCoverage.files[]` (native API or,
 * failing/forced, F7's decoration fallback - both read the identical
 * `mapLines`/`classifyLine` classification, Plan.md F7's "İki yol da özdeş
 * durum üretiyor"), `excluded` grayed out (decoration, neither path has a
 * native concept of it), anything absent from the report simply never gets
 * painted at all (hard rule 3a), and the whole block missing shows the
 * status-bar warning instead of leaving the previous run's data looking
 * current.
 */
function publishCoverage(folder: vscode.WorkspaceFolder, sinks: CoverageSinks, fileCoverage: FileCoverageBlock | undefined, overall: MetricSet): void {
	const workspaceRoot = folder.uri.fsPath;
	setCoverageState({ workspaceRoot, fileCoverage, overall });

	if (!fileCoverage) {
		showNoFileCoverageWarning(sinks.statusBarItem);
		applyExcludedDecorations(sinks.excludedDecorationType, workspaceRoot, []);
		resetController(sinks);
		clearFallbackCoverage(sinks.fallbackDecorationTypes);
		return;
	}

	paintCoverage(sinks, workspaceRoot, fileCoverage);
	applyExcludedDecorations(sinks.excludedDecorationType, workspaceRoot, fileCoverage.excluded);
	showCoverageSummary(sinks.statusBarItem, overall, true);
}

/**
 * Tries the native path first unless `coverdict.gutter.forceFallback` is
 * set (F7's own manual-test lever); a `false` return from
 * `publishFileCoverage` (unsupported host, or a real runtime failure) falls
 * through to the decoration fallback automatically. A switch away from the
 * native path resets the controller first (see `resetController`) so no
 * stale native marks survive alongside the fallback's.
 */
function paintCoverage(sinks: CoverageSinks, workspaceRoot: string, fileCoverage: FileCoverageBlock): void {
	const forceFallback = vscode.workspace.getConfiguration('coverdict').get<boolean>('gutter.forceFallback') ?? false;
	const painted = !forceFallback && publishFileCoverage(sinks.controller, workspaceRoot, fileCoverage);

	setUsingFallback(!painted);
	if (painted) {
		clearFallbackCoverage(sinks.fallbackDecorationTypes);
	} else {
		resetController(sinks);
		applyFallbackCoverage(sinks.fallbackDecorationTypes, workspaceRoot, fileCoverage, readPartialLineMode());
	}
}

function resetController(sinks: CoverageSinks): void {
	sinks.controller = resetCoverageController(sinks.controller);
	sinks.context.subscriptions.push(sinks.controller);
}

/**
 * F3's fallback ladder (Plan.md Bölüm 4), checked in this exact order:
 * `PER_TEST_TRUNCATED` first (evidence dropped, not "no tests" - hard rule
 * 3a), then no perTest block at all (suggest a re-scan), then class not
 * found in the evidence (L2 only covers changed classes). The active
 * editor's FQCN is best-effort (`detectClassName`) - a nonstandard file is
 * indistinguishable from "out of scope" here, which is the same honest
 * degrade the plan already accepts for that shape.
 */
function computePanelContent(): PanelContent {
	const coverageState = getCoverageState();
	if (!coverageState) {
		return { kind: 'noWorkspace' };
	}

	const editor = vscode.window.activeTextEditor;
	if (editor?.document.languageId !== 'java') {
		return { kind: 'noActiveEditor' };
	}

	const perTestState = getPerTestState();
	const truncated = perTestState?.warnings.find((w) => w.code === 'PER_TEST_TRUNCATED' && (w.module === undefined || w.module === perTestState.moduleId));
	if (truncated) {
		return { kind: 'truncated', message: truncated.message };
	}
	if (!perTestState?.perTest) {
		return { kind: 'noPerTestData' };
	}

	const fileName = path.basename(editor.document.fileName, '.java');
	const className = detectClassName(editor.document.getText(), fileName);
	const lookup = testsForClass(perTestState.perTest, perTestState.moduleId, className);
	if (lookup.kind !== 'found') {
		return { kind: 'classOutOfScope', className };
	}

	const relativePath = toRepoRelativePath(coverageState.workspaceRoot, editor.document.uri.fsPath);
	return { kind: 'lines', fileName: relativePath ?? editor.document.fileName, className, linesToTests: lookup.linesToTests };
}
