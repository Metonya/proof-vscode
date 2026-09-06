import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { buildAnalyzeArgs, type DiffMode, type TargetBinding } from '../cli/argsBuilder';
import { locateJar } from '../cli/jarLocator';
import { interpretMavenFailure } from '../cli/mavenErrorInterpreter';
import { incrementFor, parseProgressLine, progressMessage } from '../cli/progressParser';
import { moduleForPath, toRepoRelativePosix } from '../cli/reportDiscovery';
import { run } from '../cli/runner';
import { buildFalseGreenIndex } from '../model/falseGreenIndex';
import type { BadgeMetric } from '../model/metrics';
import { detectClassName } from '../model/classNameDetector';
import { findKillContribution, parseProductionMethod, productionMethodKey } from '../model/mutationModel';
import { classNameFromPath, toAbsolutePath } from '../model/pathIndex';
import { buildProductionClassIndex, productionSourceRoots } from '../model/productionClassIndex';
import {
	getCoverageState,
	getMutationState,
	getPerTestState,
	getStaleFiles,
	isGutterVisible,
	setCoverageState,
	setGutterVisible,
	setMutationState,
	setPerTestState,
} from '../model/store';
import { parseVerdict } from '../verdict/parse';
import { parseTestIdentity } from '../verdict/testIdentity';
import type { ChangedFile, FileCoverageBlock, Finding, MetricSet, ModuleInput, MutationBlock, NewCodeCoverage, PerTestBlock, Reason, VerdictDocument } from '../verdict/types';
import { publishFindings } from './diagnostics';
import type { ExplorerBadgeProvider } from './explorerBadges';
import { applyGutterCoverage, clearGutterCoverage, type GutterDecorationTypes } from './gutterRenderer';
import { runTestsTask } from './mavenTestTask';
import { offerToOpenSetting, resolveEvidenceClasspaths, resolveReportBinding, resolveRunTestsModuleScope, type ClasspathKind } from './preflight';
import { showCoverageSummary, showNoFileCoverageWarning } from './statusBar';
import type { CoverageTreeProvider } from './treeViews/coverageView';
import type { LineTestsNode, LineTestsTreeProvider } from './treeViews/lineTestsView';
import { findMutationBridgeTarget, type MutationNode, type MutationTreeProvider } from './treeViews/mutationView';
import { findQualityBridgeTarget, type QualityNode, type QualityTreeProvider } from './treeViews/qualityView';
import type { RunTreeProvider } from './treeViews/runView';
import { resolveWorkspaceEnv } from './workspaceEnv';


/**
 * Faz 25 (§7.5): `verdict-current.json` her koşu üzerine yazılır - bir
 * Hızlı/Derin Tarama mutation bloğu taşımadığı için mutasyon sonucunu
 * orada saklamak onu bir sonraki taramada sessizce siliyordu (kullanıcının
 * kendi bulduğu gerçek durum, 2026-08-28: mutasyon çalıştırıldı, sonra
 * Derin Tarama yapıldı, pencere yenilenince mutasyon sonucu gitmişti).
 * Artık kendi dosyasında, kendi gerçek zaman damgasıyla ayrı yaşıyor -
 * CLI'ın çıktısı zaman damgası taşımadığı için (D-xx) bunu biz, yazdığımız
 * anda ekliyoruz; restoreLastCoverageFrom bunu geri okuyunca "ne zaman
 * çalıştı" artık tahmin değil gerçek bir değer.
 */
export const MUTATION_STORAGE_FILE = 'mutation-current.json';

export interface MutationSnapshot {
	mutation: MutationBlock;
	warnings: readonly Reason[];
	targets: readonly string[];
	ranAtMs: number;
}

/**
 * Faz 28 (§7.5b): tam olarak Faz 25'in mutasyon için çözdüğü sorunun
 * perTest tarafındaki eşi - kullanıcının canlı yakaladığı gerçek durum
 * (2026-08-28): Hızlı Tarama → Derin Tarama → Mutasyon Testi sırayla
 * çalıştırıldı (üçü de gerçek veri üretti), pencere kapatılıp açıldı,
 * "Satır → Testler" boştu. Sebep: Mutasyon Testi `--per-test-report`
 * içermiyor, o yüzden **son** koşu olarak `verdict-current.json`'ı
 * perTest'siz bir haliyle üzerine yazdı - Derin Tarama'nın topladığı
 * perTest verisi hâlâ ağaçta duruyordu (bellekte) ama disk'e hiç
 * yazılmamış oluyordu bir sonraki pencere için. Aynı reçete: kendi
 * dosyasında, `verdict-current.json`'dan bağımsız yaşar.
 */
export const PERTEST_STORAGE_FILE = 'pertest-current.json';

export interface PerTestSnapshot {
	perTest: PerTestBlock;
	warnings: readonly Reason[];
}

/** Best-effort: bir koşunun test bazlı/mutasyon sonucunu diske yazamamak koşunun kendisini başarısız saymaz - sonuç zaten ekranda, yalnızca bir sonraki pencere yenilemesinde kaybolur. Sebep Output kanalına gider, kullanıcıyı bir hata diyaloğuyla kesmez. */
async function writeJsonSnapshot(context: vscode.ExtensionContext, output: vscode.OutputChannel, fileName: string, data: unknown, failureNoun: string): Promise<void> {
	const storageRoot = context.storageUri;
	if (!storageRoot) {
		return;
	}
	try {
		await vscode.workspace.fs.createDirectory(storageRoot);
		const outUri = vscode.Uri.joinPath(storageRoot, fileName);
		await fs.promises.writeFile(outUri.fsPath, JSON.stringify(data), 'utf8');
	} catch (e) {
		output.appendLine(`proof-java: ${failureNoun} kalıcı depolamaya yazılamadı (pencere yenilenince kaybolur): ${(e as Error).message}`);
	}
}

/**
 * Faz 9: hem gutter (`gutterTypes`) hem Explorer rozetleri
 * (`explorerBadges`) artık tamamen bizim çizdiğimiz, tam kontrolümüzde iki
 * ayrı yüzey - native Test Coverage API'sinin "addCoverage sonrası hangi
 * yüzeyin çizileceğine VS Code karar verir" kısıtı yok (bkz. plan). Her
 * ikisi de `proof.show.*` ayarlarına göre `paintCoverage`'da bağımsız
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
	/** Faz 26: Mutasyon → Satır → Testler köprüsü de `reveal()` kullanıyor. */
	lineTestsTreeView: vscode.TreeView<LineTestsNode>;
	/** Faz 20: L3 mutasyon raporu - beşinci görünüm. */
	mutationView: MutationTreeProvider;
	/** Faz 24: bkz. `qualityTreeView`. */
	mutationTreeView: vscode.TreeView<MutationNode>;
}

export function registerAnalyzeCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('proof.analyze', () => runAnalyze(context, output, sinks));
}

