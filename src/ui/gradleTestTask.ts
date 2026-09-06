import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { buildGradleTestArgs, unsafeModuleRoots } from '../cli/gradleTestCommand';
import { run } from '../cli/runner';
import { resolveWorkspaceEnv } from './workspaceEnv';

/**
 * Gradle counterpart of `mavenTestTask.ts`'s "Run Tests" - the same "if
 * there is no JaCoCo report, offer to run tests" ask, for a Gradle
 * workspace. Deliberately narrower than the Maven side: no pom-inspection
 * step to inject a missing jacoco plugin (there is no safe repo-external
 * way to do that for Gradle the way `-Dgoal=...` injects a Maven plugin
 * goal from the command line), and no argLine-style literal-config
 * detection - `doctor`'s own Gradle hint (DoctorCommand.java) already
 * tells the user to add `reports { xml.required.set(true) }` by hand if
 * XML output is off, and that is the one Gradle-specific setup gap this
 * command can't paper over.
 *
 * Only ever runs a workspace's own committed wrapper (`gradlew`/
 * `gradlew.bat`), never a bare `gradle` on PATH - same discipline
 * `GradleClient.java` documents on the CLI side: the wrapper pins the
 * exact Gradle version the project was actually built with.
 */

export interface GradleTaskResult {
	success: boolean;
	/** Combined stdout+stderr - no Gradle-specific error interpreter exists yet (unlike `cli/mavenErrorInterpreter.ts`), so callers just show it as-is or point at the terminal. */
	capturedOutput: string;
}

/** @return the workspace's own committed wrapper script, or undefined if none is committed - this command never falls back to a bare 'gradle' on PATH. */
export function resolveGradleWrapper(folder: vscode.WorkspaceFolder): string | undefined {
	const script = process.platform === 'win32' ? 'gradlew.bat' : 'gradlew';
	const full = path.join(folder.uri.fsPath, script);
	return fs.existsSync(full) ? full : undefined;
}

/** Same visible-Task/Pseudoterminal shape as `mavenTestTask.ts`'s `runVisibleMavenTask` - one dedicated terminal, real Gradle output relayed verbatim, never parsed for control flow. */
async function runVisibleGradleTask(folder: vscode.WorkspaceFolder, output: vscode.OutputChannel, wrapper: string, taskKind: string, label: string, args: readonly string[]): Promise<GradleTaskResult> {
	output.appendLine(`Proof: ${wrapper} ${args.join(' ')} (${folder.uri.fsPath})`);

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
				javaExecutable: wrapper,
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
 * `undefined` means the task never ran at all (no wrapper committed) -
 * distinct from `false` (the task ran and Gradle itself failed or was
 * cancelled), same contract `mavenTestTask.ts#runTestsTask` uses.
 *
 * `moduleRoots` is the scope decided by `ui/preflight.ts`'s
 * `resolveRunTestsModuleScope`, exactly as on the Maven side; `undefined`
 * runs the whole build.
 */
export async function runGradleTestsTask(folder: vscode.WorkspaceFolder, output: vscode.OutputChannel, moduleRoots?: readonly string[]): Promise<GradleTaskResult | undefined> {
	const wrapper = resolveGradleWrapper(folder);
	if (!wrapper) {
		vscode.window.showErrorMessage('Proof: no Gradle wrapper (gradlew) found at the workspace root - proof-java only ever runs '
			+ 'a project\'s own committed wrapper, never a bare \'gradle\' on PATH.');
		return undefined;
	}

	// A module root that cannot be passed as a shell-safe argument drops
	// scoping for the whole run (see `cli/gradleTestCommand.ts`) - say so,
	// rather than letting the user believe the narrower run they picked is
	// the one that happened.
	const unsafe = unsafeModuleRoots(moduleRoots);
	if (unsafe.length > 0) {
		vscode.window.showWarningMessage(`Proof: running the whole Gradle build - ${unsafe.join(', ')} cannot be passed as a task path safely.`);
	}

	const coverageTask = vscode.workspace.getConfiguration('proof', folder).get<string>('gradleCoverageTask');
	const args = buildGradleTestArgs({ moduleRoots, coverageTask });
	return runVisibleGradleTask(folder, output, wrapper, 'runTests', 'Run Tests (Gradle + JaCoCo)', args);
}
