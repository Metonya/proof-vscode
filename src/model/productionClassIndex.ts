import { classNameFromPath } from './pathIndex';
import type { FileCoverageBlock } from '../verdict/types';

/**
 * Faz 30: a multi-module run can (rarely) declare the same FQCN in two
 * modules. `byClassName` never guesses which one is meant - a colliding
 * name is removed from it and recorded in `ambiguous` instead (hard rule
 * 3a: last-writer-wins would silently point navigation at the wrong
 * file). Callers that hit `ambiguous.has(className)` should say so, not
 * fall back to whatever `byClassName.get` happens to return (undefined).
 */
export interface ProductionClassIndex {
	byClassName: ReadonlyMap<string, string>;
	ambiguous: ReadonlySet<string>;
}

/**
 * Faz 15b: `className -> repo-relative path`, built straight from
 * `fileCoverage.files[]` (already the complete, filtered listing of
 * production files this run knows about) - no filesystem probe needed,
 * unlike test-file location (`ui/testFileLocator.ts`), which has no such
 * complete listing to draw from.
 */
export function buildProductionClassIndex(fileCoverage: FileCoverageBlock, sourceRoots: readonly string[]): ProductionClassIndex {
	const byClassName = new Map<string, string>();
	const ambiguous = new Set<string>();
	for (const file of fileCoverage.files) {
		const className = classNameFromPath(file.path, sourceRoots);
		if (!className) {
			continue;
		}
		if (ambiguous.has(className)) {
			continue;
		}
		if (byClassName.has(className)) {
			byClassName.delete(className);
			ambiguous.add(className);
			continue;
		}
		byClassName.set(className, file.path);
	}
	return { byClassName, ambiguous };
}

/**
 * Faz 21: taramanın kendi beyan ettiği kaynak kökleri. Eskiden her çağıran
 * `['src/main/java']` sabitini taşıyordu; artık CLI'ın `inputs.modules[]`
 * beyanı elimizde, çoklu modül ve alışılmadık düzenler de doğru çalışıyor.
 * Beyan boşsa (eski bir verdict'ten geri yükleme) Maven'ın kuralı yedek
 * olarak kullanılır - bu bir tahmin değil, CLI'ın kendi varsayılanı.
 */
export function productionSourceRoots(modules: readonly { sourceRoots: readonly string[] }[]): readonly string[] {
	const declared = modules.flatMap((m) => m.sourceRoots);
	return declared.length > 0 ? declared : ['src/main/java'];
}

/** Faz 30: `productionSourceRoots`'un test-kökü karşılığı - `ui/hoverProvider.ts`'in kendi sabit `DEFAULT_TEST_ROOTS`'u yerine, çok-modül düzenlerde de doğru çalışsın diye. */
export function testSourceRoots(modules: readonly { testRoots: readonly string[] }[]): readonly string[] {
	const declared = modules.flatMap((m) => m.testRoots);
	return declared.length > 0 ? declared : ['src/test/java'];
}
