import * as assert from 'node:assert';

import { setCoverageState, type CoverageState } from '../../model/store';
import { CoverageTreeProvider } from '../../ui/treeViews/coverageView';
import { findQualityBridgeTarget, QualityTreeProvider } from '../../ui/treeViews/qualityView';
import { RunTreeProvider } from '../../ui/treeViews/runView';
import type { Finding, MetricSet } from '../../verdict/types';

const METRIC = { numeratorName: 'a', numerator: 8, denominatorName: 'b', denominator: 10, percent: 80 };
const METRIC_SET: MetricSet = { 'jacoco-line': METRIC, 'strict-line': METRIC, 'sonar-compatible': METRIC };

const FINDING: Finding = {
	rule: 'NO_RECOGNIZED_ORACLE',
	severity: 'WARNING',
	confidence: 'HIGH',
	module: 'root',
	path: 'src/test/java/CalcTest.java',
	startLine: 10,
	endLine: 10,
	message: 'no recognized oracle',
	suggestedAction: 'add an assertion',
	fingerprint: 'abc123',
};

const STATE: CoverageState = {
	workspaceRoot: 'C:/repo',
	fileCoverage: undefined,
	overall: METRIC_SET,
	newCode: { status: 'unavailable_no_vcs' },
	changedFiles: [{
		path: 'src/main/java/Calc.java', module: 'root', classification: 'mapped',
		newLines: 5, coveredNewLines: 2, uncoveredNewRanges: [[10, 12]],
	}],
	findings: [FINDING],
	warnings: [],
	modules: [{ id: 'root', root: '.', sourceRoots: ['src/main/java'], testRoots: ['src/test/java'] }],
};

