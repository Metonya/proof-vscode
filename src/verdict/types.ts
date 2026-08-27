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

/** The six rule codes the L0 oracle-quality engine can emit (`RuleIds.java`) - only `severity`/`confidence` decide how loud a finding is, never the rule name alone. */
export type RuleId =
	| 'NO_RECOGNIZED_ORACLE'
	| 'TAUTOLOGICAL_ORACLE'
	| 'CATCH_ORACLE_WITHOUT_FAIL'
	| 'NULL_CHECK_ONLY'
	| 'PSEUDO_TESTED_METHOD'
	| 'SUBSUMED_TEST';

/**
 * A test-oracle-quality finding. `severity` (INFO|WARNING) is NOT the same
 * field as `confidence` (HIGH|MEDIUM|LOW|INCONCLUSIVE) - the CLI's stdout
 * text report shows confidence next to each finding, which is easy to
 * mistake for severity when building a UI from memory of that output.
 */
export interface Finding {
	rule: RuleId;
	severity: 'INFO' | 'WARNING';
	confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INCONCLUSIVE';
	module: string;
	path: string;
	startLine: number;
	endLine: number;
	message: string;
	suggestedAction: string;
	fingerprint: string;
	testMethod?: string;
	productionMethod?: string;
	/** SUBSUMED_TEST only. */
	relatedTestMethod?: string;
	/** SUBSUMED_TEST only. */
	relatedPath?: string;
}

export type ChangedFileClassification = 'mapped' | 'excluded' | 'non-executable' | 'unsupported' | 'unknown';

/**
 * One file touched by the diff. `newLines`/`coveredNewLines`/
 * `uncoveredNewRanges` are present only when `classification === 'mapped'`.
 * There is no per-line "covered and new" list in the schema - only
 * `uncoveredNewRanges` enumerates actual line numbers; a "new and covered"
 * gutter decoration cannot be derived from this data, so no UI should
 * attempt one.
 */
export interface ChangedFile {
	path: string;
	module?: string;
	classification: ChangedFileClassification;
	newLines?: number;
	coveredNewLines?: number;
	uncoveredNewRanges?: readonly (readonly [number, number])[];
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
	changedFiles: readonly ChangedFile[];
	findings: readonly Finding[];
	warnings: readonly Reason[];
	/** Absent (never null) unless --file-coverage was passed (Faz 1's opt-in contract). */
	fileCoverage?: FileCoverageBlock;
	/** Absent (never null) unless --per-test-report was passed (D-46/D-55's opt-in contract). */
	perTest?: PerTestBlock;
}
