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
	const item = vscode.window.createStatusBarItem('proof-java', vscode.StatusBarAlignment.Left, 100);
	item.name = 'proof-java';
	item.command = 'proof.toggleCoverage';
	return item;
}

export function showNoFileCoverageWarning(item: vscode.StatusBarItem): void {
	item.text = '$(warning) Proof: no coverage data';
	item.tooltip = 'The last analysis run has no fileCoverage block - nothing is shown in the coverage view.';
	item.show();
}

export function showCoverageSummary(item: vscode.StatusBarItem, overall: MetricSet, gutterVisible: boolean, badgeMetric: BadgeMetric, newCode: NewCodeCoverage): void {
	const headlinePercent = overall[badgeMetric].percent;
	const eyeIcon = gutterVisible ? 'eye' : 'eye-closed';
	item.text = headlinePercent === null ? '$(check) Proof' : `$(${eyeIcon}) Proof ${headlinePercent}%`;
	item.tooltip = new vscode.MarkdownString(
		[
			`**Proof** - coverage view is ${gutterVisible ? 'on' : 'off'} (click to toggle)`,
			'',
			'**Overall** (whole repo)',
			metricLine('jacoco-line', overall['jacoco-line']),
			metricLine('strict-line', overall['strict-line']),
			metricLine('sonar-compatible', overall['sonar-compatible']),
			'',
			'**New Code** (lines in this diff)',
			newCodeLines(newCode),
		].join('\n\n'),
	);
	item.show();
}

function newCodeLines(newCode: NewCodeCoverage): string {
	if (!('jacoco-line' in newCode)) {
		return newCode.status === 'unavailable_no_vcs' ? 'cannot be computed in no-vcs mode' : 'an error occurred during the diff';
	}
	return [
		metricLine('jacoco-line', newCode['jacoco-line']),
		metricLine('strict-line', newCode['strict-line']),
		metricLine('sonar-compatible', newCode['sonar-compatible']),
	].join('\n\n');
}

function metricLine(name: string, metric: MetricSet['jacoco-line']): string {
	const percentText = metric.percent === null ? 'n/a' : `${metric.percent}%`;
	return `${name}: ${percentText} (${metric.numerator}/${metric.denominator})`;
}
