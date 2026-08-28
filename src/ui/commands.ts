import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { buildAnalyzeArgs, type DiffMode } from '../cli/argsBuilder';
import { buildPerTestClasspath } from '../cli/classpathBuilder';
import { locateJar } from '../cli/jarLocator';
import { incrementFor, parseProgressLine, progressMessage } from '../cli/progressParser';
import { run } from '../cli/runner';
import { buildFalseGreenIndex } from '../model/falseGreenIndex';
import type { BadgeMetric } from '../model/metrics';
import { detectClassName } from '../model/classNameDetector';
import { parseProductionMethod, productionMethodKey } from '../model/mutationModel';
import {
	getCoverageState,
	getPerTestState,
	getStaleFiles,
	isGutterVisible,
	setCoverageState,
	setGutterVisible,
	setMutationState,
	setPerTestState,
} from '../model/store';
import { parseVerdict } from '../verdict/parse';
import type { ChangedFile, FileCoverageBlock, Finding, MetricSet, ModuleInput, NewCodeCoverage, Reason, VerdictDocument } from '../verdict/types';
import { publishFindings } from './diagnostics';
import type { ExplorerBadgeProvider } from './explorerBadges';
import { applyGutterCoverage, clearGutterCoverage, type GutterDecorationTypes } from './gutterRenderer';
import { showCoverageSummary, showNoFileCoverageWarning } from './statusBar';
import type { CoverageTreeProvider } from './treeViews/coverageView';
import type { LineTestsTreeProvider } from './treeViews/lineTestsView';
import { findMutationBridgeTarget, type MutationNode, type MutationTreeProvider } from './treeViews/mutationView';
import { findQualityBridgeTarget, type QualityNode, type QualityTreeProvider } from './treeViews/qualityView';
import type { RunTreeProvider } from './treeViews/runView';

/** Faz 15d'nin `model/falseGreenIndex.ts`'i şu an tek bir kaynak modülü varsayıyor - F8'in çoklu modül config UI'ı gelene kadar aynı sınır. */
const DEFAULT_SOURCE_ROOTS = ['src/main/java'];

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
	/** Faz 24: Mutasyon ↔ Test Kalitesi köprüsü `reveal()` için bir `TreeView` handle'ı gerektiriyor - salt veri sağlayıcısı yetmiyor. */
	qualityTreeView: vscode.TreeView<QualityNode>;
	lineTestsView: LineTestsTreeProvider;
	/** Faz 20: L3 mutasyon raporu - beşinci görünüm. */
	mutationView: MutationTreeProvider;
	/** Faz 24: bkz. `qualityTreeView`. */
	mutationTreeView: vscode.TreeView<MutationNode>;
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

/** Faz 14b: diff'siz L2 kanıtı, tek bir açık dosya için (`--per-test-target`, Faz 14a). */
export function registerPerTestForFileCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('coverdict.perTestForFile', () => runPerTestForFile(context, output, sinks));
}

/** Faz 20: mutasyon testi - tek sınıf (önerilen) ve modül geneli (onay arkasında). */
export function registerMutationCommands(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('coverdict.mutationForFile', () => runMutationForFile(context, output, sinks)),
		vscode.commands.registerCommand('coverdict.mutationForModule', () => runMutationForModule(context, output, sinks)),
		vscode.commands.registerCommand('coverdict.mutationView.toggleSurvivorsOnly', () => {
			const on = sinks.mutationView.toggleSurvivorsOnly();
			vscode.window.setStatusBarMessage(on ? 'coverdict: sadece hayatta kalan mutantlar' : 'coverdict: bütün mutantlar', 2000);
		}),
	];
}

/**
 * Faz 24 (§7.6 madde 5): `PSEUDO_TESTED_METHOD` bulgusu (Test Kalitesi) ile
 * mutasyon ağacındaki "HAYATTA KALDI" (Mutasyon) aynı olguyu bağlantısız
 * anlatıyordu - kullanıcı ikisini elle eşleştirmek zorundaydı. `reveal()`
 * her iki yönde de gerçek veriyle eşleşme arıyor; eşleşme yoksa (mutasyon
 * verisi hiç yok ya da güncel değil) sessizce başarısız olmak yerine
 * sebebini söylüyor (hard rule 3a).
 */
