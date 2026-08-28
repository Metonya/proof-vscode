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
import type { ChangedFile, FileCoverageBlock, Finding, MetricSet, NewCodeCoverage, Reason, VerdictDocument } from '../verdict/types';
import { publishFindings } from './diagnostics';
import type { ExplorerBadgeProvider } from './explorerBadges';
import { applyGutterCoverage, clearGutterCoverage, type GutterDecorationTypes } from './gutterRenderer';
import { refreshLineTestsPanelIfOpen, showLineTestsPanel, type PanelContent } from './panelView';
import { showCoverageSummary, showNoFileCoverageWarning } from './statusBar';
import type { CoverageTreeProvider } from './treeViews/coverageView';
import type { QualityTreeProvider } from './treeViews/qualityView';
import type { RunTreeProvider } from './treeViews/runView';

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
	diagnostics: vscode.DiagnosticCollection;
	runView: RunTreeProvider;
	coverageView: CoverageTreeProvider;
	qualityView: QualityTreeProvider;
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

/** Faz 14b: diff'siz L2 kanıtı, tek bir açık dosya için (`--per-test-target`, Faz 14a). */
export function registerPerTestForFileCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('coverdict.perTestForFile', () => runPerTestForFile(context, output, sinks));
}

/** Called from extension.ts on active-editor change, to keep an already-open panel in sync without a new command invocation. */
export function refreshLineTestsPanelForActiveEditor(): void {
	refreshLineTestsPanelIfOpen(computePanelContent());
}

/** The subset of a parsed verdict `publishAnalysis` needs - deliberately flat so both a fresh CLI run and a restore from storage can build it without a fake `VerdictDocument`. */
export interface AnalysisResult {
	fileCoverage: FileCoverageBlock | undefined;
	overall: MetricSet;
	newCode: NewCodeCoverage;
	changedFiles: readonly ChangedFile[];
	findings: readonly Finding[];
	warnings: readonly Reason[];
}

export function analysisResultFrom(verdict: VerdictDocument): AnalysisResult {
	return {
		fileCoverage: verdict.fileCoverage,
		overall: verdict.coverage.overall,
		newCode: verdict.coverage.newCode,
		changedFiles: verdict.changedFiles,
		findings: verdict.findings,
		warnings: verdict.warnings,
	};
}

/**
 * The one place a run's result turns into UI: gutter/badges (if
 * `fileCoverage` is present), Problems panel findings (independent of
 * `fileCoverage` - they come from every run), and all three sidebar tree
 * views. Used both by a fresh CLI run and by `restoreLastCoverage`/a
 * `coverdict.show.*` setting change reading the same state back - every
 * path renders through this one function so they can never diverge.
 */
export function publishAnalysis(sinks: CoverageSinks, workspaceRoot: string, result: AnalysisResult): void {
	setCoverageState({ workspaceRoot, ...result });

	if (result.fileCoverage) {
		paintCoverage(sinks, workspaceRoot, result.fileCoverage);
		showCoverageSummary(sinks.statusBarItem, result.overall, isGutterVisible(), readBadgeMetric(workspaceRoot));
	} else {
		showNoFileCoverageWarning(sinks.statusBarItem);
		sinks.explorerBadges.clear();
		clearGutterCoverage(sinks.gutterTypes);
	}

	publishFindings(sinks.diagnostics, workspaceRoot, result.findings);
	sinks.runView.refresh();
	sinks.coverageView.refresh();
	sinks.qualityView.refresh();
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
	showCoverageSummary(sinks.statusBarItem, state.overall, nextVisible, readBadgeMetric(state.workspaceRoot));
	sinks.runView.refresh();
}

async function runAnalyze(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showErrorMessage('coverdict: önce bir klasör açın.');
		return;
	}
	const diffMode = readDiffMode(folder);
	if (!diffMode) {
		return;
	}

	const parsed = await runAnalyzeCore(context, output, folder, diffMode);
	if (!parsed) {
		return;
	}
	publishAnalysis(sinks, folder.uri.fsPath, analysisResultFrom(parsed));
}

/**
 * F3: bir diff modu gerektirir (--per-test-report --no-vcs altında CLI
 * tarafından reddedilir). Aynı fileCoverage verisiyle kapsamayı da boyar
 * (tek CLI çağrısı, üst küme koşu) ve panel için L2 kanıtını saklar.
 */
