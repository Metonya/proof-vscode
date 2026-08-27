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
	item.command = 'coverdict.toggleCoverage';
	return item;
}

export function showNoFileCoverageWarning(item: vscode.StatusBarItem): void {
	item.text = '$(warning) coverdict: kapsama verisi yok';
	item.tooltip = 'Son analiz koşusunda fileCoverage bloğu yok - kapsama görünümünde hiçbir şey gösterilmiyor.';
	item.show();
}

export function showCoverageSummary(item: vscode.StatusBarItem, overall: MetricSet, gutterVisible: boolean): void {
	const jacocoLine = overall['jacoco-line'].percent;
	const eyeIcon = gutterVisible ? 'eye' : 'eye-closed';
	item.text = jacocoLine === null ? '$(check) coverdict' : `$(${eyeIcon}) coverdict ${jacocoLine}%`;
	item.tooltip = new vscode.MarkdownString(
		[
			`**coverdict** - ${gutterVisible ? 'kapsama görünümü açık' : 'kapsama görünümü kapalı'} (aç/kapat için tıklayın)`,
			'',
			metricLine('jacoco-line', overall['jacoco-line']),
			metricLine('strict-line', overall['strict-line']),
			metricLine('sonar-compatible', overall['sonar-compatible']),
		].join('\n\n'),
	);
	item.show();
}

function metricLine(name: string, metric: MetricSet['jacoco-line']): string {
	const percentText = metric.percent === null ? 'yok' : `${metric.percent}%`;
	return `${name}: ${percentText} (${metric.numerator}/${metric.denominator})`;
}
