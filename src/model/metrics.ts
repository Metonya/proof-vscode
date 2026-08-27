import type { FileCoverageEntry, MetricSet } from '../verdict/types';

/**
 * The one arithmetic the extension is allowed to do itself (Plan.md Bölüm
 * 2: "Tek aritmetiği klasör rollup'ı") - everything else is the CLI's own
 * already-computed `Metric.percent` (D-70: `BigDecimal` HALF_UP is not
 * float-safely reproducible in TypeScript, so a *file's* percentage is
 * never recomputed here, only a *folder's* by summing files under it).
 */
export type BadgeMetric = keyof MetricSet;

export interface FolderRollup {
	numerator: number;
	denominator: number;
	percent: number | null;
}

export function rollupFolder(files: readonly FileCoverageEntry[], metric: BadgeMetric): FolderRollup {
	let numerator = 0;
	let denominator = 0;
	for (const file of files) {
		numerator += file.metrics[metric].numerator;
		denominator += file.metrics[metric].denominator;
	}
	const percent = denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;
	return { numerator, denominator, percent };
}
