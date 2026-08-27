import * as vscode from 'vscode';

/**
 * F2's fourth state, "blok hiç yok": when a run had no `fileCoverage` at
 * all (flag not requested, or a failure before it could be written), the
 * gutter must stay silent rather than show stale or fabricated data (hard
 * rule 3a) - this status bar item is the only place that fact is visible.
 */
export function createStatusBarItem(): vscode.StatusBarItem {
	const item = vscode.window.createStatusBarItem('coverdict', vscode.StatusBarAlignment.Left, 100);
	item.name = 'coverdict';
	return item;
}

export function showNoFileCoverageWarning(item: vscode.StatusBarItem): void {
	item.text = '$(warning) coverdict: no coverage data';
	item.tooltip = 'The last analyze run has no fileCoverage block - nothing is painted in the gutter.';
	item.show();
}

export function showUnsupportedHostWarning(item: vscode.StatusBarItem): void {
	item.text = '$(warning) coverdict: gutter unsupported here';
	item.tooltip = 'This VS Code build has no working Test Coverage API - coverage data exists but nothing can be painted (F7 will add a decoration fallback).';
	item.show();
}

export function showCoverageSummary(item: vscode.StatusBarItem, jacocoLinePercent: number | null): void {
	item.text = jacocoLinePercent === null ? '$(check) coverdict' : `$(check) coverdict ${jacocoLinePercent}%`;
	item.tooltip = 'coverdict: jacoco-line coverage from the last analyze run';
	item.show();
}
