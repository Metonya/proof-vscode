import * as assert from 'node:assert';
import * as vscode from 'vscode';

import { applyFallbackCoverage, clearFallbackCoverage, createFallbackDecorationTypes } from '../../ui/decorationFallback';

/**
 * A real Extension Host smoke test for F7's fallback renderer - what a
 * plain node:test unit test cannot prove (it never touches `vscode`):
 * `vscode.window.createTextEditorDecorationType` and `setDecorations`
 * actually accept the shapes this module builds, against a real open
 * editor, without throwing. It cannot assert the rendered *colors* -
 * that stays a manual-checklist item (Plan.md Bölüm 6).
 */
suite('Decoration fallback (F7)', () => {
	test('createFallbackDecorationTypes, applyFallbackCoverage, and clearFallbackCoverage all run against a real editor without throwing', async () => {
		const document = await vscode.workspace.openTextDocument({ content: 'line1\nline2\nline3\n', language: 'plaintext' });
		await vscode.window.showTextDocument(document);

		const types = createFallbackDecorationTypes();
		try {
			assert.doesNotThrow(() => {
				applyFallbackCoverage(types, '', {
					files: [{
						module: 'root',
						path: '', // matches the untitled document's own empty-ish path resolution path is irrelevant here - the point is setDecorations does not throw for a non-matching file either
						metrics: {
							'jacoco-line': { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 },
							'strict-line': { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 },
							'sonar-compatible': { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 },
						},
						lines: [[1, 0, 3, 0, 0], [2, 2, 3, 0, 0], [3, 2, 0, 0, 0]],
					}],
					excluded: [],
				}, 'branch-approximation');
			});
			assert.doesNotThrow(() => clearFallbackCoverage(types));
		} finally {
			types.covered.dispose();
			types.partial.dispose();
			types.uncovered.dispose();
		}
	});
});
