import * as assert from 'node:assert';
import * as vscode from 'vscode';

import { setCoverageState, setMutationState, setPerTestState, type CoverageState } from '../../model/store';
import { findMutationBridgeTarget, MutationTreeProvider } from '../../ui/treeViews/mutationView';
import type { Finding, MetricSet, MutationBlock, PerTestBlock } from '../../verdict/types';

const METRIC = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 };
const METRIC_SET: MetricSet = { 'jacoco-line': METRIC, 'strict-line': METRIC, 'sonar-compatible': METRIC };

const STATE: CoverageState = {
	workspaceRoot: 'C:/repo',
	fileCoverage: { files: [{ module: 'root', path: 'src/main/java/dev/coverdict/playground/Calculator.java', metrics: METRIC_SET, lines: [] }], excluded: [] },
	overall: METRIC_SET,
	newCode: { status: 'unavailable_no_vcs' },
	changedFiles: [], findings: [], warnings: [],
	modules: [{ id: 'root', root: '.', sourceRoots: ['src/main/java'], testRoots: ['src/test/java'] }],
};

/**
 * Verbatim real data from a live run (2026-08-28):
 *   analyze --no-vcs --mutation-report --mutation-target root=dev.coverdict.playground.Calculator
 * Two facts here are real and were **not** what the schema's golden example
 * suggested, both found by running it rather than reading docs:
 *   1. `mutator` is PIT's fully-qualified mutator class, not a short name.
 *   2. PIT mutates **test classes too** - that run produced 16 methods, 8 of
 *      them in test classes. `CalculatorSubsumedTest` below is one of them.
 */
const MUTATION: MutationBlock = {
	engine: 'pitest',
	engineVersion: '1.15.8',
	modules: [{
		id: 'root',
		methods: [
			{
				className: 'dev.coverdict.playground.Calculator', methodName: 'divide', methodDescription: '(II)I',
				firstLine: 22, lastLine: 22,
				mutants: [{
					mutator: 'org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator',
					line: 22, status: 'KILLED',
					killingTests: [
						'dev.coverdict.playground.CalculatorSubsumedTest.[engine:junit-jupiter]/[class:dev.coverdict.playground.CalculatorSubsumedTest]/[method:divideNarrow()]',
					],
				}],
			},
			{
				className: 'dev.coverdict.playground.Calculator', methodName: 'square', methodDescription: '(I)I',
				firstLine: 37, lastLine: 37,
				mutants: [{
					mutator: 'org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator',
					line: 37, status: 'SURVIVED', killingTests: [],
				}],
			},
			{
				className: 'dev.coverdict.playground.Calculator', methodName: 'negate', methodDescription: '(I)I',
				firstLine: 41, lastLine: 41,
				mutants: [{
					mutator: 'org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator',
					line: 41, status: 'NO_COVERAGE', killingTests: [],
				}],
			},
			// Real: PIT mutated the test class itself.
			{
				className: 'dev.coverdict.playground.CalculatorSubsumedTest', methodName: 'divideNarrow', methodDescription: '()V',
				firstLine: 19, lastLine: 19,
				mutants: [{
					mutator: 'org.pitest.mutationtest.engine.gregor.mutators.VoidMethodCallMutator',
					line: 19, status: 'SURVIVED', killingTests: [],
				}],
			},
		],
	}],
};

/** Root children always start with a `header` node once a mutation result exists (Faz 22) - this skips past it to the class list. */
function classNodes(provider: MutationTreeProvider) {
	return provider.getChildren().filter((n) => n.kind === 'class');
}

