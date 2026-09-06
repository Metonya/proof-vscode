import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { toAbsolutePath } from './model/pathIndex';
import { getCoverageState, getStaleFiles, isGutterVisible, setMutationState, setPerTestState } from './model/store';
import {
	analysisResultFrom,
	MUTATION_STORAGE_FILE,
	PERTEST_STORAGE_FILE,
	publishAnalysis,
	registerAnalyzeCommand,
	registerAnalyzePerTestCommand,
	registerExportReportCommand,
	registerOpenSettingsCommand,
	registerRunTestsCommand,
	registerCopyCommands,
	registerMutationCommands,
	registerPerTestForFileCommand,
	registerPerTestForModuleAllCommand,
	registerQualityMutationBridgeCommands,
	registerToggleCoverageCommand,
	resolveStorageRoot,
	type CoverageSinks,
	type MutationSnapshot,
	type PerTestSnapshot,
} from './ui/commands';
import { createDiagnosticCollection } from './ui/diagnostics';
import { ExplorerBadgeProvider } from './ui/explorerBadges';
import { applyGutterCoverage, createGutterDecorationTypes } from './ui/gutterRenderer';
import { registerHoverProvider } from './ui/hoverProvider';
import { createStatusBarItem } from './ui/statusBar';
import { CoverageTreeProvider } from './ui/treeViews/coverageView';
import { LineTestsTreeProvider, type LineTestsNode } from './ui/treeViews/lineTestsView';
import { MutationTreeProvider } from './ui/treeViews/mutationView';
import { QualityTreeProvider } from './ui/treeViews/qualityView';
import { RunTreeProvider } from './ui/treeViews/runView';
import { isMutationBlock, isPerTestBlock, parseVerdict } from './verdict/parse';

