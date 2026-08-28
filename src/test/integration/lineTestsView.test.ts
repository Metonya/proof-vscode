import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { setCoverageState, setPerTestState, type CoverageState } from '../../model/store';
import { LineTestsTreeProvider } from '../../ui/treeViews/lineTestsView';
import type { FileCoverageBlock, Finding, MetricSet, ModuleInput, PerTestBlock } from '../../verdict/types';

const METRIC = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 };
const METRIC_SET: MetricSet = { 'jacoco-line': METRIC, 'strict-line': METRIC, 'sonar-compatible': METRIC };

/** Exactly the shape a real single-module run emits (`inputs.modules[0]`, verified 2026-08-28) - roots are repo-relative, not module-relative. */
const MODULES: readonly ModuleInput[] = [{
	id: 'root', root: '.', sourceRoots: ['src/main/java'], testRoots: ['src/test/java'],
}];

/** Real shape from a live --per-test-target run (Faz 15 session): one production line, one test with a real oracle-quality finding against it. */
const PER_TEST: PerTestBlock = {
	engine: 'pitest',
	engineVersion: '1.15.8',
	modules: [{
		id: 'root',
		entries: [{
			className: 'dev.coverdict.playground.Calculator',
			methodName: 'square',
			lines: [{ line: 37, tests: ['[class:dev.coverdict.playground.CalculatorPseudoTestedTest]/[method:squareHasNoAssertion()]'] }],
		}],
		ambient: [],
	}],
};

const FINDINGS: readonly Finding[] = [{
	rule: 'NO_RECOGNIZED_ORACLE', confidence: 'HIGH', severity: 'WARNING', module: 'root',
	path: 'src/test/java/dev/coverdict/playground/CalculatorPseudoTestedTest.java', startLine: 16, endLine: 16,
	message: 'no oracle', suggestedAction: 'add one', fingerprint: 'f1',
	testMethod: 'dev.coverdict.playground.CalculatorPseudoTestedTest#squareHasNoAssertion()',
}];

/** `fileCoverage.files[]` only ever lists production files - that is what makes it the authority on "is this class production". */
const PRODUCTION_ONLY_FILE_COVERAGE: FileCoverageBlock = {
	files: [{ module: 'root', path: 'src/main/java/dev/coverdict/playground/Calculator.java', metrics: METRIC_SET, lines: [] }],
	excluded: [],
};

const STATE: Omit<CoverageState, 'workspaceRoot'> = {
	fileCoverage: undefined, overall: METRIC_SET,
	newCode: { status: 'unavailable_no_vcs' }, changedFiles: [], findings: FINDINGS, warnings: [],
	modules: MODULES,
};

/**
 * Builds a throwaway workspace root with the real Maven layout and opens one
 * `.java` file inside it. A real path under a real root matters now: since
 * Faz 21 the view picks its direction from `inputs.modules[].testRoots`, so a
 * document sitting in a bare tmpdir would exercise the `'unknown'` fallback
 * instead of the production/test decision under test. `document.fileName`
 * also needs a real `.java` basename for `detectClassName` to resolve.
 */
async function openJavaFile(rootRelativeDir: string, packageName: string, className: string): Promise<{ document: vscode.TextDocument; workspaceRoot: string }> {
	const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-lineTestsView-'));
	const dir = path.join(workspaceRoot, ...rootRelativeDir.split('/'), ...packageName.split('.'));
	fs.mkdirSync(dir, { recursive: true });
	const filePath = path.join(dir, `${className}.java`);
	fs.writeFileSync(filePath, `package ${packageName};\n\npublic class ${className} {\n}\n`, 'utf8');
	return { document: await vscode.workspace.openTextDocument(vscode.Uri.file(filePath)), workspaceRoot };
}

async function openProductionFile(className: string) {
	return openJavaFile('src/main/java', 'dev.coverdict.playground', className);
}

async function openTestFile(className: string) {
	return openJavaFile('src/test/java', 'dev.coverdict.playground', className);
}

/**
 * Real Extension Host smoke test for the tree that replaced the webview
 * panel deleted in Faz 15 - proves both the production direction (line ->
 * tests) and the reverse (test method -> lines), and that `getParent`
 * round-trips (required for `reveal()`, and for VS Code to know a leaf's
 * ancestry at all).
 */
