import type { PerTestBlock } from '../verdict/types';

/**
 * F3 (Plan.md Bölüm 4): "which tests cover this line" for one class, from
 * `perTest.entries[].lines[].tests[]`. Pure - no `vscode` (Plan.md Bölüm
 * 2's first invariant); `ui/panelView.ts` is the only caller.
 */
export type ClassLookupResult =
	| { kind: 'moduleNotFound' }
	| { kind: 'classNotFound' }
	| { kind: 'found'; linesToTests: ReadonlyMap<number, readonly string[]> };

export function testsForClass(perTest: PerTestBlock, moduleId: string, className: string): ClassLookupResult {
	const module = perTest.modules.find((m) => m.id === moduleId);
	if (!module) {
		return { kind: 'moduleNotFound' };
	}

	const outerClassName = stripNestedSuffix(className);
	const linesToTests = new Map<number, string[]>();
	for (const entry of [...module.entries, ...module.ambient]) {
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

	if (linesToTests.size === 0) {
		return { kind: 'classNotFound' };
	}
	return { kind: 'found', linesToTests };
}

/** Strips a nested-class suffix (`Outer$Inner` -> `Outer`) - same convention coverdict-cli's PseudoTestedMethodRule uses on the production side. */
function stripNestedSuffix(className: string): string {
	const dollar = className.indexOf('$');
	return dollar < 0 ? className : className.slice(0, dollar);
}