/** Faz 30 (§7.8): kullanıcının "kolay tekrar koş" isteği - her zaman erişilebilir, `runAnalyzeCore`'un içindeki "rapor yok, testleri koşalım mı?" teklifinden bağımsız olarak. Maven başarılıysa Hızlı Tarama'yı otomatik tetikler - tek eylem gibi hissettiren şey bu. */
export function registerRunTestsCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('proof.runTests', async () => {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			vscode.window.showErrorMessage('proof-java: önce bir klasör açın.');
			return;
		}
		// Faz 31: prefer this window's own in-memory scan (exact, no prompt) -
		// scope the build to it via `-pl ... -am` instead of the whole
		// reactor. Real gson testing found a second bug here: "only 1 module
		// bound -> skip scoping" is wrong whenever that one root is a real
		// submodule name (`gson`), not the trivial single-project root (`.`)
		// - gson's reactor has 7 modules, but only `gson` ever produces a
		// jacoco.xml (`test-jpms` crashes before it gets one), so exactly 1
		// module was "bound" while the reactor itself still has many - the
		// old `length > 1` check treated that 1 as "no real choice to make"
		// and ran the whole reactor unscoped anyway, straight into test-jpms.
		// A fresh window (or one that just hasn't scanned yet) has no bound
		// modules at all, even when a jacoco.xml already exists on disk from
		// an earlier session; that case falls back to the same pom.xml-based
		// discovery the first-ever "run tests" offer uses
		// (`resolveRunTestsModuleScope`), so the button is scoped correctly
		// from its very first click too, not only after this window's own
		// first successful scan.
		const boundModules = getCoverageState()?.modules;
		let moduleRoots: readonly string[] | undefined;
		if (boundModules) {
			moduleRoots = moduleRootsFromBoundModules(boundModules);
		} else {
			const scope = await resolveRunTestsModuleScope(folder);
			if (!scope) {
				return;
			}
			moduleRoots = scope.moduleRoots;
		}
		const result = await runTestsTask(folder, output, moduleRoots);
		if (result?.success) {
			await runAnalyze(context, output, sinks);
		} else if (result && !result.success) {
			const interpretation = interpretMavenFailure(result.capturedOutput);
			const reasonSuffix = interpretation ? ` Sebep: ${interpretation.detail}` : ' Ayrıntı için terminaldeki çıktıya bakın.';
			vscode.window.showErrorMessage(`proof-java: Maven başarısız oldu.${reasonSuffix}`);
		}
		sinks.runView.refresh();
	});
}

/**
 * Faz 31: real bug, found live against gson - "exactly 1 module bound"
 * does NOT mean "no real choice to make". gson's reactor has 7 modules,
 * but only `gson` ever produces a jacoco.xml (`test-jpms` crashes before
 * it gets one), so exactly 1 module gets bound while the reactor itself
 * still has many - treating that 1 as equivalent to a true single-module
 * repo ran the whole reactor unscoped anyway, straight into test-jpms.
 * The only case that is genuinely a no-op to scope is the trivial
 * single-project root (`root: '.'`, no real submodule name at all).
 */
export function moduleRootsFromBoundModules(boundModules: readonly { root: string }[]): readonly string[] | undefined {
	const roots = boundModules.map((m) => m.root);
	return roots.length === 1 && roots[0] === '.' ? undefined : roots;
}

/** F3: a diff-mode run with --per-test-report, superset of the plain scan (still paints coverage with the same fileCoverage data). */
export function registerAnalyzePerTestCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('proof.analyzePerTest', () => runAnalyzePerTest(context, output, sinks));
}

/** F4: toggles both surfaces together for the last analyze run's data - no re-scan, just republish or clear what is already in model/store. */
export function registerToggleCoverageCommand(sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('proof.toggleCoverage', () => toggleCoverage(sinks));
}

/** Faz 14b: diff'siz L2 kanıtı, tek bir açık dosya için (`--per-test-target`, Faz 14a). */
export function registerPerTestForFileCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('proof.perTestForFile', () => runPerTestForFile(context, output, sinks));
}

/** Faz 31: diff hiç hedef bulamadığında Satır → Testler'in sunduğu "yine de tüm modülü tara" kurtarma eylemi. */
export function registerPerTestForModuleAllCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable {
	return vscode.commands.registerCommand('proof.perTestForModuleAll', () => runAnalyzePerTestAll(context, output, sinks));
}

/** Faz 20: mutasyon testi - tek sınıf (önerilen) ve modül geneli (onay arkasında). */
export function registerMutationCommands(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('proof.mutationForFile', () => runMutationForFile(context, output, sinks)),
		vscode.commands.registerCommand('proof.mutationForModule', () => runMutationForModule(context, output, sinks)),
		// Faz 31: diff hiç hedef bulamadığında Mutasyon görünümünün sunduğu "yine de tüm modülü tara" kurtarma eylemi.
		vscode.commands.registerCommand('proof.mutationForModuleAll', () => runMutationForModuleAll(context, output, sinks)),
		vscode.commands.registerCommand('proof.mutationView.toggleSurvivorsOnly', () => {
			const on = sinks.mutationView.toggleSurvivorsOnly();
			vscode.window.setStatusBarMessage(on ? 'proof-java: sadece hayatta kalan mutantlar' : 'proof-java: bütün mutantlar', 2000);
		}),
	];
}

/**
 * D-78: insan-okur, dışa aktarılabilir HTML rapor - hiç yeniden taramaz.
 * İlk sürüm (D-75) her zaman taze bir diff-türetilmiş `analyze` koşusu
 * başlatıyordu; gerçek kullanıcı raporu bunun kırdığı iki şeyi gösterdi:
 * (1) o taze koşu diff'te hiç değişen sınıf bulamayınca boş dönüyordu,
 * bunu da her koşulda `setPerTestState`/`setMutationState`'e verip
 * kenar çubuğundaki gerçek, taze görünen sonucu sessizce eziyordu - tam
 * D-73/D-74'ün bir kez düzelttiği sessiz-üzerine-yazma hatası; (2)
 * kullanıcının kendi beklentisi zaten "en güncel taramayla gelmesi" idi,
 * yeni bir (ve dar kapsamlı) analiz değil. Şimdi bu komut CLI'ı hiç
 * `analyze` ile çağırmıyor - `verdict-current.json`'ı (her taramadan
 * sonra zaten diskte) `pertest-current.json`/`mutation-current.json`
 * varsa onlarla birleştirip yeni `proof-java render-html` komutuna
 * veriyor (`RenderHtmlCommand`, D-78) - sıfır yeniden-analiz maliyeti,
 * kenar çubuğu state'ine hiç dokunmuyor, sonuç kanıtlanabilir şekilde
 * ekranda zaten görünenin ta kendisi.
 */
export function registerExportReportCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel): vscode.Disposable {
	return vscode.commands.registerCommand('proof.exportReport', () => runExportReport(context, output));
}