suite('Line tests view (Faz 15c)', () => {
	test('before any Java file is active, shows the empty state', () => {
		const provider = new LineTestsTreeProvider();
		const roots = provider.getChildren();
		assert.equal(roots.length, 1);
		assert.equal(roots[0].kind, 'empty');
	});

	test('production file: line node -> test leaf -> getParent round-trip', async () => {
		setPerTestState({ moduleId: 'root', perTest: PER_TEST, warnings: [] });
		const { document, workspaceRoot } = await openProductionFile('Calculator');
		setCoverageState({ ...STATE, workspaceRoot });

		const provider = new LineTestsTreeProvider();
		provider.setActiveDocument(document);

		const roots = provider.getChildren();
		assert.equal(roots.length, 1);
		assert.equal(roots[0].kind, 'prodLine');
		assert.doesNotThrow(() => provider.getTreeItem(roots[0]));

		const tests = provider.getChildren(roots[0]);
		assert.equal(tests.length, 1);
		assert.equal(tests[0].kind, 'prodTest');
		assert.doesNotThrow(() => provider.getTreeItem(tests[0]));

		assert.deepEqual(provider.getParent(tests[0]), roots[0]);
		assert.deepEqual(provider.nodeForLine(37), roots[0]);
		assert.equal(provider.nodeForLine(999), undefined);
	});

	/**
	 * Faz 24 (§7.6 madde 4) - real data from a live
	 * `--per-test-target root=dev.coverdict.playground.Calculator` run
	 * (2026-08-28): `Calculator.java` has no explicit constructor, so the
	 * compiler's synthesized no-arg `<init>()` gets its single instruction
	 * attributed to the class declaration line (line 4). Every one of the 14
	 * tests that constructs a `Calculator` shows up covering that line, which
	 * used to render as an unexplained "Satır 4 · 14 test" at the top of the
	 * list. It must now be labelled with the real method it belongs to.
	 */
	test('a line whose only covering method is the constructor is labelled, not left as bare noise', async () => {
		const constructorPerTest: PerTestBlock = {
			engine: 'pitest', engineVersion: '1.15.8',
			modules: [{
				id: 'root',
				entries: [{
					className: 'dev.coverdict.playground.Calculator',
					methodName: '<init>',
					lines: [{ line: 4, tests: Array.from({ length: 14 }, (_, i) => `[class:dev.coverdict.playground.Test${i}]/[method:t()]`) }],
				}],
				ambient: [],
			}],
		};
		setPerTestState({ moduleId: 'root', perTest: constructorPerTest, warnings: [] });
		const { document, workspaceRoot } = await openProductionFile('Calculator');
		setCoverageState({ ...STATE, workspaceRoot, findings: [] });

		const provider = new LineTestsTreeProvider();
		provider.setActiveDocument(document);

		const roots = provider.getChildren();
		assert.equal(roots.length, 1);
		assert.equal(roots[0].kind, 'prodLine');
		if (roots[0].kind === 'prodLine') {
			assert.equal(roots[0].methodName, '<init>');
		}
		const item = provider.getTreeItem(roots[0]);
		assert.match(String(item.label), /<init>\(\)/, 'the label must name the method the line belongs to, not just "Satır 4"');
		assert.ok(item.tooltip, 'a constructor-attributed line must explain why its test count looks high');
		assert.match(String((item.tooltip as { value?: string })?.value ?? item.tooltip), /constructor/i);
	});

	/**
	 * Faz 17a: the real regression this test pins down - real
	 * NotifyingCalculator.java data (2026-08-28) had 6 lines (9-11, 14-16)
	 * all covered by the exact same one test, and the tree used to show 6
	 * separate "Satır N" nodes for it. Now it must be one range per
	 * contiguous run, split where the test set actually changes.
	 */
	test('production file: consecutive lines covered by the same test merge into one range node', async () => {
		const notifyingCalculatorPerTest: PerTestBlock = {
			engine: 'pitest',
			engineVersion: '1.15.8',
			modules: [{
				id: 'root',
				entries: [{
					className: 'dev.coverdict.playground.NotifyingCalculator',
					methodName: 'addAndNotify',
					lines: [9, 10, 11, 14, 15, 16].map((line) => ({
						line, tests: ['[class:dev.coverdict.playground.NotifyingCalculatorMockitoTest]/[method:addAndNotifySendsTheComputedResult()]'],
					})),
				}],
				ambient: [],
			}],
		};
		setPerTestState({ moduleId: 'root', perTest: notifyingCalculatorPerTest, warnings: [] });
		const { document, workspaceRoot } = await openProductionFile('NotifyingCalculator');
		setCoverageState({ ...STATE, workspaceRoot, findings: [] });

		const provider = new LineTestsTreeProvider();
		provider.setActiveDocument(document);

		const roots = provider.getChildren();
		assert.equal(roots.length, 2, 'two contiguous runs (9-11 and 14-16), not six separate line nodes');
		assert.equal(roots[0].kind, 'prodLine');
		if (roots[0].kind === 'prodLine') {
			assert.equal(roots[0].startLine, 9);
			assert.equal(roots[0].endLine, 11);
		}
		assert.equal(roots[1].kind, 'prodLine');
		if (roots[1].kind === 'prodLine') {
			assert.equal(roots[1].startLine, 14);
			assert.equal(roots[1].endLine, 16);
		}
		assert.doesNotThrow(() => provider.getTreeItem(roots[0]));

		const testsInFirstRange = provider.getChildren(roots[0]);
		assert.equal(testsInFirstRange.length, 1, 'the same test appears once, not once per merged line');
		assert.deepEqual(provider.getParent(testsInFirstRange[0]), roots[0]);
		assert.deepEqual(provider.nodeForLine(10), roots[0], 'a cursor anywhere inside the merged range resolves to the same range node');
	});

	/** Faz 19: "sorunsuzları kaldır, sadece cover edilmeyenleri göster gibi" - the filter hides lines whose covering tests all check out. */
	test('problems-only filter hides lines where every covering test is fine, keeps the rest', async () => {
		const mixedPerTest: PerTestBlock = {
			engine: 'pitest',
			engineVersion: '1.15.8',
			modules: [{
				id: 'root',
				entries: [{
					className: 'dev.coverdict.playground.Calculator',
					methodName: 'mixed',
					lines: [
						// line 37: covered only by the test that has a NO_RECOGNIZED_ORACLE finding
						{ line: 37, tests: ['[class:dev.coverdict.playground.CalculatorPseudoTestedTest]/[method:squareHasNoAssertion()]'] },
						// line 50: covered by a test with no finding at all
						{ line: 50, tests: ['[class:dev.coverdict.playground.CalculatorGoodTest]/[method:addWorksCorrectly()]'] },
					],
				}],
				ambient: [],
			}],
		};
		setPerTestState({ moduleId: 'root', perTest: mixedPerTest, warnings: [] });
		const { document, workspaceRoot } = await openProductionFile('Calculator');
		setCoverageState({ ...STATE, workspaceRoot });

		const provider = new LineTestsTreeProvider();
		provider.setActiveDocument(document);

		assert.equal(provider.getChildren().length, 2, 'filtre kapalıyken iki satır da görünür');
		assert.equal(provider.isProblemsOnly(), false, 'varsayılan: hiçbir şey gizlenmez');

		assert.equal(provider.toggleProblemsOnly(), true);
		const filtered = provider.getChildren();
		assert.equal(filtered.length, 1, 'doğrulaması olan testin kapsadığı satır gizlenir');
		assert.equal(filtered[0].kind, 'prodLine');
		if (filtered[0].kind === 'prodLine') {
			assert.equal(filtered[0].startLine, 37);
		}

		provider.toggleProblemsOnly();
		assert.equal(provider.getChildren().length, 2, 'tekrar açınca hepsi geri gelir');
	});

	test('test file (reverse direction): test-method node -> production-line leaf', async () => {
		setPerTestState({ moduleId: 'root', perTest: PER_TEST, warnings: [] });
		const { document, workspaceRoot } = await openTestFile('CalculatorPseudoTestedTest');
		setCoverageState({ ...STATE, workspaceRoot });

		const provider = new LineTestsTreeProvider();
		provider.setActiveDocument(document);

		const roots = provider.getChildren();
		assert.equal(roots.length, 1);
		assert.equal(roots[0].kind, 'testMethod');
		assert.doesNotThrow(() => provider.getTreeItem(roots[0]));

		const lines = provider.getChildren(roots[0]);
		assert.equal(lines.length, 1);
		assert.equal(lines[0].kind, 'testLine');
		assert.doesNotThrow(() => provider.getTreeItem(lines[0]));
		assert.deepEqual(provider.getParent(lines[0]), roots[0]);
	});

	/**
	 * Faz 21 - the regression Faz 16 madde 1 reported and Faz 17/18/19 never
	 * closed. The fixture below is verbatim real data from a live
	 * `--per-test-target root=dev.coverdict.playground.Calculator` run
	 * (2026-08-28): PIT's L2 collector writes **test classes into `entries`
	 * too**, each covering its own lines with its own test method. Every
	 * synthetic fixture in this file omitted that, which is exactly why the
	 * bug survived three phases of tests.
	 *
	 * With such data `testsForClass('...CalculatorPseudoTestedTest')` returns
	 * `found`, so the old "try production first" order rendered a test file
	 * in the production direction - the test file appeared to cover itself.
	 * Direction is now decided from `inputs.modules[].testRoots` instead.
	 */
	test('test file whose own lines are in perTest.entries still renders the reverse direction (Faz 16 madde 1)', async () => {
		const realPerTest: PerTestBlock = {
			engine: 'pitest',
			engineVersion: '1.15.8',
			modules: [{
				id: 'root',
				entries: [
					{
						className: 'dev.coverdict.playground.Calculator',
						methodName: 'square',
						lines: [{ line: 37, tests: ['dev.coverdict.playground.CalculatorPseudoTestedTest.[engine:junit-jupiter]/[class:dev.coverdict.playground.CalculatorPseudoTestedTest]/[method:squareHasNoAssertion()]'] }],
					},
					{
						className: 'dev.coverdict.playground.CalculatorPseudoTestedTest',
						methodName: '<init>',
						lines: [12, 14].map((line) => ({ line, tests: ['dev.coverdict.playground.CalculatorPseudoTestedTest.[engine:junit-jupiter]/[class:dev.coverdict.playground.CalculatorPseudoTestedTest]/[method:squareHasNoAssertion()]'] })),
					},
					{
						className: 'dev.coverdict.playground.CalculatorPseudoTestedTest',
						methodName: 'squareHasNoAssertion',
						lines: [18, 19].map((line) => ({ line, tests: ['dev.coverdict.playground.CalculatorPseudoTestedTest.[engine:junit-jupiter]/[class:dev.coverdict.playground.CalculatorPseudoTestedTest]/[method:squareHasNoAssertion()]'] })),
					},
				],
				ambient: [],
			}],
		};
		setPerTestState({ moduleId: 'root', perTest: realPerTest, warnings: [] });
		const { document, workspaceRoot } = await openTestFile('CalculatorPseudoTestedTest');
		// A real run always carries fileCoverage (the extension passes
		// --file-coverage on every scan) - it is the authoritative listing of
		// which classes are production, and what lets the reverse index drop
		// the test class's own self-covering entries.
		setCoverageState({ ...STATE, workspaceRoot, fileCoverage: PRODUCTION_ONLY_FILE_COVERAGE });

		const provider = new LineTestsTreeProvider();
		provider.setActiveDocument(document);

		const roots = provider.getChildren();
		assert.ok(roots.every((n) => n.kind !== 'prodLine'), 'a test file must never render production-direction "Satır N" nodes');
		assert.equal(roots.length, 1);
		assert.equal(roots[0].kind, 'testMethod');
		if (roots[0].kind === 'testMethod') {
			assert.equal(roots[0].methodName, 'squareHasNoAssertion');
			// Only the production line it ran - never the test's own 12/14/18/19.
			assert.deepEqual(roots[0].refs.map((r) => r.line), [37]);
			assert.ok(roots[0].refs.every((r) => r.outerClassName === 'dev.coverdict.playground.Calculator'));
		}

		// The cursor-follow path must agree: there is no production line node to reveal in a test file.
		assert.equal(provider.nodeForLine(18), undefined);
	});

	/** The same fixture from the other side: opening the production class must still give the forward direction. */
	test('production file under sourceRoots renders the production direction even when test classes are in entries', async () => {
		setPerTestState({ moduleId: 'root', perTest: PER_TEST, warnings: [] });
		const { document, workspaceRoot } = await openProductionFile('Calculator');
		setCoverageState({ ...STATE, workspaceRoot });

		const provider = new LineTestsTreeProvider();
		provider.setActiveDocument(document);

		const roots = provider.getChildren();
		assert.equal(roots.length, 1);
		assert.equal(roots[0].kind, 'prodLine');
	});

	test('a Java file with no per-test evidence at all shows the collect hint, not a bare empty message', async () => {
		setPerTestState({ moduleId: 'root', perTest: PER_TEST, warnings: [] });
		const { document, workspaceRoot } = await openProductionFile('Untouched');
		setCoverageState({ ...STATE, workspaceRoot });

		const provider = new LineTestsTreeProvider();
		provider.setActiveDocument(document);

		const roots = provider.getChildren();
		assert.equal(roots.length, 2);
		assert.equal(roots[0].kind, 'empty');
		assert.equal(roots[1].kind, 'collectHint');
		assert.doesNotThrow(() => provider.getTreeItem(roots[1]));
	});
});
