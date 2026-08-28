import * as vscode from 'vscode';

import type { BadgeMetric } from '../model/metrics';
import type { MetricSet, NewCodeCoverage } from '../verdict/types';

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
	item.text = '$(warning) coverdict: coverage verisi yok';
	item.tooltip = 'Son analiz koşusunda fileCoverage bloğu yok - coverage görünümünde hiçbir şey gösterilmiyor.';
	item.show();
}

export function showCoverageSummary(item: vscode.StatusBarItem, overall: MetricSet, gutterVisible: boolean, badgeMetric: BadgeMetric, newCode: NewCodeCoverage): void {
	const headlinePercent = overall[badgeMetric].percent;
	const eyeIcon = gutterVisible ? 'eye' : 'eye-closed';
	item.text = headlinePercent === null ? '$(check) coverdict' : `$(${eyeIcon}) coverdict ${headlinePercent}%`;
	item.tooltip = new vscode.MarkdownString(
		[
			`**coverdict** - ${gutterVisible ? 'coverage görünümü açık' : 'coverage görünümü kapalı'} (aç/kapat için tıklayın)`,
			'',
			'**Genel** (tüm repo)',
			metricLine('jacoco-line', overall['jacoco-line']),
			metricLine('strict-line', overall['strict-line']),
			metricLine('sonar-compatible', overall['sonar-compatible']),
			'',
			'**Yeni Kod** (bu diff\'teki satırlar)',
			newCodeLines(newCode),
		].join('\n\n'),
	);
	item.show();
}

function newCodeLines(newCode: NewCodeCoverage): string {
	if (!('jacoco-line' in newCode)) {
		return newCode.status === 'unavailable_no_vcs' ? 'no-vcs modunda hesaplanamaz' : 'diff sırasında hata oldu';
	}
	return [
		metricLine('jacoco-line', newCode['jacoco-line']),
		metricLine('strict-line', newCode['strict-line']),
		metricLine('sonar-compatible', newCode['sonar-compatible']),
	].join('\n\n');
}

function metricLine(name: string, metric: MetricSet['jacoco-line']): string {
	const percentText = metric.percent === null ? 'yok' : `${metric.percent}%`;
	return `${name}: ${percentText} (${metric.numerator}/${metric.denominator})`;
}
