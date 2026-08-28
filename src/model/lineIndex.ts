import type { PerTestBlock, PerTestEntry } from '../verdict/types';

/**
 * F3 (Plan.md Bölüm 4): "which tests cover this line" for one class, from
 * `perTest.entries[].lines[].tests[]`. Pure - no `vscode` (Plan.md Bölüm
 * 2's first invariant); `ui/panelView.ts` is the only caller.
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
