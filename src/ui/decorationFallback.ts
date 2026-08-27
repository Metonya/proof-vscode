import * as vscode from 'vscode';

import { toAbsolutePath, toRepoRelativePath } from '../model/pathIndex';
import { classifyLine, mapLines, type LineState, type PartialLineMode } from '../verdict/coverageMapping';
import type { FileCoverageBlock } from '../verdict/types';

/**
 * F7 (Plan.md Bölüm 3): the yedek (fallback) path for a host with no
 * working Test Coverage API. Renders the same four states F2 paints
 * natively, from the same `mapLines`/`classifyLine` (Plan.md F7's "İki yol
 * da özdeş durum üretiyor" requirement holds by construction - both
 * consume the identical pure classification, never a second implementation
 * that could quietly drift). A colored left border (not a full background
 * wash) so it reads at a glance without fighting a file's own syntax colors.
 */
export interface FallbackDecorationTypes {
	covered: vscode.TextEditorDecorationType;
	partial: vscode.TextEditorDecorationType;
	uncovered: vscode.TextEditorDecorationType;
}

export function createFallbackDecorationTypes(): FallbackDecorationTypes {
	return {
		covered: borderDecoration('rgba(64,176,64,0.9)'),
		partial: borderDecoration('rgba(214,171,42,0.95)'),
		uncovered: borderDecoration('rgba(212,64,64,0.9)'),
	};
}

function borderDecoration(color: string): vscode.TextEditorDecorationType {
	return vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderWidth: '0 0 0 3px',
		borderStyle: 'solid',
		borderColor: color,
		overviewRulerColor: color,
		overviewRulerLane: vscode.OverviewRulerLane.Left,
	});
}

export function applyFallbackCoverage(
	types: FallbackDecorationTypes,
	workspaceRoot: string,
	block: FileCoverageBlock,
	partialLineMode: PartialLineMode,
): void {
	const rangesByAbsolutePath = new Map<string, Record<LineState, vscode.Range[]>>();
	for (const entry of block.files) {
		const byState: Record<LineState, vscode.Range[]> = { covered: [], partial: [], uncovered: [] };
		for (const mapped of mapLines(entry.lines, partialLineMode)) {
			byState[classifyLine(mapped)].push(new vscode.Range(mapped.line - 1, 0, mapped.line - 1, 0));
		}
		rangesByAbsolutePath.set(toAbsolutePath(workspaceRoot, entry.path), byState);
	}

	for (const editor of vscode.window.visibleTextEditors) {
		const byState = rangesByAbsolutePath.get(editor.document.uri.fsPath);
		editor.setDecorations(types.covered, byState?.covered ?? []);
		editor.setDecorations(types.partial, byState?.partial ?? []);
		editor.setDecorations(types.uncovered, byState?.uncovered ?? []);
	}
}

export function clearFallbackCoverage(types: FallbackDecorationTypes): void {
	for (const editor of vscode.window.visibleTextEditors) {
		editor.setDecorations(types.covered, []);
		editor.setDecorations(types.partial, []);
		editor.setDecorations(types.uncovered, []);
	}
}

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
