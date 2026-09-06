import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { setCoverageState, setPerTestState, type CoverageState } from '../../model/store';
import { registerHoverProvider } from '../../ui/hoverProvider';
import type { Finding, MetricSet, ModuleInput, PerTestBlock } from '../../verdict/types';

const METRIC = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 };
const METRIC_SET: MetricSet = { 'jacoco-line': METRIC, 'strict-line': METRIC, 'sonar-compatible': METRIC };

/** Real shape from a live --per-test-target run (Faz 15 session): line 37's only covering test has no oracle finding against it. */
const PER_TEST: PerTestBlock = {
	engine: 'pitest',
	engineVersion: '1.15.8',
	modules: [{
		id: 'root',
		entries: [{
			className: 'dev.proofjava.playground.Calculator',
			methodName: 'square',
			lines: [{ line: 37, tests: ['[class:dev.proofjava.playground.CalculatorPseudoTestedTest]/[method:squareHasNoAssertion()]'] }],
		}],
		ambient: [],
	}],
};

const FINDINGS: readonly Finding[] = [{
	rule: 'NO_RECOGNIZED_ORACLE', confidence: 'HIGH', severity: 'WARNING', module: 'root',
	path: 'src/test/java/dev/proofjava/playground/CalculatorPseudoTestedTest.java', startLine: 16, endLine: 16,
	message: 'no oracle', suggestedAction: 'add one', fingerprint: 'f1',
	testMethod: 'dev.proofjava.playground.CalculatorPseudoTestedTest#squareHasNoAssertion()',
}];

/** Exactly the shape a real single-module run emits (`inputs.modules[0]`, verified 2026-08-28). */
const MODULES: readonly ModuleInput[] = [{
	id: 'root', root: '.', sourceRoots: ['src/main/java'], testRoots: ['src/test/java'],
}];

const STATE: Omit<CoverageState, 'workspaceRoot'> = {
	fileCoverage: undefined, overall: METRIC_SET,
	newCode: { status: 'unavailable_no_vcs' }, changedFiles: [], findings: FINDINGS, warnings: [],
	modules: MODULES,
};

/**
 * A real file on disk padded to 40 lines so line 37 is a valid hover
 * position - a fresh `package X; class Y {}` document is only 4 lines long.
 * Placed under a real `src/main/java` root inside its own workspace root:
 * since Faz 21 the hover picks its direction from `inputs.modules[]`, so the
 * file's actual location is part of what these tests exercise.
 */
async function openPaddedJavaFile(rootRelativeDir: string, packageName: string, className: string): Promise<{ document: vscode.TextDocument; workspaceRoot: string }> {
	const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-hoverProvider-'));
	const dir = path.join(workspaceRoot, ...rootRelativeDir.split('/'), ...packageName.split('.'));
	fs.mkdirSync(dir, { recursive: true });
	const filePath = path.join(dir, `${className}.java`);
	const body = `package ${packageName};\n\npublic class ${className} {\n` + '    // padding\n'.repeat(40) + '}\n';
	fs.writeFileSync(filePath, body, 'utf8');
	return { document: await vscode.workspace.openTextDocument(vscode.Uri.file(filePath)), workspaceRoot };
}

