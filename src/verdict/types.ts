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

/** [line, missedInstructions, coveredInstructions, missedBranches, coveredBranches] - same order as coverdict's own LineCoverage (Faz 1). */
export type LineTuple = readonly [number, number, number, number, number];

export interface FileCoverageEntry {
	module: string;
	path: string;
	metrics: MetricSet;
	lines: readonly LineTuple[];
}

export interface FileCoverageBlock {
	files: readonly FileCoverageEntry[];
	excluded: readonly string[];
}

export interface PerTestLine {
	line: number;
	tests: readonly string[];
}

export interface PerTestEntry {
	className: string;
	methodName: string;
	lines: readonly PerTestLine[];
}

export interface PerTestModuleEvidence {
	id: string;
	entries: readonly PerTestEntry[];
	/** D-50: static-initializer coverage (method `<clinit>`), never test-attributable, kept separate from entries. */
	ambient: readonly PerTestEntry[];
}

export interface PerTestBlock {
	engine: string;
	engineVersion: string;
	modules: readonly PerTestModuleEvidence[];
}

export interface Reason {
	code: string;
	message: string;
	path?: string;
	module?: string;
	count?: number;
}

export interface ModuleInput {
	id: string;
	root: string;
	sourceRoots: readonly string[];
	testRoots: readonly string[];
}

export interface VerdictDocument {
	schemaVersion: string;
	tool: { name: string; version: string };
	analysis: {
		status: 'complete' | 'incomplete';
		exitCode: number;
		incompleteReasons: readonly unknown[];
	};
	inputs: {
		modules: readonly ModuleInput[];
	};
	coverage: {
		overall: MetricSet;
		newCode: NewCodeCoverage;
	};
	warnings: readonly Reason[];
	/** Absent (never null) unless --file-coverage was passed (Faz 1's opt-in contract). */
	fileCoverage?: FileCoverageBlock;
	/** Absent (never null) unless --per-test-report was passed (D-46/D-55's opt-in contract). */
	perTest?: PerTestBlock;
}
