import * as assert from 'node:assert';
import * as vscode from 'vscode';

/**
 * Plan.md Bölüm 3's detection snippet, proven against a real running VS
 * Code rather than assumed from the .d.ts alone - the .d.ts only proves the
 * TypeScript *type* exists at the version @types/vscode was installed at
 * (Faz 0), not that the class is actually constructible at runtime in any
 * given build. This is the current real vscode-test download (checked
 * dynamically below, not hardcoded, so it stays true across
 * vscode-test upgrades); the engines.vscode floor (^1.88.0) itself is
 * still unverified against an old real install - see the plan's open risk 1.
 */
suite('Native Test Coverage API', () => {
	test('FileCoverage/StatementCoverage/BranchCoverage/TestRunProfileKind.Coverage all exist and are usable', () => {
		const v = vscode as unknown as Record<string, unknown>;
		assert.strictEqual(typeof v.FileCoverage, 'function');
		assert.strictEqual(typeof v.StatementCoverage, 'function');
		assert.strictEqual(typeof v.BranchCoverage, 'function');
		assert.notStrictEqual((v.TestRunProfileKind as Record<string, unknown>).Coverage, undefined);

		// Actually construct one, not just check the class exists.
		const statement = new vscode.StatementCoverage(true, new vscode.Position(0, 0));
		const uri = vscode.Uri.file(__filename);
		const fileCoverage = vscode.FileCoverage.fromDetails(uri, [statement]);
		assert.strictEqual(fileCoverage.uri.toString(), uri.toString());
	});
});