export function registerQualityMutationBridgeCommands(sinks: CoverageSinks): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('coverdict.qualityView.showInMutation', (node: unknown) => {
			const finding = (node as { kind?: string; finding?: Finding } | undefined)?.finding;
			const parsed = finding?.productionMethod ? parseProductionMethod(finding.productionMethod) : undefined;
			if (!parsed) {
				return;
			}
			const target = findMutationBridgeTarget(parsed.className, parsed.methodName, parsed.methodDescription);
			if (!target) {
				vscode.window.showInformationMessage("coverdict: bu metot için güncel mutasyon verisi yok - önce bu sınıf için Mutasyon Testi çalıştırın.");
				return;
			}
			void sinks.mutationTreeView.reveal(target, { select: true, focus: true, expand: true });
		}),
		vscode.commands.registerCommand('coverdict.mutationView.showInQuality', (node: unknown) => {
			const n = node as MutationNode | undefined;
			if (n?.kind !== 'method') {
				return;
			}
			const target = findQualityBridgeTarget(productionMethodKey(n.className, n.method.methodName, n.method.methodDescription));
			if (!target) {
				vscode.window.showInformationMessage("coverdict: bu metot için Test Kalitesi'nde bir PSEUDO_TESTED_METHOD bulgusu yok.");
				return;
			}
			void sinks.qualityTreeView.reveal(target, { select: true, focus: true, expand: true });
		}),
	];
}

/**
 * Faz 18: kullanıcının "bunlar niye sağ tık copy yapılamıyoruz" sorusu.
 * VS Code'un TreeView'ı kendiliğinden kopyalama sunmuyor - her ağaç
 * öğesinin metnini panoya almak için açık bir komut gerekiyor. Ağaç
 * düğümünün kendisi argüman olarak geliyor, ondan okunabilir bir satır
 * üretiyoruz (kural kodu + dosya:satır + mesaj gibi).
 */
export function registerCopyCommands(sinks: CoverageSinks): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('coverdict.copyItem', (node: unknown) => {
			const text = describeNode(node);
			if (text) {
				void vscode.env.clipboard.writeText(text);
				vscode.window.setStatusBarMessage('coverdict: panoya kopyalandı', 2000);
			}
		}),
		// Faz 19: iki ayrı gruplama butonu yerine tek bir geçiş - tıkla,
		// diğer görünüme geçer; hangi modda olduğun durum çubuğu mesajında
		// söylenir (ikonun kendisi VS Code'da anlık değiştirilemiyor).
		vscode.commands.registerCommand('coverdict.qualityView.toggleGrouping', () => {
			const next = sinks.qualityView.getGrouping() === 'rule' ? 'file' : 'rule';
			sinks.qualityView.setGrouping(next);
			vscode.window.setStatusBarMessage(`coverdict: Test Kalitesi ${next === 'rule' ? 'kurala' : 'dosyaya'} göre gruplandı`, 2000);
		}),
		vscode.commands.registerCommand('coverdict.lineTestsView.toggleProblemsOnly', () => {
			const on = sinks.lineTestsView.toggleProblemsOnly();
			vscode.window.setStatusBarMessage(on ? 'coverdict: sadece sorunlu satırlar' : 'coverdict: bütün satırlar', 2000);
		}),
		vscode.commands.registerCommand('coverdict.qualityView.filter', async () => {
			const filter = await vscode.window.showInputBox({
				title: 'Test Kalitesi bulgularını filtrele',
				prompt: 'Kural adı, dosya yolu, test metodu veya mesaj içinde arar. Filtreyi kaldırmak için boş bırakın.',
				value: sinks.qualityView.getFilter(),
				placeHolder: 'örn. doğrulama, Calculator, TAUTOLOGICAL',
			});
			if (filter !== undefined) {
				sinks.qualityView.setFilter(filter);
			}
		}),
	];
}

