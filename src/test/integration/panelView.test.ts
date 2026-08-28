import * as assert from 'node:assert';

import { showLineTestsPanel } from '../../ui/panelView';

/**
 * A real Extension Host smoke test for F3's panel - `vscode.window.
 * createWebviewPanel` and setting `.webview.html` actually work against
 * every `PanelContent` shape without throwing. A plain node:test unit test
 * cannot prove this (it never touches `vscode`).
 */
suite('Line tests panel (F3)', () => {
	test('every PanelContent kind renders without throwing', () => {
		assert.doesNotThrow(() => showLineTestsPanel({ kind: 'noWorkspace' }));
		assert.doesNotThrow(() => showLineTestsPanel({ kind: 'noActiveEditor' }));
		assert.doesNotThrow(() => showLineTestsPanel({ kind: 'truncated', message: 'PIT ran out of budget' }));
		assert.doesNotThrow(() => showLineTestsPanel({ kind: 'noPerTestData' }));
		assert.doesNotThrow(() => showLineTestsPanel({ kind: 'noChangedTargets' }));
		assert.doesNotThrow(() => showLineTestsPanel({ kind: 'classOutOfScope', className: 'dev.coverdict.playground.Untouched' }));
		assert.doesNotThrow(() => showLineTestsPanel({
			kind: 'lines',
			fileName: 'src/main/java/dev/coverdict/playground/Calculator.java',
			className: 'dev.coverdict.playground.Calculator',
			linesToTests: new Map([[7, ['CalcTest#addsTwoNumbers()']], [26, ['CalcTest#a()', 'CalcTest#b()']]]),
			ambientLinesToTests: new Map([[3, ['CalcTest#addsTwoNumbers()']]]),
		}));
		// Faz 14c: a real @ParameterizedTest UniqueId shape (with invocation),
		// a "more than 5 tests" line (collapses into <details>), and an
		// unrecognized id side by side in one line, all in one render.
		assert.doesNotThrow(() => showLineTestsPanel({
			kind: 'lines',
			fileName: 'src/main/java/dev/coverdict/playground/Calculator.java',
			className: 'dev.coverdict.playground.Calculator',
			linesToTests: new Map([
				[4, [
					'[class:dev.coverdict.playground.CalculatorParameterizedTest]/[test-template:add(int, int, int)]/[test-template-invocation:#1]',
					'[class:dev.coverdict.playground.CalculatorParameterizedTest]/[test-template:add(int, int, int)]/[test-template-invocation:#2]',
					'CalcTest#a()', 'CalcTest#b()', 'CalcTest#c()', 'CalcTest#d()', 'CalcTest#e()',
					'SomeWeirdEngine::totallyUnknownFormat',
				]],
			]),
			ambientLinesToTests: new Map(),
		}));
	});
});