/**
 * Registration only - no logic lives here. Features register themselves
 * from src/ui/commands.ts and friends as they land; this function stays a
 * short list of `context.subscriptions.push(...)` calls (Plan.md Bölüm 2).
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output = vscode.window.createOutputChannel('proof-java');
	const colorblindMode = vscode.workspace.getConfiguration('proof').get<boolean>('colorblindMode') ?? false;
	let gutterTypes = createGutterDecorationTypes(colorblindMode);
	const explorerBadges = new ExplorerBadgeProvider();
	const statusBarItem = createStatusBarItem();
	const diagnostics = createDiagnosticCollection();
	const runView = new RunTreeProvider();
	const coverageView = new CoverageTreeProvider();
	const qualityView = new QualityTreeProvider();
	const lineTestsView = new LineTestsTreeProvider();
	const mutationView = new MutationTreeProvider();

	// Faz 15c: `createTreeView` (not `registerTreeDataProvider`) because
	// `reveal()` needs it - the cursor-follow listener below uses it to
	// jump the tree to whichever line the caret is on. Unlike the deleted
	// webview panel, clicking a node in this view cannot empty it: the
	// provider tracks the last Java editor itself (`setActiveDocument`),
	// never reads `vscode.window.activeTextEditor` live.
	const lineTestsTreeView = vscode.window.createTreeView('proof.lineTestsView', { treeDataProvider: lineTestsView, showCollapseAll: true });
	lineTestsView.setActiveDocument(vscode.window.activeTextEditor?.document);

	// Faz 24 (§7.6 madde 5): Test Kalitesi ↔ Mutasyon köprüsü de `reveal()`
	// kullanıyor, aynı sebeple - her ikisi de plain `registerTreeDataProvider`
	// ile kalsaydı köprü komutları hedefi ekrana odaklayamazdı.
	const qualityTreeView = vscode.window.createTreeView('proof.qualityView', { treeDataProvider: qualityView, showCollapseAll: true });
	const mutationTreeView = vscode.window.createTreeView('proof.mutationView', { treeDataProvider: mutationView, showCollapseAll: true });

	const sinks: CoverageSinks = { gutterTypes, explorerBadges, statusBarItem, diagnostics, runView, coverageView, qualityView, qualityTreeView, lineTestsView, lineTestsTreeView, mutationView, mutationTreeView };

	context.subscriptions.push(
		output,
		gutterTypes.covered,
		gutterTypes.partial,
		gutterTypes.uncovered,
		gutterTypes.oracleless,
		gutterTypes.excluded,
		gutterTypes.stale,
		explorerBadges,
		vscode.window.registerFileDecorationProvider(explorerBadges),
		statusBarItem,
		diagnostics,
		vscode.window.registerTreeDataProvider('proof.runView', runView),
		vscode.window.registerTreeDataProvider('proof.coverageView', coverageView),
		qualityTreeView,
		lineTestsTreeView,
		mutationTreeView,
		registerHoverProvider(),
		registerAnalyzeCommand(output, sinks),
		registerRunTestsCommand(output, sinks),
		registerAnalyzePerTestCommand(output, sinks),
		registerExportReportCommand(output),
		registerOpenSettingsCommand(),
		registerPerTestForFileCommand(output, sinks),
		registerPerTestForModuleAllCommand(output, sinks),
		registerToggleCoverageCommand(sinks),
		...registerCopyCommands(sinks),
		...registerMutationCommands(output, sinks),
		...registerQualityMutationBridgeCommands(sinks),
		// setDecorations is per-editor, not global - a newly-visible editor
		// needs its gutter marks re-applied by hand (Faz 9: always our own
		// decorations now, no native path that keeps its own state).
		vscode.window.onDidChangeVisibleTextEditors(() => {
			const state = getCoverageState();
			if (state?.fileCoverage && isGutterVisible()) {
				applyGutterCoverage(gutterTypes, state.workspaceRoot, state.fileCoverage, getStaleFiles());
			}
		}),
		// Faz 14e: bir tarama sonrası dosya düzenlenirse eski satır
		// numaralarını boyamaya devam etmek yerine (hard rule 3a) o dosyayı
		// bayat işaretler - gutter'daki banner'a ve Explorer rozetine hemen
		// yansır, yeniden tarama bunu sıfırlar (model/store.ts).
		vscode.workspace.onDidChangeTextDocument((e) => {
			const state = getCoverageState();
			if (!state?.fileCoverage || e.contentChanges.length === 0) {
				return;
			}
			const absolutePath = e.document.uri.fsPath;
			const isTrackedFile = state.fileCoverage.files.some((f) => toAbsolutePath(state.workspaceRoot, f.path) === absolutePath);
			if (!isTrackedFile) {
				return;
			}
			explorerBadges.markStale(e.document.uri);
			if (isGutterVisible()) {
				applyGutterCoverage(gutterTypes, state.workspaceRoot, state.fileCoverage, getStaleFiles());
			}
		}),
		// Faz 15c: "Satır → Testler" görünümü aktif Java dosyasını takip eder -
		// eski panelin aksine bunu ayrı bir dinleyicide, sinyali kendi tuttuğu
		// bir alanda saklayarak yapıyor, `activeTextEditor`'ü canlı okumuyor.
		vscode.window.onDidChangeActiveTextEditor((editor) => lineTestsView.setActiveDocument(editor?.document)),
		// İmleç takibi: seçim değişince o satırın düğümünü ağaçta `reveal` eder.
		vscode.window.onDidChangeTextEditorSelection((e) => {
			if (e.textEditor.document.languageId !== 'java' || e.textEditor !== vscode.window.activeTextEditor) {
				return;
			}
			const node: LineTestsNode | undefined = lineTestsView.nodeForLine(e.selections[0].active.line + 1);
			if (node) {
				void lineTestsTreeView.reveal(node, { select: true, focus: false });
			}
		}),
		// proof.show.* ayarları canlı: kullanıcı ayarlar sayfasında
		// değiştirdiği anda son taramadan yeniden boyanır, tekrar analiz veya
		// aç/kapat yapmasına gerek kalmaz.
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (!e.affectsConfiguration('proof.show') && !e.affectsConfiguration('proof.badgeMetric')) {
				return;
			}
			const state = getCoverageState();
			if (state) {
				republishFromState(sinks, state.workspaceRoot);
			}
		}),
		// proof.colorblindMode da canlı: eski davranış (yalnızca
		// açılışta okunup pencere yenilemesi isteyen) proof.show.* ile
		// tutarsızdı ve kafa karıştırıyordu - eskiler dispose edilip
		// yenileri kaydedilir, sinks.gutterTypes güncellenir (commands.ts
		// hep sinks üzerinden okur), açık editörler hemen yeni renklerle
		// boyanır.
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (!e.affectsConfiguration('proof.colorblindMode')) {
				return;
			}
			const newMode = vscode.workspace.getConfiguration('proof').get<boolean>('colorblindMode') ?? false;
			const oldTypes = gutterTypes;
			gutterTypes = createGutterDecorationTypes(newMode);
			sinks.gutterTypes = gutterTypes;
			context.subscriptions.push(gutterTypes.covered, gutterTypes.partial, gutterTypes.uncovered, gutterTypes.oracleless, gutterTypes.excluded, gutterTypes.stale);
			oldTypes.covered.dispose();
			oldTypes.partial.dispose();
			oldTypes.uncovered.dispose();
			oldTypes.oracleless.dispose();
			oldTypes.excluded.dispose();
			oldTypes.stale.dispose();
			const state = getCoverageState();
			if (state?.fileCoverage && isGutterVisible()) {
				applyGutterCoverage(gutterTypes, state.workspaceRoot, state.fileCoverage, getStaleFiles());
			}
		}),
	);

	// The CLI's own output is already sitting in extension storage from the
	// last run (Plan.md Bölüm 5: verdict-current.json, byte-for-byte) - a
	// window reload should not force a fresh scan just to see it again.
	// Awaited (not fire-and-forget) so `activate()` only resolves once this
	// is done - otherwise a command dispatched right after activation could
	// run against empty state and race the restore that was about to fill it.
	await restoreLastCoverage(sinks);

	// Faz 25: on a real window reload, VS Code has not always finished
	// restoring the previously-active editor tab by the time this function
	// started - the `setActiveDocument` call above (line ~59) can fire
	// before `vscode.window.activeTextEditor` is populated, and if nothing
	// changes it afterward `onDidChangeActiveTextEditor` never fires again
	// (the editor was already "active" from VS Code's own perspective, so
	// there is no change to report). Re-syncing here, after the `await`
	// above gave the event loop time to catch up, is what makes "Satır →
	// Testler" reliably show the restored data instead of "Önce bir Java
	// dosyası açın" even though a Java file is genuinely open.
	lineTestsView.setActiveDocument(vscode.window.activeTextEditor?.document);
}

async function restoreLastCoverage(sinks: CoverageSinks): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return;
	}
	await restoreLastCoverageFrom(resolveStorageRoot(folder).fsPath, folder.uri.fsPath, sinks);
}

/**
 * The `vscode.workspace`-free half of the restore - split out from
 * `restoreLastCoverage` so a test can drive it with a plain temp directory
 * instead of a real open workspace folder.
 */
