import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

/**
 * Search order (Plan.md "Jar dağıtımı"): `coverdict.jarPath` setting ->
 * `${workspaceFolder}/coverdict-cli/target/coverdict.jar` ->
 * `${workspaceFolder}/.coverdict/coverdict.jar` -> undefined (caller shows
 * a "Locate coverdict.jar..." prompt). The jar itself is never bundled into
 * the `.vsix` - see the plan for why.
 */
export function locateJar(workspaceFolder: vscode.WorkspaceFolder): string | undefined {
	const configured = vscode.workspace.getConfiguration('coverdict', workspaceFolder).get<string>('jarPath');
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
		path.join(workspaceRoot, 'coverdict-cli', 'target', 'coverdict.jar'),
		path.join(workspaceRoot, '.coverdict', 'coverdict.jar'),
	];
}
