import * as vscode from 'vscode';

import { toAbsolutePath } from '../../model/pathIndex';
import { ruleDocsUrl, ruleInfo } from '../../model/ruleCatalog';
import { getCoverageState } from '../../model/store';
import type { Finding, RuleId } from '../../verdict/types';

/**
 * Faz 11b: "coverdict: Test Kalitesi" - `findings[]` gruplanmış, tıklanınca
 * ilgili test dosyası/satırı açılır.
 *
 * Faz 18: kullanıcının doğrudan geri bildirimi üzerine üç şey değişti -
 * (1) ham enum yerine düz Türkçe başlık, kod hâlâ yanında ve hover'da
 * kuralın ne olduğu + ne yapılacağı yazıyor (`model/ruleCatalog.ts`,
 * metinler coverdict'in kendi `docs/rules/<RULE>.md`'lerinden), (2) kural
 * yerine **dosyaya** göre de gruplanabiliyor, (3) serbest metinle
 * filtrelenebiliyor. Filtre ve gruplama modu bu sağlayıcının kendi
 * durumu - ayar dosyasına yazılmaz, oturum içinde yaşar.
 */
export type QualityGrouping = 'rule' | 'file';

export type QualityNode =
	| { kind: 'empty'; message: string }
	| { kind: 'rule'; rule: RuleId; findings: readonly Finding[] }
	| { kind: 'file'; path: string; findings: readonly Finding[] }
	| { kind: 'finding'; finding: Finding };

export class QualityTreeProvider implements vscode.TreeDataProvider<QualityNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	private grouping: QualityGrouping = 'rule';
	private filter = '';

	refresh(): void {
		this.changeEmitter.fire();
	}

	setGrouping(grouping: QualityGrouping): void {
		this.grouping = grouping;
		this.changeEmitter.fire();
	}

	getGrouping(): QualityGrouping {
		return this.grouping;
	}

	/** Boş dize filtreyi kaldırır. Kural kodu, Türkçe başlık, dosya yolu ve bulgu mesajı üzerinde arar. */
	setFilter(filter: string): void {
		this.filter = filter.trim().toLocaleLowerCase('tr');
		this.changeEmitter.fire();
	}

	getFilter(): string {
		return this.filter;
	}

	getTreeItem(node: QualityNode): vscode.TreeItem {
		switch (node.kind) {
			case 'empty':
				return leaf(node.message, 'info');
			case 'rule':
				return ruleItem(node);
			case 'file':
				return fileItem(node);
			case 'finding':
				return findingItem(node.finding);
		}
	}

	getChildren(node?: QualityNode): QualityNode[] {
		const state = getCoverageState();
		if (!node) {
			return this.rootChildren(state?.findings);
		}
		if (node.kind === 'rule' || node.kind === 'file') {
			return node.findings.map((finding): QualityNode => ({ kind: 'finding', finding }));
		}
		return [];
	}

	private rootChildren(allFindings: readonly Finding[] | undefined): QualityNode[] {
		if (!allFindings) {
			return [{ kind: 'empty', message: 'Önce bir analiz çalıştırın.' }];
		}
		if (allFindings.length === 0) {
			return [{ kind: 'empty', message: 'Bulgu yok.' }];
		}
		const findings = allFindings.filter((f) => this.matchesFilter(f));
		if (findings.length === 0) {
			return [{ kind: 'empty', message: `"${this.filter}" ile eşleşen bulgu yok (${allFindings.length} bulgu filtrelendi).` }];
		}
		return this.grouping === 'rule' ? groupByRule(findings) : groupByFile(findings);
	}

	private matchesFilter(finding: Finding): boolean {
		if (this.filter === '') {
			return true;
		}
		const info = ruleInfo(finding.rule);
		const haystack = [finding.rule, info.title, finding.path, finding.message, finding.testMethod ?? '', finding.productionMethod ?? '']
			.join(' ')
			.toLocaleLowerCase('tr');
		return haystack.includes(this.filter);
	}
}

