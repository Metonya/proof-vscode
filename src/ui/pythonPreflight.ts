import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { offerToOpenSetting } from './preflight';

/**
 * Minimal Python engine wiring (Plan.md Bölüm 5's "proof-vscode - soyutlama
 * borcu", scoped down deliberately: this is the "does a Python project sit
 * here at all" question, not the full `Engine` abstraction the plan
 * describes - that refactor waits for a second concrete need to shape it
 * around, per D-83's own note. `pyproject.toml` at the workspace root is
 * the one signal used, matching PEP 621; no poetry/hatch/pdm-specific
 * detection, no workspace/monorepo discovery (proof-python's own
 * `docs/RESEARCH.md` section 7 found no standard notion of a Python
 * workspace to detect in the first place).
 */

export function isPythonProjectRoot(workspaceRoot: string): boolean {
	return fs.existsSync(path.join(workspaceRoot, 'pyproject.toml'));
}

export interface PythonReportBinding {
	reportPath: string;
}

/**
 * Unlike the Java side's `resolveReportBinding`, this never globs for the
 * report or offers to generate it: proof-python has no single conventional
 * output location (`coverage json` writes wherever `-o` says), and running
 * pytest itself is a user action this minimal scope does not automate.
 * Missing means "tell the user how to produce it", not "search harder".
 */
export async function resolvePythonReportBinding(folder: vscode.WorkspaceFolder, configuredReportPath: string): Promise<PythonReportBinding | undefined> {
	const workspaceRoot = folder.uri.fsPath;
	if (!isPythonProjectRoot(workspaceRoot)) {
		vscode.window.showErrorMessage(
			`Proof: no pyproject.toml found at the workspace root (${workspaceRoot}) - this doesn't look like a Python project.`,
		);
		return undefined;
	}
	if (fs.existsSync(path.join(workspaceRoot, configuredReportPath))) {
		return { reportPath: configuredReportPath };
	}
	void offerToOpenSetting(
		`Proof: coverage report not found: ${configuredReportPath}. Run "pytest --cov --cov-branch --cov-context=test" then "coverage json -o ${configuredReportPath} --show-contexts" first, or fix the proof.python.reportPath setting.`,
		'proof.python.reportPath',
	);
	return undefined;
}
