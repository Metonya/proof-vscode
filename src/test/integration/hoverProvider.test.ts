import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { setCoverageState, setPerTestState, type CoverageState } from '../../model/store';
import { registerHoverProvider } from '../../ui/hoverProvider';
import type { Finding, MetricSet, PerTestBlock } from '../../verdict/types';

const METRIC = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 };
const METRIC_SET: MetricSet = { 'jacoco-line': METRIC, 'strict-line': METRIC, 'sonar-compatible': METRIC };

/** Real shape from a live --per-test-target run (Faz 15 session): line 37's only covering test has no oracle finding against it. */
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

/** A real file on disk padded to 40 lines so line 37 is a valid hover position - a fresh `package X; class Y {}` document is only 4 lines long. */
async function openPaddedJavaFile(packageName: string, className: string): Promise<vscode.TextDocument> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-hoverProvider-'));
	const filePath = path.join(dir, `${className}.java`);
	const body = `package ${packageName};\n\npublic class ${className} {\n` + '    // padding\n'.repeat(40) + '}\n';
	fs.writeFileSync(filePath, body, 'utf8');
	return vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
}

suite('Hover provider (Faz 15b)', () => {
	test('a false-green production line hover names the missing oracle', async () => {
		setPerTestState({ moduleId: 'root', perTest: PER_TEST, warnings: [] });
		setCoverageState(STATE);

		const document = await openPaddedJavaFile('dev.coverdict.playground', 'Calculator');
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
		setPerTestState({ moduleId: 'root', perTest: PER_TEST, warnings: [] });
		setCoverageState(STATE);

		const document = await openPaddedJavaFile('dev.coverdict.playground', 'Calculator');
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
});
