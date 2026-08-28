import * as fs from 'node:fs';
import * as vscode from 'vscode';

import { toAbsolutePath } from './model/pathIndex';
import { getCoverageState, getStaleFiles, isGutterVisible, setPerTestState } from './model/store';
import {
	analysisResultFrom,
	publishAnalysis,
	registerAnalyzeCommand,
	registerAnalyzePerTestCommand,
	registerPerTestForFileCommand,
	registerToggleCoverageCommand,
	type CoverageSinks,
} from './ui/commands';
import { createDiagnosticCollection } from './ui/diagnostics';
import { ExplorerBadgeProvider } from './ui/explorerBadges';
import { applyGutterCoverage, createGutterDecorationTypes } from './ui/gutterRenderer';
import { registerHoverProvider } from './ui/hoverProvider';
import { createStatusBarItem } from './ui/statusBar';
import { CoverageTreeProvider } from './ui/treeViews/coverageView';
import { LineTestsTreeProvider, type LineTestsNode } from './ui/treeViews/lineTestsView';
import { QualityTreeProvider } from './ui/treeViews/qualityView';
import { RunTreeProvider } from './ui/treeViews/runView';
import { parseVerdict } from './verdict/parse';

/** F3's module id, same single-module-shorthand scope as everywhere else until F8's config UI adds real multi-module support. */
const MODULE_ID = 'root';

/**
 * Registration only - no logic lives here. Features register themselves
 * from src/ui/commands.ts and friends as they land; this function stays a
 * short list of `context.subscriptions.push(...)` calls (Plan.md Bölüm 2).
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output = vscode.window.createOutputChannel('coverdict');
	const gutterTypes = createGutterDecorationTypes();
	const explorerBadges = new ExplorerBadgeProvider();
	const statusBarItem = createStatusBarItem();
	const diagnostics = createDiagnosticCollection();
	const runView = new RunTreeProvider();
	const coverageView = new CoverageTreeProvider();
	const qualityView = new QualityTreeProvider();
	const lineTestsView = new LineTestsTreeProvider();
	const sinks: CoverageSinks = { context, gutterTypes, explorerBadges, statusBarItem, diagnostics, runView, coverageView, qualityView, lineTestsView };

	// Faz 15c: `createTreeView` (not `registerTreeDataProvider`) because
	// `reveal()` needs it - the cursor-follow listener below uses it to
	// jump the tree to whichever line the caret is on. Unlike the deleted
	// webview panel, clicking a node in this view cannot empty it: the
	// provider tracks the last Java editor itself (`setActiveDocument`),
	// never reads `vscode.window.activeTextEditor` live.
	const lineTestsTreeView = vscode.window.createTreeView('coverdict.lineTestsView', { treeDataProvider: lineTestsView, showCollapseAll: true });
	lineTestsView.setActiveDocument(vscode.window.activeTextEditor?.document);

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
		vscode.window.registerTreeDataProvider('coverdict.runView', runView),
		vscode.window.registerTreeDataProvider('coverdict.coverageView', coverageView),
		vscode.window.registerTreeDataProvider('coverdict.qualityView', qualityView),
		lineTestsTreeView,
		registerHoverProvider(),
		registerAnalyzeCommand(context, output, sinks),
		registerAnalyzePerTestCommand(context, output, sinks),
		registerPerTestForFileCommand(context, output, sinks),
		registerToggleCoverageCommand(sinks),
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
		// coverdict.show.* ayarları canlı: kullanıcı ayarlar sayfasında
		// değiştirdiği anda son taramadan yeniden boyanır, tekrar analiz veya
		// aç/kapat yapmasına gerek kalmaz.
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (!e.affectsConfiguration('coverdict.show') && !e.affectsConfiguration('coverdict.badgeMetric')) {
				return;
			}
			const state = getCoverageState();
			if (state) {
				republishFromState(sinks, state.workspaceRoot);
			}
		}),
	);

	// The CLI's own output is already sitting in extension storage from the
	// last run (Plan.md Bölüm 5: verdict-current.json, byte-for-byte) - a
	// window reload should not force a fresh scan just to see it again.
	// Awaited (not fire-and-forget) so `activate()` only resolves once this
	// is done - otherwise a command dispatched right after activation could
	// run against empty state and race the restore that was about to fill it.
	await restoreLastCoverage(context, sinks);
}

async function restoreLastCoverage(context: vscode.ExtensionContext, sinks: CoverageSinks): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	// Deliberately not falling back to globalStorageUri: that storage is
	// shared across every workspace, so a verdict saved there could belong
	// to a different project entirely and get painted onto this one's files.
	const storageRoot = context.storageUri;
	if (!folder || !storageRoot) {
		return;
	}

	const outUri = vscode.Uri.joinPath(storageRoot, 'verdict-current.json');
	let raw: string;
	try {
		raw = await fs.promises.readFile(outUri.fsPath, 'utf8');
	} catch {
		return; // nothing saved yet - the normal first-run shape, not an error
	}

	const parsed = parseVerdict(raw);
	if (!parsed.ok) {
		return;
	}
	publishAnalysis(sinks, folder.uri.fsPath, analysisResultFrom(parsed.value));
	// perTest restores independently of fileCoverage - a run can carry one
	// without the other depending on which command produced it.
	setPerTestState({ moduleId: MODULE_ID, perTest: parsed.value.perTest, warnings: parsed.value.warnings });
}

/** `coverdict.show.*`/`coverdict.badgeMetric` changed while a run's data is still current - repaint from `model/store`'s own state, no re-parse needed. */
function republishFromState(sinks: CoverageSinks, workspaceRoot: string): void {
	const state = getCoverageState();
	if (state) {
		publishAnalysis(sinks, workspaceRoot, state);
	}
}

export function deactivate(): void {
	// Nothing to release: every disposable is already in context.subscriptions.
}
