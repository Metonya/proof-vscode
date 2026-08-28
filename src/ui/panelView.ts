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
	| { kind: 'noChangedTargets' }
	| { kind: 'classOutOfScope'; className: string }
	| {
		kind: 'lines'; fileName: string; className: string;
		linesToTests: ReadonlyMap<number, readonly string[]>;
		ambientLinesToTests: ReadonlyMap<number, readonly string[]>;
	  };

let panel: vscode.WebviewPanel | undefined;

export function showLineTestsPanel(content: PanelContent): void {
	if (!panel) {
		panel = vscode.window.createWebviewPanel('coverdictLineTests', 'coverdict: Satır → Testler', vscode.ViewColumn.Beside, { enableScripts: false });
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
			return message('Önce bir klasör açın.');
		case 'noActiveEditor':
			return message('Satırlarını hangi testlerin kapsadığını görmek için bir Java dosyası açın.');
		case 'truncated':
			return message(`Bu modül için test bazlı (per-test) kanıt düşürüldü: ${escapeHtml(content.message)}. Gösterilenler eksik olabilir - "bu satırı hiçbir test kapsamıyor" anlamına gelmez.`, true);
		case 'noPerTestData':
			return message('Son taramada test bazlı kanıt yok. Toplamak için "coverdict: Analiz Et (test bazlı)" komutunu çalıştırın.');
		case 'noChangedTargets':
			return message(
				'Bu koşuda hiçbir sınıf değişmemiş, bu yüzden test bazlı kanıt boş - bu bir hata değil: L2 sadece diff\'te '
				+ 'değişen production sınıflarını hedefler. Bu dosyada gerçek bir değişiklik yapıp tekrar "Analiz Et (test bazlı)" '
				+ 'çalıştırın, ya da coverdict.diffMode\'u "base" yapıp coverdict.baseRef\'e bu sınıfın değiştiği bir commit/branch girin.',
			);
		case 'classOutOfScope':
			return message(`${escapeHtml(content.className)} için test bazlı kanıt yok - L2 sadece diff'te değişen sınıfları kapsar, açık olan her dosyayı değil.`);
		case 'lines':
			return linesTable(content);
	}
}

/**
 * Faz 14c: kullanıcının "sağdan açılan gösterimden hiçbir şey anlamıyorum"
 * geri bildiriminin doğrudan çözümü. İki sorun vardı: (1) her satırda ham
 * JUnit5 UniqueId'ler tek tek basılıyordu (bkz. testIdentity.ts'in
 * test-template düzeltmesi), (2) `@ParameterizedTest`'in her invocation'ı
 * (`#1`, `#2`, `#3`...) ayrı bir satır olarak listeleniyordu. Şimdi aynı
 * sınıf+metot tek satırda toplanıyor (`#1 #2 #3`), tam FQCN sadece `title`
 * niteliğinde duruyor, ve beşten fazla test içeren satırlar `<details>`
 * içinde katlanıyor (webview `enableScripts: false` - `<details>` JS'siz
 * çalışan tek katlanır öğe).
 */
function linesTable(content: Extract<PanelContent, { kind: 'lines' }>): string {
	const summary = `<p class="muted">${content.linesToTests.size} satır · ${countDistinctTests(content.linesToTests)} farklı test`
		+ (content.ambientLinesToTests.size > 0 ? ` · ${content.ambientLinesToTests.size} satır yalnızca statik başlatıcıdan (aşağıda)` : '')
		+ '</p>';

	const rows = [...content.linesToTests.entries()]
		.sort(([a], [b]) => a - b)
		.map(([line, tests]) => lineRow(line, tests))
		.join('');

	const ambientSection = content.ambientLinesToTests.size === 0 ? '' : `
<h3>Statik başlatıcıdan gelen dolaylı kanıt</h3>
<p class="muted">Bu satırlar bir testin doğrudan çalıştırdığı kod değil - sınıfın <code>&lt;clinit&gt;</code>'i (statik alan/blok başlatıcısı) yüzünden çalışmış, ve bunu tetikleyen ilk test burada listeleniyor. "Bu satırı bu test kapsıyor" anlamına gelmez, sadece "bu test çalışınca bu satır da çalıştı" demektir.</p>
<table><thead><tr><th>Satır</th><th>Tetikleyen test(ler)</th></tr></thead><tbody>
${[...content.ambientLinesToTests.entries()].sort(([a], [b]) => a - b).map(([line, tests]) => lineRow(line, tests)).join('')}
</tbody></table>`;

	return `<h2>${escapeHtml(content.fileName)}</h2>
<p class="muted">${escapeHtml(content.className)}</p>
${summary}
<table><thead><tr><th>Satır</th><th>Kapsayan testler</th></tr></thead><tbody>${rows}</tbody></table>
${ambientSection}`;
}

const COLLAPSE_THRESHOLD = 5;

function lineRow(line: number, tests: readonly string[]): string {
	const groups = groupTestDisplays(tests);
	const items = groups.map((g) => `<span title="${escapeHtml(g.title)}">${escapeHtml(g.label)}</span>`);
	const cell = items.length > COLLAPSE_THRESHOLD
		? `<details><summary>${items.length} test</summary>${items.join('<br>')}</details>`
		: items.join('<br>');
	return `<tr><td class="line">${line}</td><td>${cell}</td></tr>`;
}

function countDistinctTests(linesToTests: ReadonlyMap<number, readonly string[]>): number {
	const distinct = new Set<string>();
	for (const tests of linesToTests.values()) {
		for (const raw of tests) {
			const id = parseTestIdentity(raw);
			distinct.add(id.className && id.methodName ? `${id.className}#${id.methodName}` : id.display);
		}
	}
	return distinct.size;
}

/**
 * Aynı sınıf+metodun birden fazla `@ParameterizedTest`/`@RepeatedTest`
 * invocation'ını (`#1`, `#2`, `#3`...) tek bir satırda toplar - her biri
 * ayrı satır olarak basılan eski davranış, üç invocation'lı tek bir testi
 * üç ayrı test gibi gösteriyordu.
 */
function groupTestDisplays(tests: readonly string[]): { label: string; title: string }[] {
	const grouped = new Map<string, { simpleClassName: string; methodName: string; className: string; invocations: string[] }>();
	const unparsed: string[] = [];

	for (const raw of tests) {
		const id = parseTestIdentity(raw);
		if (id.className === null || id.methodName === null || id.simpleClassName === null) {
			unparsed.push(id.display);
			continue;
		}
		const key = `${id.className}#${id.methodName}`;
		const existing = grouped.get(key);
		if (existing) {
			if (id.invocation !== null) {
				existing.invocations.push(id.invocation);
			}
		} else {
			grouped.set(key, {
				simpleClassName: id.simpleClassName, methodName: id.methodName, className: id.className,
				invocations: id.invocation === null ? [] : [id.invocation],
			});
		}
	}

	const groupedItems = [...grouped.values()].map((g) => {
		const invocationSuffix = g.invocations.length === 0 ? '' : ' ' + g.invocations.map((i) => `#${i}`).join(' ');
		return { label: `${g.simpleClassName}#${g.methodName}()${invocationSuffix}`, title: g.className };
	});
	const unparsedItems = unparsed.map((raw) => ({ label: raw, title: raw }));
	return [...groupedItems, ...unparsedItems];
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
h3 { margin-top: 1.5em; }
details summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
code { font-family: var(--vscode-editor-font-family); }
`;
