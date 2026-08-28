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
	const info = ruleInfo(finding.rule);
	const diagnostic = new vscode.Diagnostic(
		range,
		`${info.title}: ${finding.message} ${finding.suggestedAction}`,
		finding.severity === 'WARNING' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
	);
	diagnostic.source = 'coverdict';
	diagnostic.code = {
		value: `${finding.rule} (${finding.confidence})`,
		target: vscode.Uri.parse(ruleDocsUrl(finding.rule)),
	};
	return diagnostic;
}
