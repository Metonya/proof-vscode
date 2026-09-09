import * as vscode from 'vscode';

import { getCoverageState, type CoverageState } from '../../model/store';
import { warningInfo } from '../../model/warningCatalog';
import { toAbsolutePath } from '../../model/pathIndex';
import { engineLine, type ChangedFile, type Metric, type MetricSet, type Reason } from '../../verdict/types';

/**
 * Faz 11b: "proof-java: Kapsama" - genel kapsama, yeni kod kapsaması, ve
 * kapsanmayan yeni satırlar tek yerde. Her üçü de CLI'ın verdict'inde zaten
 * hazır (D-70: dosya/klasör bazlı yeniden hesaplama yok, sadece
 * `changedFiles[].uncoveredNewRanges`'ın kendisi listelenir - "yeni ve
 * kapsanmış" satırların numaraları şemada yok, bu yüzden hiç gösterilmez).
 *
 * Faz 13d: "Genel" ile "Yeni Kod" ayrı görünmesi kasıtlı - biri repo'nun
 * tamamı, diğeri yalnızca aktif diff'teki satırlar. "Yeni Kod: yok" artık
 * çıplak durmuyor - `newCodeStatus` iki yeni durumla (`no-changes`,
 * `stale-report`) *neden* boş olduğunu açıklıyor. Yeni bir "Uyarılar"
 * bölümü, CLI'ın `warnings[]`'ini (önceden hiçbir view'da görünmüyordu)
 * gösteriyor - hard rule 3a: "veri yok" ile "sorun yok" asla aynı görünmez.
 */
export type CoverageNode =
	| { kind: 'empty'; message: string }
	| { kind: 'section'; id: 'overall' | 'newCode' | 'uncovered' | 'warnings' }
	| { kind: 'metric'; name: keyof MetricSet; metric: Metric }
	| { kind: 'newCodeStatus'; status: string; detail?: string }
	| { kind: 'changedFile'; file: ChangedFile }
	| { kind: 'range'; file: ChangedFile; range: readonly [number, number] }
	| { kind: 'warning'; reason: Reason };

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
				return leaf(`${node.name}: ${percentText(node.metric)}`, 'graph', metricTooltip(node.name));
			case 'newCodeStatus':
				return leaf(newCodeStatusText(node.status), 'info', node.detail);
			case 'warning':
				return warningItem(node.reason);
			case 'changedFile': {
				const item = new vscode.TreeItem(node.file.path, vscode.TreeItemCollapsibleState.Collapsed);
				item.description = `${node.file.uncoveredNewRanges?.length ?? 0} uncovered range(s)`;
				item.iconPath = new vscode.ThemeIcon('file');
				return item;
			}
			case 'range': {
				const [start, end] = node.range;
				const label = start === end ? `Line ${start}` : `Line ${start}-${end}`;
				const item = leaf(label, 'circle-filled');
				const state = getCoverageState();
				if (state) {
					const uri = vscode.Uri.file(toAbsolutePath(state.workspaceRoot, node.file.path));
					const selection = new vscode.Range(start - 1, 0, start - 1, 0);
					item.command = { command: 'vscode.open', title: 'Open File', arguments: [uri, { selection }] };
				}
				return item;
			}
		}
	}

	getChildren(node?: CoverageNode): CoverageNode[] {
		const state = getCoverageState();
		if (!node) {
			return rootChildren(state);
		}
		if (!state) {
			return [];
		}
		if (node.kind === 'section') {
			return sectionChildren(node.id, state);
		}
		if (node.kind === 'changedFile') {
			return (node.file.uncoveredNewRanges ?? []).map((range): CoverageNode => ({ kind: 'range', file: node.file, range }));
		}
		return [];
	}
}

function rootChildren(state: CoverageState | undefined): CoverageNode[] {
	if (!state) {
		return [{ kind: 'empty', message: 'Run an analysis first.' }];
	}
	const sections: CoverageNode[] = [{ kind: 'section', id: 'overall' }, { kind: 'section', id: 'newCode' }, { kind: 'section', id: 'uncovered' }];
	if (state.warnings.length > 0) {
		sections.push({ kind: 'section', id: 'warnings' });
	}
	return sections;
}

function sectionChildren(id: 'overall' | 'newCode' | 'uncovered' | 'warnings', state: CoverageState): CoverageNode[] {
	if (id === 'overall') {
		return metricNodes(state.overall);
	}
	if (id === 'newCode') {
		return newCodeChildren(state.newCode, state.changedFiles, state.warnings);
	}
	if (id === 'warnings') {
		return state.warnings.map((reason): CoverageNode => ({ kind: 'warning', reason }));
	}
	const uncoveredFiles = state.changedFiles.filter((f) => f.classification === 'mapped' && (f.uncoveredNewRanges?.length ?? 0) > 0);
	return uncoveredFiles.length === 0
		? [{ kind: 'empty', message: 'No uncovered new lines.' }]
		: uncoveredFiles.map((file): CoverageNode => ({ kind: 'changedFile', file }));
}

/**
 * Faz 13d: "Yeni Kod: yok" tek başına anlamsızdı - üç ayrı sebep aynı
 * görünüyordu (no-vcs modu, boş diff, bayat rapor). `newCode.status` zaten
 * ilk ikisini ayırıyordu (`unavailable_no_vcs`/`unavailable_incomplete`);
 * burada eklenen iki durum, gerçek bir `MetricSet` geldiğinde (diff modu
 * çalıştı) ama içi boşken *neden* boş olduğunu söylüyor.
 */
