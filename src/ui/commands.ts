import * as fs from 'node:fs';
import * as vscode from 'vscode';

import { buildAnalyzeArgs } from '../cli/argsBuilder';
import { locateJar } from '../cli/jarLocator';
import { run } from '../cli/runner';
import { getCoverageState, isGutterVisible, setCoverageState, setGutterVisible } from '../model/store';
import { parseVerdict } from '../verdict/parse';
import type { FileCoverageBlock, MetricSet } from '../verdict/types';
import { applyExcludedDecorations } from './decorationFallback';
import { clearCoverage, publishFileCoverage } from './coverageProvider';
import { showCoverageSummary, showNoFileCoverageWarning, showUnsupportedHostWarning } from './statusBar';

/**
 * F1/F2 (Plan.md Bölüm 7): the manual "run coverdict on this workspace"
 * gesture - `withProgress` cancellable, `--out` written to extension
 * storage (never the repo, so it can never become an untracked file the
 * next diff sees). Always requests `--file-coverage` - painting the gutter
 * is F2's whole point, and the payload-size reason it is opt-in on the CLI
 * (Plan.md Faz 1) does not apply to a single-workspace, on-demand run here.
 */
export interface CoverageSinks {
	controller: vscode.TestController;
	excludedDecorationType: vscode.TextEditorDecorationType;
	statusBarItem: vscode.StatusBarItem;
}

export function registerAnalyzeCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('coverdict.analyze', () => runAnalyze(context, output, sinks));
}

/** F4: toggles the gutter for the last analyze run's data - no re-scan, just republish or clear what is already in model/store. */
export function registerToggleCoverageCommand(sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('coverdict.toggleCoverageGutter', () => toggleCoverageGutter(sinks));
}

function toggleCoverageGutter(sinks: CoverageSinks): void {
	const state = getCoverageState();
	if (!state?.fileCoverage) {
		vscode.window.showInformationMessage('coverdict: no coverage data yet - run "coverdict: Analyze" first.');
		return;
	}

	const nextVisible = !isGutterVisible();
	setGutterVisible(nextVisible);
	applyExcludedDecorations(sinks.excludedDecorationType, state.workspaceRoot, nextVisible ? state.fileCoverage.excluded : []);

	if (nextVisible) {
		const painted = publishFileCoverage(sinks.controller, state.workspaceRoot, state.fileCoverage);
		showCoverageSummary(sinks.statusBarItem, state.overall, painted);
	} else {
		clearCoverage(sinks.controller);
		sinks.statusBarItem.text = '$(eye-closed) coverdict';
		sinks.statusBarItem.tooltip = 'coverdict: gutter hidden (click to show)';
	}
}

async function runAnalyze(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showErrorMessage('coverdict: open a folder first.');
		return;
	}

	const jarPath = locateJar(folder);
	if (!jarPath) {
		vscode.window.showErrorMessage('coverdict: could not find coverdict.jar. Set coverdict.jarPath, or build one at coverdict-cli/target/coverdict.jar.');
		return;
	}

	const reportPath = await vscode.window.showInputBox({
		prompt: 'JaCoCo XML report path (relative to the workspace root)',
		value: 'target/site/jacoco/jacoco.xml',
	});
	if (!reportPath) {
		return;
	}

	const storageRoot = context.storageUri ?? context.globalStorageUri;
	await vscode.workspace.fs.createDirectory(storageRoot);
	const outUri = vscode.Uri.joinPath(storageRoot, 'verdict-current.json');

	const config = vscode.workspace.getConfiguration('coverdict', folder);
	const javaExecutable = config.get<string>('javaExecutable') || 'java';
	const coverageExclusions = config.get<string[]>('coverageExclusions') ?? [];
	const args = buildAnalyzeArgs({
		repo: folder.uri.fsPath,
		diffMode: { kind: 'no-vcs' },
		reportPath,
		outPath: outUri.fsPath,
		fileCoverage: true,
		coverageExclusions,
	});

	output.show(true);
	output.appendLine(`coverdict: java -jar ${jarPath} ${args.join(' ')}`);

	await vscode.window.withProgress(
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
				return;
			}

			let raw: string;
			try {
				raw = await fs.promises.readFile(outUri.fsPath, 'utf8');
			} catch (e) {
				vscode.window.showErrorMessage(`coverdict: could not read the verdict file: ${(e as Error).message}`);
				return;
			}

			const parsed = parseVerdict(raw);
			if (!parsed.ok) {
				vscode.window.showErrorMessage(`coverdict: could not parse the verdict file: ${parsed.error}`);
				return;
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

			publishCoverage(folder, sinks, parsed.value.fileCoverage, overall);
		},
	);
}

function percentText(percent: number | null): string {
	return percent === null ? 'n/a' : `${percent}%`;
}

/**
 * F2's four states: painted from `fileCoverage.files[]` (native API),
 * `excluded` grayed out (decoration, native has no such concept), anything
 * absent from the report simply never gets a `FileCoverage` entry (nothing
 * painted - hard rule 3a), and the whole block missing shows the status-bar
 * warning instead of leaving the previous run's data looking current.
 */
function publishCoverage(folder: vscode.WorkspaceFolder, sinks: CoverageSinks, fileCoverage: FileCoverageBlock | undefined, overall: MetricSet): void {
	const workspaceRoot = folder.uri.fsPath;
	setCoverageState({ workspaceRoot, fileCoverage, overall });

	if (!fileCoverage) {
		showNoFileCoverageWarning(sinks.statusBarItem);
		applyExcludedDecorations(sinks.excludedDecorationType, workspaceRoot, []);
		return;
	}

	const painted = publishFileCoverage(sinks.controller, workspaceRoot, fileCoverage);
	applyExcludedDecorations(sinks.excludedDecorationType, workspaceRoot, fileCoverage.excluded);
	if (painted) {
		showCoverageSummary(sinks.statusBarItem, overall, true);
	} else {
		showUnsupportedHostWarning(sinks.statusBarItem);
	}
}
