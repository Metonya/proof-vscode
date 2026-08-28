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
