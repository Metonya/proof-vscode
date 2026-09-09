import * as vscode from 'vscode';

/**
 * User request (2026-09-09): a single "Install proof-python" button, next
 * to "Download proof-java.jar" and "Install Skill", offering the choice
 * proof-python's own plan settled on for v0.1 distribution (an isolated
 * tool via pipx or uv, never a bare pip into whatever happens to be
 * active) - plus a third option for the one case those two don't cover:
 * putting it directly into the venv `proof.python.interpreter` already
 * points at, which is what this extension itself invokes via `-m
 * proof_python.cli`.
 *
 * proof-python is not published to PyPI (unlike an npm/Maven package,
 * there is no registry name to install by) - every option installs
 * straight from the GitHub repo, which all three tools support as a
 * plain `git+https://...` target. Runs in a real, visible terminal rather
 * than a hidden spawn: a package-manager failure (missing pipx/uv, no
 * network, a private repo needing auth) needs to be seen and acted on
 * directly, the same reasoning `mavenTestTask.ts`'s own doc comment gives
 * for Maven.
 */
export function registerInstallPythonCommand(): vscode.Disposable {
	return vscode.commands.registerCommand('proof.installPython', runInstallPython);
}

const REPO_URL = 'https://github.com/Metonya/proof-python.git';

interface InstallerChoice extends vscode.QuickPickItem {
	command: (interpreter: string) => string;
}

async function runInstallPython(): Promise<void> {
	const choices: InstallerChoice[] = [
		{
			label: 'pipx',
			description: 'isolated tool environment - recommended if you use proof-python from the command line too',
			command: () => `pipx install git+${REPO_URL}`,
		},
		{
			label: 'uv tool',
			description: 'isolated tool environment via uv - same idea as pipx, if you already use uv',
			command: () => `uv tool install git+${REPO_URL}`,
		},
		{
			label: 'pip (into proof.python.interpreter)',
			description: 'installs into the venv this extension itself already points at - no setting to change afterward',
			command: (interpreter) => `${quoteIfNeeded(interpreter)} -m pip install git+${REPO_URL}`,
		},
	];

	const picked = await vscode.window.showQuickPick(choices, {
		title: 'Proof: Install proof-python',
		placeHolder: 'Which installer should install it?',
	});
	if (!picked) {
		return;
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	const interpreter = (folder ? vscode.workspace.getConfiguration('proof', folder).get<string>('python.interpreter') : undefined) || 'python';
	if (picked.label.startsWith('pip ') && interpreter === 'python') {
		vscode.window.showWarningMessage(
			'Proof: proof.python.interpreter is not set (using plain "python" on PATH) - set it to your project\'s own venv first, or this installs somewhere unrelated to what "Analyze (Python)" will actually run.',
		);
	}

	const terminal = vscode.window.createTerminal({ name: 'Proof: install proof-python', cwd: folder?.uri.fsPath });
	terminal.show();
	terminal.sendText(picked.command(interpreter));
}

/** A Windows venv path routinely has spaces (`Program Files`, a username) - quoted only when it actually needs to be, so a plain `python` on PATH stays unquoted in the visible command. */
function quoteIfNeeded(interpreter: string): string {
	return /\s/.test(interpreter) ? `"${interpreter}"` : interpreter;
}
