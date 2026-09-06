import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { buildMavenTestArgs, type MavenTestPhase } from '../cli/mavenTestCommand';
import { inspectPom } from '../cli/pomInspector';
import { toRepoRelativePosix } from '../cli/reportDiscovery';
import { run } from '../cli/runner';
import { resolveWorkspaceEnv } from './workspaceEnv';

/**
 * Faz 30 (§7.8): "if there is no JaCoCo report, offer to run tests" -
 * the user's explicit ask, and the honest answer to the gson dogfood's
 * four manual fixes (JDK range, no jacoco plugin, `test` vs `verify`,
 * surefire clobbering the agent). Runs Maven as a **visible** `vscode.Task`
 * in a real terminal - deliberately not a hidden spawn, so Maven's own
 * errors are seen directly and the user can edit/re-run by hand. Never
 * `mvn clean` (Faz 19's classpath-list deletion trap) and never `-q`
 * (the whole point is seeing what Maven says).
 */

interface ReactorPomFacts {
	hasJacocoPlugin: boolean;
	literalArgLine: { file: string; line: number; text: string } | undefined;
}

async function scanPoms(folder: vscode.WorkspaceFolder): Promise<ReactorPomFacts> {
	const pomUris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/pom.xml'), '**/node_modules/**', 100);
	let hasJacocoPlugin = false;
	let literalArgLine: { file: string; line: number; text: string } | undefined;
	for (const uri of pomUris) {
		let xml: string;
		try {
			xml = fs.readFileSync(uri.fsPath, 'utf8');
		} catch {
			continue;
		}
		const facts = inspectPom(xml);
		hasJacocoPlugin ||= facts.hasJacocoPlugin;
		if (facts.literalArgLine && !literalArgLine) {
			literalArgLine = { file: toRepoRelativePosix(uri.fsPath, folder.uri.fsPath), line: facts.literalArgLine.line, text: facts.literalArgLine.text };
		}
	}
	return { hasJacocoPlugin, literalArgLine };
}

function resolveMavenExecutable(folder: vscode.WorkspaceFolder): string {
	const configured = vscode.workspace.getConfiguration('proof', folder).get<string>('mavenExecutable');
	return configured || (process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
}

export interface MavenTaskResult {
	success: boolean;
	/** Combined stdout+stderr, so a failure can be handed to `cli/mavenErrorInterpreter.ts` for an honest cause instead of a bare "failed". */
	capturedOutput: string;
}

/**
 * Shared by every visible-Task runner in this file - one dedicated
 * terminal, no `-q`, no `clean` (Faz 19's classpath-list deletion trap).
 *
 * Faz 31: rebuilt on `vscode.CustomExecution`/`Pseudoterminal` instead of
 * `ShellExecution` - a plain `ShellExecution` gives VS Code no way to hand
 * its output back to the extension, so a real Maven failure (the gson
 * `test-jpms` JPMS error) could only ever be shown as a bare "Maven başarısız
 * oldu - terminaldeki çıktıya bakın", never interpreted. The pty relays
 * `cli/runner.ts`'s own `run()` (already used for the CLI jar and `doctor`,
 * already handles line buffering and tree-kill cancellation) into the visible
 * terminal verbatim, byte for byte, while also capturing it into a string.
 */
async function runVisibleMavenTask(folder: vscode.WorkspaceFolder, output: vscode.OutputChannel, taskKind: string, label: string, args: readonly string[]): Promise<MavenTaskResult> {
	const mavenExecutable = resolveMavenExecutable(folder);
	output.appendLine(`Proof: ${mavenExecutable} ${args.join(' ')} (${folder.uri.fsPath})`);

	const writeEmitter = new vscode.EventEmitter<string>();
	const closeEmitter = new vscode.EventEmitter<number>();
	let cancelProcess: (() => void) | undefined;
	let resolveDone: ((result: { exitCode: number | null; capturedOutput: string }) => void) | undefined;
	const done = new Promise<{ exitCode: number | null; capturedOutput: string }>((resolve) => {
		resolveDone = resolve;
	});

	const pty: vscode.Pseudoterminal = {
		onDidWrite: writeEmitter.event,
		onDidClose: closeEmitter.event,
		open: () => {
			const handle = run({
				javaExecutable: mavenExecutable,
				args: [...args],
				cwd: folder.uri.fsPath,
				shell: true,
				env: resolveWorkspaceEnv(folder),
				onStdoutLine: (line) => writeEmitter.fire(`${line}\r\n`),
				onStderrLine: (line) => writeEmitter.fire(`${line}\r\n`),
			});
			cancelProcess = handle.cancel;
			void handle.result.then((result) => {
				const exitCode = result.exitCode ?? 1;
				closeEmitter.fire(exitCode);
				resolveDone?.({ exitCode: result.exitCode, capturedOutput: result.stdout + result.stderr });
			});
		},
		close: () => cancelProcess?.(),
	};

	const task = new vscode.Task(
		{ type: 'proof-java', kind: taskKind },
		folder,
		label,
		'proof-java',
		new vscode.CustomExecution(() => Promise.resolve(pty)),
	);
	task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };
	await vscode.tasks.executeTask(task);

	const { exitCode, capturedOutput } = await done;
	return { success: exitCode === 0, capturedOutput };
}

