import * as vscode from 'vscode';

import { registerAnalyzeCommand } from './ui/commands';

/**
 * Registration only - no logic lives here. Features register themselves
 * from src/ui/commands.ts and friends as they land; this function stays a
 * short list of `context.subscriptions.push(...)` calls (Plan.md Bölüm 2).
 */
export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('coverdict');
	context.subscriptions.push(output, registerAnalyzeCommand(context, output));
}

export function deactivate(): void {
	// Nothing to release: every disposable is already in context.subscriptions.
}