/** Çalıştır panelinin başlık çubuğundaki dişli ikonu - `proof.*` ayarlarına, Ayarlar sekmesinde "proof-java" ile filtrelenmiş halde götürür. Kullanıcının kendi klasörüne özgü ayarları görmesi için workspace scope'unda açılır. */
export function registerOpenSettingsCommand(): vscode.Disposable {
	return vscode.commands.registerCommand('proof.openSettings', () => {
		void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:proof-java.proof-vscode');
	});
}

/** `context.storageUri` altındaki bir anlık görüntüyü okur; dosya yoksa (o kanıt hiç toplanmamış) veya bozuksa `undefined` döner - hangisi olduğu çağıranı ilgilendirmiyor, ikisinde de o blok birleştirilmeden atlanır. */
async function readJsonSnapshotIfPresent(storageRoot: vscode.Uri, fileName: string): Promise<Record<string, unknown> | undefined> {
	try {
		const raw = await fs.promises.readFile(vscode.Uri.joinPath(storageRoot, fileName).fsPath, 'utf8');
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

async function runExportReport(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showErrorMessage('proof-java: önce bir klasör açın.');
		return;
	}
	const storageRoot = context.storageUri;
	if (!storageRoot) {
		vscode.window.showErrorMessage('proof-java: bu pencerede workspace depolaması yok (bir klasör yerine tek dosya mı açık?) - rapor dışa aktarılamaz.');
		return;
	}

	const verdict = await readJsonSnapshotIfPresent(storageRoot, 'verdict-current.json');
	if (!verdict) {
		vscode.window.showErrorMessage('proof-java: henüz bir tarama yok - önce "proof-java: Hızlı Tarama" (veya Derin Tarama/Mutasyon Testi) çalıştırın.');
		return;
	}

	// pertest-current.json/mutation-current.json kasıtlı olarak ayrı dosyalar
	// (bkz. bu dosyanın başındaki MUTATION_STORAGE_FILE/PERTEST_STORAGE_FILE
	// yorumu) - varsa splice edilir, yoksa o blok basitçe eksik kalır (hard
	// rule 3a: hiç toplanmamış kanıt sessizce uydurulmaz).
	const perTestSnapshot = await readJsonSnapshotIfPresent(storageRoot, PERTEST_STORAGE_FILE);
	if (perTestSnapshot?.perTest) {
		verdict.perTest = perTestSnapshot.perTest;
	}
	const mutationSnapshot = await readJsonSnapshotIfPresent(storageRoot, MUTATION_STORAGE_FILE);
	if (mutationSnapshot?.mutation) {
		verdict.mutation = mutationSnapshot.mutation;
	}

	const jarPath = locateJar(folder);
	if (!jarPath) {
		void offerToOpenSetting('proof-java: proof-java.jar bulunamadı. proof.jarPath ayarını yapın veya proof-java-cli/target/proof-java.jar konumunda bir tane derleyin.', 'proof.jarPath');
		return;
	}

	const target = await vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.joinPath(folder.uri, 'proof-report.html'),
		filters: { HTML: ['html'] },
		saveLabel: 'Dışa Aktar',
		title: 'proof-java: Raporu Dışa Aktar',
	});
	if (!target) {
		return;
	}

	const composedUri = vscode.Uri.joinPath(storageRoot, 'export-verdict.json');
	await vscode.workspace.fs.writeFile(composedUri, Buffer.from(JSON.stringify(verdict), 'utf8'));

	const javaExecutable = vscode.workspace.getConfiguration('proof', folder).get<string>('javaExecutable') || 'java';
	const args = ['render-html', '--in', composedUri.fsPath, '--out', target.fsPath];
	output.appendLine(`proof-java: java -jar ${jarPath} ${args.join(' ')}`);

	const result = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'proof-java: rapor dışa aktarılıyor' },
		async () => {
			try {
				return await run({ javaExecutable, jarPath, args, env: resolveWorkspaceEnv(folder) }).result;
			} catch (e) {
				vscode.window.showErrorMessage(`proof-java: "${javaExecutable}" çalıştırılamadı: ${(e as Error).message}`);
				return undefined;
			}
		},
	);
	if (!result) {
		return;
	}
	output.appendLine(result.stdout);
	if (result.exitCode !== 0) {
		vscode.window.showErrorMessage(`proof-java: rapor oluşturulamadı (çıkış kodu ${result.exitCode}). ${result.stderr.trim()}`);
		return;
	}

	const choice = await vscode.window.showInformationMessage(`proof-java: rapor dışa aktarıldı: ${target.fsPath}`, 'Aç');
	if (choice === 'Aç') {
		void vscode.env.openExternal(target);
	}
}

/**
 * Faz 24 (§7.6 madde 5 ve 6): iki ayrı görünümün aynı olguyu bağlantısız
 * anlattığı iki gerçek durumu birbirine bağlar - `PSEUDO_TESTED_METHOD`
 * bulgusu (Test Kalitesi) ↔ mutasyon ağacındaki "HAYATTA KALDI" (madde
 * 5), ve statik analizin `INCONCLUSIVE` dediği bir test ↔ o testin
 * gerçekten öldürdüğü bir mutant (madde 6, aracın en değerli anı).
 * `reveal()` her yönde de gerçek veriyle eşleşme arıyor; eşleşme yoksa
 * (mutasyon verisi hiç yok ya da güncel değil) sessizce başarısız olmak
 * yerine sebebini söylüyor (hard rule 3a).
 */