/**
 * The fix for `unresolvedReactorSibling` (D-67, `cli/mavenErrorInterpreter.ts`):
 * a reactor sibling module has never been installed to `~/.m2`, so
 * `dependency:build-classpath` cannot resolve it. `-DskipTests` because this
 * run's only purpose is populating the local repo, not verifying anything.
 */
export async function runMavenInstallTask(folder: vscode.WorkspaceFolder, output: vscode.OutputChannel): Promise<MavenTaskResult> {
	return runVisibleMavenTask(folder, output, 'installSkipTests', 'mvn install -DskipTests', ['-B', 'install', '-DskipTests']);
}

/**
 * `undefined` return means the task never ran at all (argLine modal
 * declined, or the user opened the pom instead) - distinct from `false`
 * (the task ran and Maven itself failed or was cancelled).
 *
 * `moduleRoots` (Faz 31): scopes the build to already-bound module(s) via
 * `-pl ... -am` when the caller has them (a re-run after a scan already
 * happened) - real gson testing found a whole-reactor run pulling in
 * sibling modules proof-java never needed (native-image, ProGuard-obfuscated
 * tests, JPMS) whose own fragility has nothing to do with the module being
 * analyzed. The very first run (no scan yet) has nothing to scope to and
 * stays whole-reactor - guessing a module here would be a guess.
 */
export async function runTestsTask(folder: vscode.WorkspaceFolder, output: vscode.OutputChannel, moduleRoots?: readonly string[]): Promise<MavenTaskResult | undefined> {
	const facts = await scanPoms(folder);

	if (facts.literalArgLine) {
		const choice = await vscode.window.showWarningMessage(
			`Proof: the surefire configuration in ${facts.literalArgLine.file} (line ${facts.literalArgLine.line}) writes <argLine> as a literal string.`,
			{
				modal: true,
				detail: 'When the JaCoCo agent is bound from the command line, this line drops the agent - no jacoco.exec is produced, no coverage data comes out. '
					+ 'This can\'t be fixed from the command line (-DargLine=... has no effect, because the pom\'s <configuration><argLine> always wins). '
					+ `You need to edit the line in the pom to include @{argLine}, e.g.: <argLine>@{argLine} ${facts.literalArgLine.text.replaceAll(/<\/?argLine>/g, '')}</argLine>`,
			},
			'Open pom.xml',
			'Run Anyway',
		);
		if (choice === 'Open pom.xml') {
			const uri = vscode.Uri.file(path.join(folder.uri.fsPath, facts.literalArgLine.file));
			const selection = new vscode.Range(facts.literalArgLine.line - 1, 0, facts.literalArgLine.line - 1, 0);
			await vscode.window.showTextDocument(uri, { selection });
			return undefined;
		}
		if (choice !== 'Run Anyway') {
			return undefined;
		}
	}

	const config = vscode.workspace.getConfiguration('proof', folder);
	const phase = (config.get<MavenTestPhase>('testCommandPhase')) || 'test';
	const jacocoPluginVersion = config.get<string>('jacocoPluginVersion') || '0.8.13';
	const args = buildMavenTestArgs({ phase, injectJacocoGoals: !facts.hasJacocoPlugin, jacocoPluginVersion, moduleRoots });
	return runVisibleMavenTask(folder, output, 'runTests', 'Run Tests (JaCoCo)', args);
}
