import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * Search order (Plan.md "Jar dağıtımı"): `proof.jarPath` setting ->
 * `${workspaceFolder}/proof-java-cli/target/proof-java.jar` ->
 * `${workspaceFolder}/.proof-java/proof-java.jar` -> undefined (caller shows
 * a "Locate proof-java.jar..." prompt). The jar itself is never bundled into
 * the `.vsix` - see the plan for why.
 */
export function locateJar(workspaceFolder: vscode.WorkspaceFolder): string | undefined {
	const configured = vscode.workspace.getConfiguration('proof', workspaceFolder).get<string>('jarPath');
	if (configured && configured.trim().length > 0) {
		const resolved = path.isAbsolute(configured) ? configured : path.join(workspaceFolder.uri.fsPath, configured);
		return fs.existsSync(resolved) ? resolved : undefined;
	}

	for (const candidate of defaultCandidates(workspaceFolder.uri.fsPath)) {
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

function defaultCandidates(workspaceRoot: string): string[] {
	return [
		path.join(workspaceRoot, 'proof-java-cli', 'target', 'proof-java.jar'),
		path.join(workspaceRoot, '.proof-java', 'proof-java.jar'),
	];
}