suite('Mutation view (Faz 20)', () => {
	test('with no run at all, offers to run rather than claiming there is nothing to find', () => {
		const provider = new MutationTreeProvider();
		const roots = provider.getChildren();
		assert.equal(roots.length, 2);
		assert.equal(roots[0].kind, 'empty');
		assert.equal(roots[1].kind, 'runHint');
		assert.doesNotThrow(() => provider.getTreeItem(roots[1]));
	});

	/** Hard rule 3a: "the run failed" and "the run found nothing" must not look identical. No mutation block -> no header either, there is nothing to date-stamp. */
	test('an empty result explains the specific warning that caused it', () => {
		setCoverageState(STATE);
		setMutationState({
			moduleId: 'root', mutation: undefined, targets: [], ranAt: undefined,
			warnings: [{ code: 'MUTATION_BUDGET_EXCEEDED', message: 'budget exhausted', module: 'root' }],
		});
		const provider = new MutationTreeProvider();
		const roots = provider.getChildren();
		assert.equal(roots.length, 2, 'no header when there is no result to date-stamp');
		assert.equal(roots[0].kind, 'empty');
		if (roots[0].kind === 'empty') {
			assert.match(roots[0].message, /bütçe/i);
			assert.match(roots[0].message, /mutationTimeout/, 'must name the setting that fixes it');
		}
	});

	/**
	 * Faz 22: kullanıcının bulduğu gerçek kafa karışıklığı - panel dosyadan
	 * dosyaya geçince değişmiyordu, hangi koşuya bakıldığı belli değildi.
	 * Şimdi kökler her zaman "Hedef: ... · ..." başlığıyla başlıyor.
	 */
	test('a fresh run shows a header naming the target and "az önce"', () => {
		setCoverageState(STATE);
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: ['dev.coverdict.playground.Calculator'], ranAt: Date.now() });
		const provider = new MutationTreeProvider();

		const roots = provider.getChildren();
		assert.equal(roots[0].kind, 'header');
		const headerItem = provider.getTreeItem(roots[0]);
		assert.match(String(headerItem.label), /Hedef: Calculator/);
		assert.match(String(headerItem.label), /az önce/);
	});

	/** A result restored from disk (extension.ts on window reload) has no `ranAt` - the header must say so, not guess a time. */
	test('a restored result (no ranAt) says so instead of guessing a time', () => {
		setCoverageState(STATE);
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [], ranAt: undefined });
		const provider = new MutationTreeProvider();

		const header = provider.getChildren()[0];
		const item = provider.getTreeItem(header);
		assert.match(String(item.label), /kaydedilmiş sonuç/);
		assert.match(String(item.label), /diff'teki değişen sınıflar/, 'empty targets = module-wide, diff-derived');
	});

	test('class -> method -> mutant -> killing test, with test classes filtered out', () => {
		setCoverageState(STATE);
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: ['dev.coverdict.playground.Calculator'], ranAt: Date.now() });
		const provider = new MutationTreeProvider();

		const classes = classNodes(provider);
		assert.equal(classes.length, 1, 'CalculatorSubsumedTest is a test class - its own mutants must not be reported');
		assert.equal(classes[0].kind, 'class');
		const classItem = provider.getTreeItem(classes[0]);
		// 1 killed, 1 survived, 1 indeterminate -> 50%, and the indeterminate must stay visible.
		assert.match(String(classItem.description), /50%/);
		assert.match(String(classItem.description), /1 belirsiz/, 'an indeterminate mutant must never be hidden or folded into the score');

		const methods = provider.getChildren(classes[0]);
		assert.deepEqual(methods.map((m) => (m.kind === 'method' ? m.method.methodName : '')), ['divide', 'square', 'negate']);

		const survived = methods.find((m) => m.kind === 'method' && m.method.methodName === 'square')!;
		const mutants = provider.getChildren(survived);
		assert.equal(mutants.length, 1);
		const mutantItem = provider.getTreeItem(mutants[0]);
		assert.match(String(mutantItem.label), /PrimitiveReturns/, 'PIT\'s fully-qualified mutator name must be shortened for the label');
		assert.ok(!String(mutantItem.label).includes('org.pitest'), 'the full class name belongs in the tooltip, not the label');
		assert.match(String(mutantItem.description), /HAYATTA KALDI/);

		const killed = methods.find((m) => m.kind === 'method' && m.method.methodName === 'divide')!;
		const killingTests = provider.getChildren(provider.getChildren(killed)[0]);
		assert.equal(killingTests.length, 1);
		assert.match(String(provider.getTreeItem(killingTests[0]).label), /divideNarrow/, 'a raw JUnit5 UniqueId must be rendered readable');
	});

	/** A NO_COVERAGE mutant is not evidence of a bad test - it is evidence of no test at all. */
	test('an indeterminate mutant is labelled with its own status, never as killed or survived', () => {
		setCoverageState(STATE);
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [], ranAt: Date.now() });
		const provider = new MutationTreeProvider();

		const methods = provider.getChildren(classNodes(provider)[0]);
		const negate = methods.find((m) => m.kind === 'method' && m.method.methodName === 'negate')!;
		const item = provider.getTreeItem(provider.getChildren(negate)[0]);
		assert.match(String(item.description), /belirsiz/);
		assert.match(String(item.description), /NO_COVERAGE/, 'the raw status stays visible - "indeterminate" alone does not say why');

		// The method's own score has no denominator at all.
		const negateItem = provider.getTreeItem(negate);
		assert.match(String(negateItem.description), /skor yok/);
		// Faz 24 (§7.6 madde 7): every mutant here is NO_COVERAGE (real negate() shape) - say why plainly, not just "belirsiz".
		assert.match(String(negateItem.description), /hiçbir test bu metoda uğramıyor/);
		assert.match(String((negateItem.tooltip as vscode.MarkdownString).value), /hiçbir test bu metoda hiç uğramıyor/);
	});

	/** Faz 24 (§7.6 madde 7): the mixed real describe() shape (NO_COVERAGE + SURVIVED) must NOT claim "no test reaches it" - a SURVIVED mutant proves a test did reach it. */
	test('a method with mixed NO_COVERAGE and other statuses does not falsely claim no test reaches it', () => {
		const mixedMethod: MutationBlock = {
			engine: 'pitest', engineVersion: '1.15.8',
			modules: [{
				id: 'root',
				methods: [{
					className: 'dev.coverdict.playground.Calculator', methodName: 'describe', methodDescription: '(I)Ljava/lang/String;',
					firstLine: 30, lastLine: 33,
					mutants: [
						{ mutator: 'org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator', line: 30, status: 'NO_COVERAGE', killingTests: [] },
						{ mutator: 'org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator', line: 33, status: 'SURVIVED', killingTests: [] },
					],
				}],
			}],
		};
		setCoverageState(STATE);
		setMutationState({ moduleId: 'root', mutation: mixedMethod, warnings: [], targets: [], ranAt: Date.now() });
		const provider = new MutationTreeProvider();

		const describe = provider.getChildren(classNodes(provider)[0]).find((m) => m.kind === 'method' && m.method.methodName === 'describe')!;
		assert.doesNotMatch(String(provider.getTreeItem(describe).description), /hiçbir test bu metoda uğramıyor/);
	});

	test('survivors-only filter keeps the methods worth looking at and can be turned back off', () => {
		setCoverageState(STATE);
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [], ranAt: Date.now() });
		const provider = new MutationTreeProvider();

		assert.equal(provider.isSurvivorsOnly(), false, 'default: hide nothing');
		assert.equal(provider.getChildren(classNodes(provider)[0]).length, 3);

		assert.equal(provider.toggleSurvivorsOnly(), true);
		const filtered = provider.getChildren(classNodes(provider)[0]);
		assert.deepEqual(filtered.map((m) => (m.kind === 'method' ? m.method.methodName : '')), ['square']);
		// The header must survive the filter too - it is not one of the filtered class nodes.
		assert.equal(provider.getChildren()[0].kind, 'header');

		provider.toggleSurvivorsOnly();
		assert.equal(provider.getChildren(classNodes(provider)[0]).length, 3);
	});

	/**
	 * Faz 24 (§7.6 madde 5): Test Kalitesi ↔ Mutasyon köprüsü. Gerçek bir
	 * `--mutation-report` koşusu (2026-08-28) `square`'in tek mutantı hayatta
	 * kaldığı için gerçek bir `PSEUDO_TESTED_METHOD` bulgusu üretti
	 * (`productionMethod: "dev.coverdict.playground.Calculator#square(I)I"`),
	 * `divide`'ın (killed mutant) için üretmedi - köprü yalnızca gerçekten
	 * eşleşen metotta görünmeli.
	 */
	const SQUARE_PSEUDO_TESTED_FINDING: Finding = {
		rule: 'PSEUDO_TESTED_METHOD', severity: 'WARNING', confidence: 'HIGH', module: 'root',
		path: 'src/main/java/dev/coverdict/playground/Calculator.java', startLine: 37, endLine: 37,
		productionMethod: 'dev.coverdict.playground.Calculator#square(I)I',
		message: 'dev.coverdict.playground.Calculator#square is covered but every mutant generated for it survived - the tests that reach it never observe its behavior.',
		suggestedAction: "Add an assertion on this method's return value or observable side effect for at least one covering test.",
		fingerprint: 'e1f087bbb5ce5bc8',
	};

	test('a method with a matching real PSEUDO_TESTED_METHOD finding gets the bridge contextValue, an unrelated method does not', () => {
		setCoverageState({ ...STATE, findings: [SQUARE_PSEUDO_TESTED_FINDING] });
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [], ranAt: Date.now() });
		const provider = new MutationTreeProvider();

		const methods = provider.getChildren(classNodes(provider)[0]);
		const square = methods.find((m) => m.kind === 'method' && m.method.methodName === 'square')!;
		const divide = methods.find((m) => m.kind === 'method' && m.method.methodName === 'divide')!;

		assert.equal(provider.getTreeItem(square).contextValue, 'coverdict.mutationMethod.pseudoTested');
		assert.equal(provider.getTreeItem(divide).contextValue, 'coverdict.mutationMethod', 'divide has no matching finding - must not get the bridge affordance');
	});

	test('getParent: a method node resolves back to its class node, siblings intact for reveal()', () => {
		setCoverageState(STATE);
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [], ranAt: Date.now() });
		const provider = new MutationTreeProvider();

		const classNode = classNodes(provider)[0];
		const square = provider.getChildren(classNode).find((m) => m.kind === 'method' && m.method.methodName === 'square')!;
		assert.deepEqual(provider.getParent(square), classNode);
		assert.equal(provider.getParent(classNode), undefined, 'a class node is root-level, has no parent');
	});

	test('findMutationBridgeTarget: finds the real square() method by its productionMethod-derived identity', () => {
		setCoverageState(STATE);
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [], ranAt: Date.now() });

		const target = findMutationBridgeTarget('dev.coverdict.playground.Calculator', 'square', '(I)I');
		assert.ok(target);
		assert.equal(target?.kind, 'method');
		if (target?.kind === 'method') {
			assert.equal(target.method.methodName, 'square');
		}
	});

	test('findMutationBridgeTarget: no mutation data at all -> undefined, not a guess', () => {
		setCoverageState(STATE);
		setMutationState({ moduleId: 'root', mutation: undefined, warnings: [], targets: [], ranAt: undefined });
		assert.equal(findMutationBridgeTarget('dev.coverdict.playground.Calculator', 'square', '(I)I'), undefined);
	});

	test('findMutationBridgeTarget: mutation data present but this method is not in it (stale result) -> undefined', () => {
		setCoverageState(STATE);
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [], ranAt: Date.now() });
		assert.equal(findMutationBridgeTarget('dev.coverdict.playground.Calculator', 'notAMethod', '()V'), undefined);
	});

	/**
	 * Faz 24 (§7.6 madde 6, ters yön) - real shape: `divide`'ın killed
	 * mutantını `CalculatorSubsumedTest#divideNarrow()` öldürdü (bkz.
	 * MUTATION fixture yukarıda). Bu testin L0'da INCONCLUSIVE bir bulgusu
	 * olduğu varsayımıyla, mutasyon ağacındaki bu killing test yaprağı da
	 * çelişkiyi hatırlatmalı - "Satır → Testler"deki köprünün simetriği.
	 */
	test('a killing test with a real INCONCLUSIVE finding gets a contradiction tooltip note', () => {
		const inconclusiveFinding: Finding = {
			rule: 'NO_RECOGNIZED_ORACLE', confidence: 'INCONCLUSIVE', severity: 'WARNING', module: 'root',
			path: 'src/test/java/dev/coverdict/playground/CalculatorSubsumedTest.java', startLine: 19, endLine: 19,
			message: 'looked oracle-suggestive but could not be resolved', suggestedAction: 'add an assertion', fingerprint: 'abc',
			testMethod: 'dev.coverdict.playground.CalculatorSubsumedTest#divideNarrow()',
		};
		setCoverageState({ ...STATE, findings: [inconclusiveFinding] });
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: ['dev.coverdict.playground.Calculator'], ranAt: Date.now() });
		const provider = new MutationTreeProvider();

		const divide = provider.getChildren(classNodes(provider)[0]).find((m) => m.kind === 'method' && m.method.methodName === 'divide')!;
		const killingTest = provider.getChildren(provider.getChildren(divide)[0])[0];
		const item = provider.getTreeItem(killingTest);
		assert.equal(item.contextValue, 'coverdict.killingTest.contradiction');
		assert.match(String((item.tooltip as vscode.MarkdownString).value), /belirsiz/);
	});

	test('a killing test with no matching finding at all gets the plain leaf, no fabricated note', () => {
		setCoverageState({ ...STATE, findings: [] });
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [], ranAt: Date.now() });
		const provider = new MutationTreeProvider();

		const divide = provider.getChildren(classNodes(provider)[0]).find((m) => m.kind === 'method' && m.method.methodName === 'divide')!;
		const killingTest = provider.getChildren(provider.getChildren(divide)[0])[0];
		const item = provider.getTreeItem(killingTest);
		assert.equal(item.contextValue, undefined);
		assert.equal(item.tooltip, undefined);
	});

	/**
	 * Faz 26: a SURVIVED mutant has no `killingTests` at all - the only way
	 * to see "which tests covered this line but never caught it" is perTest
	 * data. Real shape: `square`'s SURVIVED mutant is on line 37 (MUTATION
	 * fixture above), and a real Derin Tarama's perTest entry for `square`
	 * also lists line 37 - the bridge affordance must appear there, and
	 * nowhere a line has no such record (`divide`, no perTest entry here).
	 */
	const SQUARE_PER_TEST: PerTestBlock = {
		engine: 'pitest', engineVersion: '1.15.8',
		modules: [{
			id: 'root',
			entries: [{
				className: 'dev.coverdict.playground.Calculator', methodName: 'square',
				lines: [{ line: 37, tests: ['[class:dev.coverdict.playground.CalculatorPseudoTestedTest]/[method:squareHasNoAssertion()]'] }],
			}],
			ambient: [],
		}],
	};

	test('a SURVIVED mutant whose line has real perTest coverage gets the bridge contextValue and tooltip note', () => {
		setCoverageState(STATE);
		setPerTestState({ moduleId: 'root', perTest: SQUARE_PER_TEST, warnings: [] });
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [], ranAt: Date.now() });
		const provider = new MutationTreeProvider();

		const square = provider.getChildren(classNodes(provider)[0]).find((m) => m.kind === 'method' && m.method.methodName === 'square')!;
		const mutant = provider.getChildren(square)[0];
		const item = provider.getTreeItem(mutant);
		assert.equal(item.contextValue, 'coverdict.mutant.hasLineEvidence');
		assert.match(String((item.tooltip as vscode.MarkdownString).value), /Satır → Testler'de Göster/);
	});

	test('a mutant whose line has no perTest record at all gets the plain contextValue, no fabricated bridge', () => {
		setCoverageState(STATE);
		setPerTestState({ moduleId: 'root', perTest: SQUARE_PER_TEST, warnings: [] });
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [], ranAt: Date.now() });
		const provider = new MutationTreeProvider();

		const divide = provider.getChildren(classNodes(provider)[0]).find((m) => m.kind === 'method' && m.method.methodName === 'divide')!;
		const mutant = provider.getChildren(divide)[0];
		const item = provider.getTreeItem(mutant);
		assert.equal(item.contextValue, 'coverdict.mutant', 'divide has no perTest entry in this fixture - must not claim a bridge');
	});

	test('no perTest data collected at all - every mutant gets the plain contextValue', () => {
		setCoverageState(STATE);
		setPerTestState({ moduleId: 'root', perTest: undefined, warnings: [] });
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [], ranAt: Date.now() });
		const provider = new MutationTreeProvider();

		const square = provider.getChildren(classNodes(provider)[0]).find((m) => m.kind === 'method' && m.method.methodName === 'square')!;
		const mutant = provider.getChildren(square)[0];
		assert.equal(provider.getTreeItem(mutant).contextValue, 'coverdict.mutant');
	});
});
