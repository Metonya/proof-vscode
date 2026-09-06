import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { resolveRunTestsModuleScope } from '../../ui/preflight';

/**
 * Faz 31: the real fix behind the gson `test-jpms` failure - a first-ever
 * "Testleri Çalıştır" click had no way to know which module(s) the user
 * cared about, so it always built the whole reactor, including sibling
 * modules proof-java never needed (JPMS/native-image/ProGuard, each with its
 * own unrelated toolchain requirements). `resolveRunTestsModuleScope`
 * decides the scope *before* ever offering to run tests: 0/1 module needs no
 * decision, an unambiguous active-file signal scopes silently, otherwise a
 * real multi-select prompt (never a single "pick one" - the pattern the
 * user rejected earlier was for a different question, "which report to
 * bind", where every candidate equally belonged).
 */

function makeWorkspaceFolder(root: string): vscode.WorkspaceFolder {
	return { uri: vscode.Uri.file(root), name: path.basename(root), index: 0 };
}

function writePom(root: string, relativeDir: string): void {
	const dir = relativeDir === '.' ? root : path.join(root, ...relativeDir.split('/'));
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'pom.xml'), '<project></project>', 'utf8');
}

async function openJavaFile(root: string, relativeDir: string, packageName: string, className: string): Promise<vscode.TextDocument> {
	const dir = path.join(root, ...relativeDir.split('/'), ...packageName.split('.'));
	fs.mkdirSync(dir, { recursive: true });
	const filePath = path.join(dir, `${className}.java`);
	fs.writeFileSync(filePath, `package ${packageName};\n\npublic class ${className} {\n}\n`, 'utf8');
	return vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
}

suite('resolveRunTestsModuleScope (Faz 31)', () => {
	test('a single pom.xml (no real scoping decision) never prompts, returns undefined moduleRoots', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-preflight-single-'));
		writePom(root, '.');
		const scope = await resolveRunTestsModuleScope(makeWorkspaceFolder(root));
		assert.deepEqual(scope, { moduleRoots: undefined });
	});

	test('multiple modules, active Java file under one of them, scopes silently to it - no prompt', async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-preflight-active-'));
		writePom(root, '.');
		writePom(root, 'gson');
		writePom(root, 'extras');
		const doc = await openJavaFile(root, 'gson/src/main/java', 'com.google.gson', 'Gson');
		await vscode.window.showTextDocument(doc);

		const scope = await resolveRunTestsModuleScope(makeWorkspaceFolder(root));
		assert.deepEqual(scope, { moduleRoots: ['gson'] });

		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('multiple modules, no active document, shows a multi-select prompt with every module checked by default', async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-preflight-multi-'));
		writePom(root, '.');
		writePom(root, 'gson');
		writePom(root, 'test-jpms');

		const originalShowQuickPick = vscode.window.showQuickPick;
		let capturedOptions: vscode.QuickPickOptions | undefined;
		let capturedItems: readonly (vscode.QuickPickItem & { moduleRoot: string })[] | undefined;
		// @ts-expect-error - monkey-patching for the duration of this test, restored in finally
		vscode.window.showQuickPick = async (items: readonly (vscode.QuickPickItem & { moduleRoot: string })[], options: vscode.QuickPickOptions) => {
			capturedItems = items;
			capturedOptions = options;
			return items; // simulate "confirm with everything checked" (the default)
		};
		try {
			const scope = await resolveRunTestsModuleScope(makeWorkspaceFolder(root));
			assert.equal(capturedOptions?.canPickMany, true, 'must be a multi-select, never the single-pick pattern the user rejected');
			assert.equal(capturedItems?.length, 3);
			assert.ok(capturedItems?.every((i) => i.picked === true), 'every module must default to checked - unchanged behavior if the user just confirms');
			// Confirming with everything checked is equivalent to no scoping at all.
			assert.deepEqual(scope, { moduleRoots: undefined });
		} finally {
			vscode.window.showQuickPick = originalShowQuickPick;
		}
	});

	test('multiple modules, user unchecks one in the prompt - scopes to only what stayed checked', async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-preflight-partial-'));
		writePom(root, '.');
		writePom(root, 'gson');
		writePom(root, 'test-jpms');

		const originalShowQuickPick = vscode.window.showQuickPick;
		// @ts-expect-error - monkey-patching for the duration of this test, restored in finally
		vscode.window.showQuickPick = async (items: readonly (vscode.QuickPickItem & { moduleRoot: string })[]) => items.filter((i) => i.moduleRoot !== 'test-jpms');
		try {
			const scope = await resolveRunTestsModuleScope(makeWorkspaceFolder(root));
			// The root '.' pom is itself a discovered module and stays checked - only test-jpms was explicitly unchecked.
			assert.deepEqual(scope, { moduleRoots: ['.', 'gson'] });
		} finally {
			vscode.window.showQuickPick = originalShowQuickPick;
		}
	});

	test('multiple modules, user dismisses the prompt (Escape) - returns undefined entirely, never falls back to running everything silently', async () => {
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-preflight-cancel-'));
		writePom(root, '.');
		writePom(root, 'gson');
		writePom(root, 'test-jpms');

		const originalShowQuickPick = vscode.window.showQuickPick;
		vscode.window.showQuickPick = async () => undefined;
		try {
			const scope = await resolveRunTestsModuleScope(makeWorkspaceFolder(root));
			assert.equal(scope, undefined, 'a dismissed prompt must mean "do not run" - distinct from a confirmed empty selection or "run everything"');
		} finally {
			vscode.window.showQuickPick = originalShowQuickPick;
		}
	});
});
