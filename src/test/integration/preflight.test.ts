import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { detectRunTestsBuildTool, resolveEvidenceClasspaths, resolveRunTestsModuleScope } from '../../ui/preflight';

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

/**
 * Faz "Gradle support" G1: `resolveReportBinding`'s own `findFiles` glob
 * (`**\/{target/site/jacoco/jacoco.xml,build/reports/jacoco/test/jacocoTestReport.xml}`)
 * is the one part of this change that isn't provable by a plain unit test -
 * VS Code's own glob engine has to actually honor the `{a,b}` brace syntax
 * against a real Extension Host filesystem. This proves that directly,
 * independent of `resolveReportBinding`'s own (larger, unrelated) UI flow.
 */
suite('Gradle jacocoTestReport.xml discovery glob (Faz "Gradle support" G1)', () => {
	test('the brace-expansion glob finds both a Maven jacoco.xml and a Gradle jacocoTestReport.xml in the same workspace', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-gradle-glob-'));
		const mavenReport = path.join(root, 'target', 'site', 'jacoco', 'jacoco.xml');
		const gradleReport = path.join(root, 'core', 'build', 'reports', 'jacoco', 'test', 'jacocoTestReport.xml');
		fs.mkdirSync(path.dirname(mavenReport), { recursive: true });
		fs.mkdirSync(path.dirname(gradleReport), { recursive: true });
		fs.writeFileSync(mavenReport, '<report/>', 'utf8');
		fs.writeFileSync(gradleReport, '<report/>', 'utf8');

		const found = await vscode.workspace.findFiles(
			new vscode.RelativePattern(makeWorkspaceFolder(root), '**/{target/site/jacoco/jacoco.xml,build/reports/jacoco/test/jacocoTestReport.xml}'),
			'**/node_modules/**',
			50,
		);
		// Windows drive letters can come back from VS Code's own URI handling
		// in either case (a harness quirk, not a glob-matching one) - lower
		// both sides so the comparison is about which files were found, not
		// which case a drive letter happened to render in this run.
		const normalize = (p: string) => p.toLowerCase();
		const foundPaths = found.map((uri) => normalize(uri.fsPath)).sort();
		assert.deepEqual(foundPaths, [mavenReport, gradleReport].map(normalize).sort());
	});
});

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

/**
 * Faz "Gradle support" G2: which "Run Tests" flow applies - same priority
 * the CLI's own DoctorCommand.discoverModules uses (Maven first, Gradle
 * only when no root pom.xml exists), so the button/offer-to-run-tests flow
 * never disagrees with what `doctor` itself would have discovered.
 */
suite('detectRunTestsBuildTool (Faz "Gradle support" G2)', () => {
	function writeGradlew(root: string): void {
		fs.mkdirSync(root, { recursive: true });
		fs.writeFileSync(path.join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), '', 'utf8');
	}

	test('a root pom.xml means Maven, even when a Gradle wrapper also happens to be present', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-buildtool-both-'));
		writePom(root, '.');
		writeGradlew(root);

		assert.equal(detectRunTestsBuildTool(makeWorkspaceFolder(root)), 'maven');
	});

	test('a committed Gradle wrapper with no root pom.xml means Gradle', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-buildtool-gradle-'));
		writeGradlew(root);

		assert.equal(detectRunTestsBuildTool(makeWorkspaceFolder(root)), 'gradle');
	});

	test('neither a root pom.xml nor a committed wrapper means undefined - never guessed at', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-buildtool-neither-'));
		fs.mkdirSync(root, { recursive: true });

		assert.equal(detectRunTestsBuildTool(makeWorkspaceFolder(root)), undefined);
	});

	test('a Gradle project with no committed wrapper (bare gradle on PATH only) is not detected - this command never runs a bare gradle', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-buildtool-nowrapper-'));
		fs.mkdirSync(root, { recursive: true });
		fs.writeFileSync(path.join(root, 'build.gradle.kts'), '', 'utf8');

		assert.equal(detectRunTestsBuildTool(makeWorkspaceFolder(root)), undefined);
	});
});

/**
 * Faz "Gradle support" G2: `resolveEvidenceClasspaths` used to look for
 * L2/L3 classpath lists under `target/proof-*-classpath.txt` unconditionally
 * - correct for Maven, but `GradleClasspathFixer.java`'s own output lands
 * under `build/proof-*-classpath.txt`, so on a Gradle project this always
 * reported "missing" even right after a real `doctor --fix` had just
 * written the file, then tried to run `doctor --fix` again pointlessly.
 * This exercises only the fast path (files already on disk) - it does not
 * need a real CLI jar, since that path never spawns one.
 */
suite('resolveEvidenceClasspaths looks in the right build-output directory (Faz "Gradle support" G2)', () => {
	function fakeOutputChannel(): vscode.OutputChannel {
		return { appendLine: () => undefined } as unknown as vscode.OutputChannel;
	}

	test('a Gradle project finds its classpath list under build/, not target/', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-classpath-gradle-'));
		fs.writeFileSync(path.join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'), '', 'utf8');
		fs.mkdirSync(path.join(root, 'build'), { recursive: true });
		fs.writeFileSync(path.join(root, 'build', 'proof-per-test-classpath.txt'), path.join(root, 'build', 'classes', 'java', 'main'), 'utf8');

		const classpaths = await resolveEvidenceClasspaths(makeWorkspaceFolder(root), 'unused.jar', 'java', fakeOutputChannel(), [{ id: 'root', root: '.' }], 'perTest');

		assert.deepEqual(classpaths, [{ moduleId: 'root', path: 'build/proof-per-test-classpath.txt' }]);
	});

	test('a Maven project still finds its classpath list under target/, unchanged', async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-classpath-maven-'));
		writePom(root, '.');
		fs.mkdirSync(path.join(root, 'target'), { recursive: true });
		fs.writeFileSync(path.join(root, 'target', 'proof-per-test-classpath.txt'), path.join(root, 'target', 'classes'), 'utf8');

		const classpaths = await resolveEvidenceClasspaths(makeWorkspaceFolder(root), 'unused.jar', 'java', fakeOutputChannel(), [{ id: 'root', root: '.' }], 'perTest');

		assert.deepEqual(classpaths, [{ moduleId: 'root', path: 'target/proof-per-test-classpath.txt' }]);
	});
});
