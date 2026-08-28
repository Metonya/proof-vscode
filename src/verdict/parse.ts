import type {
	ChangedFile,
	FileCoverageBlock,
	FileCoverageEntry,
	Finding,
	LineTuple,
	Metric,
	MetricSet,
	ModuleInput,
	MutatedMethod,
	Mutant,
	MutationBlock,
	MutationModuleEvidence,
	NewCodeCoverage,
	PerTestBlock,
	PerTestEntry,
	PerTestLine,
	PerTestModuleEvidence,
	Reason,
	VerdictDocument,
} from './types';

const RULE_IDS = new Set([
	'NO_RECOGNIZED_ORACLE',
	'TAUTOLOGICAL_ORACLE',
	'CATCH_ORACLE_WITHOUT_FAIL',
	'NULL_CHECK_ONLY',
	'PSEUDO_TESTED_METHOD',
	'SUBSUMED_TEST',
]);

/**
 * `verdict/` never throws (Plan.md Bölüm 2/6) - a malformed or truncated
 * verdict file is a real, expected shape (a killed process, a disk full
 * mid-write), never an exception the caller must remember to catch.
 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseVerdict(raw: string): Result<VerdictDocument> {
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (e) {
		return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
	}

	if (!isVerdictDocument(json)) {
		return { ok: false, error: 'does not look like a coverdict verdict document (missing a required top-level field)' };
	}
	if ('fileCoverage' in json && !isFileCoverageBlock(json.fileCoverage)) {
		return { ok: false, error: 'fileCoverage is present but malformed' };
	}
	if ('perTest' in json && !isPerTestBlock(json.perTest)) {
		return { ok: false, error: 'perTest is present but malformed' };
	}
	if ('mutation' in json && !isMutationBlock(json.mutation)) {
		return { ok: false, error: 'mutation is present but malformed' };
	}
	return { ok: true, value: json };
}

function isVerdictDocument(value: unknown): value is VerdictDocument {
	if (!isRecord(value)) {
		return false;
	}
	return typeof value.schemaVersion === 'string'
		&& isRecord(value.tool) && typeof value.tool.version === 'string'
		&& isRecord(value.analysis) && (value.analysis.status === 'complete' || value.analysis.status === 'incomplete')
		&& isRecord(value.inputs) && Array.isArray(value.inputs.modules) && value.inputs.modules.every(isModuleInput)
		&& isRecord(value.coverage) && isMetricSet(value.coverage.overall) && isNewCodeCoverage(value.coverage.newCode)
		&& Array.isArray(value.changedFiles) && value.changedFiles.every(isChangedFile)
		&& Array.isArray(value.findings) && value.findings.every(isFinding)
		&& Array.isArray(value.warnings) && value.warnings.every(isReason);
}

function isNewCodeCoverage(value: unknown): value is NewCodeCoverage {
	return isMetricSet(value) || (isRecord(value) && typeof value.status === 'string');
}

function isChangedFile(value: unknown): value is ChangedFile {
	if (!isRecord(value) || typeof value.path !== 'string') {
		return false;
	}
	if (value.classification !== 'mapped' && value.classification !== 'excluded' && value.classification !== 'non-executable'
		&& value.classification !== 'unsupported' && value.classification !== 'unknown') {
		return false;
	}
	if (value.module !== undefined && typeof value.module !== 'string') {
		return false;
	}
	if (value.newLines !== undefined && typeof value.newLines !== 'number') {
		return false;
	}
	if (value.coveredNewLines !== undefined && typeof value.coveredNewLines !== 'number') {
		return false;
	}
	return value.uncoveredNewRanges === undefined
		|| (Array.isArray(value.uncoveredNewRanges) && value.uncoveredNewRanges.every(isLineRange));
}

function isLineRange(value: unknown): value is readonly [number, number] {
	return Array.isArray(value) && value.length === 2 && value.every((n) => typeof n === 'number');
}

function isFinding(value: unknown): value is Finding {
	return isRecord(value)
		&& typeof value.rule === 'string' && RULE_IDS.has(value.rule)
		&& (value.severity === 'INFO' || value.severity === 'WARNING')
		&& (value.confidence === 'HIGH' || value.confidence === 'MEDIUM' || value.confidence === 'LOW' || value.confidence === 'INCONCLUSIVE')
		&& typeof value.module === 'string'
		&& typeof value.path === 'string'
		&& typeof value.startLine === 'number'
		&& typeof value.endLine === 'number'
		&& typeof value.message === 'string'
		&& typeof value.suggestedAction === 'string'
		&& typeof value.fingerprint === 'string';
}

function isModuleInput(value: unknown): value is ModuleInput {
	return isRecord(value)
		&& typeof value.id === 'string'
		&& typeof value.root === 'string'
		&& Array.isArray(value.sourceRoots) && value.sourceRoots.every((s) => typeof s === 'string')
		&& Array.isArray(value.testRoots) && value.testRoots.every((s) => typeof s === 'string');
}

function isReason(value: unknown): value is Reason {
	return isRecord(value) && typeof value.code === 'string' && typeof value.message === 'string';
}

function isFileCoverageBlock(value: unknown): value is FileCoverageBlock {
	if (!isRecord(value) || !Array.isArray(value.files) || !Array.isArray(value.excluded)) {
		return false;
	}
	return value.files.every(isFileCoverageEntry) && value.excluded.every((p) => typeof p === 'string');
}

function isFileCoverageEntry(value: unknown): value is FileCoverageEntry {
	return isRecord(value)
		&& typeof value.module === 'string'
		&& typeof value.path === 'string'
		&& isMetricSet(value.metrics)
		&& Array.isArray(value.lines) && value.lines.every(isLineTuple);
}

function isLineTuple(value: unknown): value is LineTuple {
	return Array.isArray(value) && value.length === 5 && value.every((n) => typeof n === 'number');
}

/** Faz 28 (§7.5b): `extension.ts`'in kendi `pertest-current.json`'ını doğrularken de kullanılıyor - `isMutationBlock`'un aynı gerekçesi. */
export function isPerTestBlock(value: unknown): value is PerTestBlock {
	return isRecord(value)
		&& typeof value.engine === 'string'
		&& typeof value.engineVersion === 'string'
		&& Array.isArray(value.modules) && value.modules.every(isPerTestModuleEvidence);
}

