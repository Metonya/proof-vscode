import * as vscode from 'vscode';

import { toAbsolutePath } from '../model/pathIndex';
import { ruleDocsUrl, ruleInfo } from '../model/ruleCatalog';
import type { Finding } from '../verdict/types';

/**
 * Faz 11a: coverdict'in altı test-oracle-kalitesi bulgusunu (`findings[]`)
 * Problems panelinde gösterir - Sonar'ın yaptığı gibi, ama sıfır yeni
 * analiz: her bulgu zaten CLI'ın verdict'inde tam biçimlendirilmiş geliyor.
 *
 * `severity` (INFO|WARNING) `confidence` (HIGH|MEDIUM|LOW|INCONCLUSIVE) ile
 * karıştırılmaz - ikisi ayrı alan, `message`'a hem bulgunun ne olduğu hem de
 * CLI'ın kendi `suggestedAction`'ı eklenir.
 */
export function createDiagnosticCollection(): vscode.DiagnosticCollection {
	return vscode.languages.createDiagnosticCollection('coverdict');
}

export function publishFindings(collection: vscode.DiagnosticCollection, workspaceRoot: string, findings: readonly Finding[]): void {
	const byUri = new Map<string, vscode.Diagnostic[]>();
	for (const finding of findings) {
		const absolutePath = toAbsolutePath(workspaceRoot, finding.path);
		const diagnostics = byUri.get(absolutePath) ?? [];
		diagnostics.push(toDiagnostic(finding));
		byUri.set(absolutePath, diagnostics);
	}

	collection.clear();
	for (const [absolutePath, diagnostics] of byUri) {
		collection.set(vscode.Uri.file(absolutePath), diagnostics);
	}
}

export function clearFindings(collection: vscode.DiagnosticCollection): void {
	collection.clear();
}

function toDiagnostic(finding: Finding): vscode.Diagnostic {
	const startLine = Math.max(0, finding.startLine - 1);
	const endLine = Math.max(startLine, finding.endLine - 1);
	const range = new vscode.Range(startLine, 0, endLine, 0);

	// Faz 18: the human-readable title leads, the raw enum stays in `code`
	// (still greppable, still the docs link's anchor) - same catalogue the
	// Test Kalitesi tree reads, so the two can never describe a rule
	// differently.
	//
	// Faz 22: bu satır düzenleyicide (bazı VS Code çatallarında) satır
	// sonuna aynen basılıyor - eskiden CLI'ın ham İngilizce `message`'ı ve
	// `suggestedAction`'ı da eklendiği için tek satırda üç dil karışıyor ve
	// ekranın dışına taşıyordu. Türkçe başlık + varsa metot adı yeterli;
	// CLI'ın tam cümlesi ve "ne yapmalı" zaten Test Kalitesi ağacının
	// tooltip'inde birebir aynı katalogdan geliyor - burada tekrarlamaya
	// gerek yok, sadece tutarsızlık riski ekler.
	const info = ruleInfo(finding.rule);
	const hint = methodHint(finding);
	const diagnostic = new vscode.Diagnostic(
		range,
		hint ? `${info.title}: ${hint}` : info.title,
		finding.severity === 'WARNING' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
	);
	diagnostic.source = 'coverdict';
	diagnostic.code = {
		value: `${finding.rule} (${finding.confidence})`,
		target: vscode.Uri.parse(ruleDocsUrl(finding.rule)),
	};
	return diagnostic;
}

/** `productionMethod`/`testMethod` `FQCN#method(...)` biçiminde - kısa etiket için sadece `#`'ten sonrası. İkisi de yoksa `undefined`, uydurulmaz. */
function methodHint(finding: Finding): string | undefined {
	const raw = finding.productionMethod ?? finding.testMethod;
	if (!raw) {
		return undefined;
	}
	return raw.split('#').pop();
}
