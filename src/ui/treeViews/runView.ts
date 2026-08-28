import * as vscode from 'vscode';

import { isGutterVisible } from '../../model/store';

/**
 * Faz 11b: "coverdict: Çalıştır" - komut paletine gitmeden analiz
 * başlatmak için sol kenar çubuğu görünümü. Her öğe zaten var olan bir
 * komutu tetikler (Plan.md F8: "sihir olmaktan çıksın" - description
 * alanında hangi ayarların kullanılacağı görünür). Faz 13 madde 1/4: bu
 * ağaç artık aç/kapa durumunu ve no-vcs kısıtını da yansıtıyor, sadece
 * sabit bir buton listesi değil.
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
		const gutterVisible = isGutterVisible();

		const items = [
			new RunItem('Kapsama Taraması', `sadece kapsama yüzdelerini hesaplar - diffMode: ${diffMode} · rapor: ${reportPath}`, 'coverdict.analyze', 'play'),
		];

		if (diffMode === 'no-vcs') {
			items.push(new RunItem('Kapsama + Hangi Test Hangi Satırı Kapsıyor', 'no-vcs modunda kullanılamaz: L2 kanıtı sadece diff\'te değişen sınıfları hedefleyebilir', undefined, 'circle-slash'));
		} else {
			items.push(new RunItem('Kapsama + Hangi Test Hangi Satırı Kapsıyor', 'ayrıca her satırı hangi testin çalıştırdığını toplar (daha yavaş, bir diff gerektirir)', 'coverdict.analyzePerTest', 'play-circle'));
		}

		items.push(
			new RunItem('Kapsama Görünümünü Aç/Kapat', `şu an ${gutterVisible ? 'açık' : 'kapalı'}`, 'coverdict.toggleCoverage', gutterVisible ? 'eye' : 'eye-closed'),
			new RunItem('Satır → Testler Göster', undefined, 'coverdict.showLineTests', 'list-tree'),
		);
		return items;
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
