import * as vscode from 'vscode';

import { resolveEnvOverrides } from '../cli/terminalEnv';

/**
 * Faz 31: reconstructs the environment a real VS Code integrated terminal
 * would use for this workspace, for **any** subprocess this extension
 * spawns directly - not just Maven. First found for `ui/mavenTestTask.ts`
 * (the `CustomExecution` rewrite bypasses the terminal, so a workspace's
 * `terminal.integrated.env.*` JDK pin silently stopped applying to Maven),
 * but the exact same gap exists for `proof-java.jar` itself: it has always
 * been a plain `child_process.spawn` (`cli/runner.ts`), never routed
 * through a terminal, so it only ever inherited the *extension host's own*
 * environment. Real symptom: `proof-java.jar`'s own L2/L3 collection forks a
 * PIT "minion" JVM using the *same* JDK `proof-java.jar` itself is running
 * under - if that resolves to whatever `java` happens to be on the
 * extension host's PATH (JDK 25 in this session) instead of the
 * workspace's pinned JDK 17, the minion crashes
 * (`PitError: Coverage generation minion exited abnormally!`), and L2/L3
 * evidence silently comes back empty - "Satır → Testler" and Mutasyon show
 * nothing, with no obvious link back to a JDK mismatch.
 *
 * Used for the `proof-java.jar` spawn itself (`ui/commands.ts`) and for
 * `doctor` (`ui/preflight.ts`) - `doctor --fix` also shells out to `mvn`
 * internally (`MavenClient.java`), so it needs the same environment too.
 */
export function resolveWorkspaceEnv(folder: vscode.WorkspaceFolder): NodeJS.ProcessEnv {
	const overrides = vscode.workspace.getConfiguration('terminal.integrated', folder).get<Record<string, string>>(`env.${terminalPlatformKey()}`) ?? {};
	return { ...process.env, ...resolveEnvOverrides(overrides, process.env) };
}

const TERMINAL_PLATFORM_KEYS: Record<string, string> = { win32: 'windows', darwin: 'osx' };

/** VS Code's own `terminal.integrated.env.<platform>` setting key for the current OS - `linux` is the fallback for every non-Windows, non-macOS platform, matching VS Code's own default. */
function terminalPlatformKey(): string {
	return TERMINAL_PLATFORM_KEYS[process.platform] ?? 'linux';
}
