import * as vscode from 'vscode';

import { toAbsolutePath } from '../../model/pathIndex';
import { getCoverageState } from '../../model/store';
import type { Finding, RuleId } from '../../verdict/types';

/** Faz 11b: "coverdict: Test Kalitesi" - findings[] kural bazında gruplanmış, tıklanınca ilgili test dosyası/satırı açılır. */
export type QualityNode =
	| { kind: 'empty'; message: string }
	| { kind: 'rule'; rule: RuleId; findings: readonly Finding[] }
	| { kind: 'finding'; finding: Finding };

export class QualityTreeProvider implements vscode.TreeDataProvider<QualityNode> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(node: QualityNode): vscode.TreeItem {
		if (node.kind === 'empty') {
			const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
			item.iconPath = new vscode.ThemeIcon('info');
			return item;
		}
		if (node.kind === 'rule') {
			const item = new vscode.TreeItem(node.rule, vscode.TreeItemCollapsibleState.Expanded);
			item.description = `${node.findings.length} bulgu`;
			item.iconPath = new vscode.ThemeIcon(node.findings.some((f) => f.severity === 'WARNING') ? 'warning' : 'info');
			return item;
		}

		const finding = node.finding;
		const fileName = finding.path.split('/').pop() ?? finding.path;
		const item = new vscode.TreeItem(`${fileName}:${finding.startLine}`, vscode.TreeItemCollapsibleState.None);
		item.description = finding.testMethod ?? finding.productionMethod ?? finding.confidence;
		item.tooltip = new vscode.MarkdownString(`**${finding.confidence}** - ${finding.message}\n\n${finding.suggestedAction}`);
		item.iconPath = new vscode.ThemeIcon(finding.severity === 'WARNING' ? 'warning' : 'info');

		const state = getCoverageState();
		if (state) {
			const uri = vscode.Uri.file(toAbsolutePath(state.workspaceRoot, finding.path));
			const selection = new vscode.Range(finding.startLine - 1, 0, finding.startLine - 1, 0);
			item.command = { command: 'vscode.open', title: 'Dosyayı Aç', arguments: [uri, { selection }] };
		}
		return item;
	}

	getChildren(node?: QualityNode): QualityNode[] {
		const state = getCoverageState();
		if (!node) {
			if (!state) {
				return [{ kind: 'empty', message: 'Önce bir analiz çalıştırın.' }];
			}
			if (state.findings.length === 0) {
				return [{ kind: 'empty', message: 'Bulgu yok.' }];
			}
			const byRule = new Map<RuleId, Finding[]>();
			for (const finding of state.findings) {
				const existing = byRule.get(finding.rule);
				if (existing) {
					existing.push(finding);
				} else {
					byRule.set(finding.rule, [finding]);
				}
			}
			return [...byRule.entries()].map(([rule, findings]): QualityNode => ({ kind: 'rule', rule, findings }));
		}
		if (node.kind === 'rule') {
			return node.findings.map((finding): QualityNode => ({ kind: 'finding', finding }));
		}
		return [];
	}
}