/** Ağaç düğümlerinden panoya yazılacak düz metin - tanımadığımız bir şekle `undefined` döner, uydurmaz. */
function describeNode(node: unknown): string | undefined {
	if (!node || typeof node !== 'object') {
		return undefined;
	}
	const n = node as { kind?: string; finding?: Finding; reason?: Reason; rule?: string; path?: string; rawTestId?: string; startLine?: number; endLine?: number };
	if (n.kind === 'finding' && n.finding) {
		return `${n.finding.rule} ${n.finding.path}:${n.finding.startLine} ${n.finding.testMethod ?? ''} - ${n.finding.message}`.trim();
	}
	if (n.kind === 'warning' && n.reason) {
		return `${n.reason.code}: ${n.reason.message}`;
	}
	if (n.kind === 'rule' && n.rule) {
		return n.rule;
	}
	if (n.kind === 'file' && n.path) {
		return n.path;
	}
	if (n.kind === 'prodTest' && n.rawTestId) {
		return n.rawTestId;
	}
	if (n.kind === 'prodLine' && n.startLine !== undefined) {
		return n.startLine === n.endLine ? `Satır ${n.startLine}` : `Satır ${n.startLine}-${n.endLine}`;
	}
	return undefined;
}

/** The subset of a parsed verdict `publishAnalysis` needs - deliberately flat so both a fresh CLI run and a restore from storage can build it without a fake `VerdictDocument`. */
export interface AnalysisResult {
	fileCoverage: FileCoverageBlock | undefined;
	overall: MetricSet;
	newCode: NewCodeCoverage;
	changedFiles: readonly ChangedFile[];
	findings: readonly Finding[];
	warnings: readonly Reason[];
	/** Faz 21: kaynak/test kökleri - "Satır → Testler"in yön kararı buna bakar. */
	modules: readonly ModuleInput[];
}

export function analysisResultFrom(verdict: VerdictDocument): AnalysisResult {
	return {
		fileCoverage: verdict.fileCoverage,
		overall: verdict.coverage.overall,
		newCode: verdict.coverage.newCode,
		changedFiles: verdict.changedFiles,
		findings: verdict.findings,
		warnings: verdict.warnings,
		modules: verdict.inputs.modules,
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
		paintCoverage(sinks, workspaceRoot, result.fileCoverage, result.findings);
		showCoverageSummary(sinks.statusBarItem, result.overall, isGutterVisible(), readBadgeMetric(workspaceRoot), result.newCode);
	} else {
		showNoFileCoverageWarning(sinks.statusBarItem);
		sinks.explorerBadges.clear();
		clearGutterCoverage(sinks.gutterTypes);
	}

	publishFindings(sinks.diagnostics, workspaceRoot, result.findings);
	sinks.runView.refresh();
	sinks.coverageView.refresh();
	sinks.qualityView.refresh();
	sinks.lineTestsView.refresh();
}

function toggleCoverage(sinks: CoverageSinks): void {
	const state = getCoverageState();
	if (!state?.fileCoverage) {
		vscode.window.showInformationMessage('coverdict: henüz coverage verisi yok - önce "coverdict: Analiz Et" komutunu çalıştırın.');
		return;
	}

	const nextVisible = !isGutterVisible();
	setGutterVisible(nextVisible);

	if (nextVisible) {
		paintCoverage(sinks, state.workspaceRoot, state.fileCoverage, state.findings);
	} else {
		sinks.explorerBadges.clear();
		clearGutterCoverage(sinks.gutterTypes);
	}
	showCoverageSummary(sinks.statusBarItem, state.overall, nextVisible, readBadgeMetric(state.workspaceRoot), state.newCode);
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

	const classpathPath = await ensurePerTestClasspath(folder, output);
	if (!classpathPath) {
		return;
	}
	const parsed = await runAnalyzeCore(context, output, folder, diffMode, {
		perTest: { classpathModuleId: MODULE_ID, classpathPath },
		progressTitle: 'coverdict: derin tarama',
	});
	if (!parsed) {
		return;
	}

	publishAnalysis(sinks, folder.uri.fsPath, analysisResultFrom(parsed));
	setPerTestState({ moduleId: MODULE_ID, perTest: parsed.perTest, warnings: parsed.warnings });
	if (!parsed.perTest) {
		vscode.window.showWarningMessage('coverdict: bu koşuda test bazlı (per-test) kanıt yok - PER_TEST_* uyarıları için çıktı kanalını kontrol edin.');
	}
	revealLineTestsView(sinks);
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
	const classpathPath = await ensurePerTestClasspath(folder, output);
	if (!classpathPath) {
		return;
	}
	const parsed = await runAnalyzeCore(context, output, folder, diffMode, {
		perTest: { classpathModuleId: MODULE_ID, classpathPath, targets: [className] },
		progressTitle: `coverdict: ${className.split('.').pop()} için test kanıtı`,
	});
	if (!parsed) {
		return;
	}

	publishAnalysis(sinks, folder.uri.fsPath, analysisResultFrom(parsed));
	setPerTestState({ moduleId: MODULE_ID, perTest: parsed.perTest, warnings: parsed.warnings });
	if (!parsed.perTest) {
		vscode.window.showWarningMessage(`coverdict: ${className} için test bazlı kanıt yok - PER_TEST_* uyarıları için çıktı kanalını kontrol edin.`);
	}
	revealLineTestsView(sinks);
}

