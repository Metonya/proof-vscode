import { classNameFromPath } from './pathIndex';
import type { FileCoverageBlock } from '../verdict/types';

/**
 * Faz 15b: `className -> repo-relative path`, built straight from
 * `fileCoverage.files[]` (already the complete, filtered listing of
 * production files this run knows about) - no filesystem probe needed,
 * unlike test-file location (`ui/testFileLocator.ts`), which has no such
 * complete listing to draw from.
 */
export function buildProductionClassIndex(fileCoverage: FileCoverageBlock, sourceRoots: readonly string[]): ReadonlyMap<string, string> {
	const index = new Map<string, string>();
	for (const file of fileCoverage.files) {
		const className = classNameFromPath(file.path, sourceRoots);
		if (className) {
			index.set(className, file.path);
		}
	}
	return index;
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
