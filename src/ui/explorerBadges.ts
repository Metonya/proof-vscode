import * as path from 'node:path';
import * as vscode from 'vscode';

import { rollupFolder, type BadgeMetric } from '../model/metrics';
import { toAbsolutePath, toRepoRelativePath } from '../model/pathIndex';
import { isFileStale, markFileStale } from '../model/store';
import type { FileCoverageBlock, FileCoverageEntry } from '../verdict/types';

/**
 * Faz 9: Explorer'daki dosya/klasör yüzdesi rozetleri, VS Code'un
 * `FileDecorationProvider`'ıyla (native Test Coverage API'nin aksine tam
 * belgelenmiş, `onDidChangeFileDecorations` ile garantili temizlenen bir
 * yol). Dosya rozeti CLI'ın kendi `Metric.percent`'i (asla yeniden
 * hesaplanmaz); klasör rozeti tek izinli aritmetik olan rollup'tan gelir
 * (`model/metrics.ts`).
 *
 * **Faz 18 - iki karakter sınırı (Faz 9'un "Açık risk 1"i, gerçekleşti).**
 * VS Code'un uzantı ana süreci `FileDecoration.badge` iki *code point*'ten
 * uzunsa **exception fırlatıyor** ("The 'badge'-property must be undefined
 * or a short character"), ve o sağlayıcının o dosya için hiçbir dekorasyonu
 * çizilmiyor. Yani `"100"` sessizce rozetsiz bir dosya demekti - %100
 * kapsanan her sınıf (playground'da `NotifyingCalculator.java`) hiç
 * coverage verisi yokmuş gibi görünüyordu. Bu yüzden %100 artık `✓`
 * (tek code point), gerçek sayı tooltip'te. Bu sınıf `.d.ts`'te
 * belgelenmemiş - gerçek VS Code 1.135.0 kaynağında doğrulandı.
 */
const FULLY_COVERED_BADGE = '✓';
const EXCLUDED_BADGE = '–';

export class ExplorerBadgeProvider implements vscode.FileDecorationProvider, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	readonly onDidChangeFileDecorations = this.changeEmitter.event;

	private workspaceRoot: string | undefined;
	private byAbsolutePath = new Map<string, FileCoverageEntry>();
	private excludedAbsolutePaths = new Set<string>();
	private metric: BadgeMetric = 'sonar-compatible';

	update(workspaceRoot: string, block: FileCoverageBlock | undefined, metric: BadgeMetric): void {
		this.workspaceRoot = workspaceRoot;
		this.metric = metric;
		this.byAbsolutePath = new Map(block?.files.map((file) => [toAbsolutePath(workspaceRoot, file.path), file]) ?? []);
		this.excludedAbsolutePaths = new Set((block?.excluded ?? []).map((p) => toAbsolutePath(workspaceRoot, p)));
		this.changeEmitter.fire(undefined);
	}

	clear(): void {
		this.byAbsolutePath = new Map();
		this.excludedAbsolutePaths = new Set();
		this.changeEmitter.fire(undefined);
	}

	/** Faz 14e: bir tarama sonrası dosya düzenlenirse, eski yüzdeyi göstermeye devam etmek yerine bayatlığı işaretle. */
	markStale(uri: vscode.Uri): void {
		markFileStale(uri.fsPath);
		this.changeEmitter.fire(uri);
	}

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		if (!this.workspaceRoot) {
			return undefined;
		}

		if (isFileStale(uri.fsPath)) {
			return new vscode.FileDecoration('!', 'coverdict: bu dosya son taramadan sonra değişti - coverage bayat olabilir, tekrar tarayın', new vscode.ThemeColor('charts.yellow'));
		}

		// Faz 18: coverage dışı bırakılmış dosyalar artık Explorer'da da
		// görünüyor - "hiç veri yok" ile "kasten hariç tutuldu" aynı
		// görünmemeli (hard rule 3a). Kapsama listesinden ÖNCE bakılır:
		// hariç tutulmuş bir dosya zaten `files[]`'ta olmaz.
		if (this.excludedAbsolutePaths.has(uri.fsPath)) {
			const relative = toRepoRelativePath(this.workspaceRoot, uri.fsPath) ?? uri.fsPath;
			return new vscode.FileDecoration(
				EXCLUDED_BADGE,
				`coverdict: coverage dışı bırakıldı (coverdict.coverageExclusions)\n${relative}\nBu dosya coverage yüzdelerine hiç katılmıyor.`,
				new vscode.ThemeColor('charts.gray'),
			);
		}

		if (this.byAbsolutePath.size === 0) {
			return undefined;
		}

		const file = this.byAbsolutePath.get(uri.fsPath);
		if (file) {
			return this.fileDecoration(file);
		}
		return this.folderDecoration(uri);
	}

	private fileDecoration(file: FileCoverageEntry): vscode.FileDecoration | undefined {
		const metric = file.metrics[this.metric];
		if (metric.percent === null) {
			return undefined; // no executable lines at all (a pure interface) - "no data" is not "0%"
		}
		const tooltip = `coverdict: bu dosya ${metric.percent}% (${metric.numerator}/${metric.denominator}, ${this.metric})\n`
			+ 'Durum çubuğundaki yüzde tüm repo içindir - bu sayı yalnızca bu dosyanın kendisi.';
		return this.badge(metric.percent, tooltip);
	}

	private folderDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		const prefix = uri.fsPath + path.sep;
		const childFiles = [...this.byAbsolutePath.entries()]
			.filter(([absolutePath]) => absolutePath.startsWith(prefix))
			.map(([, entry]) => entry);
		if (childFiles.length === 0) {
			return undefined;
		}
		const rollup = rollupFolder(childFiles, this.metric);
		if (rollup.percent === null) {
			return undefined;
		}
		const tooltip = `coverdict: bu klasör ${rollup.percent}% (${rollup.numerator}/${rollup.denominator}, ${this.metric})\n`
			+ `${childFiles.length} dosyanın toplamı.`;
		return this.badge(rollup.percent, tooltip);
	}

	/**
	 * En fazla iki code point'lik bir rozet üretir - VS Code daha uzununu
	 * reddedip dekorasyonu tamamen düşürüyor (yukarıdaki sınıf yorumu).
	 * `Math.round` %99.6'yı 100'e çıkarabildiği için karar yuvarlanmış
	 * değer üzerinden verilir, ham yüzde üzerinden değil.
	 */
	private badge(percent: number, tooltip: string): vscode.FileDecoration {
		const rounded = Math.round(percent);
		const badge = rounded >= 100 ? FULLY_COVERED_BADGE : rounded.toString();
		return new vscode.FileDecoration(badge, tooltip, new vscode.ThemeColor(colorIdFor(percent)));
	}

	dispose(): void {
		this.changeEmitter.dispose();
	}
}

function colorIdFor(percent: number): string {
	if (percent >= 80) {
		return 'charts.green';
	}
	if (percent >= 50) {
		return 'charts.yellow';
	}
	return 'charts.red';
}
