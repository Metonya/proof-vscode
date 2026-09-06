import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { downloadLatestJar } from '../cli/jarDownloader';
import { userJarPath, workspaceJarPath } from '../cli/jarLocator';

/**
 * Faz 34 (user request): "give me something that makes it convenient to
 * download the jar, like the skill". Same shape as
 * `skillInstaller.ts`'s scope choice - "Workspace" and "User" both write to
 * a location `cli/jarLocator.ts`'s own default search order already
 * checks, so nothing else needs to change afterward (no `proof.jarPath`
 * setting to set, no reload).
 */
export function registerDownloadJarCommand(): vscode.Disposable {
	return vscode.commands.registerCommand('proof.downloadJar', runDownloadJar);
}

async function runDownloadJar(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const scopePick = await vscode.window.showQuickPick(
		[
			...(folder ? [{ label: 'Workspace', description: '.proof-java/proof-java.jar in this workspace only', scope: 'workspace' as const }] : []),
			{ label: 'User', description: '~/.proof-java/proof-java.jar - shared by every workspace on this machine', scope: 'user' as const },
		],
		{ title: 'Proof: Download proof-java.jar', placeHolder: 'Where should the jar be installed?' },
	);
	if (!scopePick) {
		return;
	}
	const destPath = scopePick.scope === 'workspace' && folder ? workspaceJarPath(folder.uri.fsPath) : userJarPath();

	await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Proof: downloading the latest proof-java.jar from GitHub...' }, async () => {
		let result;
		try {
			result = await downloadLatestJar();
		} catch (e) {
			vscode.window.showErrorMessage(`Proof: could not download proof-java.jar: ${(e as Error).message}`);
			return;
		}
		try {
			await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
			await fs.promises.writeFile(destPath, result.content);
		} catch (e) {
			vscode.window.showErrorMessage(`Proof: downloaded proof-java.jar but could not write it to ${destPath}: ${(e as Error).message}`);
			return;
		}
		vscode.window.showInformationMessage(`Proof: installed proof-java.jar ${result.version} to ${destPath}.`);
	});
}
