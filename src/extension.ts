import * as fs from 'node:fs';
import * as vscode from 'vscode';

import { getCoverageState, isGutterVisible, setPerTestState } from './model/store';
import {
	refreshLineTestsPanelForActiveEditor,
	registerAnalyzeCommand,
	registerAnalyzePerTestCommand,
	registerShowLineTestsCommand,
	registerToggleCoverageCommand,
	republishCoverage,
	type CoverageSinks,
} from './ui/commands';
import { ExplorerBadgeProvider } from './ui/explorerBadges';
import { applyGutterCoverage, createGutterDecorationTypes } from './ui/gutterRenderer';
import { createStatusBarItem } from './ui/statusBar';
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
	const sinks: CoverageSinks = { context, gutterTypes, explorerBadges, statusBarItem };

	context.subscriptions.push(
		output,
		gutterTypes.covered,
		gutterTypes.partial,
		gutterTypes.uncovered,
		gutterTypes.excluded,
		explorerBadges,
		vscode.window.registerFileDecorationProvider(explorerBadges),
		statusBarItem,
		registerAnalyzeCommand(context, output, sinks),
		registerAnalyzePerTestCommand(context, output, sinks),
		registerToggleCoverageCommand(sinks),
		registerShowLineTestsCommand(),
		// setDecorations is per-editor, not global - a newly-visible editor
		// needs its gutter marks re-applied by hand (Faz 9: always our own
		// decorations now, no native path that keeps its own state).
		vscode.window.onDidChangeVisibleTextEditors(() => {
			const state = getCoverageState();
			if (state?.fileCoverage && isGutterVisible()) {
				applyGutterCoverage(gutterTypes, state.workspaceRoot, state.fileCoverage);
			}
		}),
		// F3: an already-open line->tests panel follows the user from file to
		// file - re-running the command every time they switch editors would
		// be the "why do I have to keep asking" complaint F1's restore-on-
		// activation fix already addressed once this session.
		vscode.window.onDidChangeActiveTextEditor(() => refreshLineTestsPanelForActiveEditor()),
		// coverdict.show.* ayarları canlı: kullanıcı ayarlar sayfasında
		// değiştirdiği anda son taramadan yeniden boyanır, tekrar analiz veya
		// aç/kapat yapmasına gerek kalmaz.
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (!e.affectsConfiguration('coverdict.show') && !e.affectsConfiguration('coverdict.badgeMetric')) {
				return;
			}
			const state = getCoverageState();
			if (state?.fileCoverage) {
				republishCoverage(sinks, state.workspaceRoot, state.fileCoverage, state.overall);
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
	if (parsed.value.fileCoverage) {
		republishCoverage(sinks, folder.uri.fsPath, parsed.value.fileCoverage, parsed.value.coverage.overall);
	}
	// perTest restores independently of fileCoverage - a run can carry one
	// without the other depending on which command produced it.
	setPerTestState({ moduleId: MODULE_ID, perTest: parsed.value.perTest, warnings: parsed.value.warnings });
}

export function deactivate(): void {
	// Nothing to release: every disposable is already in context.subscriptions.
}