/**
 * Faz 20: tek sınıf için mutasyon testi - **önerilen ve varsayılan yol**.
 * `--mutation-target` (D-71) diff gerektirmez, `--no-vcs` altında bile
 * çalışır ve tek bir sınıf genelde saniyeler sürer. Modül geneli koşu
 * ayrı bir komut ve ayrı bir onayın arkasında (`runMutationForModule`),
 * çünkü büyük bir modülde 70-90 dakikayı bulabiliyor.
 */
async function runMutationForFile(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showErrorMessage('coverdict: önce bir klasör açın.');
		return;
	}
	const editor = vscode.window.activeTextEditor;
	if (editor?.document.languageId !== 'java') {
		vscode.window.showErrorMessage('coverdict: mutasyon testi çalıştırmak için bir Java dosyası açın.');
		return;
	}
	const className = detectClassName(editor.document.getText(), path.basename(editor.document.fileName, '.java'));
	await runMutation(context, output, sinks, folder, [className], `coverdict: ${className.split('.').pop()} mutasyon testi`);
}

/**
 * Faz 20: modül geneli mutasyon. Asla otomatik tetiklenmez ve her seferinde
 * onay ister - süre hedef sayısıyla doğrusal büyüyor ve kullanıcı buna
 * bilerek girmeli. Onay metni bütçeyi de söyler, çünkü bütçe aşılırsa
 * sonuç kısmi kalır.
 */
async function runMutationForModule(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showErrorMessage('coverdict: önce bir klasör açın.');
		return;
	}
	const timeout = readMutationTimeout(folder);
	const choice = await vscode.window.showWarningMessage(
		'Mutasyon testi tüm modül için çalıştırılacak.',
		{
			modal: true,
			detail: `Bu koşu uzun sürebilir - büyük bir modülde bir saati aşabilir. Modül başına zaman bütçesi ${timeout} saniye (coverdict.mutationTimeout); aşılırsa koşu durdurulur ve sonuç kısmi kalır.\n\nTek bir sınıf için genelde saniyeler yeterlidir: o dosyada sağ tık → "Bu Sınıf İçin Mutasyon Testi".`,
		},
		'Devam Et',
	);
	if (choice !== 'Devam Et') {
		return;
	}
	// Hedef verilmiyor: CLI diff'teki değişen production sınıflarını hedefler.
	await runMutation(context, output, sinks, folder, [], 'coverdict: mutasyon testi (modül)');
}

