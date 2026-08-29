import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { buildMavenTestArgs, type MavenTestPhase } from '../cli/mavenTestCommand';
import { inspectPom } from '../cli/pomInspector';
import { toRepoRelativePosix } from '../cli/reportDiscovery';

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
	const configured = vscode.workspace.getConfiguration('coverdict', folder).get<string>('mavenExecutable');
	return configured || (process.platform === 'win32' ? 'mvn.cmd' : 'mvn');
}

/**
 * `undefined` return means the task never ran at all (argLine modal
 * declined, or the user opened the pom instead) - distinct from `false`
 * (the task ran and Maven itself failed or was cancelled).
 */
export async function runTestsTask(folder: vscode.WorkspaceFolder, output: vscode.OutputChannel): Promise<boolean | undefined> {
	const facts = await scanPoms(folder);

	if (facts.literalArgLine) {
		const choice = await vscode.window.showWarningMessage(
			`coverdict: ${facts.literalArgLine.file} (satır ${facts.literalArgLine.line}) içindeki surefire yapılandırması <argLine> değerini sabit bir metin olarak yazıyor.`,
			{
				modal: true,
				detail: 'JaCoCo ajanı komut satırından bağlandığında bu satır ajanı düşürür - hiç jacoco.exec üretilmez, coverage verisi çıkmaz. '
					+ 'Bu, komut satırından düzeltilemez (-DargLine=... işe yaramaz, çünkü pomdaki <configuration><argLine> her zaman kazanır). '
					+ `Pomdaki satırı @{argLine} ekleyecek şekilde düzenlemeniz gerekir, örn.: <argLine>@{argLine} ${facts.literalArgLine.text.replaceAll(/<\/?argLine>/g, '')}</argLine>`,
			},
			"Pom'u Aç",
			'Yine de Çalıştır',
		);
		if (choice === "Pom'u Aç") {
			const uri = vscode.Uri.file(path.join(folder.uri.fsPath, facts.literalArgLine.file));
			const selection = new vscode.Range(facts.literalArgLine.line - 1, 0, facts.literalArgLine.line - 1, 0);
			await vscode.window.showTextDocument(uri, { selection });
			return undefined;
		}
		if (choice !== 'Yine de Çalıştır') {
			return undefined;
		}
	}

	const config = vscode.workspace.getConfiguration('coverdict', folder);
	const phase = (config.get<MavenTestPhase>('testCommandPhase')) || 'test';
	const jacocoPluginVersion = config.get<string>('jacocoPluginVersion') || '0.8.13';
	const args = buildMavenTestArgs({ phase, injectJacocoGoals: !facts.hasJacocoPlugin, jacocoPluginVersion });
	const mavenExecutable = resolveMavenExecutable(folder);

	output.appendLine(`coverdict: ${mavenExecutable} ${args.join(' ')} (${folder.uri.fsPath})`);

	const task = new vscode.Task(
		{ type: 'coverdict', kind: 'runTests' },
		folder,
		'Testleri Çalıştır (JaCoCo)',
		'coverdict',
		new vscode.ShellExecution(mavenExecutable, args, { cwd: folder.uri.fsPath }),
	);
	task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Dedicated, clear: true };

	const executed = await vscode.tasks.executeTask(task);
	return new Promise<boolean>((resolve) => {
		const disposable = vscode.tasks.onDidEndTaskProcess((e) => {
			if (e.execution === executed) {
				disposable.dispose();
				resolve(e.exitCode === 0);
			}
		});
	});
}
