import { parseTestIdentity } from '../verdict/testIdentity';
import type { PerTestBlock, PerTestEntry } from '../verdict/types';

/**
 * F3 (Plan.md Bölüm 4): "which tests cover this line" for one class, from
 * `perTest.entries[].lines[].tests[]`. Pure - no `vscode` (Plan.md Bölüm
 * 2's first invariant); `ui/hoverProvider.ts` and `ui/treeViews/
 * lineTestsView.ts` are the callers (Faz 15c replaced the old webview panel).
 *
 * Faz 14c (hata D-6): `entries` and `ambient` used to be flattened into one
 * map, destroying the CLI's own distinction (D-50) between "a test directly
 * executed this line" (`entries`) and "this line only ran as a side effect
 * of a static initializer/`<clinit>`, indirectly reachable from a test but
 * not really exercised by it" (`ambient`). They are now kept in two
 * separate maps so the panel can label ambient evidence instead of quietly
 * mixing it into the same list.
 */
export type ClassLookupResult =
	| { kind: 'moduleNotFound' }
	| { kind: 'classNotFound' }
	| { kind: 'found'; linesToTests: ReadonlyMap<number, readonly string[]>; ambientLinesToTests: ReadonlyMap<number, readonly string[]> };

export function testsForClass(perTest: PerTestBlock, moduleId: string, className: string): ClassLookupResult {
	const module = perTest.modules.find((m) => m.id === moduleId);
	if (!module) {
		return { kind: 'moduleNotFound' };
	}

	const outerClassName = stripNestedSuffix(className);
	const linesToTests = collectLines(module.entries, outerClassName);
	const ambientLinesToTests = collectLines(module.ambient, outerClassName);

	if (linesToTests.size === 0 && ambientLinesToTests.size === 0) {
		return { kind: 'classNotFound' };
	}
	return { kind: 'found', linesToTests, ambientLinesToTests };
}

function collectLines(entries: readonly PerTestEntry[], outerClassName: string): Map<number, string[]> {
	const linesToTests = new Map<number, string[]>();
	for (const entry of entries) {
		if (stripNestedSuffix(entry.className) !== outerClassName) {
			continue;
		}
		for (const line of entry.lines) {
			const existing = linesToTests.get(line.line);
			if (existing) {
				existing.push(...line.tests);
			} else {
				linesToTests.set(line.line, [...line.tests]);
			}
		}
	}
	return linesToTests;
}

/** Strips a nested-class suffix (`Outer$Inner` -> `Outer`) - same convention coverdict-cli's PseudoTestedMethodRule uses on the production side. */
function stripNestedSuffix(className: string): string {
	const dollar = className.indexOf('$');
	return dollar < 0 ? className : className.slice(0, dollar);
}

/** One production line a test (`className#methodName`) is on record as covering. */
export interface TestLineRef {
	/** Outer class name (nested-suffix already stripped) - the unit `model/pathIndex.ts`'s FQCN-to-path resolution expects. */
	outerClassName: string;
	line: number;
}

/**
 * Faz 15a/15b (ters yön): "this test covers these production lines",
 * `testsForClass`'ın tersi. Yalnızca `entries` (gerçek doğrudan kanıt) -
 * `ambient` (`<clinit>` kaynaklı, D-50) kasıtlı olarak dışarıda bırakılıyor,
 * çünkü "bu test şu satırı çalıştırıyor" demek onun kendi mantığının o
 * satırı tetiklediği anlamına gelir; bir statik başlatıcı yüzünden dolaylı
 * çalışan bir satırı aynı iddiayla sunmak yanıltıcı olurdu.
 *
 * Anahtar `parseTestIdentity`'nin ürettiği `Class#method()` biçimi -
 * `model/testQuality.ts`'in `finding.testMethod` eşleştirmesiyle aynı
 * sözleşme, iki yön hiçbir zaman ayrışamaz.
 */
export function testsToLines(perTest: PerTestBlock, moduleId: string): ReadonlyMap<string, readonly TestLineRef[]> {
	const module = perTest.modules.find((m) => m.id === moduleId);
	const result = new Map<string, TestLineRef[]>();
	if (!module) {
		return result;
	}
	for (const entry of module.entries) {
		const outerClassName = stripNestedSuffix(entry.className);
		for (const line of entry.lines) {
			for (const rawTestId of line.tests) {
				addTestLineRef(result, rawTestId, outerClassName, line.line);
			}
		}
	}
	return result;
}

/** One or more consecutive production lines covered by the exact same set of tests. */
export interface LineGroup {
	startLine: number;
	endLine: number;
	tests: readonly string[];
}

/**
 * Faz 17a: `ui/treeViews/lineTestsView.ts`'in per-satır listesi, aynı tek
 * testin kapsadığı ardışık satırları (ör. bir constructor'ın gövdesi) ayrı
 * ayrı düğümler olarak basıyordu - gerçek bir örnekte 6 ardışık satır, her
 * biri aynı tek testi tekrar tekrar açan 6 ayrı düğüm demekti.
 * `ui/treeViews/coverageView.ts`'in `uncoveredNewRanges` için zaten
 * kullandığı "aralık" deseniyle aynı fikir - sırasız test kümesi eşitliğine
 * göre bitişik satırları birleştirir.
 */
export function groupConsecutiveLines(linesToTests: ReadonlyMap<number, readonly string[]>): LineGroup[] {
	const sortedLines = [...linesToTests.keys()].sort((a, b) => a - b);
	const groups: LineGroup[] = [];
	for (const line of sortedLines) {
		const tests = linesToTests.get(line)!;
		const last = groups.at(-1);
		if (last?.endLine === line - 1 && sameTestSet(last.tests, tests)) {
			last.endLine = line;
		} else {
			groups.push({ startLine: line, endLine: line, tests });
		}
	}
	return groups;
}

/** Order-independent set equality over raw test ids - two lines "have the same tests" regardless of the order `perTest` happened to list them in. */
function sameTestSet(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	const sortedA = [...a].sort((x, y) => x.localeCompare(y));
	const sortedB = [...b].sort((x, y) => x.localeCompare(y));
	return sortedA.every((test, i) => test === sortedB[i]);
}

function addTestLineRef(result: Map<string, TestLineRef[]>, rawTestId: string, outerClassName: string, line: number): void {
	const identity = parseTestIdentity(rawTestId);
	if (identity.className === null || identity.methodName === null) {
		return;
	}
	const key = `${identity.className}#${identity.methodName}()`;
	const ref: TestLineRef = { outerClassName, line };
	const refs = result.get(key);
	if (refs) {
		refs.push(ref);
	} else {
		result.set(key, [ref]);
	}
}