export function registerQualityMutationBridgeCommands(sinks: CoverageSinks): vscode.Disposable[] {
	return [
		vscode.commands.registerCommand('proof.qualityView.showInMutation', (node: unknown) => {
			const finding = (node as { kind?: string; finding?: Finding } | undefined)?.finding;
			const parsed = finding?.productionMethod ? parseProductionMethod(finding.productionMethod) : undefined;
			if (!parsed) {
				return;
			}
			const target = findMutationBridgeTarget(parsed.className, parsed.methodName, parsed.methodDescription);
			if (!target) {
				vscode.window.showInformationMessage("proof-java: bu metot için güncel mutasyon verisi yok - önce bu sınıf için Mutasyon Testi çalıştırın.");
				return;
			}
			void sinks.mutationTreeView.reveal(target, { select: true, focus: true, expand: true });
		}),
		vscode.commands.registerCommand('proof.mutationView.showInQuality', (node: unknown) => {
			const n = node as MutationNode | undefined;
			if (n?.kind !== 'method') {
				return;
			}
			const target = findQualityBridgeTarget(productionMethodKey(n.className, n.method.methodName, n.method.methodDescription));
			if (!target) {
				vscode.window.showInformationMessage("proof-java: bu metot için Test Kalitesi'nde bir PSEUDO_TESTED_METHOD bulgusu yok.");
				return;
			}
			void sinks.qualityTreeView.reveal(target, { select: true, focus: true, expand: true });
		}),
		// Faz 24 (§7.6 madde 6): "Satır → Testler"deki bir INCONCLUSIVE test'ten,
		// o testin gerçekten öldürdüğü mutantın metoduna.
		vscode.commands.registerCommand('proof.lineTestsView.showInMutation', (node: unknown) => {
			const n = node as { kind?: string; rawTestId?: string } | undefined;
			if (n?.kind !== 'prodTest' || !n.rawTestId) {
				return;
			}
			const identity = parseTestIdentity(n.rawTestId);
			if (!identity.className || !identity.methodName) {
				return;
			}
			const mutationState = getMutationState();
			const contribution = mutationState?.mutation
				? findKillContribution(mutationState.mutation, identity.className, identity.methodName)
				: undefined;
			if (!contribution) {
				vscode.window.showInformationMessage('proof-java: bu test için mutasyon kanıtı yok - önce Mutasyon Testi çalıştırın.');
				return;
			}
			const target = findMutationBridgeTarget(contribution.className, contribution.methodName, contribution.methodDescription);
			if (!target) {
				vscode.window.showInformationMessage("proof-java: mutasyon verisi güncel değil - bu sınıf için Mutasyon Testi'ni tekrar çalıştırın.");
				return;
			}
			void sinks.mutationTreeView.reveal(target, { select: true, focus: true, expand: true });
		}),
		// Faz 26: mutasyon listesinde tıklamak zaten production satırına
		// gidiyordu ("Satıra Git") - bu, aynı satırı **kapsayan ama
		// yakalayamayan** testlere gitmenin yolu. SURVIVED bir mutantın
		// `killingTests`'i boş olduğu için tek kaynak perTest verisi -
		// "Satır → Testler" zaten o satırın tüm kapsayan testlerini oracle
		// kaliteleriyle birlikte gösteriyor, burada yeniden icat edilmiyor.
		vscode.commands.registerCommand('proof.mutationView.showInLineTests', async (node: unknown) => {
			const n = node as MutationNode | undefined;
			if (n?.kind !== 'mutant') {
				return;
			}
			const state = getCoverageState();
			const filePath = state?.fileCoverage ? buildProductionClassIndex(state.fileCoverage, productionSourceRoots(state.modules)).byClassName.get(n.className) : undefined;
			if (!state || !filePath) {
				vscode.window.showInformationMessage('proof-java: bu sınıfın dosyası bilinmiyor - önce fileCoverage üreten bir tarama çalıştırın.');
				return;
			}
			const uri = vscode.Uri.file(toAbsolutePath(state.workspaceRoot, filePath));
			const selection = new vscode.Range(n.mutant.line - 1, 0, n.mutant.line - 1, 0);
			const editor = await vscode.window.showTextDocument(uri, { selection });
			// `onDidChangeActiveTextEditor` should also fire this, but not
			// waiting on that timing - setting it directly from the editor
			// `showTextDocument` just gave us is unambiguous.
			sinks.lineTestsView.setActiveDocument(editor.document);
			const target = sinks.lineTestsView.nodeForLine(n.mutant.line);
			if (!target) {
				vscode.window.showInformationMessage("proof-java: bu satır için test bazlı kanıt yok - Derin Tarama ile toplayın.");
				return;
			}
			void sinks.lineTestsTreeView.reveal(target, { select: true, focus: true, expand: true });
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
		vscode.commands.registerCommand('proof.copyItem', (node: unknown) => {
			const text = describeNode(node);
			if (text) {
				void vscode.env.clipboard.writeText(text);
				vscode.window.setStatusBarMessage('proof-java: panoya kopyalandı', 2000);
			}
		}),
		// Faz 19: iki ayrı gruplama butonu yerine tek bir geçiş - tıkla,
		// diğer görünüme geçer; hangi modda olduğun durum çubuğu mesajında
		// söylenir (ikonun kendisi VS Code'da anlık değiştirilemiyor).
		vscode.commands.registerCommand('proof.qualityView.toggleGrouping', () => {
			const next = sinks.qualityView.getGrouping() === 'rule' ? 'file' : 'rule';
			sinks.qualityView.setGrouping(next);
			vscode.window.setStatusBarMessage(`proof-java: Test Kalitesi ${next === 'rule' ? 'kurala' : 'dosyaya'} göre gruplandı`, 2000);
		}),
		vscode.commands.registerCommand('proof.lineTestsView.toggleProblemsOnly', () => {
			const on = sinks.lineTestsView.toggleProblemsOnly();
			vscode.window.setStatusBarMessage(on ? 'proof-java: sadece sorunlu satırlar' : 'proof-java: bütün satırlar', 2000);
		}),
		vscode.commands.registerCommand('proof.qualityView.filter', async () => {
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

/**
 * Faz 31: real user report - right-clicking "Kopyala" on an `'empty'`
 * explanation node (the long "no changed class" message, real screenshot)
 * silently did nothing, because this function never had a case for it -
 * `vscode.env.clipboard.writeText` only runs when this returns a real
 * string. Broadened to every node kind across all four tree views that
 * carries real, copyable text; a still-unrecognized shape (a future node
 * kind added without updating this) keeps returning `undefined` rather
 * than guessing at a representation (hard rule 3a) - the button just does
 * nothing for it, same as today, instead of copying something wrong.
 *
 * Faz 31 follow-up, real user report: still silent on `proof.runView`'s
 * own items - `RunTreeProvider`'s `RunItem` (`ui/treeViews/runView.ts`) is
 * not a `{kind, ...}` data node at all, it *is* a `vscode.TreeItem`
 * subclass with a real `label`/`description` already set. The generic
 * fallback below covers that shape (and any other plain `TreeItem` this
 * extension ever right-clicks "Kopyala" on) without needing a `kind` field.
 */
interface DescribableNode {
	kind?: string; finding?: Finding; reason?: Reason; rule?: string; path?: string; rawTestId?: string;
	startLine?: number; endLine?: number; message?: string; text?: string; className?: string; methodName?: string;
	ref?: { outerClassName?: string; line?: number };
	method?: { methodName?: string; methodDescription?: string };
	mutant?: { line?: number; mutator?: string; status?: string };
	label?: string | { label: string };
	description?: string | boolean;
}

export function describeNode(node: unknown): string | undefined {
	if (!node || typeof node !== 'object') {
		return undefined;
	}
	const n = node as DescribableNode;
	return describeQualityOrCoverageNode(n) ?? describeTestOrMutationTreeNode(n) ?? describePlainTreeItem(n);
}

/** A plain `vscode.TreeItem` (or subclass) with no recognized `kind` - e.g. `runView.ts`'s `RunItem`. Uses whatever real label/description it already carries rather than guessing a shape. */
function describePlainTreeItem(n: DescribableNode): string | undefined {
	const label = typeof n.label === 'string' ? n.label : n.label?.label;
	if (!label) {
		return undefined;
	}
	return typeof n.description === 'string' ? `${label} - ${n.description}` : label;
}

/** Quality/coverage views' node kinds - `qualityView.ts`/`coverageView.ts`. */
function describeQualityOrCoverageNode(n: DescribableNode): string | undefined {
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
	return undefined;
}

/** Satır → Testler / Mutasyon views' node kinds - `lineTestsView.ts`/`mutationView.ts`; the two shared/generic kinds (`'empty'`, `'prodTest'`/`'killingTest'`) live here, view-specific kinds are split out below to keep this under the complexity limit. */
function describeTestOrMutationTreeNode(n: DescribableNode): string | undefined {
	if ((n.kind === 'prodTest' || n.kind === 'killingTest') && n.rawTestId) {
		return n.rawTestId;
	}
	if (n.kind === 'empty' && n.message) {
		return n.message;
	}
	if (n.kind === 'class' && n.className) {
		return n.className;
	}
	return describeLineTestsNode(n) ?? describeMutationNode(n);
}

/** `lineTestsView.ts`-only node kinds. */
function describeLineTestsNode(n: DescribableNode): string | undefined {
	if (n.kind === 'prodLine' && n.startLine !== undefined) {
		return n.startLine === n.endLine ? `Satır ${n.startLine}` : `Satır ${n.startLine}-${n.endLine}`;
	}
	if (n.kind === 'testMethod' && n.methodName) {
		return `${n.methodName}()`;
	}
	if (n.kind === 'testLine' && n.ref?.outerClassName && n.ref.line !== undefined) {
		return `${n.ref.outerClassName}:${n.ref.line}`;
	}
	return undefined;
}

/** `mutationView.ts`-only node kinds. */
function describeMutationNode(n: DescribableNode): string | undefined {
	if (n.kind === 'header' && n.text) {
		return n.text;
	}
	if (n.kind === 'method' && n.className && n.method?.methodName) {
		return `${n.className}#${n.method.methodName}${n.method.methodDescription ?? ''}`;
	}
	if (n.kind === 'mutant' && n.className && n.mutant?.line !== undefined) {
		return `${n.className}:${n.mutant.line} ${n.mutant.mutator ?? ''} ${n.mutant.status ?? ''}`.trim();
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
 * `proof.show.*` setting change reading the same state back - every
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
		vscode.window.showInformationMessage('proof-java: henüz coverage verisi yok - önce "proof-java: Analiz Et" komutunu çalıştırın.');
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
		vscode.window.showErrorMessage('proof-java: önce bir klasör açın.');
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
		vscode.window.showErrorMessage('proof-java: önce bir klasör açın.');
		return;
	}
	const diffMode = readDiffMode(folder);
	if (!diffMode) {
		return;
	}
	if (diffMode.kind === 'no-vcs') {
		vscode.window.showErrorMessage(
			'proof-java: L2 kanıtı sadece değişen dosyaları hedefleyebilir; no-vcs\'te "değişen dosya" diye bir kavram yok, bu yüzden test bazlı analiz çalışmaz. '
			+ 'proof.diffMode ayarını "uncommitted" veya "base" yapın.',
		);
		return;
	}

	const parsed = await runAnalyzeCore(context, output, folder, diffMode, {
		perTest: { timeoutSeconds: readPerTestTimeout(folder) },
		progressTitle: 'proof-java: derin tarama',
	});
	if (!parsed) {
		return;
	}

	publishAnalysis(sinks, folder.uri.fsPath, analysisResultFrom(parsed));
	setPerTestState({ perTest: parsed.perTest, warnings: parsed.warnings });
	if (parsed.perTest) {
		// Faz 28 (§7.5b): yalnızca blok gerçekten varsa yazılır - sonraki bir
		// Hızlı Tarama ya da Mutasyon Testi bu bloğu taşımayan bir
		// verdict-current.json yazınca bu dosya etkilenmeden kalır.
		const snapshot: PerTestSnapshot = { perTest: parsed.perTest, warnings: parsed.warnings };
		await writeJsonSnapshot(context, output, PERTEST_STORAGE_FILE, snapshot, 'test bazlı kanıt');
	} else {
		vscode.window.showWarningMessage('proof-java: bu koşuda test bazlı (per-test) kanıt yok - PER_TEST_* uyarıları için çıktı kanalını kontrol edin.');
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
		vscode.window.showErrorMessage('proof-java: önce bir klasör açın.');
		return;
	}
	const editor = vscode.window.activeTextEditor;
	if (editor?.document.languageId !== 'java') {
		vscode.window.showErrorMessage('proof-java: bu sınıf için test bazlı kanıt toplamak üzere bir Java dosyası açın.');
		return;
	}
	const diffMode = readDiffMode(folder);
	if (!diffMode) {
		return;
	}

	const fileName = path.basename(editor.document.fileName, '.java');
	const className = detectClassName(editor.document.getText(), fileName);
	const parsed = await runAnalyzeCore(context, output, folder, diffMode, {
		perTest: { targets: [{ filePath: editor.document.fileName, fqcn: className }], timeoutSeconds: readPerTestTimeout(folder) },
		progressTitle: `proof-java: ${className.split('.').pop()} için test kanıtı`,
	});
	if (!parsed) {
		return;
	}

	publishAnalysis(sinks, folder.uri.fsPath, analysisResultFrom(parsed));
	setPerTestState({ perTest: parsed.perTest, warnings: parsed.warnings });
	if (parsed.perTest) {
		const snapshot: PerTestSnapshot = { perTest: parsed.perTest, warnings: parsed.warnings };
		await writeJsonSnapshot(context, output, PERTEST_STORAGE_FILE, snapshot, 'test bazlı kanıt');
	} else {
		vscode.window.showWarningMessage(`proof-java: ${className} için test bazlı kanıt yok - PER_TEST_* uyarıları için çıktı kanalını kontrol edin.`);
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
		vscode.window.showErrorMessage('proof-java: önce bir klasör açın.');
		return;
	}
	const editor = vscode.window.activeTextEditor;
	if (editor?.document.languageId !== 'java') {
		vscode.window.showErrorMessage('proof-java: mutasyon testi çalıştırmak için bir Java dosyası açın.');
		return;
	}
	const className = detectClassName(editor.document.getText(), path.basename(editor.document.fileName, '.java'));
	await runMutation(context, output, sinks, folder, [{ filePath: editor.document.fileName, fqcn: className }], `proof-java: ${className.split('.').pop()} mutasyon testi`);
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
		vscode.window.showErrorMessage('proof-java: önce bir klasör açın.');
		return;
	}
	const timeout = readMutationTimeout(folder);
	const choice = await vscode.window.showWarningMessage(
		'Mutasyon testi tüm modül için çalıştırılacak.',
		{
			modal: true,
			detail: `Bu koşu uzun sürebilir - büyük bir modülde bir saati aşabilir. Modül başına zaman bütçesi ${timeout} saniye (proof.mutationTimeout); aşılırsa koşu durdurulur ve sonuç kısmi kalır.\n\nTek bir sınıf için genelde saniyeler yeterlidir: o dosyada sağ tık → "Bu Sınıf İçin Mutasyon Testi".`,
		},
		'Devam Et',
	);
	if (choice !== 'Devam Et') {
		return;
	}
	// Hedef verilmiyor: CLI diff'teki değişen production sınıflarını hedefler.
	await runMutation(context, output, sinks, folder, [], 'proof-java: mutasyon testi (modül)');
}

/**
 * Faz 31: kullanıcının açık isteği - "ben değişiklik yapmadan tüm repoda
 * tarama yapabilmeliyim". `fileCoverage.files[]` bir Hızlı Tarama'nın diff'ten
 * tamamen bağımsız, o koşunun bildiği **tam** production dosya listesi
 * (`hoverProvider.ts`'in de dayandığı aynı yetkili kaynak) - bu yüzden
 * diff hiç değişen sınıf bulamasa bile buradan gerçek, diff'siz bir hedef
 * listesi çıkarılabilir. Yol çözülemeyen bir dosya (`classNameFromPath`
 * `undefined` dönerse) sessizce atlanır - eksik bir hedef, uydurulmuş bir
 * hedeften iyidir (hard rule 3a).
 */
export function allProductionTargets(state: NonNullable<ReturnType<typeof getCoverageState>>): readonly { filePath: string; fqcn: string }[] {
	if (!state.fileCoverage) {
		return [];
	}
	const sourceRoots = productionSourceRoots(state.modules);
	const targets: { filePath: string; fqcn: string }[] = [];
	for (const file of state.fileCoverage.files) {
		const fqcn = classNameFromPath(file.path, sourceRoots);
		if (fqcn) {
			targets.push({ filePath: toAbsolutePath(state.workspaceRoot, file.path), fqcn });
		}
	}
	return targets;
}

/** Faz 31: diff hiç hedef bulamadığında (`PER_TEST_NO_CHANGED_TARGETS`) Satır → Testler görünümünün sunduğu kurtarma eylemi - diff'ten bağımsız, modüldeki **her** production sınıfı hedeflenir. */
async function runAnalyzePerTestAll(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showErrorMessage('proof-java: önce bir klasör açın.');
		return;
	}
	const state = getCoverageState();
	if (!state?.fileCoverage) {
		vscode.window.showErrorMessage('proof-java: önce Hızlı Tara çalıştırın - tüm modülü diff\'siz taramak için production dosya listesi gerekiyor.');
		return;
	}
	const targets = allProductionTargets(state);
	if (targets.length === 0) {
		vscode.window.showErrorMessage('proof-java: bu modülde hedeflenebilecek bir production sınıfı bulunamadı.');
		return;
	}
	const diffMode = readDiffMode(folder);
	if (!diffMode) {
		return;
	}

	const parsed = await runAnalyzeCore(context, output, folder, diffMode, {
		perTest: { targets, timeoutSeconds: readPerTestTimeout(folder) },
		progressTitle: `proof-java: tüm modül için derin tarama (${targets.length} sınıf)`,
	});
	if (!parsed) {
		return;
	}

	publishAnalysis(sinks, folder.uri.fsPath, analysisResultFrom(parsed));
	setPerTestState({ perTest: parsed.perTest, warnings: parsed.warnings });
	if (parsed.perTest) {
		const snapshot: PerTestSnapshot = { perTest: parsed.perTest, warnings: parsed.warnings };
		await writeJsonSnapshot(context, output, PERTEST_STORAGE_FILE, snapshot, 'test bazlı kanıt');
	} else {
		vscode.window.showWarningMessage('proof-java: bu koşuda test bazlı (per-test) kanıt yok - PER_TEST_* uyarıları için çıktı kanalını kontrol edin.');
	}
	revealLineTestsView(sinks);
}

/** Faz 31: `runMutationForModule`'ün diff'siz karşılığı - diff hiç hedef bulamadığında (`MUTATION_NO_CHANGED_TARGETS`) Mutasyon görünümünün sunduğu kurtarma eylemi. Diff-tabanlı koşudan bile daha pahalı olabileceği için (değişmemiş sınıflar da dahil) aynı onay modalı, bütçe uyarısı zaten söylenerek. */
async function runMutationForModuleAll(context: vscode.ExtensionContext, output: vscode.OutputChannel, sinks: CoverageSinks): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showErrorMessage('proof-java: önce bir klasör açın.');
		return;
	}
	const state = getCoverageState();
	if (!state?.fileCoverage) {
		vscode.window.showErrorMessage('proof-java: önce Hızlı Tara çalıştırın - tüm modülü diff\'siz taramak için production dosya listesi gerekiyor.');
		return;
	}
	const targets = allProductionTargets(state);
	if (targets.length === 0) {
		vscode.window.showErrorMessage('proof-java: bu modülde hedeflenebilecek bir production sınıfı bulunamadı.');
		return;
	}

	const timeout = readMutationTimeout(folder);
	const choice = await vscode.window.showWarningMessage(
		`Mutasyon testi TÜM modül için çalıştırılacak (${targets.length} sınıf, diff'ten bağımsız).`,
		{
			modal: true,
			detail: `Bu koşu diff-tabanlı "modül geneli" koşudan bile daha uzun sürebilir - değişmemiş sınıflar da dahil. Sınıf başına zaman bütçesi ${timeout} saniye (proof.mutationTimeout); aşılırsa koşu durdurulur ve sonuç kısmi kalır.`,
		},
		'Devam Et',
	);
	if (choice !== 'Devam Et') {
		return;
	}
	await runMutation(context, output, sinks, folder, targets, `proof-java: mutasyon testi (tüm modül, ${targets.length} sınıf)`);
}

/** İki mutasyon girişinin ortak gövdesi. `targets` boşsa CLI diff'ten hedef türetir (bu durumda bir diff modu şart). */
async function runMutation(
	context: vscode.ExtensionContext,
	output: vscode.OutputChannel,
	sinks: CoverageSinks,
	folder: vscode.WorkspaceFolder,
	targets: readonly { filePath: string; fqcn: string }[],
	progressTitle: string,
): Promise<void> {
	const diffMode = readDiffMode(folder);
	if (!diffMode) {
		return;
	}
	if (targets.length === 0 && diffMode.kind === 'no-vcs') {
		vscode.window.showErrorMessage('proof-java: modül geneli mutasyon bir diff gerektirir - proof.diffMode "no-vcs" iken hedeflenecek değişen sınıf yok. Tek bir sınıf için o dosyada sağ tık → "Bu Sınıf İçin Mutasyon Testi".');
		return;
	}

	const parsed = await runAnalyzeCore(context, output, folder, diffMode, {
		mutation: { targets, timeoutSeconds: readMutationTimeout(folder) },
		progressTitle,
	});
	if (!parsed) {
		return;
	}

	publishAnalysis(sinks, folder.uri.fsPath, analysisResultFrom(parsed));
	const ranAtMs = Date.now();
	const targetFqcns = targets.map((t) => t.fqcn);
	setMutationState({ mutation: parsed.mutation, warnings: parsed.warnings, targets: targetFqcns, ranAt: ranAtMs });
	sinks.mutationView.refresh();
	void vscode.commands.executeCommand('proof.mutationView.focus');
	// Faz 25: yalnızca blok gerçekten varsa yazılır - yoksa (bütçe aşıldı vb.)
	// eski bir sonucu yeni ama boş bir "koşu" ile ezmemek için hiç dokunulmaz.
	if (parsed.mutation) {
		const snapshot: MutationSnapshot = { mutation: parsed.mutation, warnings: parsed.warnings, targets: targetFqcns, ranAtMs };
		await writeJsonSnapshot(context, output, MUTATION_STORAGE_FILE, snapshot, 'mutasyon sonucu');
	}
}

function readMutationTimeout(folder: vscode.WorkspaceFolder): number {
	return vscode.workspace.getConfiguration('proof', folder).get<number>('mutationTimeout') ?? 300;
}

/** Faz 31: `--per-test-timeout`'un varsayılanıyla aynı (120) - CLI'ın kendi varsayılanını burada tekrarlamak yerine ayarın kendi `default`ı (`package.json`) tek kaynak, burada yalnızca ayar hiç okunamazsa (teorik) bir yedek. */
function readPerTestTimeout(folder: vscode.WorkspaceFolder): number {
	return vscode.workspace.getConfiguration('proof', folder).get<number>('perTestTimeout') ?? 120;
}

/** Faz 15c/15e: yeni "Satır → Testler" kenar çubuğu görünümüne odaklanır - eski webview'in aksine, tıklanınca kendini boşaltmaz (o hatanın doğrudan dersi, bkz. `ui/treeViews/lineTestsView.ts`). */
function revealLineTestsView(sinks: CoverageSinks): void {
	sinks.lineTestsView.refresh();
	void vscode.commands.executeCommand('proof.lineTestsView.focus');
}

/** `proof.diffMode` + (base modundaysa) `proof.baseRef`'i okur; base seçiliyken baseRef boşsa kullanıcıyı ayara yönlendirip `undefined` döner. */
function readDiffMode(folder: vscode.WorkspaceFolder): DiffMode | undefined {
	const config = vscode.workspace.getConfiguration('proof', folder);
	const kind = config.get<string>('diffMode') ?? 'uncommitted';
	if (kind === 'base') {
		const ref = config.get<string>('baseRef')?.trim();
		if (!ref) {
			void offerToOpenSetting('proof-java: proof.diffMode "base" ayarlı ama proof.baseRef boş.', 'proof.baseRef');
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
	/**
	 * Present (even empty) to request L2. `targets` names explicit classes by
	 * file; omitted/empty lets the CLI derive diff-scoped targets per bound
	 * module's classpath. `timeoutSeconds` mirrors `mutation`'s own field -
	 * relevant mainly for a large explicit `targets` list (the "scan the
	 * whole module anyway" gesture), which can outrun the CLI's own
	 * `--per-test-timeout` default.
	 */
	perTest?: { targets?: readonly { filePath: string; fqcn: string }[]; timeoutSeconds?: number };
	/** Faz 20: L3. Verildiğinde ilerleme bildirimi de mutasyon diliyle konuşur ve iptal süreç ağacını öldürür. */
	mutation?: { targets?: readonly { filePath: string; fqcn: string }[]; timeoutSeconds?: number };
	/** Bildirim başlığı - mutasyon dakikalar/saatler sürebildiği için "analiz ediliyor" yetersiz kalıyor. */
	progressTitle?: string;
}

/**
 * Faz 30: resolves each `{filePath, fqcn}` target to the module that owns
 * it (longest-root-prefix match, `cli/reportDiscovery.ts`'s `moduleForPath`)
 * and pairs it with the module's own classpath binding id. A target whose
 * file falls under no bound module's root is dropped rather than guessed
 * at (hard rule 3a) - the caller is responsible for surfacing that as an
 * error when it makes the whole request meaningless (a single explicit
 * per-file target with nowhere to bind it).
 */
function resolveTargets(folder: vscode.WorkspaceFolder, allModules: readonly { id: string; root: string }[], targets: readonly { filePath: string; fqcn: string }[] | undefined): TargetBinding[] {
	if (!targets) {
		return [];
	}
	const result: TargetBinding[] = [];
	for (const t of targets) {
		const repoRelative = toRepoRelativePosix(t.filePath, folder.uri.fsPath);
		const moduleId = moduleForPath(repoRelative, allModules);
		if (moduleId) {
			result.push({ moduleId, fqcn: t.fqcn });
		}
	}
	return result;
}

/**
 * Faz 30: the shared shape `perTest`/`mutation` both resolve to - one
 * classpath per bound module (generating missing ones via `doctor --fix`
 * if needed) plus each explicit target paired with the module that owns
 * its file. `undefined` means resolution failed and the reason was already
 * shown to the user - the caller just returns.
 */
async function resolveEvidenceArg(
	kind: ClasspathKind,
	folder: vscode.WorkspaceFolder,
	jarPath: string,
	javaExecutable: string,
	output: vscode.OutputChannel,
	allModules: readonly { id: string; root: string }[],
	evidenceInput: { targets?: readonly { filePath: string; fqcn: string }[] },
): Promise<{ classpaths: readonly { moduleId: string; path: string }[]; targets: readonly TargetBinding[] | undefined } | undefined> {
	const classpaths = await resolveEvidenceClasspaths(folder, jarPath, javaExecutable, output, allModules, kind);
	if (!classpaths) {
		return undefined;
	}
	const targets = resolveTargets(folder, allModules, evidenceInput.targets);
	if (evidenceInput.targets && evidenceInput.targets.length > 0 && targets.length === 0) {
		vscode.window.showErrorMessage('proof-java: hedef sınıfın hangi modüle ait olduğu belirlenemedi - dosya bağlı modüllerden hiçbirinin kökü altında değil.');
		return undefined;
	}
	return { classpaths, targets: targets.length > 0 ? targets : undefined };
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
		void offerToOpenSetting('proof-java: proof-java.jar bulunamadı. proof.jarPath ayarını yapın veya proof-java-cli/target/proof-java.jar konumunda bir tane derleyin.', 'proof.jarPath');
		return undefined;
	}

	const config = vscode.workspace.getConfiguration('proof', folder);
	const configuredReportPath = config.get<string>('reportPath') || 'target/site/jacoco/jacoco.xml';
	const binding = await resolveReportBinding(folder, configuredReportPath, output);
	if (!binding) {
		return undefined;
	}

	const javaExecutable = config.get<string>('javaExecutable') || 'java';

	// Faz 30: classpath resolution (and, if missing, doctor --fix generation)
	// now happens here - after the report binding is known, so it can
	// resolve one classpath per real bound module instead of the single
	// hardcoded 'root' the old caller-side ensurePerTestClasspath assumed.
	let perTestArg: Parameters<typeof buildAnalyzeArgs>[0]['perTest'];
	if (evidence.perTest) {
		const resolved = await resolveEvidenceArg('perTest', folder, jarPath, javaExecutable, output, binding.allModules, evidence.perTest);
		if (!resolved) {
			return undefined;
		}
		perTestArg = { ...resolved, timeoutSeconds: evidence.perTest.timeoutSeconds };
	}

	let mutationArg: Parameters<typeof buildAnalyzeArgs>[0]['mutation'];
	if (evidence.mutation) {
		const resolved = await resolveEvidenceArg('mutation', folder, jarPath, javaExecutable, output, binding.allModules, evidence.mutation);
		if (!resolved) {
			return undefined;
		}
		mutationArg = { ...resolved, timeoutSeconds: evidence.mutation.timeoutSeconds };
	}

	const storageRoot = context.storageUri;
	if (!storageRoot) {
		vscode.window.showErrorMessage('proof-java: bu pencerede workspace depolaması yok (bir klasör yerine tek dosya mı açık?) - sonuç kaydedilemez.');
		return undefined;
	}
	await vscode.workspace.fs.createDirectory(storageRoot);
	const outUri = vscode.Uri.joinPath(storageRoot, 'verdict-current.json');

	const coverageExclusions = config.get<string[]>('coverageExclusions') ?? [];
	const args = buildAnalyzeArgs({
		repo: folder.uri.fsPath,
		diffMode,
		reportPath: binding.reportPath,
		modules: binding.modules,
		outPath: outUri.fsPath,
		fileCoverage: true,
		coverageExclusions,
		perTest: perTestArg,
		mutation: mutationArg,
	});

	output.appendLine(`proof-java: java -jar ${jarPath} ${args.join(' ')}`);

	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: evidence.progressTitle ?? 'proof-java: analiz ediliyor', cancellable: true },
		async (progress, token) => {
			// Faz 20: CLI'ın stderr ilerleme akışı nihayet tüketiliyor
			// (`cli/progressParser.ts` - Faz 1'den beri yorumda söz verilmiş,
			// hiç yazılmamıştı). Tanınan satır bildirime yazılır, tanınmayan
			// satır Output'a **aynen** gider: biçim değişirse yanlış yüzde
			// göstermektense hiç göstermemek yeğdir (hard rule 3a).
			//
			// Faz 30: `done` modül başına tutulur (bir Map) - paylaşılan tek
			// bir sayaç, bir modül `3/3`'e ulaşıp bir sonraki modül kendi
			// `1/5`'iyle başladığında negatif bir farkı düşürüp bar'ı donuk
			// bırakıyordu (gerçek bir çok-modül regresyonu). Modül sayısına
			// göre ölçeklenir ki N modüllü bir koşuda toplam 100'ü aşmasın.
			const doneByModule = new Map<string, number>();
			const moduleCountFor = { mutation: mutationArg?.classpaths.length ?? 1, perTest: perTestArg?.classpaths.length ?? 1 };
			const handle = run({
				javaExecutable, jarPath, args,
				env: resolveWorkspaceEnv(folder),
				onStderrLine: (line) => {
					output.appendLine(line);
					const event = parseProgressLine(line);
					if (!event) {
						return;
					}
					const moduleCount = moduleCountFor[event.kind];
					const step = incrementFor(event, doneByModule.get(event.moduleId) ?? 0, moduleCount);
					if (step) {
						doneByModule.set(event.moduleId, step.done);
					}
					progress.report({ increment: step?.increment, message: progressMessage(event, moduleCount > 1) });
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
				vscode.window.showErrorMessage(`proof-java: "${javaExecutable}" çalıştırılamadı: ${(e as Error).message}`);
				return undefined;
			}
			output.appendLine(result.stdout);

			if (cancelled) {
				return undefined; // user-initiated cancel - not a failure, say nothing
			}

			// exit 3 (incomplete) still writes a real document - read it rather
			// than treating it as a failure (hard rule 3a, mirrored from the CLI).
			if (result.exitCode !== 0 && result.exitCode !== 3) {
				vscode.window.showErrorMessage(`proof-java: analiz başarısız oldu (çıkış kodu ${result.exitCode}).`);
				return undefined;
			}

			let raw: string;
			try {
				raw = await fs.promises.readFile(outUri.fsPath, 'utf8');
			} catch (e) {
				vscode.window.showErrorMessage(`proof-java: verdict dosyası okunamadı: ${(e as Error).message}`);
				return undefined;
			}

			const parsed = parseVerdict(raw);
			if (!parsed.ok) {
				vscode.window.showErrorMessage(`proof-java: verdict dosyası ayrıştırılamadı: ${parsed.error}`);
				return undefined;
			}

			// Faz 19: tarama sonrası açılır bildirim tamamen kaldırıldı.
			// Aynı sayı zaten durum çubuğunda, Coverage ağacında ve Explorer
			// rozetlerinde duruyor - her koşuda ekranın köşesinde bir kutu
			// açmak sadece dikkat dağıtıyordu. `analysis.status` "incomplete"
			// ise gerçekten bir şey söylenmesi gerekir; o hâlâ uyarılıyor.
			if (parsed.value.analysis.status === 'incomplete') {
				vscode.window.showWarningMessage('proof-java: analiz eksik tamamlandı - Coverage görünümündeki "Uyarılar" bölümüne bakın.');
			}

			return parsed.value;
		},
	);
}

/** `proof.badgeMetric`'i tekli okuma noktası - durum çubuğu başlığı, rozetler ve gutter aynı ayarı, aynı şekilde okur (madde 2). */
function readBadgeMetric(workspaceRoot: string): BadgeMetric {
	return vscode.workspace.getConfiguration('proof', vscode.Uri.file(workspaceRoot)).get<BadgeMetric>('badgeMetric') ?? 'sonar-compatible';
}

/**
 * `proof.show.explorerBadges` ve `proof.show.lineGutter` birbirinden
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

	const config = vscode.workspace.getConfiguration('proof', vscode.Uri.file(workspaceRoot));
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
		// Faz 30: the hardcoded DEFAULT_SOURCE_ROOTS this used to pass silently
		// disabled the false-green gutter in any multi-module layout (its source
		// roots are never 'src/main/java' at the repo root) - productionSourceRoots
		// is the same real declaration every other call site already uses.
		const falseGreenLinesByPath = showOraclelessLines && perTest?.perTest
			? buildFalseGreenIndex(perTest.perTest, findings, fileCoverage, productionSourceRoots(getCoverageState()?.modules ?? []))
			: new Map();
		applyGutterCoverage(sinks.gutterTypes, workspaceRoot, fileCoverage, getStaleFiles(), falseGreenLinesByPath);
	} else {
		clearGutterCoverage(sinks.gutterTypes);
	}
}

