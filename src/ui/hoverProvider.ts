import * as vscode from 'vscode';

import { detectClassName } from '../model/classNameDetector';
import { testsForClass, testsToLines, type TestLineRef } from '../model/lineIndex';
import { classifySourcePath, toAbsolutePath, toRepoRelativePath } from '../model/pathIndex';
import { buildProductionClassIndex, productionSourceRoots } from '../model/productionClassIndex';
import { getCoverageState, getPerTestState } from '../model/store';
import { indexFindingsByTestMethod, lineQuality, type LineQuality } from '../model/testQuality';
import { parseTestIdentity } from '../verdict/testIdentity';
import type { Finding, PerTestBlock } from '../verdict/types';
import { locateTestFile } from './testFileLocator';

/**
 * Faz 15b: the actual answer to "is this line really tested?", right where
 * the question is asked - no second panel, no line-number bookkeeping.
 * Two directions from the same `model/testQuality.ts`/`model/lineIndex.ts`
 * data, so they can never disagree:
 *   - a production line -> which tests cover it, and whether any of them
 *     actually asserts anything (`lineQuality`'s `isFalseGreen`).
 *   - a test method (cursor on its name in a test file) -> which
 *     production lines it runs, within this run's per-test-target scope.
 *
 * Single-module-shorthand scope, same as the rest of the extension until
 * F8's config UI: source/test roots are the CLI's own conventional
 * defaults, not read from a config the extension does not yet model.
 */
const MODULE_ID = 'root';
const DEFAULT_TEST_ROOTS = ['src/test/java'];

export function registerHoverProvider(): vscode.Disposable {
	return vscode.languages.registerHoverProvider({ language: 'java' }, { provideHover });
}

async function provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
	const coverageState = getCoverageState();
	const perTestState = getPerTestState();
	if (!coverageState || !perTestState?.perTest) {
		return undefined;
	}

	const fileBaseName = baseNameWithoutExtension(document.fileName);
	const className = detectClassName(document.getText(), fileBaseName);
	const findingsByTestMethod = indexFindingsByTestMethod(coverageState.findings);

	// Faz 21: yön, "bu sınıfın satır kaydı var mı" ile değil, CLI'ın kendi
	// kök beyanıyla seçilir. PIT'in L2 toplayıcısı test sınıflarını da
	// `entries`'e yazdığı için (gerçek veriyle doğrulandı) eski sıra bir
	// test dosyasında hep production dalına düşüyor, ters yön hover'ı hiç
	// çalışmıyordu - `ui/treeViews/lineTestsView.ts` ile aynı hata, aynı
	// düzeltme, çünkü iki yüzeyin ayrışmaması bu dosyanın sözleşmesi.
	const sourceKind = classifySourcePath(
		toRepoRelativePath(coverageState.workspaceRoot, document.fileName) ?? '',
		coverageState.modules,
	);
	if (sourceKind === 'test') {
		return testMethodHover(document, position, perTestState.perTest, coverageState.workspaceRoot, className);
	}

	const lineNumber = position.line + 1;
	const productionLookup = testsForClass(perTestState.perTest, perTestState.moduleId, className);
	if (productionLookup.kind === 'found') {
		const tests = productionLookup.linesToTests.get(lineNumber);
		if (tests && tests.length > 0) {
			const quality = lineQuality(tests, findingsByTestMethod);
			return productionHover(coverageState.workspaceRoot, lineNumber, quality);
		}
		return undefined; // a known class, but this specific line has no per-test evidence - no hover, not a guess
	}

	return testMethodHover(document, position, perTestState.perTest, coverageState.workspaceRoot, className);
}

async function productionHover(workspaceRoot: string, lineNumber: number, quality: LineQuality): Promise<vscode.Hover> {
	const md = new vscode.MarkdownString(undefined, true);
	md.isTrusted = true;

	if (quality.isFalseGreen) {
		md.appendMarkdown('**⚠ coverdict: bu satırı kapsayan hiçbir testin oracle\'ı yok** - kapsama yeşil ama satır gerçekte doğrulanmıyor.\n\n---\n\n');
	}

	const weakCount = quality.byVerdict.noOracle + quality.byVerdict.weak;
	md.appendMarkdown(`**coverdict — satır ${lineNumber}**\n\n`);
	md.appendMarkdown(`${quality.tests.length} test çalıştırıyor` + (weakCount > 0 ? ` · ${weakCount}'inin oracle'ı yok/zayıf` : '') + '\n\n');

	// Resolve each test's own file only once per class (most lines share a
	// handful of test classes) - Promise.all so N tests do not serialize N
	// filesystem probes.
	const uniqueClassNames = [...new Set(quality.tests.map((t) => parseTestIdentity(t.rawTestId).className).filter((c): c is string => c !== null))];
	const pathByClassName = new Map(await Promise.all(uniqueClassNames.map(async (className): Promise<[string, string | undefined]> => {
		const findingWithPath = quality.tests.find((t) => t.finding && parseTestIdentity(t.rawTestId).className === className)?.finding?.path;
		return [className, await locateTestFile(workspaceRoot, DEFAULT_TEST_ROOTS, className, findingWithPath)];
	})));

	for (const test of quality.tests) {
		md.appendMarkdown(`${verdictIcon(test.verdict)} ${testLine(test.rawTestId, test.finding, pathByClassName, workspaceRoot)}\n\n`);
	}
	return new vscode.Hover(md, new vscode.Range(lineNumber - 1, 0, lineNumber - 1, 0));
}

