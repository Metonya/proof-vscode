import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { buildAnalyzeArgs, type DiffMode } from '../cli/argsBuilder';
import { locateJar } from '../cli/jarLocator';
import { run } from '../cli/runner';
import type { BadgeMetric } from '../model/metrics';
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
} from '../model/store';
import { parseVerdict } from '../verdict/parse';
import type { FileCoverageBlock, MetricSet, VerdictDocument } from '../verdict/types';
import type { ExplorerBadgeProvider } from './explorerBadges';
import { applyGutterCoverage, clearGutterCoverage, type GutterDecorationTypes } from './gutterRenderer';
import { refreshLineTestsPanelIfOpen, showLineTestsPanel, type PanelContent } from './panelView';
import { showCoverageSummary, showNoFileCoverageWarning } from './statusBar';

/** F3's own module id - single-module shorthand only, same scope limit as F1's argsBuilder (multi-module lands with F8). */
const MODULE_ID = 'root';

/**
 * Faz 9: hem gutter (`gutterTypes`) hem Explorer rozetleri
 * (`explorerBadges`) artık tamamen bizim çizdiğimiz, tam kontrolümüzde iki
 * ayrı yüzey - native Test Coverage API'sinin "addCoverage sonrası hangi
 * yüzeyin çizileceğine VS Code karar verir" kısıtı yok (bkz. plan). Her
 * ikisi de `coverdict.show.*` ayarlarına göre `paintCoverage`'da bağımsız
 * açılıp kapanıyor.
 */
export interface CoverageSinks {
	context: vscode.ExtensionContext;
	gutterTypes: GutterDecorationTypes;
	explorerBadges: ExplorerBadgeProvider;
	statusBarItem: vscode.StatusBarItem;
}

export function registerAnalyzeCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('coverdict.analyze', () => runAnalyze(context, output, sinks));
}

/** F3: a diff-mode run with --per-test-report, superset of the plain scan (still paints coverage with the same fileCoverage data). */
export function registerAnalyzePerTestCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('coverdict.analyzePerTest', () => runAnalyzePerTest(context, output, sinks));
}

/** F4: toggles both surfaces together for the last analyze run's data - no re-scan, just republish or clear what is already in model/store. */
export function registerToggleCoverageCommand(sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('coverdict.toggleCoverage', () => toggleCoverage(sinks));
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
	showCoverageSummary(sinks.statusBarItem, overall, isGutterVisible());
}