function newCodeChildren(newCode: CoverageState['newCode'], changedFiles: CoverageState['changedFiles'], warnings: CoverageState['warnings']): CoverageNode[] {
	if ('status' in newCode) {
		return [{ kind: 'newCodeStatus', status: newCode.status }];
	}
	if (changedFiles.length === 0) {
		return [{ kind: 'newCodeStatus', status: 'no-changes', detail: diffModeDetail() }];
	}
	const stale = warnings.find((w) => w.code === 'CHANGED_LINES_ABSENT_FROM_REPORT');
	if (stale) {
		return [{ kind: 'newCodeStatus', status: 'stale-report', detail: stale.message }, ...metricNodes(newCode)];
	}
	return metricNodes(newCode);
}

/** Reads `proof.diffMode`/`proof.baseRef` and produces a one-line answer to "which mode is active" - surfaced here again without having to go check the settings. */
function diffModeDetail(): string {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return '';
	}
	const config = vscode.workspace.getConfiguration('proof', folder);
	const diffMode = config.get<string>('diffMode') ?? 'uncommitted';
	if (diffMode === 'base') {
		const baseRef = config.get<string>('baseRef')?.trim();
		return `mode: base, ref: ${baseRef || '(empty - proof.baseRef not set)'}`;
	}
	return `mode: ${diffMode}`;
}

function metricNodes(set: MetricSet): CoverageNode[] {
	const engine = engineLine(set);
	return [
		...(engine ? [{ kind: 'metric' as const, name: engine.mode, metric: engine.metric }] : []),
		{ kind: 'metric', name: 'strict-line', metric: set['strict-line'] },
		{ kind: 'metric', name: 'sonar-compatible', metric: set['sonar-compatible'] },
	];
}

function section(id: 'overall' | 'newCode' | 'uncovered' | 'warnings'): vscode.TreeItem {
	const labels: Record<typeof id, string> = { overall: 'Overall', newCode: 'New Code', uncovered: 'Uncovered New Lines', warnings: 'Warnings' };
	const descriptions: Partial<Record<typeof id, string>> = { overall: 'whole repo', newCode: 'only lines in this diff' };
	const item = new vscode.TreeItem(labels[id], id === 'overall' || id === 'newCode' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
	item.description = descriptions[id];
	item.iconPath = new vscode.ThemeIcon(id === 'uncovered' || id === 'warnings' ? 'warning' : 'folder');
	return item;
}

/**
 * Faz 18: ham CLI kodu ve İngilizce mesajı yerine düz Türkçe başlık +
 * hover'da "ne demek / ne yapmalı". Ham mesaj tooltip'in sonunda aynen
 * kalıyor - içindeki gerçek sayılar (kaç satır, kaç dosya) yalnızca orada
 * var, uydurulamaz (`model/warningCatalog.ts`).
 */
function warningItem(reason: Reason): vscode.TreeItem {
	const info = warningInfo(reason);
	const item = leaf(info.title, 'warning');
	item.description = info.code;
	item.tooltip = new vscode.MarkdownString(
		[
			`**${info.title}** \`${info.code}\``,
			info.explanation,
			info.action ? `**What to do:** ${info.action}` : undefined,
			`\`\`\`\n${reason.message}\n\`\`\``,
		].filter(Boolean).join('\n\n'),
	);
	item.contextValue = 'proof.warning';
	return item;
}

function leaf(label: string, icon: string, tooltip?: string): vscode.TreeItem {
	const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon(icon);
	if (tooltip) {
		item.tooltip = tooltip;
	}
	return item;
}

/**
 * Faz 13 madde 10: üç metrik modunun nasıl hesaplandığını anlatan tek yer -
 * `MetricsEngine.java`/D-04'e dayanıyor, uydurulmuyor. İlk mod, raporu üreten
 * motorun kendi sayacının adını taşıyor (proof-java D-99), o yüzden iki
 * yazımın da karşılığı var.
 */
function metricTooltip(name: string): string {
	switch (name) {
		case 'jacoco-line':
			return 'A line counts as covered if any instruction on it ran - the most generous number, identical to JaCoCo\'s own raw line coverage.';
		case 'coverage-line':
			return 'A statement counts as covered if it ran - identical to coverage.py\'s own statement percentage. proof-python\'s counterpart to jacoco-line.';
		case 'strict-line':
			return 'A line only counts as covered if EVERY instruction on it ran and no branch on it was missed - the strictest number, usually the lowest.';
		case 'sonar-compatible':
			return 'Adds branch coverage on top of the engine\'s own line coverage - matches the percentage SonarQube shows within ±0.1, so it usually comes out lower.';
		default:
			// Never reached from `metricNodes`, which only produces the four
			// ids above; a mode this build does not know gets no tooltip
			// rather than an invented one.
			return '';
	}
}

function percentText(metric: Metric): string {
	return metric.percent === null ? 'n/a' : `${metric.percent}% (${metric.numerator}/${metric.denominator})`;
}

function newCodeStatusText(status: string): string {
	if (status === 'unavailable_no_vcs') {
		return 'new code cannot be computed in no-vcs mode';
	}
	if (status === 'unavailable_incomplete') {
		return 'an error occurred during the diff, new code could not be computed';
	}
	if (status === 'no-changes') {
		return 'no files changed in this diff';
	}
	if (status === 'stale-report') {
		return 'changed lines are absent from the report - it may be older than this diff';
	}
	return status;
}