function isPerTestModuleEvidence(value: unknown): value is PerTestModuleEvidence {
	return isRecord(value)
		&& typeof value.id === 'string'
		&& Array.isArray(value.entries) && value.entries.every(isPerTestEntry)
		&& Array.isArray(value.ambient) && value.ambient.every(isPerTestEntry);
}

function isPerTestEntry(value: unknown): value is PerTestEntry {
	return isRecord(value)
		&& typeof value.className === 'string'
		&& typeof value.methodName === 'string'
		&& Array.isArray(value.lines) && value.lines.every(isPerTestLine);
}

function isPerTestLine(value: unknown): value is PerTestLine {
	return isRecord(value)
		&& typeof value.line === 'number'
		&& Array.isArray(value.tests) && value.tests.every((t) => typeof t === 'string');
}

/** Faz 25 (§7.5): `extension.ts`'in kendi `mutation-current.json`'ını doğrularken de kullanılıyor - CLI'ın `mutation` bloğuyla aynı şema, iki ayrı validator tutmamak için dışa açıldı. */
export function isMutationBlock(value: unknown): value is MutationBlock {
	return isRecord(value)
		&& typeof value.engine === 'string'
		&& typeof value.engineVersion === 'string'
		&& Array.isArray(value.modules) && value.modules.every(isMutationModuleEvidence);
}

function isMutationModuleEvidence(value: unknown): value is MutationModuleEvidence {
	return isRecord(value)
		&& typeof value.id === 'string'
		&& Array.isArray(value.methods) && value.methods.every(isMutatedMethod);
}

function isMutatedMethod(value: unknown): value is MutatedMethod {
	return isRecord(value)
		&& typeof value.className === 'string'
		&& typeof value.methodName === 'string'
		&& typeof value.methodDescription === 'string'
		&& typeof value.firstLine === 'number'
		&& typeof value.lastLine === 'number'
		&& Array.isArray(value.mutants) && value.mutants.every(isMutant);
}

/** `status` bilerek serbest bir string olarak doğrulanır: tanımadığımız bir PIT statüsü bütün verdict'i reddettirmemeli, "belirsiz" olarak gösterilmeli (hard rule 3a). */
function isMutant(value: unknown): value is Mutant {
	return isRecord(value)
		&& typeof value.mutator === 'string'
		&& typeof value.line === 'number'
		&& typeof value.status === 'string'
		&& Array.isArray(value.killingTests) && value.killingTests.every((t) => typeof t === 'string');
}

function isMetricSet(value: unknown): value is MetricSet {
	return isRecord(value)
		&& isMetric(value['jacoco-line'])
		&& isMetric(value['strict-line'])
		&& isMetric(value['sonar-compatible']);
}

function isMetric(value: unknown): value is Metric {
	return isRecord(value)
		&& typeof value.numerator === 'number'
		&& typeof value.denominator === 'number'
		&& (value.percent === null || typeof value.percent === 'number');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
