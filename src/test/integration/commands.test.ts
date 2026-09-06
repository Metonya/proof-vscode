import * as assert from 'node:assert';

import { allProductionTargets, describeNode, moduleRootsFromBoundModules } from '../../ui/commands';
import type { CoverageState } from '../../model/store';
import type { MetricSet } from '../../verdict/types';

/**
 * Faz 31: real user report - right-clicking "Kopyala" on the "no changed
 * class" explanation node (a screenshot) did nothing, because `describeNode`
 * had no case for `'empty'` (or several other real node kinds across the
 * four tree views). These are integration tests, not unit tests, because
 * `commands.ts` imports `vscode` at module scope - it cannot load under
 * plain `node:test` outside a real Extension Host (this codebase's own
 * established convention for everything under `src/ui/**`).
 */
suite('describeNode (Faz 31 - "Kopyala" coverage)', () => {
	test('empty: the long explanation message itself, the exact real report', () => {
		const text = describeNode({ kind: 'empty', message: "No class changed in this run, so per-test evidence is empty - this is not an error: L2 only targets changed production classes in the diff." });
		assert.equal(text, "No class changed in this run, so per-test evidence is empty - this is not an error: L2 only targets changed production classes in the diff.");
	});

	test('empty: a node with no message copies nothing, never an empty string masquerading as content', () => {
		assert.equal(describeNode({ kind: 'empty' }), undefined);
	});

	test('header (mutation view target line)', () => {
		assert.equal(describeNode({ kind: 'header', text: 'Target: Calculator · just now' }), 'Target: Calculator · just now');
	});

	test('class (both tree views\' class node)', () => {
		assert.equal(describeNode({ kind: 'class', className: 'dev.proofjava.playground.Calculator' }), 'dev.proofjava.playground.Calculator');
	});

	test('testMethod (line tests view, reverse direction)', () => {
		assert.equal(describeNode({ kind: 'testMethod', methodName: 'addsTwoNumbers' }), 'addsTwoNumbers()');
	});

	test('testLine (line tests view, reverse direction leaf)', () => {
		assert.equal(describeNode({ kind: 'testLine', ref: { outerClassName: 'dev.proofjava.playground.Calculator', line: 37 } }), 'dev.proofjava.playground.Calculator:37');
	});

	test('method (mutation view)', () => {
		const text = describeNode({ kind: 'method', className: 'dev.proofjava.playground.Calculator', method: { methodName: 'square', methodDescription: '(I)I' } });
		assert.equal(text, 'dev.proofjava.playground.Calculator#square(I)I');
	});

	test('mutant (mutation view)', () => {
		const text = describeNode({ kind: 'mutant', className: 'dev.proofjava.playground.Calculator', mutant: { line: 37, mutator: 'PrimitiveReturnsMutator', status: 'SURVIVED' } });
		assert.equal(text, 'dev.proofjava.playground.Calculator:37 PrimitiveReturnsMutator SURVIVED');
	});

	test('killingTest (mutation view) - same raw-id convention as prodTest, unchanged', () => {
		const rawTestId = '[class:dev.proofjava.playground.CalculatorSubsumedTest]/[method:divideNarrow()]';
		assert.equal(describeNode({ kind: 'killingTest', rawTestId }), rawTestId);
		assert.equal(describeNode({ kind: 'prodTest', rawTestId }), rawTestId);
	});

	test('an unrecognized shape still returns undefined, never a guess (hard rule 3a) - a button node has nothing worth copying', () => {
		assert.equal(describeNode({ kind: 'collectHint' }), undefined);
		assert.equal(describeNode({ kind: 'runHint' }), undefined);
		assert.equal(describeNode(null), undefined);
		assert.equal(describeNode('a raw string, not a node'), undefined);
	});

	/**
	 * Faz 31 follow-up, real user report: right-clicking "Kopyala" on the
	 * Çalıştır view's own items still did nothing. `runView.ts`'s `RunItem`
	 * is not a `{kind, ...}` data node at all - it *is* a `vscode.TreeItem`
	 * subclass, with real `label`/`description` already set and no `kind`
	 * field whatsoever, so none of the `kind`-dispatched branches above
	 * could ever match it.
	 */
	test('a plain TreeItem-shaped node (no `kind`, e.g. runView.ts\'s RunItem) uses its own real label/description', () => {
		assert.equal(describeNode({ label: 'Run Tests', description: 'report: not yet' }), 'Run Tests - report: not yet');
		assert.equal(describeNode({ label: 'Coverage View', description: 'open - click to hide' }), 'Coverage View - open - click to hide');
	});

	test('a plain TreeItem-shaped node with no description copies just the label', () => {
		assert.equal(describeNode({ label: 'Quick Scan' }), 'Quick Scan');
	});

	test('a plain TreeItem-shaped node with a boolean description (VS Code\'s "always show" flag, not real text) copies just the label', () => {
		assert.equal(describeNode({ label: 'Quick Scan', description: true }), 'Quick Scan');
	});
});

