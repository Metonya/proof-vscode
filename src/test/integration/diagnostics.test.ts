import * as assert from 'node:assert';
import * as vscode from 'vscode';

import { clearFindings, createDiagnosticCollection, publishFindings } from '../../ui/diagnostics';
import type { Finding } from '../../verdict/types';

const FINDING: Finding = {
	rule: 'NO_RECOGNIZED_ORACLE',
	severity: 'WARNING',
	confidence: 'HIGH',
	module: 'root',
	path: 'src/test/java/CalcTest.java',
	startLine: 10,
	endLine: 10,
	message: 'no recognized oracle',
	suggestedAction: 'add an assertion',
	fingerprint: 'abc123',
	testMethod: 'subtractHasNoAssertion',
};

/**
 * Real Extension Host smoke test for Faz 11a: `publishFindings` produces a
 * real `vscode.Diagnostic` at the right URI/range and `clearFindings`
 * actually empties the collection - both real `DiagnosticCollection`
 * behavior a plain node:test cannot exercise.
 */
suite('Diagnostics (Faz 11a)', () => {
	test('publishFindings sets one diagnostic at the finding path, clearFindings empties it', () => {
		const collection = createDiagnosticCollection();
		try {
			publishFindings(collection, 'C:/repo', [FINDING]);

			const uri = vscode.Uri.file('C:/repo/src/test/java/CalcTest.java');
			const diagnostics = collection.get(uri) ?? [];
			assert.equal(diagnostics.length, 1);
			assert.equal(diagnostics[0].severity, vscode.DiagnosticSeverity.Warning);
			assert.equal(diagnostics[0].range.start.line, 9);
			assert.equal(diagnostics[0].source, 'proof-java');

			clearFindings(collection);
			assert.deepEqual(collection.get(uri) ?? [], []);
		} finally {
			collection.dispose();
		}
	});

	/**
	 * Faz 22: eskiden `message` CLI'ın ham İngilizce cümlesini ve
	 * `suggestedAction`'ı da içeriyordu - bazı VS Code çatallarında satır
	 * sonuna aynen basılan bu metin üç dil karışıp ekranın dışına
	 * taşıyordu. Artık yalnızca Türkçe başlık + varsa metot adı.
	 */
	test('diagnostic message is the short Turkish title plus the method, not the raw English CLI text', () => {
		const collection = createDiagnosticCollection();
		try {
			publishFindings(collection, 'C:/repo', [FINDING]);
			const uri = vscode.Uri.file('C:/repo/src/test/java/CalcTest.java');
			const message = (collection.get(uri) ?? [])[0].message;
			assert.equal(message, 'Doğrulama yok: subtractHasNoAssertion');
			assert.ok(!message.includes(FINDING.message), 'the raw CLI sentence must not be duplicated here - it already lives in the Test Kalitesi tree tooltip');
			assert.ok(!message.includes(FINDING.suggestedAction), 'suggestedAction must not be duplicated here either');
		} finally {
			collection.dispose();
		}
	});

	test('a finding with neither productionMethod nor testMethod still gets a diagnostic - the short title alone', () => {
		const collection = createDiagnosticCollection();
		try {
			publishFindings(collection, 'C:/repo', [{ ...FINDING, testMethod: undefined }]);
			const uri = vscode.Uri.file('C:/repo/src/test/java/CalcTest.java');
			assert.equal((collection.get(uri) ?? [])[0].message, 'Doğrulama yok');
		} finally {
			collection.dispose();
		}
	});
});