function groupByRule(findings: readonly Finding[]): QualityNode[] {
	const byRule = new Map<RuleId, Finding[]>();
	for (const finding of findings) {
		const existing = byRule.get(finding.rule);
		if (existing) {
			existing.push(finding);
		} else {
			byRule.set(finding.rule, [finding]);
		}
	}
	return [...byRule.entries()].map(([rule, group]): QualityNode => ({ kind: 'rule', rule, findings: group }));
}

function groupByFile(findings: readonly Finding[]): QualityNode[] {
	const byPath = new Map<string, Finding[]>();
	for (const finding of findings) {
		const existing = byPath.get(finding.path);
		if (existing) {
			existing.push(finding);
		} else {
			byPath.set(finding.path, [finding]);
		}
	}
	return [...byPath.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([path, group]): QualityNode => ({ kind: 'file', path, findings: group }));
}

function ruleItem(node: Extract<QualityNode, { kind: 'rule' }>): vscode.TreeItem {
	const info = ruleInfo(node.rule);
	const item = new vscode.TreeItem(info.title, vscode.TreeItemCollapsibleState.Expanded);
	item.description = `${node.findings.length} bulgu · ${info.code}`;
	item.iconPath = new vscode.ThemeIcon(node.findings.some((f) => f.severity === 'WARNING') ? 'warning' : 'info');
	item.tooltip = new vscode.MarkdownString(
		`**${info.title}** \`${info.code}\`\n\n${info.summary}\n\n**Ne yapmalı:** ${info.action}\n\n[Kural dokümanı](${ruleDocsUrl(node.rule)})`,
	);
	item.contextValue = 'coverdict.qualityRule';
	return item;
}

function fileItem(node: Extract<QualityNode, { kind: 'file' }>): vscode.TreeItem {
	const fileName = node.path.split('/').pop() ?? node.path;
	const item = new vscode.TreeItem(fileName, vscode.TreeItemCollapsibleState.Expanded);
	item.description = `${node.findings.length} bulgu`;
	item.resourceUri = resourceUriFor(node.path);
	item.iconPath = vscode.ThemeIcon.File;
	item.tooltip = node.path;
	item.contextValue = 'coverdict.qualityFile';
	return item;
}

function findingItem(finding: Finding): vscode.TreeItem {
	const info = ruleInfo(finding.rule);
	const fileName = finding.path.split('/').pop() ?? finding.path;
	const item = new vscode.TreeItem(`${fileName}:${finding.startLine}`, vscode.TreeItemCollapsibleState.None);
	item.description = finding.testMethod?.split('#').pop() ?? finding.productionMethod ?? info.code;
	item.iconPath = new vscode.ThemeIcon(finding.severity === 'WARNING' ? 'warning' : 'info');
	item.tooltip = new vscode.MarkdownString(
		`**${info.title}** \`${info.code}\` · güven: ${finding.confidence}\n\n${finding.message}\n\n**Ne yapmalı:** ${finding.suggestedAction}\n\n[Kural dokümanı](${ruleDocsUrl(finding.rule)})`,
	);
	item.contextValue = 'coverdict.qualityFinding';

	const state = getCoverageState();
	if (state) {
		const uri = vscode.Uri.file(toAbsolutePath(state.workspaceRoot, finding.path));
		const selection = new vscode.Range(finding.startLine - 1, 0, finding.startLine - 1, 0);
		item.command = { command: 'vscode.open', title: 'Dosyayı Aç', arguments: [uri, { selection }] };
	}
	return item;
}

function resourceUriFor(repoRelativePath: string): vscode.Uri | undefined {
	const state = getCoverageState();
	return state ? vscode.Uri.file(toAbsolutePath(state.workspaceRoot, repoRelativePath)) : undefined;
}

function leaf(label: string, icon: string): vscode.TreeItem {
	const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon(icon);
	return item;
}
