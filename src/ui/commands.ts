import * as fs from 'node:fs';
import * as vscode from 'vscode';

import { buildAnalyzeArgs } from '../cli/argsBuilder';
import { locateJar } from '../cli/jarLocator';
import { run } from '../cli/runner';
import { parseVerdict } from '../verdict/parse';

/**
 * F1 (Plan.md Bölüm 7): the manual "run coverdict on this workspace" gesture
 * - `withProgress` cancellable, `--out` written to extension storage (never
 * the repo, so it can never become an untracked file the next diff sees).
 * No gutter/panel yet (F2/F3) - success is reported as an information
 * message with the same headline number the CLI's own text report prints,
 * which is what proves this wiring end to end until there is a UI surface
 * to show it in.
 */
export function registerAnalyzeCommand(context: vscode.ExtensionContext, output: vscode.OutputChannel): vscode.Disposable {
	return vscode.commands.registerCommand('coverdict.analyze', () => runAnalyze(context, output));
}

async function runAnalyze(context: vscode.ExtensionContext, output: vscode.OutputChannel): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showErrorMessage('coverdict: open a folder first.');
		return;
	}

	const jarPath = locateJar(folder);
	if (!jarPath) {
		vscode.window.showErrorMessage('coverdict: could not find coverdict.jar. Set coverdict.jarPath, or build one at coverdict-cli/target/coverdict.jar.');
		return;
	}

	const reportPath = await vscode.window.showInputBox({
		prompt: 'JaCoCo XML report path (relative to the workspace root)',
		value: 'target/site/jacoco/jacoco.xml',
	});
	if (!reportPath) {
		return;
	}

	const storageRoot = context.storageUri ?? context.globalStorageUri;
	await vscode.workspace.fs.createDirectory(storageRoot);
	const outUri = vscode.Uri.joinPath(storageRoot, 'verdict-current.json');

	const javaExecutable = vscode.workspace.getConfiguration('coverdict', folder).get<string>('javaExecutable') || 'java';
	const args = buildAnalyzeArgs({
		repo: folder.uri.fsPath,
		diffMode: { kind: 'no-vcs' },
		reportPath,
		outPath: outUri.fsPath,
	});

	output.show(true);
	output.appendLine(`coverdict: java -jar ${jarPath} ${args.join(' ')}`);

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'coverdict: analyzing', cancellable: true },
		async (_progress, token) => {
			const handle = run({ javaExecutable, jarPath, args, onStderrLine: (line) => output.appendLine(line) });
			token.onCancellationRequested(() => handle.cancel());

			const result = await handle.result;
			output.appendLine(result.stdout);

			// exit 3 (incomplete) still writes a real document - read it rather
			// than treating it as a failure (hard rule 3a, mirrored from the CLI).
			if (result.exitCode !== 0 && result.exitCode !== 3) {
				vscode.window.showErrorMessage(`coverdict: analyze failed (exit ${result.exitCode}).`);
				return;
			}

			let raw: string;
			try {
				raw = await fs.promises.readFile(outUri.fsPath, 'utf8');
			} catch (e) {
				vscode.window.showErrorMessage(`coverdict: could not read the verdict file: ${(e as Error).message}`);
				return;
			}

			const parsed = parseVerdict(raw);
			if (!parsed.ok) {
				vscode.window.showErrorMessage(`coverdict: could not parse the verdict file: ${parsed.error}`);
				return;
			}

			const percent = parsed.value.coverage.overall['jacoco-line'].percent;
			const percentText = percent === null ? 'n/a' : `${percent}%`;
			vscode.window.showInformationMessage(`coverdict: ${parsed.value.analysis.status} - jacoco-line ${percentText}`);
		},
	);
}
