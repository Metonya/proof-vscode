import { engineLine, type FileCoverageEntry, type MetricSet } from '../verdict/types';

/**
 * The one arithmetic the extension is allowed to do itself (Plan.md Bölüm
 * 2: "Tek aritmetiği klasör rollup'ı") - everything else is the CLI's own
 * already-computed `Metric.percent` (D-70: `BigDecimal` HALF_UP is not
 * float-safely reproducible in TypeScript, so a *file's* percentage is
 * never recomputed here, only a *folder's* by summing files under it).
 */
/**
 * What a user's `proof.badgeMetric` setting can say. `jacoco-line` is kept as
 * a value because it is already saved in people's settings; it and
 * `coverage-line` both mean "the engine's own line counter", and
 * `metricFor` resolves either to whichever the document has (proof-java
 * D-99). So a Java setting keeps working on a Python project and vice versa,
 * with no migration.
 */
export type BadgeMetric = 'jacoco-line' | 'coverage-line' | 'strict-line' | 'sonar-compatible';

/** The metric a badge setting selects, or undefined when the document has none. */
export function metricFor(metrics: MetricSet, badge: BadgeMetric) {
	if (badge === 'strict-line' || badge === 'sonar-compatible') {
		return metrics[badge];
	}
	return engineLine(metrics)?.metric;
}

export interface FolderRollup {
	numerator: number;
	denominator: number;
	percent: number | null;
}

export function rollupFolder(files: readonly FileCoverageEntry[], metric: BadgeMetric): FolderRollup {
	let numerator = 0;
	let denominator = 0;
	for (const file of files) {
		const m = metricFor(file.metrics, metric);
		if (!m) {
			continue;
		}
		numerator += m.numerator;
		denominator += m.denominator;
	}
	const percent = denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10;
	return { numerator, denominator, percent };
}
