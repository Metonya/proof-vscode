import * as assert from 'node:assert';
import * as vscode from 'vscode';

import { applyGutterCoverage, clearGutterCoverage, createGutterDecorationTypes } from '../../ui/gutterRenderer';

/**
 * Real Extension Host smoke test - what a plain node:test unit test cannot
 * prove (it never touches `vscode`): `createTextEditorDecorationType` and
 * `setDecorations` accept the shapes this module builds, against a real
 * open editor, without throwing. It cannot assert rendered colors - that
 * stays a manual check (see the plan's "Doğrulama" section).
 */
suite('Gutter renderer (Faz 9)', () => {
	test('createGutterDecorationTypes, applyGutterCoverage, and clearGutterCoverage all run against a real editor without throwing', async () => {
		const document = await vscode.workspace.openTextDocument({ content: 'line1\nline2\nline3\n', language: 'plaintext' });
		await vscode.window.showTextDocument(document);

		const types = createGutterDecorationTypes();
		try {
			assert.doesNotThrow(() => {
				applyGutterCoverage(types, '', {
					files: [{
						module: 'root',
						path: '',
						metrics: {
							'jacoco-line': { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 },
							'strict-line': { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 },
							'sonar-compatible': { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 },
						},
						lines: [[1, 0, 3, 0, 0], [2, 2, 3, 0, 0], [3, 2, 0, 0, 0]],
					}],
					excluded: [],
				});
			});
			assert.doesNotThrow(() => clearGutterCoverage(types));
			// Faz 14e: staleAbsolutePaths matching the open document's own path
			// must switch it into the "bayat" banner without throwing.
			assert.doesNotThrow(() => applyGutterCoverage(types, '', { files: [], excluded: [] }, new Set([document.uri.fsPath])));
			// Faz 15d: a falseGreenLinesByPath entry for a covered line must
			// route it into the "oracleless" bucket without throwing.
			assert.doesNotThrow(() => applyGutterCoverage(types, '', {
				files: [{
					module: 'root',
					path: '',
					metrics: {
						'jacoco-line': { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 },
						'strict-line': { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 },
						'sonar-compatible': { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 },
					},
					lines: [[1, 0, 3, 0, 0]],
				}],
				excluded: [],
			}, new Set(), new Map([['', new Set([1])]])));
		} finally {
			types.covered.dispose();
			types.partial.dispose();
			types.uncovered.dispose();
			types.oracleless.dispose();
			types.excluded.dispose();
			types.stale.dispose();
		}
	});

	/**
	 * Faz 31 (user request): `coverdict.colorblindMode` swaps the gutter's
	 * red/green pair (the classic red-green CVD confusion) for the
	 * Okabe-Ito palette - real color values are a manual check (see above),
	 * this only proves the raw-hex branch builds valid decoration types too.
	 */
	test('createGutterDecorationTypes(true) - colorblind palette - also builds valid decoration types', () => {
		const types = createGutterDecorationTypes(true);
		try {
			assert.ok(types.covered);
			assert.ok(types.partial);
			assert.ok(types.uncovered);
			assert.ok(types.oracleless);
		} finally {
			types.covered.dispose();
			types.partial.dispose();
			types.uncovered.dispose();
			types.oracleless.dispose();
			types.excluded.dispose();
			types.stale.dispose();
		}
	});
});