function toggleCoverage(sinks: CoverageSinks): void {
	const state = getCoverageState();
	if (!state?.fileCoverage) {
		vscode.window.showInformationMessage('coverdict: henüz kapsama verisi yok - önce "coverdict: Analiz Et" komutunu çalıştırın.');
		return;
	}

	const nextVisible = !isGutterVisible();
	setGutterVisible(nextVisible);

	if (nextVisible) {
		paintCoverage(sinks, state.workspaceRoot, state.fileCoverage);
	} else {
		sinks.explorerBadges.clear();
		clearGutterCoverage(sinks.gutterTypes);
	}
	showCoverageSummary(sinks.statusBarItem, state.overall, nextVisible);
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
 * prompted --per-test-classpath list file. Still paints coverage with the
 * same fileCoverage data (a superset run, one CLI invocation) and stores L2
 * evidence for the panel.
 */
async function runAnalyzePerTest(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): Promise<void> {
	const classpathPath = await vscode.window.showInputBox({
		prompt: 'Test bazlı classpath liste dosyası (satır başına bir jar/çıktı-dizini yolu, workspace köküne göre)',
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
		vscode.window.showWarningMessage('coverdict: bu koşuda test bazlı (per-test) kanıt yok - PER_TEST_* uyarıları için çıktı kanalını kontrol edin.');
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
		vscode.window.showErrorMessage('coverdict: önce bir klasör açın.');
		return undefined;
	}

	const jarPath = locateJar(folder);
	if (!jarPath) {
		vscode.window.showErrorMessage('coverdict: coverdict.jar bulunamadı. coverdict.jarPath ayarını yapın veya coverdict-cli/target/coverdict.jar konumunda bir tane derleyin.');
		return undefined;
	}

	const reportPath = await vscode.window.showInputBox({
		prompt: 'JaCoCo XML rapor yolu (workspace köküne göre)',
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

	output.appendLine(`coverdict: java -jar ${jarPath} ${args.join(' ')}`);

	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'coverdict: analiz ediliyor', cancellable: true },
		async (_progress, token) => {
			const handle = run({ javaExecutable, jarPath, args, onStderrLine: (line) => output.appendLine(line) });
			let cancelled = false;
			token.onCancellationRequested(() => {
				cancelled = true;
				handle.cancel();
			});

			let result;
			try {
				result = await handle.result;
			} catch (e) {
				vscode.window.showErrorMessage(`coverdict: "${javaExecutable}" çalıştırılamadı: ${(e as Error).message}`);
				return undefined;
			}
			output.appendLine(result.stdout);

			if (cancelled) {
				return undefined; // user-initiated cancel - not a failure, say nothing
			}

			// exit 3 (incomplete) still writes a real document - read it rather
			// than treating it as a failure (hard rule 3a, mirrored from the CLI).
			if (result.exitCode !== 0 && result.exitCode !== 3) {
				vscode.window.showErrorMessage(`coverdict: analiz başarısız oldu (çıkış kodu ${result.exitCode}).`);
				return undefined;
			}

			let raw: string;
			try {
				raw = await fs.promises.readFile(outUri.fsPath, 'utf8');
			} catch (e) {
				vscode.window.showErrorMessage(`coverdict: verdict dosyası okunamadı: ${(e as Error).message}`);
				return undefined;
			}

			const parsed = parseVerdict(raw);
			if (!parsed.ok) {
				vscode.window.showErrorMessage(`coverdict: verdict dosyası ayrıştırılamadı: ${parsed.error}`);
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

			return parsed.value;
		},
	);
}

function percentText(percent: number | null): string {
	return percent === null ? 'yok' : `${percent}%`;
}

/**
 * `fileCoverage.files[]` yoksa (bayrak istenmedi ya da yazılmadan önce bir
 * hata oldu) durum çubuğu uyarısı gösterir ve her iki yüzeyi de temizler -
 * hard rule 3a: eski koşunun verisi güncelmiş gibi görünmeye devam etmez.
 */
function publishCoverage(folder: vscode.WorkspaceFolder, sinks: CoverageSinks, fileCoverage: FileCoverageBlock | undefined, overall: MetricSet): void {
	const workspaceRoot = folder.uri.fsPath;
	setCoverageState({ workspaceRoot, fileCoverage, overall });

	if (!fileCoverage) {
		showNoFileCoverageWarning(sinks.statusBarItem);
		sinks.explorerBadges.clear();
		clearGutterCoverage(sinks.gutterTypes);
		return;
	}

	paintCoverage(sinks, workspaceRoot, fileCoverage);
	showCoverageSummary(sinks.statusBarItem, overall, isGutterVisible());
}

/**
 * `coverdict.show.explorerBadges` ve `coverdict.show.lineGutter` birbirinden
 * tamamen bağımsız - ikisi de kendi çizim yolumuzdan geliyor (Faz 9), native
 * API'nin "ikisini birlikte üretir" kısıtı yok. `isGutterVisible()` (F4'ün
 * genel aç/kapa'sı) `false` ise ikisi de hiç çağrılmaz.
 */
function paintCoverage(sinks: CoverageSinks, workspaceRoot: string, fileCoverage: FileCoverageBlock): void {
	if (!isGutterVisible()) {
		sinks.explorerBadges.clear();
		clearGutterCoverage(sinks.gutterTypes);
		return;
	}

	const config = vscode.workspace.getConfiguration('coverdict', vscode.Uri.file(workspaceRoot));
	const showExplorerBadges = config.get<boolean>('show.explorerBadges') ?? true;
	const showLineGutter = config.get<boolean>('show.lineGutter') ?? true;
	const badgeMetric = config.get<BadgeMetric>('badgeMetric') ?? 'sonar-compatible';

	if (showExplorerBadges) {
		sinks.explorerBadges.update(workspaceRoot, fileCoverage, badgeMetric);
	} else {
		sinks.explorerBadges.clear();
	}

	if (showLineGutter) {
		applyGutterCoverage(sinks.gutterTypes, workspaceRoot, fileCoverage);
	} else {
		clearGutterCoverage(sinks.gutterTypes);
	}
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