/** İki mutasyon girişinin ortak gövdesi. `targets` boşsa CLI diff'ten hedef türetir (bu durumda bir diff modu şart). */
async function runMutation(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	sinks: CoverageSinks,
	folder: vscode.WorkspaceFolder,
	targets: readonly string[],
	progressTitle: string,
): Promise<void> {
	const diffMode = readDiffMode(folder);
	if (!diffMode) {
		return;
	}
	if (targets.length === 0 && diffMode.kind === 'no-vcs') {
		vscode.window.showErrorMessage('coverdict: modül geneli mutasyon bir diff gerektirir - coverdict.diffMode "no-vcs" iken hedeflenecek değişen sınıf yok. Tek bir sınıf için o dosyada sağ tık → "Bu Sınıf İçin Mutasyon Testi".');
		return;
	}

	const classpathPath = await ensurePerTestClasspath(folder, output);
	if (!classpathPath) {
		return;
	}
	const parsed = await runAnalyzeCore(context, output, folder, diffMode, {
		// Faz 19'un classpath üreticisi aynen kullanılıyor - CLI iki bayrağı
		// ayrı opt-in sayıyor ama dosya biçimi birebir aynı.
		mutation: { classpathModuleId: MODULE_ID, classpathPath, targets, timeoutSeconds: readMutationTimeout(folder) },
		progressTitle,
	});
	if (!parsed) {
		return;
	}

	publishAnalysis(sinks, folder.uri.fsPath, analysisResultFrom(parsed));
	setMutationState({ moduleId: MODULE_ID, mutation: parsed.mutation, warnings: parsed.warnings, targets, ranAt: Date.now() });
	sinks.mutationView.refresh();
	void vscode.commands.executeCommand('coverdict.mutationView.focus');
}

function readMutationTimeout(folder: vscode.WorkspaceFolder): number {
	return vscode.workspace.getConfiguration('coverdict', folder).get<number>('mutationTimeout') ?? 300;
}

/** Faz 15c/15e: yeni "Satır → Testler" kenar çubuğu görünümüne odaklanır - eski webview'in aksine, tıklanınca kendini boşaltmaz (o hatanın doğrudan dersi, bkz. `ui/treeViews/lineTestsView.ts`). */
function revealLineTestsView(sinks: CoverageSinks): void {
	sinks.lineTestsView.refresh();
	void vscode.commands.executeCommand('coverdict.lineTestsView.focus');
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
interface EvidenceOptions {
	perTest?: { classpathModuleId: string; classpathPath: string; targets?: readonly string[] };
	/** Faz 20: L3. Verildiğinde ilerleme bildirimi de mutasyon diliyle konuşur ve iptal süreç ağacını öldürür. */
	mutation?: { classpathModuleId: string; classpathPath: string; targets?: readonly string[]; timeoutSeconds?: number };
	/** Bildirim başlığı - mutasyon dakikalar/saatler sürebildiği için "analiz ediliyor" yetersiz kalıyor. */
	progressTitle?: string;
}

async function runAnalyzeCore(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	folder: vscode.WorkspaceFolder,
	diffMode: DiffMode,
	evidence: EvidenceOptions = {},
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
		perTest: evidence.perTest,
		mutation: evidence.mutation,
	});

	output.appendLine(`coverdict: java -jar ${jarPath} ${args.join(' ')}`);

	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: evidence.progressTitle ?? 'coverdict: analiz ediliyor', cancellable: true },
		async (progress, token) => {
			// Faz 20: CLI'ın stderr ilerleme akışı nihayet tüketiliyor
			// (`cli/progressParser.ts` - Faz 1'den beri yorumda söz verilmiş,
			// hiç yazılmamıştı). Tanınan satır bildirime yazılır, tanınmayan
			// satır Output'a **aynen** gider: biçim değişirse yanlış yüzde
			// göstermektense hiç göstermemek yeğdir (hard rule 3a).
			let done = 0;
			const handle = run({
				javaExecutable, jarPath, args,
				onStderrLine: (line) => {
					output.appendLine(line);
					const event = parseProgressLine(line);
					if (!event) {
						return;
					}
					const step = incrementFor(event, done);
					if (step) {
						done = step.done;
					}
					progress.report({ increment: step?.increment, message: progressMessage(event) });
				},
			});
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

			// Faz 19: tarama sonrası açılır bildirim tamamen kaldırıldı.
			// Aynı sayı zaten durum çubuğunda, Coverage ağacında ve Explorer
			// rozetlerinde duruyor - her koşuda ekranın köşesinde bir kutu
			// açmak sadece dikkat dağıtıyordu. `analysis.status` "incomplete"
			// ise gerçekten bir şey söylenmesi gerekir; o hâlâ uyarılıyor.
			if (parsed.value.analysis.status === 'incomplete') {
				vscode.window.showWarningMessage('coverdict: analiz eksik tamamlandı - Coverage görünümündeki "Uyarılar" bölümüne bakın.');
			}

			return parsed.value;
		},
	);
}

