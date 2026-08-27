import * as vscode from 'vscode';

import { toRepoRelativePath } from '../model/pathIndex';

/**
 * The one gutter state the built-in Test Coverage API has no concept of at
 * all: "explicitly excluded" (hard rule 3a - never conflated with "unknown"
 * or "uncovered"). A plain `TextEditorDecorationType` covers this
 * regardless of whether F2's primary native path or F7's fallback decoration
 * path is active for everything else - this one is always a decoration.
 */
export function createExcludedDecorationType(): vscode.TextEditorDecorationType {
	return vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		backgroundColor: 'rgba(128,128,128,0.12)',
		overviewRulerColor: 'rgba(128,128,128,0.5)',
		overviewRulerLane: vscode.OverviewRulerLane.Left,
		after: {
			contentText: '  coverdict: excluded from coverage',
			color: 'rgba(128,128,128,0.8)',
			fontStyle: 'italic',
			margin: '0 0 0 1em',
		},
	});
}

export function applyExcludedDecorations(
	decorationType: vscode.TextEditorDecorationType,
	workspaceRoot: string,
	excludedRepoRelativePaths: readonly string[],
): void {
	const excludedPaths = new Set(excludedRepoRelativePaths);
	for (const editor of vscode.window.visibleTextEditors) {
		const relative = toRepoRelativePath(workspaceRoot, editor.document.uri.fsPath);
		const isExcluded = relative !== undefined && excludedPaths.has(relative);
		editor.setDecorations(decorationType, isExcluded && editor.document.lineCount > 0 ? [editor.document.lineAt(0).range] : []);
	}
}
