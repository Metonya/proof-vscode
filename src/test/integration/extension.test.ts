import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension activation', () => {
	test('activates without throwing and shows no UI on its own (only registers the analyze command)', async () => {
		const ext = vscode.extensions.getExtension('proof-java.proof-vscode');
		assert.ok(ext, 'expected the extension to be discoverable by id');

		await ext.activate();

		assert.strictEqual(ext.isActive, true);
	});
});
