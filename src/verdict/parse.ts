import type { Metric, MetricSet, VerdictDocument } from './types';

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
		return { ok: false, error: 'does not look like a coverdict verdict document (missing schemaVersion/tool/analysis/coverage)' };
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
		&& isRecord(value.coverage) && isMetricSet(value.coverage.overall);
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