export async function restoreLastCoverageFrom(storageDir: string, workspaceRoot: string, sinks: CoverageSinks): Promise<void> {
	// Faz 25/28 (§7.5, §7.5b): ikisi de kendi dosyasında yaşıyor artık,
	// `verdict-current.json`'dan tamamen bağımsız olarak geri yüklenir -
	// biri bozuksa/yoksa diğerleri yine de geri gelsin diye ayrı adımlar,
	// aşağıdaki erken `return`'lerden etkilenmez.
	await restoreMutationSnapshot(storageDir, sinks);
	const perTestRestored = await restorePerTestSnapshot(storageDir, sinks);

	let raw: string;
	try {
		raw = await fs.promises.readFile(path.join(storageDir, 'verdict-current.json'), 'utf8');
	} catch {
		return; // nothing saved yet - the normal first-run shape, not an error
	}

	const parsed = parseVerdict(raw);
	if (!parsed.ok) {
		return;
	}
	publishAnalysis(sinks, workspaceRoot, analysisResultFrom(parsed.value));
	// Faz 28: pertest-current.json zaten geri yüklediyse (yukarıda) burada
	// tekrar `setPerTestState` çağırıp onu `verdict-current.json`'ın
	// (muhtemelen perTest'siz) haliyle ezmiyoruz - hangisi varsa o kalır.
	if (!perTestRestored) {
		setPerTestState({ perTest: parsed.value.perTest, warnings: parsed.value.warnings });
	}
	// Faz 23: publishAnalysis kendi refresh()'ini setPerTestState çağrılmadan
	// ÖNCE tetikliyor (bu fonksiyonun içinde), yani TreeView eski/boş
	// state ile bir kez yenileniyor. setPerTestState düz değişken ataması -
	// kendi event'ini ateşlemiyor - o yüzden burada elle refresh() şart.
	sinks.lineTestsView.refresh();
}

