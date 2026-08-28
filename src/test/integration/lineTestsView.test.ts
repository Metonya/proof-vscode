import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { setCoverageState, setPerTestState, type CoverageState } from '../../model/store';
import { LineTestsTreeProvider } from '../../ui/treeViews/lineTestsView';
import type { Finding, MetricSet, PerTestBlock } from '../../verdict/types';

const METRIC = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 };
const METRIC_SET: MetricSet = { 'jacoco-line': METRIC, 'strict-line': METRIC, 'sonar-compatible': METRIC };

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

const STATE: CoverageState = {
	workspaceRoot: 'C:/repo', fileCoverage: undefined, overall: METRIC_SET,
	newCode: { status: 'unavailable_no_vcs' }, changedFiles: [], findings: FINDINGS, warnings: [],
};

/** Opens a real temp .java file on disk - `document.fileName` needs a real `.java` basename for `detectClassName` to resolve correctly, which a pure in-memory untitled document does not provide. */
async function openJavaFile(packageName: string, className: string): Promise<vscode.TextDocument> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-lineTestsView-'));
	const filePath = path.join(dir, `${className}.java`);
	fs.writeFileSync(filePath, `package ${packageName};\n\npublic class ${className} {\n}\n`, 'utf8');
	return vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
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
		setCoverageState(STATE);

		const document = await openJavaFile('dev.coverdict.playground', 'Calculator');
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

	test('test file (reverse direction): test-method node -> production-line leaf', async () => {
		setPerTestState({ moduleId: 'root', perTest: PER_TEST, warnings: [] });
		setCoverageState(STATE);

		const document = await openJavaFile('dev.coverdict.playground', 'CalculatorPseudoTestedTest');
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

	test('a Java file with no per-test evidence at all shows the collect hint, not a bare empty message', async () => {
		setPerTestState({ moduleId: 'root', perTest: PER_TEST, warnings: [] });
		setCoverageState(STATE);

		const document = await openJavaFile('dev.coverdict.playground', 'Untouched');
		const provider = new LineTestsTreeProvider();
		provider.setActiveDocument(document);

		const roots = provider.getChildren();
		assert.equal(roots.length, 2);
		assert.equal(roots[0].kind, 'empty');
		assert.equal(roots[1].kind, 'collectHint');
		assert.doesNotThrow(() => provider.getTreeItem(roots[1]));
	});
});
