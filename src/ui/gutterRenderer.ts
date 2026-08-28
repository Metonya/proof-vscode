import * as vscode from 'vscode';

import { toAbsolutePath, toRepoRelativePath } from '../model/pathIndex';
import { classifyLine, mapLines, type LineState } from '../verdict/coverageMapping';
import type { FileCoverageBlock } from '../verdict/types';

/**
 * Faz 9: the only gutter renderer. VS Code's native Test Coverage API was
 * dropped entirely (its `addCoverage` has no documented remove/replace/
 * clear counterpart, and it exposes no separate control over the Explorer
 * badge vs. the editor gutter - `node_modules/@types/vscode/index.d.ts`
 * confirmed both, see Plan.md). Plain `TextEditorDecorationType`s give full,
 * documented control instead: `setDecorations(type, [])` reliably clears.
 *
 * Renders from `verdict/coverageMapping.ts`'s `classifyLine()` - the same
 * classification `ui/explorerBadges.ts` reads percentages from, so the two
 * surfaces can never show contradictory data for the same run.
 */
export interface GutterDecorationTypes {
	covered: vscode.TextEditorDecorationType;
	partial: vscode.TextEditorDecorationType;
	uncovered: vscode.TextEditorDecorationType;
	excluded: vscode.TextEditorDecorationType;
	stale: vscode.TextEditorDecorationType;
	/** Faz 15d: JaCoCo-covered, but every covering test has a real oracle-quality finding - a "false green" the plain JaCoCo colors cannot distinguish from a genuinely tested line. */
	oracleless: vscode.TextEditorDecorationType;
}

export function createGutterDecorationTypes(): GutterDecorationTypes {
	return {
		covered: borderDecoration(new vscode.ThemeColor('charts.green')),
		partial: borderDecoration(new vscode.ThemeColor('charts.yellow')),
		uncovered: borderDecoration(new vscode.ThemeColor('charts.red')),
		excluded: vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			backgroundColor: new vscode.ThemeColor('editorInactiveSelection.background'),
			overviewRulerColor: new vscode.ThemeColor('charts.gray'),
			overviewRulerLane: vscode.OverviewRulerLane.Left,
			after: {
				contentText: '  coverdict: kapsama dışı bırakılmış',
				color: new vscode.ThemeColor('descriptionForeground'),
				fontStyle: 'italic',
				margin: '0 0 0 1em',
			},
		}),
		// Faz 14e: son taramadan sonra dosya düzenlendi - eski satır
		// numaralarını boyamaya devam etmek yerine (hard rule 3a) tüm
		// kapsama dekorasyonları kaldırılır, yerine bu tek banner konur.
		stale: vscode.window.createTextEditorDecorationType({
			isWholeLine: true,
			overviewRulerColor: new vscode.ThemeColor('charts.yellow'),
			overviewRulerLane: vscode.OverviewRulerLane.Left,
			after: {
				contentText: '  coverdict: bu dosya son taramadan sonra değişti - kapsama bayat, tekrar tarayın',
				color: new vscode.ThemeColor('editorWarning.foreground'),
				fontStyle: 'italic',
				margin: '0 0 0 1em',
			},
		}),
		oracleless: borderDecoration(new vscode.ThemeColor('charts.orange')),
	};
}

function borderDecoration(color: vscode.ThemeColor): vscode.TextEditorDecorationType {
	return vscode.window.createTextEditorDecorationType({
		isWholeLine: true,
		borderWidth: '0 0 0 3px',
		borderStyle: 'solid',
		borderColor: color,
		overviewRulerColor: color,
		overviewRulerLane: vscode.OverviewRulerLane.Left,
	});
}

export function applyGutterCoverage(
	types: GutterDecorationTypes,
	workspaceRoot: string,
	block: FileCoverageBlock,
	staleAbsolutePaths: ReadonlySet<string> = new Set(),
	falseGreenLinesByPath: ReadonlyMap<string, ReadonlySet<number>> = new Map(),
): void {
	const rangesByAbsolutePath = new Map<string, Record<LineState | 'oracleless', vscode.Range[]>>();
	for (const entry of block.files) {
		const byState: Record<LineState | 'oracleless', vscode.Range[]> = { covered: [], partial: [], uncovered: [], oracleless: [] };
		const falseGreenLines = falseGreenLinesByPath.get(entry.path);
		for (const mapped of mapLines(entry.lines)) {
			const state = classifyLine(mapped);
			const range = new vscode.Range(mapped.line - 1, 0, mapped.line - 1, 0);
			// Faz 15d: a JaCoCo-covered line whose every covering test has no
			// real oracle moves out of "covered" into its own bucket - never
			// touches partial/uncovered, both already say something real.
			byState[state === 'covered' && falseGreenLines?.has(mapped.line) ? 'oracleless' : state].push(range);
		}
		rangesByAbsolutePath.set(toAbsolutePath(workspaceRoot, entry.path), byState);
	}

	const excludedPaths = new Set(block.excluded);
	for (const editor of vscode.window.visibleTextEditors) {
		const bannerRange = editor.document.lineCount > 0 ? [editor.document.lineAt(0).range] : [];
		if (staleAbsolutePaths.has(editor.document.uri.fsPath)) {
			editor.setDecorations(types.covered, []);
			editor.setDecorations(types.partial, []);
			editor.setDecorations(types.uncovered, []);
			editor.setDecorations(types.oracleless, []);
			editor.setDecorations(types.excluded, []);
			editor.setDecorations(types.stale, bannerRange);
			continue;
		}
		editor.setDecorations(types.stale, []);

		const byState = rangesByAbsolutePath.get(editor.document.uri.fsPath);
		editor.setDecorations(types.covered, byState?.covered ?? []);
		editor.setDecorations(types.partial, byState?.partial ?? []);
		editor.setDecorations(types.uncovered, byState?.uncovered ?? []);
		editor.setDecorations(types.oracleless, byState?.oracleless ?? []);

		const relative = toRepoRelativePath(workspaceRoot, editor.document.uri.fsPath);
		const isExcluded = relative !== undefined && excludedPaths.has(relative);
		editor.setDecorations(types.excluded, isExcluded ? bannerRange : []);
	}
}

export function clearGutterCoverage(types: GutterDecorationTypes): void {
	for (const editor of vscode.window.visibleTextEditors) {
		editor.setDecorations(types.covered, []);
		editor.setDecorations(types.partial, []);
		editor.setDecorations(types.uncovered, []);
		editor.setDecorations(types.oracleless, []);
		editor.setDecorations(types.excluded, []);
		editor.setDecorations(types.stale, []);
	}
}
