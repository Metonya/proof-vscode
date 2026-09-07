import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { fetchSkillFiles } from '../cli/skillFetcher';
import { CANCELLED, raceAgainstCancellation } from './cancellation';

/**
 * Faz 34 (user request): "let's add a way to point users at installing the
 * skill for their AI agent, but each tool's own installation method
 * differs." Four targets, each with the scope(s) that tool actually
 * supports - verified against each tool's own current docs/convention,
 * not guessed:
 *   - Claude Code: `.claude/skills/` (workspace, committed) or
 *     `~/.claude/skills/` (user, every project on this machine).
 *   - Windsurf: `.windsurf/skills/` - workspace only, no documented
 *     user-level equivalent found.
 *   - Antigravity: `~/.gemini/antigravity-cli/skills/` - user only, no
 *     documented workspace-level equivalent found.
 *   - Portable: `.agents/skills/` - the shared convention Cursor, OpenAI
 *     Codex CLI, Gemini CLI, and GitHub Copilot all read directly, so one
 *     install covers all four without duplicating files per tool.
 */
type SkillScope = 'workspace' | 'user';

interface SkillTarget {
	id: string;
	label: string;
	description: string;
	scopes: readonly SkillScope[];
	resolveDir(scope: SkillScope, workspaceRoot: string): string;
}

const SKILL_TARGETS: readonly SkillTarget[] = [
	{
		id: 'claude',
		label: 'Claude Code',
		description: '.claude/skills/proof-java (workspace) or ~/.claude/skills/proof-java (user)',
		scopes: ['workspace', 'user'],
		resolveDir: (scope, workspaceRoot) => (scope === 'workspace'
			? path.join(workspaceRoot, '.claude', 'skills', 'proof-java')
			: path.join(os.homedir(), '.claude', 'skills', 'proof-java')),
	},
	{
		id: 'windsurf',
		label: 'Windsurf',
		description: '.windsurf/skills/proof-java (workspace)',
		scopes: ['workspace'],
		resolveDir: (_scope, workspaceRoot) => path.join(workspaceRoot, '.windsurf', 'skills', 'proof-java'),
	},
	{
		id: 'antigravity',
		label: 'Antigravity',
		description: '~/.gemini/antigravity-cli/skills/proof-java (user)',
		scopes: ['user'],
		resolveDir: () => path.join(os.homedir(), '.gemini', 'antigravity-cli', 'skills', 'proof-java'),
	},
	{
		id: 'portable',
		label: 'Portable (.agents/skills)',
		description: '.agents/skills/proof-java (workspace) - read directly by Cursor, Codex CLI, Gemini CLI, and GitHub Copilot',
		scopes: ['workspace'],
		resolveDir: (_scope, workspaceRoot) => path.join(workspaceRoot, '.agents', 'skills', 'proof-java'),
	},
];

export function registerInstallSkillCommand(): vscode.Disposable {
	return vscode.commands.registerCommand('proof.installSkill', runInstallSkill);
}

async function runInstallSkill(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	const availableTargets = folder ? SKILL_TARGETS : SKILL_TARGETS.filter((t) => t.scopes.includes('user'));

	const targetPick = await vscode.window.showQuickPick(
		availableTargets.map((target) => ({ label: target.label, description: target.description, target })),
		{ title: 'Proof: Install Skill For', placeHolder: 'Choose the AI tool to install the proof-java skill for' },
	);
	if (!targetPick) {
		return;
	}
	const target = targetPick.target;

	let scope: SkillScope;
	if (target.scopes.length === 1) {
		scope = target.scopes[0];
	} else {
		const scopePick = await vscode.window.showQuickPick(
			target.scopes.map((s) => ({
				label: s === 'workspace' ? 'Workspace' : 'User',
				description: s === 'workspace' ? 'committed to this repo, shared with the team' : 'this machine only, every project',
				scope: s,
			})),
			{ title: 'Proof: Install Scope' },
		);
		if (!scopePick) {
			return;
		}
		scope = scopePick.scope;
	}

	if (scope === 'workspace' && !folder) {
		vscode.window.showErrorMessage('Proof: open a folder first.');
		return;
	}
	const destDir = target.resolveDir(scope, folder?.uri.fsPath ?? '');

	await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Proof: fetching the latest skill from GitHub...', cancellable: true }, async (_progress, token) => {
		let files;
		try {
			files = await raceAgainstCancellation(fetchSkillFiles(), token);
		} catch (e) {
			if (e === CANCELLED) {
				return;
			}
			vscode.window.showErrorMessage(`Proof: could not fetch the skill from GitHub: ${(e as Error).message}`);
			return;
		}
		try {
			for (const file of files) {
				const outPath = path.join(destDir, ...file.relativePath.split('/'));
				await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
				await fs.promises.writeFile(outPath, file.content);
			}
		} catch (e) {
			vscode.window.showErrorMessage(`Proof: fetched the skill but could not write it to ${destDir}: ${(e as Error).message}`);
			return;
		}

		const choice = await vscode.window.showInformationMessage(`Proof: installed the skill to ${destDir} (${files.length} file(s)).`, 'Open SKILL.md');
		if (choice === 'Open SKILL.md') {
			await vscode.window.showTextDocument(vscode.Uri.file(path.join(destDir, 'SKILL.md')));
		}
	});
}
