/**
 * TypeScript shape of `schema/coverdict-verdict.schema.json` - grown field
 * by field as each feature needs it (F1 needs only the header: schema/tool
 * version, analysis status, and the overall MetricSet). Never `import
 * 'vscode'` here (Plan.md Bölüm 2's first invariant).
 */

export interface Metric {
	numeratorName: string;
	numerator: number;
	denominatorName: string;
	denominator: number;
	percent: number | null;
}

export interface MetricSet {
	'jacoco-line': Metric;
	'strict-line': Metric;
	'sonar-compatible': Metric;
}

export type NewCodeCoverage = MetricSet | { status: string };

export interface VerdictDocument {
	schemaVersion: string;
	tool: { name: string; version: string };
	analysis: {
		status: 'complete' | 'incomplete';
		exitCode: number;
		incompleteReasons: readonly unknown[];
	};
	coverage: {
		overall: MetricSet;
		newCode: NewCodeCoverage;
	};
}
