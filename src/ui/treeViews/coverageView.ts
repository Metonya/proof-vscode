import * as vscode from 'vscode';

import { getCoverageState, type CoverageState } from '../../model/store';
import { warningInfo } from '../../model/warningCatalog';
import { toAbsolutePath } from '../../model/pathIndex';
import type { ChangedFile, Metric, MetricSet, Reason } from '../../verdict/types';

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
				item.description = `${node.file.uncoveredNewRanges?.length ?? 0} uncovered aralık`;
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
		return [{ kind: 'empty', message: 'Önce bir analiz çalıştırın.' }];
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
		? [{ kind: 'empty', message: 'Uncovered yeni satır yok.' }]
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
	if (!('jacoco-line' in newCode)) {
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

/** `proof.diffMode`/`proof.baseRef`'i okuyup kullanıcının "hangi mod aktif" sorusuna tek satırlık bir cevap üretir - ayarları değiştirmeden burada tekrar görünür kılmak için. */
function diffModeDetail(): string {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return '';
	}
	const config = vscode.workspace.getConfiguration('proof', folder);
	const diffMode = config.get<string>('diffMode') ?? 'uncommitted';
	if (diffMode === 'base') {
		const baseRef = config.get<string>('baseRef')?.trim();
		return `mod: base, ref: ${baseRef || '(boş - proof.baseRef ayarlanmamış)'}`;
	}
	return `mod: ${diffMode}`;
}

function metricNodes(set: MetricSet): CoverageNode[] {
	return [
		{ kind: 'metric', name: 'jacoco-line', metric: set['jacoco-line'] },
		{ kind: 'metric', name: 'strict-line', metric: set['strict-line'] },
		{ kind: 'metric', name: 'sonar-compatible', metric: set['sonar-compatible'] },
	];
}

function section(id: 'overall' | 'newCode' | 'uncovered' | 'warnings'): vscode.TreeItem {
	const labels: Record<typeof id, string> = { overall: 'Genel', newCode: 'Yeni Kod', uncovered: 'Uncovered Yeni Satırlar', warnings: 'Uyarılar' };
	const descriptions: Partial<Record<typeof id, string>> = { overall: 'tüm repo', newCode: 'sadece bu diff\'teki satırlar' };
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
			info.action ? `**Ne yapmalı:** ${info.action}` : undefined,
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

/** Faz 13 madde 10: üç metrik modunun nasıl hesaplandığını anlatan tek yer - `MetricsEngine.java`/D-04'e dayanıyor, uydurulmuyor. */
function metricTooltip(name: keyof MetricSet): string {
	switch (name) {
		case 'jacoco-line':
			return 'Bir satırdaki herhangi bir komut çalıştıysa kapsanmış sayılır - en cömert sayı, JaCoCo\'nun ham satır kapsamasıyla birebir aynı.';
		case 'strict-line':
			return 'Bir satırın kapsanmış sayılması için o satırdaki HER komutun çalışmış olması gerekir - en katı sayı, genelde en düşük çıkar.';
		case 'sonar-compatible':
			return 'JaCoCo satır kapsamasına dal (branch) kapsamasını da ekler - SonarQube\'un gösterdiği yüzdeyle ±0.1 içinde eşleşir, bu yüzden genelde jacoco-line\'dan daha düşük çıkar.';
	}
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
	if (status === 'no-changes') {
		return 'bu diff\'te değişen dosya yok';
	}
	if (status === 'stale-report') {
		return 'değişen satırlar raporda yok - rapor bu diff\'ten eski olabilir';
	}
	return status;
}