suite('Hover provider (Faz 15b)', () => {
	test('a false-green production line hover names the missing oracle', async () => {
		setPerTestState({ perTest: PER_TEST, warnings: [] });
		const { document, workspaceRoot } = await openPaddedJavaFile('src/main/java', 'dev.proofjava.playground', 'Calculator');
		setCoverageState({ ...STATE, workspaceRoot });

		const disposable = registerHoverProvider();
		try {
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
				'vscode.executeHoverProvider', document.uri, new vscode.Position(36, 0), // line 37, 0-based
			);
			assert.ok(hovers && hovers.length > 0, 'expected a hover on the false-green line');
			const text = hovers[0].contents.map((c) => (typeof c === 'string' ? c : (c as vscode.MarkdownString).value)).join('\n');
			assert.match(text, /oracle/i);
			assert.match(text, /squareHasNoAssertion/);
		} finally {
			disposable.dispose();
		}
	});

	test('a line with no per-test evidence at all produces no hover (no data, no claim)', async () => {
		setPerTestState({ perTest: PER_TEST, warnings: [] });
		const { document, workspaceRoot } = await openPaddedJavaFile('src/main/java', 'dev.proofjava.playground', 'Calculator');
		setCoverageState({ ...STATE, workspaceRoot });

		const disposable = registerHoverProvider();
		try {
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
				'vscode.executeHoverProvider', document.uri, new vscode.Position(9, 0), // line 10, no evidence for it
			);
			assert.ok(!hovers || hovers.length === 0);
		} finally {
			disposable.dispose();
		}
	});

	/**
	 * Faz 21: the hover had the same direction bug as the tree - because
	 * PIT's L2 collector writes test classes into `entries` too, a test file
	 * hit the production branch and returned `undefined` at the "known class,
	 * no evidence for this line" guard, so the reverse hover never ran on
	 * real data. Direction now comes from `inputs.modules[].testRoots`.
	 */
	test('a test file under testRoots gets the reverse hover, not the production one (Faz 16 madde 1)', async () => {
		const realPerTest: PerTestBlock = {
			engine: 'pitest',
			engineVersion: '1.15.8',
			modules: [{
				id: 'root',
				entries: [
					{
						className: 'dev.proofjava.playground.Calculator',
						methodName: 'square',
						lines: [{ line: 37, tests: ['dev.proofjava.playground.CalculatorPseudoTestedTest.[engine:junit-jupiter]/[class:dev.proofjava.playground.CalculatorPseudoTestedTest]/[method:squareHasNoAssertion()]'] }],
					},
					// Real data: the test class covers its own lines too.
					{
						className: 'dev.proofjava.playground.CalculatorPseudoTestedTest',
						methodName: 'squareHasNoAssertion',
						lines: [{ line: 4, tests: ['dev.proofjava.playground.CalculatorPseudoTestedTest.[engine:junit-jupiter]/[class:dev.proofjava.playground.CalculatorPseudoTestedTest]/[method:squareHasNoAssertion()]'] }],
					},
				],
				ambient: [],
			}],
		};
		setPerTestState({ perTest: realPerTest, warnings: [] });
		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-hoverProvider-'));
		const dir = path.join(workspaceRoot, 'src', 'test', 'java', 'dev', 'proofjava', 'playground');
		fs.mkdirSync(dir, { recursive: true });
		const filePath = path.join(dir, 'CalculatorPseudoTestedTest.java');
		fs.writeFileSync(filePath, 'package dev.proofjava.playground;\n\npublic class CalculatorPseudoTestedTest {\n    void squareHasNoAssertion() {}\n}\n', 'utf8');
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
		setCoverageState({
			...STATE,
			workspaceRoot,
			// Authoritative production listing - lets the reverse index drop the test class's own self-covering entry.
			fileCoverage: { files: [{ module: 'root', path: 'src/main/java/dev/proofjava/playground/Calculator.java', metrics: METRIC_SET, lines: [] }], excluded: [] },
		});

		const disposable = registerHoverProvider();
		try {
			// Cursor on the method name on line 4 (0-based 3), column inside `squareHasNoAssertion`.
			const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
				'vscode.executeHoverProvider', document.uri, new vscode.Position(3, 12),
			);
			assert.ok(hovers && hovers.length > 0, 'expected the reverse-direction hover on a test method');
			const text = hovers.map((h) => h.contents.map((c) => (typeof c === 'string' ? c : (c as vscode.MarkdownString).value)).join('\n')).join('\n');
			assert.match(text, /production lines/, 'must be the reverse hover, which names the production lines this test runs');
			assert.match(text, /Calculator\.java/);
		} finally {
			disposable.dispose();
		}
	});
});
