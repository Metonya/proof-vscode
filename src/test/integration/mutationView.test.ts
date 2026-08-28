import * as assert from 'node:assert';

import { setCoverageState, setMutationState, type CoverageState } from '../../model/store';
import { MutationTreeProvider } from '../../ui/treeViews/mutationView';
import type { MetricSet, MutationBlock } from '../../verdict/types';

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

suite('Mutation view (Faz 20)', () => {
	test('with no run at all, offers to run rather than claiming there is nothing to find', () => {
		const provider = new MutationTreeProvider();
		const roots = provider.getChildren();
		assert.equal(roots.length, 2);
		assert.equal(roots[0].kind, 'empty');
		assert.equal(roots[1].kind, 'runHint');
		assert.doesNotThrow(() => provider.getTreeItem(roots[1]));
	});

	/** Hard rule 3a: "the run failed" and "the run found nothing" must not look identical. */
	test('an empty result explains the specific warning that caused it', () => {
		setCoverageState(STATE);
		setMutationState({
			moduleId: 'root', mutation: undefined, targets: [],
			warnings: [{ code: 'MUTATION_BUDGET_EXCEEDED', message: 'budget exhausted', module: 'root' }],
		});
		const provider = new MutationTreeProvider();
		const roots = provider.getChildren();
		assert.equal(roots[0].kind, 'empty');
		if (roots[0].kind === 'empty') {
			assert.match(roots[0].message, /bütçe/i);
			assert.match(roots[0].message, /mutationTimeout/, 'must name the setting that fixes it');
		}
	});

	test('class -> method -> mutant -> killing test, with test classes filtered out', () => {
		setCoverageState(STATE);
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: ['dev.coverdict.playground.Calculator'] });
		const provider = new MutationTreeProvider();

		const classes = provider.getChildren();
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
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [] });
		const provider = new MutationTreeProvider();

		const methods = provider.getChildren(provider.getChildren()[0]);
		const negate = methods.find((m) => m.kind === 'method' && m.method.methodName === 'negate')!;
		const item = provider.getTreeItem(provider.getChildren(negate)[0]);
		assert.match(String(item.description), /belirsiz/);
		assert.match(String(item.description), /NO_COVERAGE/, 'the raw status stays visible - "indeterminate" alone does not say why');

		// The method's own score has no denominator at all.
		assert.match(String(provider.getTreeItem(negate).description), /skor yok/);
	});

	test('survivors-only filter keeps the methods worth looking at and can be turned back off', () => {
		setCoverageState(STATE);
		setMutationState({ moduleId: 'root', mutation: MUTATION, warnings: [], targets: [] });
		const provider = new MutationTreeProvider();

		assert.equal(provider.isSurvivorsOnly(), false, 'default: hide nothing');
		assert.equal(provider.getChildren(provider.getChildren()[0]).length, 3);

		assert.equal(provider.toggleSurvivorsOnly(), true);
		const filtered = provider.getChildren(provider.getChildren()[0]);
		assert.deepEqual(filtered.map((m) => (m.kind === 'method' ? m.method.methodName : '')), ['square']);

		provider.toggleSurvivorsOnly();
		assert.equal(provider.getChildren(provider.getChildren()[0]).length, 3);
	});
});
