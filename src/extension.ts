import * as vscode from 'vscode';

/**
 * Registration only - no logic lives here. Features register themselves
 * from src/ui/commands.ts and friends as they land; this function stays a
 * short list of `context.subscriptions.push(...)` calls (Plan.md Bölüm 2).
 */
export function activate(_context: vscode.ExtensionContext): void {
	// Faz 4: skeleton only - activates cleanly, registers nothing yet.
}

export function deactivate(): void {
}
