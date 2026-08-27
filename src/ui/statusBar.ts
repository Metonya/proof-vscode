import * as vscode from 'vscode';

import type { MetricSet } from '../verdict/types';

/**
 * F2's fourth state, "blok hiç yok": when a run had no `fileCoverage` at
 * all (flag not requested, or a failure before it could be written), the
 * gutter must stay silent rather than show stale or fabricated data (hard
 * rule 3a) - this status bar item is the only place that fact is visible.
 * The item's `command` is set once at creation (F4) so clicking it toggles
 * the gutter, same gesture as the info message's summary text.
 */
export function createStatusBarItem(): vscode.StatusBarItem {
	const item = vscode.window.createStatusBarItem('coverdict', vscode.StatusBarAlignment.Left, 100);
	item.name = 'coverdict';
	item.command = 'coverdict.toggleCoverageGutter';
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

export function showCoverageSummary(item: vscode.StatusBarItem, overall: MetricSet, gutterVisible: boolean): void {
	const jacocoLine = overall['jacoco-line'].percent;
	const eyeIcon = gutterVisible ? 'eye' : 'eye-closed';
	item.text = jacocoLine === null ? '$(check) coverdict' : `$(${eyeIcon}) coverdict ${jacocoLine}%`;
	item.tooltip = new vscode.MarkdownString(
		[
			`**coverdict** - ${gutterVisible ? 'gutter shown' : 'gutter hidden'} (click to toggle)`,
			'',
			metricLine('jacoco-line', overall['jacoco-line']),
			metricLine('strict-line', overall['strict-line']),
			metricLine('sonar-compatible', overall['sonar-compatible']),
		].join('\n\n'),
	);
	item.show();
}

function metricLine(name: string, metric: MetricSet['jacoco-line']): string {
	const percentText = metric.percent === null ? 'n/a' : `${metric.percent}%`;
	return `${name}: ${percentText} (${metric.numerator}/${metric.denominator})`;
}
