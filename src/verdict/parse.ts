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
	// Shared, both engines (proof-java/proof-python D-99).
	'NO_RECOGNIZED_ORACLE',
	'TAUTOLOGICAL_ORACLE',
	'CATCH_ORACLE_WITHOUT_FAIL',
	'NULL_CHECK_ONLY',
	// proof-java only (mutation-derived, no proof-python counterpart yet).
	'PSEUDO_TESTED_METHOD',
	'SUBSUMED_TEST',
	// proof-python only - no Java counterpart (pythonrules.py).
	'UNCOLLECTED_TEST_CLASS',
	'EMPTY_PARAMETRIZE',
	'RETURN_IN_TEST',
	'NON_STRICT_XFAIL',
	'UNCALLED_ORACLE',
	'MOCK_ONLY_ORACLE',
	'BROAD_RAISES_WITHOUT_MATCH',
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
		return { ok: false, error: 'does not look like a proof-java verdict document (missing a required top-level field)' };
	}
	if ('fileCoverage' in json && !isFileCoverageBlock(json.fileCoverage)) {
		return { ok: false, error: 'fileCoverage is present but malformed' };
	}
	if ('perTest' in json) {
		resolveInternedTestIds(json.perTest);
		if (!isPerTestBlock(json.perTest)) {
			return { ok: false, error: 'perTest is present but malformed' };
		}
	}
	if ('mutation' in json) {
		resolveInternedMutationTestIds(json.mutation);
		if (!isMutationBlock(json.mutation)) {
			return { ok: false, error: 'mutation is present but malformed' };
		}
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

/**
 * D-86 (proof-java, 2026-09-05): a real gson run produced a 312 MB verdict
 * document because the same long PIT test id was written out once per line
 * it touched. The fix moved each module's test ids into a sorted `testIds`
 * array and replaced each line's `tests: string[]` with `tests: number[]`
 * indexes into it - a breaking wire-format change taken before proof-java's
 * v0.1 (no published consumers to break at the time). This extension is
 * one now: resolves the indexes back into raw strings in place, mirroring
 * proof-java's own `VerdictJsonReader` (D-86: "every other reader see[s]
 * what they saw before"), so every downstream consumer here
 * (`model/lineIndex.ts`, `ui/hoverProvider.ts`, `ui/treeViews/lineTestsView.ts`,
 * `model/falseGreenIndex.ts`) keeps reading plain `tests: string[]`
 * unchanged. A module with no `testIds` array (an older proof-java build,
 * pre-D-86) is left untouched - its `tests` are presumably already strings,
 * and `isPerTestBlock` below is what actually catches a truly malformed
 * shape either way.
 */
function resolveInternedTestIds(value: unknown): void {
	if (!isRecord(value) || !Array.isArray(value.modules)) {
		return;
	}
	for (const testModule of value.modules) {
		if (!isRecord(testModule) || !Array.isArray(testModule.testIds)) {
			continue;
		}
		const testIds = testModule.testIds;
		for (const line of collectPerTestLines(testModule)) {
			line.tests = (line.tests as unknown[]).map((index) => (typeof index === 'number' ? testIds[index] : index));
		}
		// Faz 34: without this, the module is left in a mixed state (a
		// `testIds` array alongside now-resolved-to-strings `tests`) - a
		// snapshot later written from this data would then fool
		// `reinternPerTestIds`'s "already interned" check (which only looks
		// for `testIds`'s presence) into skipping it, re-emitting plain
		// strings where proof-java's own reader expects numeric indexes
		// again. Deleting it here keeps "has `testIds`" and "`tests` is
		// numeric" the same fact everywhere in this file.
		delete testModule.testIds;
	}
}

/** Shared by `resolveInternedTestIds` and `reinternPerTestIds` (module -> entries+ambient -> lines, flattened) so neither has to carry the entry/line nesting itself. */
function collectPerTestLines(testModule: Record<string, unknown>): Record<string, unknown>[] {
	return [...(Array.isArray(testModule.entries) ? testModule.entries : []), ...(Array.isArray(testModule.ambient) ? testModule.ambient : [])]
		.flatMap((entry) => (isRecord(entry) && Array.isArray(entry.lines) ? entry.lines : []))
		.filter((line): line is Record<string, unknown> => isRecord(line) && Array.isArray(line.tests));
}

/** Shared by `resolveInternedMutationTestIds` and `reinternMutationTestIds` (module -> methods -> mutants, flattened). */
function collectMutants(mutationModule: Record<string, unknown>): Record<string, unknown>[] {
	if (!Array.isArray(mutationModule.methods)) {
		return [];
	}
	return mutationModule.methods
		.flatMap((method) => (isRecord(method) && Array.isArray(method.mutants) ? method.mutants : []))
		.filter((mutant): mutant is Record<string, unknown> => isRecord(mutant) && Array.isArray(mutant.killingTests));
}

/** Shared by `reinternPerTestIds`/`reinternMutationTestIds` - a small dedup-and-index table, so both stop carrying their own identical copy of it. */
function createTestIdInterner(): { testIds: string[]; indexOf: (id: string) => number } {
	const testIds: string[] = [];
	const indexOf = (id: string): number => {
		const existing = testIds.indexOf(id);
		if (existing !== -1) {
			return existing;
		}
		testIds.push(id);
		return testIds.length - 1;
	};
	return { testIds, indexOf };
}

/**
 * Faz 34, real user bug: "Proof: report could not be generated (exit code
 * 2) ... Current token (VALUE_STRING) not numeric". `ui/commands.ts`'s
 * `runExportReport` merges `pertest-current.json`/`mutation-current.json`
 * (our OWN snapshots - already resolved to plain strings by
 * `resolveInternedTestIds` above, since that runs at `parseVerdict` time,
 * before `writeJsonSnapshot` ever sees the data) into a document it then
 * hands back to proof-java's `render-html` command. That reader still
 * expects D-86's wire shape (`testIds` + numeric indexes) - feeding it
 * plain strings where it expects numbers is exactly this crash. This is
 * the inverse of `resolveInternedTestIds`: rebuilds a `testIds` array and
 * replaces each `tests: string[]` with indexes into it, so the document
 * `runExportReport` sends back to the CLI matches what the CLI itself
 * would have produced. A module that already has a `testIds` array (read
 * straight from a fresh `verdict-current.json`, never touched by our
 * resolver) is left alone - re-interning it would silently discard its
 * real one.
 */
export function reinternPerTestIds(value: unknown): void {
	if (!isRecord(value) || !Array.isArray(value.modules)) {
		return;
	}
	for (const testModule of value.modules) {
		if (!isRecord(testModule)) {
			continue;
		}
		const lines = collectPerTestLines(testModule);
		// A stray leftover `testIds` field (an older extension build's
		// snapshot, written before it deleted this on resolve) is not a
		// reliable "already native" signal on its own - checking the
		// `tests` values themselves is: a module with nothing left to
		// convert is a true no-op, self-healing regardless of what shape
		// this document happened to arrive in.
		if (!lines.some((line) => (line.tests as unknown[]).some((t) => typeof t === 'string'))) {
			continue;
		}
		const { testIds, indexOf } = createTestIdInterner();
		for (const line of lines) {
			line.tests = (line.tests as unknown[]).map((id) => (typeof id === 'string' ? indexOf(id) : id));
		}
		testModule.testIds = testIds;
	}
}

/** Same reasoning as `reinternPerTestIds`, for `mutation.modules[].methods[].mutants[].killingTests`. */
export function reinternMutationTestIds(value: unknown): void {
	if (!isRecord(value) || !Array.isArray(value.modules)) {
		return;
	}
	for (const mutationModule of value.modules) {
		if (!isRecord(mutationModule)) {
			continue;
		}
		const mutants = collectMutants(mutationModule);
		// Same reasoning as reinternPerTestIds: check the values, not a
		// possibly-stale leftover testIds field.
		if (!mutants.some((mutant) => (mutant.killingTests as unknown[]).some((t) => typeof t === 'string'))) {
			continue;
		}
		const { testIds, indexOf } = createTestIdInterner();
		for (const mutant of mutants) {
			mutant.killingTests = (mutant.killingTests as unknown[]).map((id) => (typeof id === 'string' ? indexOf(id) : id));
		}
		mutationModule.testIds = testIds;
	}
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

/** D-86 (see `resolveInternedTestIds` above): the same test-id interning applies to `mutation.modules[].methods[].mutants[].killingTests`, resolved back here the same way so `Mutant.killingTests` stays `readonly string[]` for every consumer. */
function resolveInternedMutationTestIds(value: unknown): void {
	if (!isRecord(value) || !Array.isArray(value.modules)) {
		return;
	}
	for (const mutationModule of value.modules) {
		if (!isRecord(mutationModule) || !Array.isArray(mutationModule.testIds)) {
			continue;
		}
		const testIds = mutationModule.testIds;
		for (const mutant of collectMutants(mutationModule)) {
			mutant.killingTests = (mutant.killingTests as unknown[]).map((index) => (typeof index === 'number' ? testIds[index] : index));
		}
		// Faz 34: same reasoning as resolveInternedTestIds's own delete above.
		delete mutationModule.testIds;
	}
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
		// D-100: optional - proof-python's mutation block has no JVM
		// descriptor to report. Requiring it made every proof-python
		// mutation block fail isMutationBlock, and therefore the whole
		// document (the same class of bug isMetricSet had, just above).
		&& (value.methodDescription === undefined || typeof value.methodDescription === 'string')
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

/**
 * D-99: `jacoco-line`/`coverage-line` are each optional in `MetricSet`
 * (`types.ts`) - a document carries exactly one, named for whichever
 * engine produced it. This validator was missed when that change landed,
 * still hard-requiring `jacoco-line` - so every proof-python verdict
 * failed to parse at all ("missing a required top-level field", the
 * generic message `isVerdictDocument` falls back to). Found by actually
 * running a proof-python verdict through this extension end to end.
 */
function isMetricSet(value: unknown): value is MetricSet {
	return isRecord(value)
		&& (isMetric(value['jacoco-line']) || isMetric(value['coverage-line']))
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
