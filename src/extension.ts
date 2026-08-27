import * as vscode from 'vscode';

import { getCoverageState, isGutterVisible } from './model/store';
import { createCoverageController } from './ui/coverageProvider';
import { registerAnalyzeCommand, registerToggleCoverageCommand } from './ui/commands';
import { applyExcludedDecorations, createExcludedDecorationType } from './ui/decorationFallback';
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
	const statusBarItem = createStatusBarItem();
	const sinks = { controller, excludedDecorationType, statusBarItem };

	context.subscriptions.push(
		output,
		controller,
		excludedDecorationType,
		statusBarItem,
		registerAnalyzeCommand(context, output, sinks),
		registerToggleCoverageCommand(sinks),
		vscode.window.onDidChangeVisibleTextEditors(() => {
			const state = getCoverageState();
			if (state) {
				const excluded = isGutterVisible() ? (state.fileCoverage?.excluded ?? []) : [];
				applyExcludedDecorations(excludedDecorationType, state.workspaceRoot, excluded);
			}
		}),
	);
}

export function deactivate(): void {
	// Nothing to release: every disposable is already in context.subscriptions.
}
