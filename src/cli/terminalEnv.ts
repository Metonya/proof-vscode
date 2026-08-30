/**
 * Pure: resolves VS Code's own `terminal.integrated.env.<platform>`
 * override shape (`{ VAR: "value with ${env:OTHER} placeholders" }`) into
 * plain env values.
 *
 * Faz 31 regression, found live: `ui/mavenTestTask.ts` used to run Maven
 * through a `ShellExecution`, which VS Code's own integrated terminal
 * spawns - and that terminal honors `terminal.integrated.env.*`, which is
 * exactly how this session's gson checkout pins JDK 17
 * (`.vscode/settings.json`: `terminal.integrated.env.windows.JAVA_HOME`).
 * Rebuilding it on `CustomExecution` (to capture output for
 * `mavenErrorInterpreter.ts`) switched to a plain `child_process.spawn`,
 * which only ever sees the *extension host's own* environment - the
 * workspace's JDK pin silently stopped applying, and Maven fell back to
 * whatever JDK happened to be on the host's own PATH (JDK 25, which then
 * failed the enforcer's `[17,22)` range). This function is what lets
 * `mavenTestTask.ts` reconstruct the same environment a real integrated
 * terminal would have used.
 *
 * `${env:X}` always resolves against `baseEnv` (the environment *before*
 * any of these overrides), never against another override in the same
 * batch - matching the real setting's own intent ("prepend to the
 * existing PATH"), not a chained substitution.
 */
export function resolveEnvOverrides(overrides: Readonly<Record<string, string>>, baseEnv: Readonly<Record<string, string | undefined>>): Record<string, string> {
	const placeholder = /\$\{env:([^}]+)\}/g;
	const resolved: Record<string, string> = {};
	for (const [key, rawValue] of Object.entries(overrides)) {
		resolved[key] = rawValue.replaceAll(placeholder, (_match, varName: string) => baseEnv[varName] ?? '');
	}
	return resolved;
}
