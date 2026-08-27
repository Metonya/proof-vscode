import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension activation', () => {
	test('activates without throwing and registers no visible UI yet (Faz 4)', async () => {
		const ext = vscode.extensions.getExtension('coverdict.coverdict-vscode');
		assert.ok(ext, 'expected the extension to be discoverable by id');

		await ext.activate();

		assert.strictEqual(ext.isActive, true);
	});
});
