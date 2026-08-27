import * as fs from 'node:fs';
import * as vscode from 'vscode';

import { getCoverageState, isGutterVisible, isUsingFallback, setPerTestState } from './model/store';
import { createCoverageController, readPartialLineMode } from './ui/coverageProvider';
import {
	refreshLineTestsPanelForActiveEditor,
	registerAnalyzeCommand,
	registerAnalyzePerTestCommand,
	registerShowLineTestsCommand,
	registerToggleCoverageCommand,
	republishCoverage,
	type CoverageSinks,
} from './ui/commands';
import {
	applyExcludedDecorations,
	applyFallbackCoverage,
	createExcludedDecorationType,
	createFallbackDecorationTypes,
} from './ui/decorationFallback';
import { createStatusBarItem } from './ui/statusBar';
import { parseVerdict } from './verdict/parse';

/** F3's module id, same single-module-shorthand scope as everywhere else until F8's config UI adds real multi-module support. */
const MODULE_ID = 'root';

/**
 * Registration only - no logic lives here. Features register themselves
 * from src/ui/commands.ts and friends as they land; this function stays a
 * short list of `context.subscriptions.push(...)` calls (Plan.md Bölüm 2).
 */
export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('coverdict');
	const controller = createCoverageController();
	const excludedDecorationType = createExcludedDecorationType();
	const fallbackDecorationTypes = createFallbackDecorationTypes();
	const statusBarItem = createStatusBarItem();
	const sinks: CoverageSinks = { context, controller, excludedDecorationType, fallbackDecorationTypes, statusBarItem };

	context.subscriptions.push(
		output,
		controller,
		excludedDecorationType,
		fallbackDecorationTypes.covered,
		fallbackDecorationTypes.partial,
		fallbackDecorationTypes.uncovered,
		statusBarItem,
		registerAnalyzeCommand(context, output, sinks),
		registerAnalyzePerTestCommand(context, output, sinks),
		registerToggleCoverageCommand(sinks),
		registerShowLineTestsCommand(),
		vscode.window.onDidChangeVisibleTextEditors(() => {
			const state = getCoverageState();
			if (!state) {
				return;
			}
			const visible = isGutterVisible();
			applyExcludedDecorations(excludedDecorationType, state.workspaceRoot, visible ? (state.fileCoverage?.excluded ?? []) : []);
			// The native API keeps its own gutter marks across editor changes -
			// only the decoration fallback needs manual re-application per
			// newly-visible editor (setDecorations is per-editor, not global).
			if (visible && isUsingFallback() && state.fileCoverage) {
				applyFallbackCoverage(fallbackDecorationTypes, state.workspaceRoot, state.fileCoverage, readPartialLineMode());
			}
		}),
		// F3: an already-open line->tests panel follows the user from file to
		// file - re-running the command every time they switch editors would
		// be the "why do I have to keep asking" complaint F1's restore-on-
		// activation fix already addressed once this session.
		vscode.window.onDidChangeActiveTextEditor(() => refreshLineTestsPanelForActiveEditor()),
	);

	// The CLI's own output is already sitting in extension storage from the
	// last run (Plan.md Bölüm 5: verdict-current.json, byte-for-byte) - a
	// window reload should not force a fresh scan just to see it again.
	void restoreLastCoverage(context, sinks);
}

async function restoreLastCoverage(context: vscode.ExtensionContext, sinks: CoverageSinks): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const storageRoot = context.storageUri ?? context.globalStorageUri;
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
