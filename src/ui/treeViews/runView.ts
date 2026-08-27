import * as vscode from 'vscode';

/**
 * Faz 11b: "coverdict: Çalıştır" - komut paletine gitmeden analiz
 * başlatmak için sol kenar çubuğu görünümü. Her öğe zaten var olan bir
 * komutu tetikler (Plan.md F8: "sihir olmaktan çıksın" - description
 * alanında hangi ayarların kullanılacağı görünür).
 */
export class RunTreeProvider implements vscode.TreeDataProvider<RunItem> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(item: RunItem): vscode.TreeItem {
		return item;
	}

	getChildren(): RunItem[] {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return [new RunItem('Önce bir klasör açın', undefined, undefined, 'warning')];
		}

		const config = vscode.workspace.getConfiguration('coverdict', folder);
		const diffMode = config.get<string>('diffMode') ?? 'uncommitted';
		const reportPath = config.get<string>('reportPath') ?? 'target/site/jacoco/jacoco.xml';

		return [
			new RunItem('Analiz Et', `diffMode: ${diffMode} · rapor: ${reportPath}`, 'coverdict.analyze', 'play'),
			new RunItem('Analiz Et (test bazlı)', 'ayrıca hangi testin hangi satırı kapsadığını toplar - bir diff gerektirir', 'coverdict.analyzePerTest', 'play-circle'),
			new RunItem('Kapsama Görünümünü Aç/Kapat', undefined, 'coverdict.toggleCoverage', 'eye'),
			new RunItem('Satır → Testler Göster', undefined, 'coverdict.showLineTests', 'list-tree'),
		];
	}
}

class RunItem extends vscode.TreeItem {
	constructor(label: string, description: string | undefined, commandId: string | undefined, icon: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = description;
		this.iconPath = new vscode.ThemeIcon(icon);
		if (commandId) {
			this.command = { command: commandId, title: label };
		}
	}
}
