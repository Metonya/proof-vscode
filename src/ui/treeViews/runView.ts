import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { formatRelativeTime } from '../../model/mutationModel';
import { isGutterVisible } from '../../model/store';

/**
 * Faz 11b: "proof-java: Çalıştır" - komut paletine gitmeden analiz
 * başlatmak için sol kenar çubuğu görünümü.
 *
 * **Faz 18 - iki butona indirildi.** Kullanıcının kendi geri bildirimi:
 * "son kullanıcı olarak fazla buton var... benim isteğim proof-java'in
 * kullanılması, kötü testleri tespit, coverage'ın overall ve new code
 * olarak hesaplanması, hangi test hangi yeri cover ediyor görmek,
 * mutasyon başlatmak". Beş komut yerine iki tarama var, ikisi de ne
 * yaptığını ve ne kadar süreceğini söylüyor:
  *   - **Hızlı Tarama**: coverage (overall + yeni kod) + kötü test bulguları.
 *   - **Derin Tarama**: ayrıca hangi test hangi satırı cover ediyor (L2).
 * Dar kapsamlı "bu sınıf için" işi editör sağ-tık menüsüne taşındı
 * (`package.json`'daki `editor/context`), ağaçtan kalktı. Aç/kapa ve
 * görünüme odaklanma da eylem değil, durum - onlar da kalktı; aç/kapa
 * zaten durum çubuğundan tek tıkla yapılıyor.
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

		const config = vscode.workspace.getConfiguration('proof', folder);
		const diffMode = config.get<string>('diffMode') ?? 'uncommitted';
		const scopeText = diffModeText(diffMode, config.get<string>('baseRef'));

		const items = [
			// Faz 30 (§7.8): kullanıcının açıkça istediği "kolay tekrar koşma
			// düğmesi" - her zaman erişilebilir, rapor eksikken de dolu bir
			// analiz koşusu beklemek zorunda kalmadan.
			new RunItem(
				'Testleri Çalıştır',
				reportFreshnessText(folder),
				'proof.runTests',
				'run-all',
				'Maven ile testleri JaCoCo altında çalıştırır (görünür bir terminalde) ve raporu tazeler. Pom\'da JaCoCo eklentisi yoksa proof-java komut satırından ekler, kalıcı bir pom değişikliği yapmaz. Bitince Hızlı Tarama otomatik çalışır.',
			),
			new RunItem(
				'Hızlı Tarama',
				`coverage + kötü test bulguları · yeni kod: ${scopeText}`,
				'proof.analyze',
				'play',
				`Saniyeler sürer. Şunları hesaplar:\n· Genel coverage (tüm repo)\n· Yeni kod coverage (${scopeText})\n· Test kalitesi bulguları (doğrulaması olmayan/zayıf testler)`,
			),
		];

		if (diffMode === 'no-vcs') {
			items.push(new RunItem(
				'Derin Tarama',
				'no-vcs modunda kullanılamaz - bir diff gerektirir',
				undefined,
				'circle-slash',
				'Derin tarama, hangi testin hangi satırı çalıştırdığını yalnızca diff\'te değişen sınıflar için toplayabilir; "no-vcs" modunda değişen dosya kavramı olmadığı için hedefleyecek sınıf yok.\n\nTek bir sınıf için diff\'siz toplamak isterseniz: o dosyada sağ tık → "Bu Sınıf İçin Hangi Test Hangi Satırı Kapsıyor".',
			));
		} else {
			items.push(new RunItem(
				'Derin Tarama',
				'hızlı taramanın her şeyi + hangi test hangi satırı cover ediyor',
				'proof.analyzePerTest',
				'beaker',
				'DERİN TARAMA MUTASYON TESTİ DEĞİLDİR - mutasyon ayrı bir madde (aşağıda).\n\n'
				+ `Dakikalar sürebilir (testleri PIT motoru altında yeniden çalıştırır, ama sadece hangi testin hangi satıra dokunduğunu kaydetmek için - kodu mutasyona uğratmaz).\n\nHızlı taramanın her şeyine ek olarak:\n· Her satırı hangi testlerin çalıştırdığı ("Satır → Testler" görünümü)\n· "Yalancı yeşil" satırlar - covered ama cover eden hiçbir testin doğrulaması yok\n\nKapsam: ${scopeText} içinde değişen sınıflar.`,
			));
		}

		// Faz 20: mutasyon ayrı bir madde. Asla otomatik tetiklenmiyor ve
		// modül geneli koşu bir onay diyaloğunun arkasında - tek sınıf
		// saniyeler sürerken büyük bir modül bir saati aşabiliyor.
		items.push(diffMode === 'no-vcs'
			? new RunItem(
				'Mutasyon Testi',
				'modül geneli no-vcs modunda kullanılamaz - tek sınıf için sağ tık',
				undefined,
				'circle-slash',
				'Modül geneli mutasyon, hedeflerini diff\'te değişen production sınıflarından türetir; "no-vcs" modunda değişen dosya kavramı olmadığı için hedef yok.\n\nTek bir sınıf için bu modda da çalışır: o dosyada sağ tık → "Bu Sınıf İçin Mutasyon Testi".',
			)
			: new RunItem(
				'Mutasyon Testi',
				'kodu kasten boz, hiçbir testin fark etmediği yerleri bul',
				'proof.mutationForModule',
				'zap',
				'GERÇEK MUTASYON TESTİ (Derin Tarama\'dan farklı).\n\n'
				+ 'Kodun küçük varyantlarını ("mutant") üretip testleri tekrar koşar. Bir mutant hayatta kaldıysa kodu bozduk ve hiçbir test fark etmedi - o davranışı doğrulayan bir assertion eksik demektir.\n\n'
				+ 'UZUN SÜRER: büyük bir modülde bir saati aşabilir, onay isteyecek. Tek bir sınıf genelde saniyeler sürer - o dosyada sağ tık → "Bu Sınıf İçin Mutasyon Testi".\n\n'
				+ `Kapsam: ${scopeText} içinde değişen sınıflar. Sonuçlar "Mutasyon" görünümünde.`,
			),
			new RunItem(
				'Coverage Görünümü',
				isGutterVisible() ? 'açık - gizlemek için tıklayın' : 'kapalı - göstermek için tıklayın',
				'proof.toggleCoverage',
				isGutterVisible() ? 'eye' : 'eye-closed',
				'Editördeki satır renklerini ve Dosya Gezgini rozetlerini birlikte açar/kapatır. Yeniden tarama yapmaz.',
			));
		return items;
	}
}

/** Best-effort: the configured report's own mtime, the same "is this stale?" signal `--file-coverage`-driven staleness already relies on elsewhere. A missing report is not an error here, just "henüz yok" (hard rule 3a: absence gets its own state, not a guess). */
function reportFreshnessText(folder: vscode.WorkspaceFolder): string {
	const reportPath = vscode.workspace.getConfiguration('proof', folder).get<string>('reportPath') || 'target/site/jacoco/jacoco.xml';
	try {
		const stat = fs.statSync(path.join(folder.uri.fsPath, reportPath));
		return `rapor: ${formatRelativeTime(stat.mtimeMs, Date.now())}`;
	} catch {
		return 'rapor: henüz yok';
	}
}

function diffModeText(diffMode: string, baseRef: string | undefined): string {
	if (diffMode === 'base') {
		return `${baseRef?.trim() || '(baseRef ayarlanmamış)'} ile fark`;
	}
	if (diffMode === 'no-vcs') {
		return 'hesaplanmıyor (no-vcs)';
	}
	return 'commit bekleyen değişiklikler';
}

class RunItem extends vscode.TreeItem {
	constructor(label: string, description: string | undefined, commandId: string | undefined, icon: string, tooltip?: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = description;
		this.iconPath = new vscode.ThemeIcon(icon);
		this.tooltip = tooltip;
		if (commandId) {
			this.command = { command: commandId, title: label };
		}
	}
}