const METRIC: MetricSet = {
	'jacoco-line': { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 },
	'strict-line': { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 },
	'sonar-compatible': { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 },
};

/**
 * Faz 31: the user's explicit ask - "değişiklik yapmadan tüm repoda tarama
 * yapabilmeliyim" (I should be able to scan the whole repo without making
 * changes). `allProductionTargets` is what a diff finding nothing changed
 * falls back to: every production file this run's own fileCoverage already
 * knows about, independent of git diff entirely.
 */
suite('allProductionTargets (Faz 31)', () => {
	const BASE_STATE: Omit<CoverageState, 'fileCoverage'> = {
		workspaceRoot: 'C:/repo',
		overall: METRIC, newCode: { status: 'unavailable_no_vcs' }, changedFiles: [], findings: [], warnings: [],
		modules: [{ id: 'root', root: '.', sourceRoots: ['src/main/java'], testRoots: ['src/test/java'] }],
	};

	test('resolves every production file to its real FQCN, regardless of diff', () => {
		const state: CoverageState = {
			...BASE_STATE,
			fileCoverage: {
				files: [
					{ module: 'root', path: 'src/main/java/dev/proofjava/playground/Calculator.java', metrics: METRIC, lines: [] },
					{ module: 'root', path: 'src/main/java/dev/proofjava/playground/Multiplier.java', metrics: METRIC, lines: [] },
				],
				excluded: [],
			},
		};
		const targets = allProductionTargets(state);
		assert.deepEqual(targets.map((t) => t.fqcn), ['dev.proofjava.playground.Calculator', 'dev.proofjava.playground.Multiplier']);
		assert.ok(targets[0].filePath.endsWith('Calculator.java'));
	});

	test('no fileCoverage at all (no scan has run yet) - empty, not an error', () => {
		assert.deepEqual(allProductionTargets({ ...BASE_STATE, fileCoverage: undefined }), []);
	});

	test('a path that does not resolve to a class under any declared source root is skipped, not guessed at', () => {
		const state: CoverageState = {
			...BASE_STATE,
			fileCoverage: { files: [{ module: 'root', path: 'some/unrelated/generated/Thing.java', metrics: METRIC, lines: [] }], excluded: [] },
		};
		assert.deepEqual(allProductionTargets(state), []);
	});
});

/**
 * Faz 31: real bug, found live against gson - "exactly 1 module bound"
 * does NOT mean "no real choice to make" when that one module is a real
 * submodule name. gson's reactor has 7 modules but only `gson` ever
 * produces a jacoco.xml (`test-jpms` crashes before it gets one), so
 * exactly 1 module got bound while the reactor itself still had many -
 * "Testleri Çalıştır" ran the whole reactor unscoped anyway, straight
 * into test-jpms's real JPMS module-info failure.
 */
suite('moduleRootsFromBoundModules (Faz 31)', () => {
	test('a real submodule name, even alone, is still scoped - the exact gson bug', () => {
		assert.deepEqual(moduleRootsFromBoundModules([{ root: 'gson' }]), ['gson']);
	});

	test('the trivial single-project root (".") is the only true no-op case', () => {
		assert.equal(moduleRootsFromBoundModules([{ root: '.' }]), undefined);
	});

	test('several bound modules are all scoped, unchanged from before', () => {
		assert.deepEqual(moduleRootsFromBoundModules([{ root: 'gson' }, { root: 'extras' }]), ['gson', 'extras']);
	});
});