/**
 * Faz 25 (§7.5): `mutation-current.json`'ı okur - `ui/commands.ts`'in
 * `writeJsonSnapshot`'ının yazdığı, kendi gerçek zaman damgamızı
 * taşıyan format (CLI'ın çıktısı hiç taşımaz, D-xx). Dosya yok/bozuksa
 * (eski bir eklenti sürümünden kalma farklı bir şekil dahil) sessizce
 * hiçbir şey yapmaz - "henüz mutasyon testi çalıştırılmadı" ilk hâli
 * zaten doğru varsayılan (hard rule 3a).
 */
async function restoreMutationSnapshot(storageDir: string, sinks: CoverageSinks): Promise<void> {
	let raw: string;
	try {
		raw = await fs.promises.readFile(path.join(storageDir, MUTATION_STORAGE_FILE), 'utf8');
	} catch {
		return;
	}
	const snapshot = parseMutationSnapshot(raw);
	if (!snapshot) {
		return;
	}
	setMutationState({ mutation: snapshot.mutation, warnings: snapshot.warnings, targets: snapshot.targets, ranAt: snapshot.ranAtMs });
	sinks.mutationView.refresh();
}

/**
 * Faz 30: `moduleId` is no longer part of the shape (state dropped it - a
 * merged-across-modules run has no single id to carry), but an old
 * snapshot file written before this change still has it as an extra key.
 * That is fine: this check only validates field *presence*, not exact
 * shape, so an old file with a harmless extra `moduleId` key still passes
 * and still restores correctly. No migration, no data loss.
 */
function parseMutationSnapshot(raw: string): MutationSnapshot | undefined {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (
		typeof json !== 'object' || json === null
		|| !('mutation' in json) || !isMutationBlock(json.mutation)
		|| !('warnings' in json) || !Array.isArray(json.warnings)
		|| !('targets' in json) || !Array.isArray(json.targets) || !json.targets.every((t) => typeof t === 'string')
		|| !('ranAtMs' in json) || typeof json.ranAtMs !== 'number'
	) {
		return undefined;
	}
	return json as unknown as MutationSnapshot;
}

/**
 * Faz 28 (§7.5b): `pertest-current.json`'ı okur - `mutation-current.json`
 * ile birebir aynı gerekçe, şimdi perTest tarafında. Restore edebildiyse
 * `true` döner - çağıran, `verdict-current.json`'ın (muhtemelen
 * perTest'siz) kendi bloğuyla bunu ezmesin diye.
 */
async function restorePerTestSnapshot(storageDir: string, sinks: CoverageSinks): Promise<boolean> {
	let raw: string;
	try {
		raw = await fs.promises.readFile(path.join(storageDir, PERTEST_STORAGE_FILE), 'utf8');
	} catch {
		return false;
	}
	const snapshot = parsePerTestSnapshot(raw);
	if (!snapshot) {
		return false;
	}
	setPerTestState({ perTest: snapshot.perTest, warnings: snapshot.warnings });
	// verdict-current.json bağımsız olarak eksik/bozuk olabilir (§7.5/§7.5b
	// aynı gerekçe) - bu yenileme onun varlığına bağlı olmamalı.
	sinks.lineTestsView.refresh();
	return true;
}

/** Faz 30: same "extra key is harmless" note as `parseMutationSnapshot` above. */
function parsePerTestSnapshot(raw: string): PerTestSnapshot | undefined {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (
		typeof json !== 'object' || json === null
		|| !('perTest' in json) || !isPerTestBlock(json.perTest)
		|| !('warnings' in json) || !Array.isArray(json.warnings)
	) {
		return undefined;
	}
	return json as unknown as PerTestSnapshot;
}

/** `proof.show.*`/`proof.badgeMetric` changed while a run's data is still current - repaint from `model/store`'s own state, no re-parse needed. */
function republishFromState(sinks: CoverageSinks, workspaceRoot: string): void {
	const state = getCoverageState();
	if (state) {
		publishAnalysis(sinks, workspaceRoot, state);
	}
}

export function deactivate(): void {
	// Nothing to release: every disposable is already in context.subscriptions.
}