/**
 * Faz 19: derin taramanın classpath listesi eksikse (ilk kez çalıştırılıyor
 * ya da `mvn clean` sildi) kullanıcıyı elle üretmeye göndermek yerine
 * eklenti kendisi üretir. Kullanıcı yalnızca bir kez "Üret" der; iptal
 * ederse tarama hiç başlamaz - yarım bir listeyle koşup
 * `PER_TEST_CLASSPATH_MISSING` uyarısına düşmekten iyidir.
 * Dosya varsa hiçbir şey sorulmaz.
 */
async function ensurePerTestClasspath(folder: vscode.WorkspaceFolder, output: vscode.OutputChannel): Promise<string | undefined> {
	const classpathPath = vscode.workspace.getConfiguration('coverdict', folder).get<string>('perTestClasspathPath') || 'target/coverdict-classpath.txt';
	if (fs.existsSync(path.join(folder.uri.fsPath, classpathPath))) {
		return classpathPath;
	}

	const choice = await vscode.window.showInformationMessage(
		`coverdict: derin tarama için classpath listesi gerekli ama ${classpathPath} yok. Maven ile şimdi üretilsin mi?`,
		'Üret',
		'Vazgeç',
	);
	if (choice !== 'Üret') {
		return undefined;
	}

	const built = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'coverdict: classpath listesi üretiliyor (mvn)', cancellable: false },
		() => buildPerTestClasspath(folder.uri.fsPath, classpathPath, output),
	);
	if (!built.ok) {
		vscode.window.showErrorMessage(`coverdict: ${built.message}`);
		return undefined;
	}
	output.appendLine(`coverdict: ${built.message}`);
	return classpathPath;
}

/** `coverdict.badgeMetric`'i tekli okuma noktası - durum çubuğu başlığı, rozetler ve gutter aynı ayarı, aynı şekilde okur (madde 2). */
function readBadgeMetric(workspaceRoot: string): BadgeMetric {
	return vscode.workspace.getConfiguration('coverdict', vscode.Uri.file(workspaceRoot)).get<BadgeMetric>('badgeMetric') ?? 'sonar-compatible';
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
function paintCoverage(sinks: CoverageSinks, workspaceRoot: string, fileCoverage: FileCoverageBlock, findings: readonly Finding[]): void {
	if (!isGutterVisible()) {
		sinks.explorerBadges.clear();
		clearGutterCoverage(sinks.gutterTypes);
		return;
	}

	const config = vscode.workspace.getConfiguration('coverdict', vscode.Uri.file(workspaceRoot));
	const showExplorerBadges = config.get<boolean>('show.explorerBadges') ?? true;
	const showLineGutter = config.get<boolean>('show.lineGutter') ?? true;
	const showOraclelessLines = config.get<boolean>('show.oraclelessLines') ?? true;
	const badgeMetric = readBadgeMetric(workspaceRoot);

	if (showExplorerBadges) {
		sinks.explorerBadges.update(workspaceRoot, fileCoverage, badgeMetric);
	} else {
		sinks.explorerBadges.clear();
	}

	if (showLineGutter) {
		// Faz 15d: a JaCoCo-green line every covering test has a real
		// oracle-quality finding against gets its own decoration instead of
		// blending into "covered" - only computed when the setting is on and
		// there is per-test evidence to compute it from (no perTest -> no claim).
		const perTest = getPerTestState();
		const falseGreenLinesByPath = showOraclelessLines && perTest?.perTest
			? buildFalseGreenIndex(perTest.perTest, perTest.moduleId, findings, fileCoverage, DEFAULT_SOURCE_ROOTS)
			: new Map();
		applyGutterCoverage(sinks.gutterTypes, workspaceRoot, fileCoverage, getStaleFiles(), falseGreenLinesByPath);
	} else {
		clearGutterCoverage(sinks.gutterTypes);
	}
}

