import * as vscode from 'vscode';

import { parseTestIdentity } from '../verdict/testIdentity';

/**
 * F3 (Plan.md Bölüm 4): the "which tests cover this line" panel. Server-
 * rendered HTML only, regenerated on every update - no `postMessage`
 * protocol yet (nothing in this view is interactive beyond what the panel
 * itself already gets for free), so there is no `panelProtocol.ts` until a
 * real interaction (e.g. "reveal this test") needs one.
 *
 * The fallback ladder is Plan.md's own, checked in this exact order:
 * `PER_TEST_TRUNCATED` first (evidence dropped, not "no tests" - hard rule
 * 3a), then "no perTest block at all" (suggest a re-scan with
 * --per-test-report), then "class not in perTest evidence" (L2 only covers
 * changed classes, not every open file).
 */
export type PanelContent =
	| { kind: 'noWorkspace' }
	| { kind: 'noActiveEditor' }
	| { kind: 'truncated'; message: string }
	| { kind: 'noPerTestData' }
	| { kind: 'classOutOfScope'; className: string }
	| { kind: 'lines'; fileName: string; className: string; linesToTests: ReadonlyMap<number, readonly string[]> };

let panel: vscode.WebviewPanel | undefined;

export function isPanelOpen(): boolean {
	return panel !== undefined;
}

export function showLineTestsPanel(content: PanelContent): void {
	if (!panel) {
		panel = vscode.window.createWebviewPanel('coverdictLineTests', 'coverdict: Line → Tests', vscode.ViewColumn.Beside, { enableScripts: false });
		panel.onDidDispose(() => {
			panel = undefined;
		});
	}
	panel.reveal(vscode.ViewColumn.Beside, true);
	panel.webview.html = renderHtml(content);
}

export function refreshLineTestsPanelIfOpen(content: PanelContent): void {
	if (panel) {
		panel.webview.html = renderHtml(content);
	}
}

function renderHtml(content: PanelContent): string {
	return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>${STYLE}</style></head>
<body>${bodyFor(content)}</body>
</html>`;
}

function bodyFor(content: PanelContent): string {
	switch (content.kind) {
		case 'noWorkspace':
			return message('Open a folder first.');
		case 'noActiveEditor':
			return message('Open a Java file to see which tests cover its lines.');
		case 'truncated':
			return message(`Per-test evidence was dropped for this module: ${escapeHtml(content.message)}. What is shown may be incomplete - not "no tests cover this".`, true);
		case 'noPerTestData':
			return message('No per-test evidence in the last scan. Run "coverdict: Analyze (per-test)" to collect it.');
		case 'classOutOfScope':
			return message(`${escapeHtml(content.className)} has no per-test evidence - L2 only covers classes touched by the diff, not every open file.`);
		case 'lines':
			return linesTable(content);
	}
}

function linesTable(content: Extract<PanelContent, { kind: 'lines' }>): string {
	const rows = [...content.linesToTests.entries()]
		.sort(([a], [b]) => a - b)
		.map(([line, tests]) => {
			const displayed = tests.map((t) => escapeHtml(parseTestIdentity(t).display));
			return `<tr><td class="line">${line}</td><td>${displayed.join('<br>')}</td></tr>`;
		})
		.join('');
	return `<h2>${escapeHtml(content.fileName)}</h2>
<p class="muted">${escapeHtml(content.className)}</p>
<table><thead><tr><th>Line</th><th>Covering tests</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function message(text: string, warning = false): string {
	return `<p class="${warning ? 'warning' : 'muted'}">${text}</p>`;
}

function escapeHtml(text: string): string {
	return text.replaceAll(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c] ?? c);
}

const STYLE = `
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 1em; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
.line { font-family: var(--vscode-editor-font-family); color: var(--vscode-descriptionForeground); width: 3em; }
.muted { color: var(--vscode-descriptionForeground); }
.warning { color: var(--vscode-editorWarning-foreground); }
`;
