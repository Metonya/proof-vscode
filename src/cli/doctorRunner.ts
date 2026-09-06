import { run } from './runner';

/**
 * Faz 30: spawns `proof-java doctor`, the CLI's own Maven-reactor preflight
 * (`docs/CLI-REFERENCE.md`'s doctor section) - the extension delegates to
 * it rather than re-implementing module discovery or classpath generation.
 * `--fix` writes `<module>/target/proof-per-test-classpath.txt` and
 * `.../proof-mutation-classpath.txt` (module-root-relative, real
 * `mvn -pl <module> dependency:build-classpath` per module, skipping any
 * module whose classpath already validates) - one call fixes every usable
 * module in the reactor, not just one, so `ui/preflight.ts` never needs to
 * orchestrate per-module classpath generation itself.
 *
 * Only exit code + stdout/stderr are consumed (never machine-readable -
 * `doctor` has no `--json`); the caller decides what any of that means.
 * doctor's own prose always goes to Output verbatim, never parsed for
 * control flow (progressParser.ts's established discipline).
 */
export interface DoctorResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

export interface DoctorOptions {
	fix?: boolean;
	writeConfig?: boolean;
	/** Faz 31: `doctor --fix` shells out to `mvn` internally (`MavenClient.java`) - without this it only ever sees the extension host's own environment, not a workspace-pinned JDK (`terminal.integrated.env.*`, see `ui/workspaceEnv.ts`). Defaults to `process.env` when omitted. */
	env?: NodeJS.ProcessEnv;
	onStderrLine?: (line: string) => void;
	/** Handed the process's own `cancel()` as soon as it is spawned, so a `vscode`-aware caller can wire it to a `CancellationToken` without this file importing `vscode` itself. */
	onStart?: (cancel: () => void) => void;
}

export async function runDoctor(javaExecutable: string, jarPath: string, repo: string, options: DoctorOptions = {}): Promise<DoctorResult> {
	const args = ['doctor', '--repo', repo];
	if (options.fix) {
		args.push('--fix');
	}
	if (options.writeConfig) {
		args.push('--write-config');
	}
	const handle = run({ javaExecutable, jarPath, args, env: options.env, onStderrLine: options.onStderrLine });
	options.onStart?.(handle.cancel);
	const result = await handle.result;
	return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}
