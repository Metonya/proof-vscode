import { buildProductionClassIndex } from './productionClassIndex';
import { indexFindingsByTestMethod, lineQuality } from './testQuality';
import type { FileCoverageBlock, Finding, PerTestBlock } from '../verdict/types';

/**
 * Faz 15d: precomputes which (path, line) pairs are a "false green" -
 * JaCoCo-covered, but every test that covers the line has a real oracle-
 * quality finding against it (`model/testQuality.ts`'s `isFalseGreen`).
 * `ui/gutterRenderer.ts` only consumes the result (a plain path->lines
 * lookup) and stays ignorant of `perTest`/`findings` entirely - the same
 * separation `verdict/coverageMapping.ts`'s doc comment already draws
 * between classification and rendering.
 */
/** Faz 30: merges every bound module's entries - `perTest.modules` may hold several in a multi-module run. */
export function buildFalseGreenIndex(
	perTest: PerTestBlock | undefined,
	findings: readonly Finding[],
	fileCoverage: FileCoverageBlock | undefined,
	sourceRoots: readonly string[],
): ReadonlyMap<string, ReadonlySet<number>> {
	const index = new Map<string, Set<number>>();
	if (!perTest || perTest.modules.length === 0 || !fileCoverage) {
		return index;
	}

	const { byClassName: classNameToPath } = buildProductionClassIndex(fileCoverage, sourceRoots);
	const findingsByTestMethod = indexFindingsByTestMethod(findings);

	for (const entry of perTest.modules.flatMap((m) => m.entries)) {
		const path = classNameToPath.get(stripNestedSuffix(entry.className));
		if (!path) {
			continue;
		}
		for (const line of entry.lines) {
			if (lineQuality(line.tests, findingsByTestMethod).isFalseGreen) {
				const lines = index.get(path);
				if (lines) {
					lines.add(line.line);
				} else {
					index.set(path, new Set([line.line]));
				}
			}
		}
	}
	return index;
}

/** Same convention as `model/lineIndex.ts`'s own copy - coverdict-cli's `PseudoTestedMethodRule` strips nested classes the same way on the production side. */
function stripNestedSuffix(className: string): string {
	const dollar = className.indexOf('$');
	return dollar < 0 ? className : className.slice(0, dollar);
}