async function runAnalyzePerTest(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showErrorMessage('coverdict: önce bir klasör açın.');
		return;
	}
	const diffMode = readDiffMode(folder);
	if (!diffMode) {
		return;
	}
	if (diffMode.kind === 'no-vcs') {
		vscode.window.showErrorMessage(
			'coverdict: L2 kanıtı sadece değişen dosyaları hedefleyebilir; no-vcs\'te "değişen dosya" diye bir kavram yok, bu yüzden test bazlı analiz çalışmaz. '
			+ 'coverdict.diffMode ayarını "uncommitted" veya "base" yapın.',
		);
		return;
	}

	const classpathPath = vscode.workspace.getConfiguration('coverdict', folder).get<string>('perTestClasspathPath') || 'target/coverdict-classpath.txt';
	const parsed = await runAnalyzeCore(context, output, folder, diffMode, { classpathModuleId: MODULE_ID, classpathPath });
	if (!parsed) {
		return;
	}

	publishAnalysis(sinks, folder.uri.fsPath, analysisResultFrom(parsed));
	setPerTestState({ moduleId: MODULE_ID, perTest: parsed.perTest, warnings: parsed.warnings });
	if (!parsed.perTest) {
		vscode.window.showWarningMessage('coverdict: bu koşuda test bazlı (per-test) kanıt yok - PER_TEST_* uyarıları için çıktı kanalını kontrol edin.');
	}
	showLineTestsPanel(computePanelContent());
}

/**
 * Faz 14b: aktif Java dosyasının FQCN'i doğrudan `--per-test-target` olarak
 * geçirilir (Faz 14a'nın CLI'a eklediği diff'siz L2 girişi) - dosyada
 * değişiklik yapmaya ya da diff'te görünmesine gerek yok. `readDiffMode`
 * yine de çağrılır çünkü CLI her koşuda tam olarak bir diff modu bekler
 * (--no-vcs dahil, artık hedef verildiği için reddedilmiyor) - ama hangi
 * mod seçilirse seçilsin sonuç aynıdır, sadece "yeni kod" hesaplaması
 * etkilenir.
 */
async function runPerTestForFile(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showErrorMessage('coverdict: önce bir klasör açın.');
		return;
	}
	const editor = vscode.window.activeTextEditor;
	if (editor?.document.languageId !== 'java') {
		vscode.window.showErrorMessage('coverdict: bu sınıf için test bazlı kanıt toplamak üzere bir Java dosyası açın.');
		return;
	}
	const diffMode = readDiffMode(folder);
	if (!diffMode) {
		return;
	}

	const fileName = path.basename(editor.document.fileName, '.java');
	const className = detectClassName(editor.document.getText(), fileName);
	const classpathPath = vscode.workspace.getConfiguration('coverdict', folder).get<string>('perTestClasspathPath') || 'target/coverdict-classpath.txt';
	const parsed = await runAnalyzeCore(context, output, folder, diffMode, { classpathModuleId: MODULE_ID, classpathPath, targets: [className] });
	if (!parsed) {
		return;
	}

	publishAnalysis(sinks, folder.uri.fsPath, analysisResultFrom(parsed));
	setPerTestState({ moduleId: MODULE_ID, perTest: parsed.perTest, warnings: parsed.warnings });
	if (!parsed.perTest) {
		vscode.window.showWarningMessage(`coverdict: ${className} için test bazlı kanıt yok - PER_TEST_* uyarıları için çıktı kanalını kontrol edin.`);
	}
	showLineTestsPanel(computePanelContent());
}

/** `coverdict.diffMode` + (base modundaysa) `coverdict.baseRef`'i okur; base seçiliyken baseRef boşsa kullanıcıyı ayara yönlendirip `undefined` döner. */
function readDiffMode(folder: vscode.WorkspaceFolder): DiffMode | undefined {
	const config = vscode.workspace.getConfiguration('coverdict', folder);
	const kind = config.get<string>('diffMode') ?? 'uncommitted';
	if (kind === 'base') {
		const ref = config.get<string>('baseRef')?.trim();
		if (!ref) {
			void offerToOpenSetting('coverdict: coverdict.diffMode "base" ayarlı ama coverdict.baseRef boş.', 'coverdict.baseRef');
			return undefined;
		}
		return { kind: 'base', ref };
	}
	if (kind === 'no-vcs') {
		return { kind: 'no-vcs' };
	}
	return { kind: 'uncommitted' };
}

/**
 * Shared by both commands: locate the jar, spawn the CLI, read and parse
 * `--out`. Returns `undefined` after already showing the user why (hard
 * rule 3a's exit-3-still-writes-a-document handling included) - callers
 * never need their own error UI for this part.
 */
