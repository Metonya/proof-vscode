import * as vscode from 'vscode';

import { getCoverageState } from '../../model/store';
import { toAbsolutePath } from '../../model/pathIndex';
import type { ChangedFile, Metric, MetricSet } from '../../verdict/types';

/**
 * Faz 11b: "coverdict: Kapsama" - genel kapsama, yeni kod kapsaması, ve
 * kapsanmayan yeni satırlar tek yerde. Her üçü de CLI'ın verdict'inde zaten
 * hazır (D-70: dosya/klasör bazlı yeniden hesaplama yok, sadece
 * `changedFiles[].uncoveredNewRanges`'ın kendisi listelenir - "yeni ve
 * kapsanmış" satırların numaraları şemada yok, bu yüzden hiç gösterilmez).
 */
export type CoverageNode =
	| { kind: 'empty'; message: string }
	| { kind: 'section'; id: 'overall' | 'newCode' | 'uncovered' }
	| { kind: 'metric'; name: keyof MetricSet; metric: Metric }
	| { kind: 'newCodeStatus'; status: string }
	| { kind: 'changedFile'; file: ChangedFile }
	| { kind: 'range'; file: ChangedFile; range: readonly [number, number] };

export class CoverageTreeProvider implements vscode.TreeDataProvider<CoverageNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(node: CoverageNode): vscode.TreeItem {
		switch (node.kind) {
			case 'empty':
				return leaf(node.message, 'info');
			case 'section':
				return section(node.id);
			case 'metric':
				return leaf(`${node.name}: ${percentText(node.metric)}`, 'graph');
			case 'newCodeStatus':
				return leaf(newCodeStatusText(node.status), 'info');
			case 'changedFile': {
				const item = new vscode.TreeItem(node.file.path, vscode.TreeItemCollapsibleState.Collapsed);
				item.description = `${node.file.uncoveredNewRanges?.length ?? 0} kapsanmayan aralık`;
				item.iconPath = new vscode.ThemeIcon('file');
				return item;
			}
			case 'range': {
				const [start, end] = node.range;
				const label = start === end ? `Satır ${start}` : `Satır ${start}-${end}`;
				const item = leaf(label, 'circle-filled');
				const state = getCoverageState();
				if (state) {
					const uri = vscode.Uri.file(toAbsolutePath(state.workspaceRoot, node.file.path));
					const selection = new vscode.Range(start - 1, 0, start - 1, 0);
					item.command = { command: 'vscode.open', title: 'Dosyayı Aç', arguments: [uri, { selection }] };
				}
				return item;
			}
		}
	}

	getChildren(node?: CoverageNode): CoverageNode[] {
		const state = getCoverageState();
		if (!node) {
			if (!state) {
				return [{ kind: 'empty', message: 'Önce bir analiz çalıştırın.' }];
			}
			return [{ kind: 'section', id: 'overall' }, { kind: 'section', id: 'newCode' }, { kind: 'section', id: 'uncovered' }];
		}
		if (!state) {
			return [];
		}

		if (node.kind === 'section') {
			if (node.id === 'overall') {
				return metricNodes(state.overall);
			}
			if (node.id === 'newCode') {
				if ('jacoco-line' in state.newCode) {
					return metricNodes(state.newCode);
				}
				return [{ kind: 'newCodeStatus', status: state.newCode.status }];
			}
			const uncoveredFiles = state.changedFiles.filter((f) => f.classification === 'mapped' && (f.uncoveredNewRanges?.length ?? 0) > 0);
			return uncoveredFiles.length === 0
				? [{ kind: 'empty', message: 'Kapsanmayan yeni satır yok.' }]
				: uncoveredFiles.map((file): CoverageNode => ({ kind: 'changedFile', file }));
		}
		if (node.kind === 'changedFile') {
			return (node.file.uncoveredNewRanges ?? []).map((range): CoverageNode => ({ kind: 'range', file: node.file, range }));
		}
		return [];
	}
}

function metricNodes(set: MetricSet): CoverageNode[] {
	return [
		{ kind: 'metric', name: 'jacoco-line', metric: set['jacoco-line'] },
		{ kind: 'metric', name: 'strict-line', metric: set['strict-line'] },
		{ kind: 'metric', name: 'sonar-compatible', metric: set['sonar-compatible'] },
	];
}

function section(id: 'overall' | 'newCode' | 'uncovered'): vscode.TreeItem {
	const labels: Record<typeof id, string> = { overall: 'Genel', newCode: 'Yeni Kod', uncovered: 'Kapsanmayan Yeni Satırlar' };
	const item = new vscode.TreeItem(labels[id], id === 'uncovered' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
	item.iconPath = new vscode.ThemeIcon(id === 'uncovered' ? 'warning' : 'folder');
	return item;
}

function leaf(label: string, icon: string): vscode.TreeItem {
	const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon(icon);
	return item;
}

function percentText(metric: Metric): string {
	return metric.percent === null ? 'yok' : `${metric.percent}% (${metric.numerator}/${metric.denominator})`;
}

function newCodeStatusText(status: string): string {
	if (status === 'unavailable_no_vcs') {
		return 'no-vcs modunda yeni kod hesaplanamaz';
	}
	if (status === 'unavailable_incomplete') {
		return 'diff sırasında bir hata oldu, yeni kod hesaplanamadı';
	}
	return status;
}