/** Real Extension Host smoke test - each provider's getChildren/getTreeItem run without throwing, both with and without published state. */
suite('Sidebar tree views (Faz 11b)', () => {
	test('RunTreeProvider always returns actionable items', () => {
		const provider = new RunTreeProvider();
		const children = provider.getChildren();
		assert.ok(children.length > 0);
		for (const child of children) {
			assert.doesNotThrow(() => provider.getTreeItem(child));
		}
	});

	test('CoverageTreeProvider shows an empty placeholder with no state, real sections once published', () => {
		const provider = new CoverageTreeProvider();
		const empty = provider.getChildren();
		assert.equal(empty.length, 1);
		assert.equal(empty[0].kind, 'empty');

		setCoverageState(STATE);
		const sections = provider.getChildren();
		assert.equal(sections.length, 3);

		const overallMetrics = provider.getChildren(sections[0]);
		assert.equal(overallMetrics.length, 3);
		assert.doesNotThrow(() => provider.getTreeItem(overallMetrics[0]));

		const uncoveredFiles = provider.getChildren(sections[2]);
		assert.equal(uncoveredFiles.length, 1);
		const ranges = provider.getChildren(uncoveredFiles[0]);
		assert.equal(ranges.length, 1);
		assert.doesNotThrow(() => provider.getTreeItem(ranges[0]));
	});

	test('QualityTreeProvider groups findings by rule', () => {
		setCoverageState(STATE);
		const provider = new QualityTreeProvider();
		const rules = provider.getChildren();
		assert.equal(rules.length, 1);
		assert.equal(rules[0].kind, 'rule');
		const findings = provider.getChildren(rules[0]);
		assert.equal(findings.length, 1);
		assert.doesNotThrow(() => provider.getTreeItem(findings[0]));
	});

	/**
	 * Faz 13d: "Yeni Kod: yok" tek başına anlamsız duruyordu - bu, gerçek bir
	 * `MetricSet` geldiği (diff modu çalıştı) ama `changedFiles` boş olduğu
	 * durumda artık çıplak "yok" yerine bir sebep düğümü üretildiğini
	 * kanıtlıyor; `unavailable_no_vcs` (STATE'in normal şekli) ile
	 * karıştırılmamalı.
	 */
	test('CoverageTreeProvider explains an empty real newCode MetricSet with a reason node, not a bare "yok"', () => {
		const emptyDiffState: CoverageState = { ...STATE, newCode: METRIC_SET, changedFiles: [] };
		setCoverageState(emptyDiffState);
		const provider = new CoverageTreeProvider();
		const sections = provider.getChildren();
		const newCodeSection = sections.find((s) => s.kind === 'section' && s.id === 'newCode')!;
		const children = provider.getChildren(newCodeSection);
		assert.equal(children.length, 1);
		assert.equal(children[0].kind, 'newCodeStatus');
		if (children[0].kind === 'newCodeStatus') {
			assert.equal(children[0].status, 'no-changes');
		}
		assert.doesNotThrow(() => provider.getTreeItem(children[0]));
	});

	/** Faz 13d: `warnings[]` was computed by the CLI but never shown anywhere in the sidebar - now a "Uyarılar" section only appears when there is at least one. */
	test('CoverageTreeProvider shows a Warnings section only when state.warnings is non-empty', () => {
		setCoverageState(STATE); // warnings: []
		const provider = new CoverageTreeProvider();
		assert.ok(!provider.getChildren().some((s) => s.kind === 'section' && s.id === 'warnings'));

		const withWarning: CoverageState = {
			...STATE,
			warnings: [{ code: 'CHANGED_LINES_ABSENT_FROM_REPORT', message: '4 changed line(s) are absent from the report.' }],
		};
		setCoverageState(withWarning);
		const sections = provider.getChildren();
		const warningsSection = sections.find((s) => s.kind === 'section' && s.id === 'warnings');
		assert.ok(warningsSection);
		const warningNodes = provider.getChildren(warningsSection);
		assert.equal(warningNodes.length, 1);
		assert.equal(warningNodes[0].kind, 'warning');
		assert.doesNotThrow(() => provider.getTreeItem(warningNodes[0]));
	});

	/**
	 * Faz 24 (§7.6 madde 5): Test Kalitesi ↔ Mutasyon köprüsü. Gerçek
	 * `productionMethod` biçimi (`--mutation-report` koşusundan,
	 * 2026-08-28): `"dev.proofjava.playground.Calculator#square(I)I"`.
	 */
	const PSEUDO_TESTED_FINDING: Finding = {
		rule: 'PSEUDO_TESTED_METHOD', severity: 'WARNING', confidence: 'HIGH', module: 'root',
		path: 'src/main/java/dev/proofjava/playground/Calculator.java', startLine: 37, endLine: 37,
		productionMethod: 'dev.proofjava.playground.Calculator#square(I)I',
		message: 'dev.proofjava.playground.Calculator#square is covered but every mutant generated for it survived - the tests that reach it never observe its behavior.',
		suggestedAction: "Add an assertion on this method's return value or observable side effect for at least one covering test.",
		fingerprint: 'e1f087bbb5ce5bc8',
	};

	test('a PSEUDO_TESTED_METHOD finding gets the bridge contextValue, an unrelated finding does not', () => {
		setCoverageState({ ...STATE, findings: [FINDING, PSEUDO_TESTED_FINDING] });
		const provider = new QualityTreeProvider();

		const rules = provider.getChildren();
		const pseudoRule = rules.find((r) => r.kind === 'rule' && r.rule === 'PSEUDO_TESTED_METHOD')!;
		const oracleRule = rules.find((r) => r.kind === 'rule' && r.rule === 'NO_RECOGNIZED_ORACLE')!;

		const pseudoFinding = provider.getChildren(pseudoRule)[0];
		const oracleFinding = provider.getChildren(oracleRule)[0];
		assert.equal(provider.getTreeItem(pseudoFinding).contextValue, 'proof.qualityFinding.pseudoTested');
		assert.equal(provider.getTreeItem(oracleFinding).contextValue, 'proof.qualityFinding', 'a non-PSEUDO_TESTED_METHOD finding must not get the bridge affordance');
	});

	test('getParent: a finding node resolves back to its group (rule or file), matching whichever grouping is active', () => {
		setCoverageState({ ...STATE, findings: [FINDING, PSEUDO_TESTED_FINDING] });
		const provider = new QualityTreeProvider();

		const ruleGroup = provider.getChildren().find((r) => r.kind === 'rule' && r.rule === 'PSEUDO_TESTED_METHOD')!;
		const finding = provider.getChildren(ruleGroup)[0];
		assert.deepEqual(provider.getParent(finding), ruleGroup);

		provider.setGrouping('file');
		const fileGroup = provider.getChildren().find((f) => f.kind === 'file')!;
		const findingUnderFile = provider.getChildren(fileGroup).find((f) => f.kind === 'finding' && f.finding.fingerprint === PSEUDO_TESTED_FINDING.fingerprint)!;
		assert.deepEqual(provider.getParent(findingUnderFile), fileGroup);
	});

	test('findQualityBridgeTarget: finds the real PSEUDO_TESTED_METHOD finding by its productionMethod key', () => {
		setCoverageState({ ...STATE, findings: [FINDING, PSEUDO_TESTED_FINDING] });
		const target = findQualityBridgeTarget('dev.proofjava.playground.Calculator#square(I)I');
		assert.ok(target);
		assert.equal(target?.kind, 'finding');
		if (target?.kind === 'finding') {
			assert.equal(target.finding.fingerprint, PSEUDO_TESTED_FINDING.fingerprint);
		}
	});

	test('findQualityBridgeTarget: no matching finding (stale/mismatched method) -> undefined, not a guess', () => {
		setCoverageState({ ...STATE, findings: [FINDING] });
		assert.equal(findQualityBridgeTarget('dev.proofjava.playground.Calculator#square(I)I'), undefined);
	});
});