async function runAnalyzeCore(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	folder: vscode.WorkspaceFolder,
	diffMode: DiffMode,
	perTest?: { classpathModuleId: string; classpathPath: string; targets?: readonly string[] },
): Promise<VerdictDocument | undefined> {
	const jarPath = locateJar(folder);
	if (!jarPath) {
		vscode.window.showErrorMessage('coverdict: coverdict.jar bulunamadı. coverdict.jarPath ayarını yapın veya coverdict-cli/target/coverdict.jar konumunda bir tane derleyin.');
		return undefined;
	}

	const config = vscode.workspace.getConfiguration('coverdict', folder);
	const reportPath = config.get<string>('reportPath') || 'target/site/jacoco/jacoco.xml';
	if (!fs.existsSync(path.join(folder.uri.fsPath, reportPath))) {
		void offerToOpenSetting(`coverdict: rapor dosyası bulunamadı: ${reportPath}. Önce testleri JaCoCo ile çalıştırın, ya da coverdict.reportPath ayarını düzeltin.`, 'coverdict.reportPath');
		return undefined;
	}

	const storageRoot = context.storageUri;
	if (!storageRoot) {
		vscode.window.showErrorMessage('coverdict: bu pencerede workspace depolaması yok (bir klasör yerine tek dosya mı açık?) - sonuç kaydedilemez.');
		return undefined;
	}
	await vscode.workspace.fs.createDirectory(storageRoot);
	const outUri = vscode.Uri.joinPath(storageRoot, 'verdict-current.json');

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

			// Faz 13 madde 9: tek satır, tek sayı - diğer iki mod zaten durum
			// çubuğu tooltip'inde ve Kapsama ağacında duruyor, burada tekrar
			// basmak (önceki sürüm) satırı okunaksız yapıyordu. "Ayrıntılar"
			// butonu isteyeni doğrudan Kapsama görünümüne götürür.
			const overall = parsed.value.coverage.overall;
			const headline = readBadgeMetric(folder.uri.fsPath);
			const headlineText = `coverdict: analiz ${statusText(parsed.value.analysis.status)} — ${headline} ${percentText(overall[headline].percent)}`;
			void vscode.window.showInformationMessage(headlineText, 'Ayrıntılar').then((choice) => {
				if (choice === 'Ayrıntılar') {
					void vscode.commands.executeCommand('coverdict.coverageView.focus');
				}
			});

			return parsed.value;
		},
	);
}

/** `coverdict.badgeMetric`'i tekli okuma noktası - durum çubuğu başlığı, rozetler ve gutter aynı ayarı, aynı şekilde okur (madde 2). */
function readBadgeMetric(workspaceRoot: string): BadgeMetric {
	return vscode.workspace.getConfiguration('coverdict', vscode.Uri.file(workspaceRoot)).get<BadgeMetric>('badgeMetric') ?? 'sonar-compatible';
}

function percentText(percent: number | null): string {
	return percent === null ? 'yok' : `${percent}%`;
}

function statusText(status: 'complete' | 'incomplete'): string {
	return status === 'complete' ? 'tamamlandı' : 'eksik tamamlandı';
}

/** A blocking configuration problem: shows the reason and a button that opens Settings scrolled to the offending key, instead of a bare error + a manual search. */
async function offerToOpenSetting(message: string, settingId: string): Promise<void> {
	const choice = await vscode.window.showErrorMessage(message, 'Ayarı Aç');
	if (choice === 'Ayarı Aç') {
		await vscode.commands.executeCommand('workbench.action.openSettings', settingId);
	}
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
	const badgeMetric = readBadgeMetric(workspaceRoot);

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
	const warningFor = (code: string) => perTestState?.warnings.find((w) => w.code === code && (w.module === undefined || w.module === perTestState.moduleId));
	if (warningFor('PER_TEST_TRUNCATED')) {
		return { kind: 'truncated', message: warningFor('PER_TEST_TRUNCATED')!.message };
	}
	if (!perTestState?.perTest) {
		return { kind: 'noPerTestData' };
	}
	// Bu, "hiç kanıt yok" ile "kapsam dışı" ile aynı görünmemesi gereken üçüncü
	// bir durum: L2 hiçbir sınıfı hedeflemedi çünkü diff'te değişen production
	// sınıfı yoktu (PerTestCollector.java'nın kendi uyarısı) - kullanıcının
	// "anlamadım" dediği yer tam olarak burasıydı (2026-08-27).
	if (warningFor('PER_TEST_NO_CHANGED_TARGETS')) {
		return { kind: 'noChangedTargets' };
	}

	const fileName = path.basename(editor.document.fileName, '.java');
	const className = detectClassName(editor.document.getText(), fileName);
	const lookup = testsForClass(perTestState.perTest, perTestState.moduleId, className);
	if (lookup.kind !== 'found') {
		return { kind: 'classOutOfScope', className };
	}

	const relativePath = toRepoRelativePath(coverageState.workspaceRoot, editor.document.uri.fsPath);
	return {
		kind: 'lines', fileName: relativePath ?? editor.document.fileName, className,
		linesToTests: lookup.linesToTests, ambientLinesToTests: lookup.ambientLinesToTests,
	};
}
