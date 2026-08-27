import * as vscode from 'vscode';

import { getCoverageState, isGutterVisible, isUsingFallback } from './model/store';
import { createCoverageController, readPartialLineMode } from './ui/coverageProvider';
import { registerAnalyzeCommand, registerToggleCoverageCommand } from './ui/commands';
import {
	applyExcludedDecorations,
	applyFallbackCoverage,
	createExcludedDecorationType,
	createFallbackDecorationTypes,
} from './ui/decorationFallback';
import { createStatusBarItem } from './ui/statusBar';

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
	const sinks = { controller, excludedDecorationType, fallbackDecorationTypes, statusBarItem };

	context.subscriptions.push(
		output,
		controller,
		excludedDecorationType,
		fallbackDecorationTypes.covered,
		fallbackDecorationTypes.partial,
		fallbackDecorationTypes.uncovered,
		statusBarItem,
		registerAnalyzeCommand(context, output, sinks),
		registerToggleCoverageCommand(sinks),
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
	);
}

export function deactivate(): void {
	// Nothing to release: every disposable is already in context.subscriptions.
}
