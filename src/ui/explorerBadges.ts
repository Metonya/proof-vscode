import * as path from 'node:path';
import * as vscode from 'vscode';

import { rollupFolder, type BadgeMetric } from '../model/metrics';
import { toAbsolutePath } from '../model/pathIndex';
import type { FileCoverageBlock, FileCoverageEntry } from '../verdict/types';

/**
 * Faz 9: Explorer'daki dosya/klasör yüzdesi rozetleri, VS Code'un
 * `FileDecorationProvider`'ıyla (native Test Coverage API'nin aksine tam
 * belgelenmiş, `onDidChangeFileDecorations` ile garantili temizlenen bir
 * yol). Dosya rozeti CLI'ın kendi `Metric.percent`'i (asla yeniden
 * hesaplanmaz); klasör rozeti tek izinli aritmetik olan rollup'tan gelir
 * (`model/metrics.ts`).
 */
export class ExplorerBadgeProvider implements vscode.FileDecorationProvider, vscode.Disposable {
	private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	readonly onDidChangeFileDecorations = this.changeEmitter.event;

	private workspaceRoot: string | undefined;
	private byAbsolutePath = new Map<string, FileCoverageEntry>();
	private metric: BadgeMetric = 'sonar-compatible';

	update(workspaceRoot: string, block: FileCoverageBlock | undefined, metric: BadgeMetric): void {
		this.workspaceRoot = workspaceRoot;
		this.metric = metric;
		this.byAbsolutePath = new Map(block?.files.map((file) => [toAbsolutePath(workspaceRoot, file.path), file]) ?? []);
		this.changeEmitter.fire(undefined);
	}

	clear(): void {
		this.byAbsolutePath = new Map();
		this.changeEmitter.fire(undefined);
	}

	provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
		if (!this.workspaceRoot || this.byAbsolutePath.size === 0) {
			return undefined;
		}

		const file = this.byAbsolutePath.get(uri.fsPath);
		if (file) {
			return this.decorationFor(file.metrics[this.metric].percent);
		}

		const prefix = uri.fsPath + path.sep;
		const childFiles = [...this.byAbsolutePath.entries()]
			.filter(([absolutePath]) => absolutePath.startsWith(prefix))
			.map(([, entry]) => entry);
		if (childFiles.length === 0) {
			return undefined;
		}
		return this.decorationFor(rollupFolder(childFiles, this.metric).percent);
	}

	private decorationFor(percent: number | null): vscode.FileDecoration | undefined {
		if (percent === null) {
			return undefined;
		}
		const badge = Math.round(percent).toString();
		const color = new vscode.ThemeColor(colorIdFor(percent));
		return new vscode.FileDecoration(badge, `coverdict: ${percent}%`, color);
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