function testLine(rawTestId: string, finding: Finding | undefined, pathByClassName: ReadonlyMap<string, string | undefined>, workspaceRoot: string): string {
	const identity = parseTestIdentity(rawTestId);
	const ruleTag = finding ? ` \`${finding.rule}\`` : '';
	const path = identity.className ? pathByClassName.get(identity.className) : undefined;
	if (!path) {
		return `${identity.display}${ruleTag}`;
	}
	const startLine = finding ? finding.startLine : 1;
	const link = openCommandLink(toAbsolutePath(workspaceRoot, path), startLine, identity.display);
	return `${link}${ruleTag}`;
}

async function testMethodHover(document: vscode.TextDocument, position: vscode.Position, perTest: PerTestBlock, workspaceRoot: string, className: string): Promise<vscode.Hover | undefined> {
	const wordRange = document.getWordRangeAtPosition(position);
	if (!wordRange) {
		return undefined;
	}
	const methodName = document.getText(wordRange);
	const key = `${className}#${methodName}()`;
	// Faz 21: test sınıflarının kendi satırları elenir - `entries` onları da
	// içeriyor, süzülmezse test kendi gövdesini "çalıştırdığı production
	// satırı" diye gösterirdi (`ui/treeViews/lineTestsView.ts` ile aynı süzgeç).
	const reverse = testsToLines(perTest, MODULE_ID, productionClassFilter()).get(key);
	if (!reverse || reverse.length === 0) {
		return undefined; // not a known test method - no hover, not a guess
	}

	const md = new vscode.MarkdownString(undefined, true);
	md.isTrusted = true;
	md.appendMarkdown(`**coverdict — ${methodName}()**\n\n`);
	md.appendMarkdown('Bu test şu production satırlarını çalıştırıyor (yalnızca bu koşuda hedeflenen sınıflar):\n\n');

	const productionClassIndex = buildProductionClassIndexFor();
	const byClass = groupByClass(reverse);
	for (const [outerClassName, lines] of byClass) {
		const path = productionClassIndex?.get(outerClassName);
		const label = `${shortName(outerClassName)}.java`;
		const sortedLines = [...lines].sort((a, b) => a - b);
		const lineLinks = sortedLines
			.map((line) => (path ? openCommandLink(toAbsolutePath(workspaceRoot, path), line, `${line}`) : `${line}`))
			.join(', ');
		md.appendMarkdown(`${label}: ${lineLinks}\n\n`);
	}
	return new vscode.Hover(md, wordRange);
}

function buildProductionClassIndexFor(): ReadonlyMap<string, string> | undefined {
	const state = getCoverageState();
	if (!state?.fileCoverage) {
		return undefined;
	}
	return buildProductionClassIndex(state.fileCoverage, productionSourceRoots(state.modules));
}

/** Faz 21: hangi sınıflar production - `fileCoverage.files[]` bu koşunun yetkili listesi; blok yoksa süzgeç de yok (eksik bilgiyle elemek kanıt yok eder). */
function productionClassFilter(): ((outerClassName: string) => boolean) | undefined {
	const index = buildProductionClassIndexFor();
	return index ? (outerClassName) => index.has(outerClassName) : undefined;
}

function groupByClass(refs: readonly TestLineRef[]): Map<string, number[]> {
	const byClass = new Map<string, number[]>();
	for (const ref of refs) {
		const lines = byClass.get(ref.outerClassName);
		if (lines) {
			lines.push(ref.line);
		} else {
			byClass.set(ref.outerClassName, [ref.line]);
		}
	}
	return byClass;
}

function verdictIcon(verdict: LineQuality['tests'][number]['verdict']): string {
	switch (verdict) {
		case 'ok':
			return '✓';
		case 'inconclusive':
			return '?';
		default:
			return '⚠';
	}
}

function openCommandLink(absolutePath: string, line: number, label: string): string {
	const uri = vscode.Uri.file(absolutePath);
	const args = encodeURIComponent(JSON.stringify([uri.toString(), { selection: [line - 1, 0, line - 1, 0] }]));
	return `[${label}](command:vscode.open?${args})`;
}

function shortName(fqcn: string): string {
	const dot = fqcn.lastIndexOf('.');
	return dot < 0 ? fqcn : fqcn.slice(dot + 1);
}

function baseNameWithoutExtension(fileName: string): string {
	const base = fileName.split(/[\\/]/).pop() ?? fileName;
	return base.endsWith('.java') ? base.slice(0, -'.java'.length) : base;
}
