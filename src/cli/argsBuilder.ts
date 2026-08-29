/**
 * Pure: builds the `analyze` argv from already-resolved inputs, never
 * touches the filesystem or `vscode` (Plan.md Bölüm 2/6 - unit-testable
 * with plain `node --test`). Single-module shorthand is still the default
 * (F1's self-scan case, `--repo`-rooted bare `--report`). `module` (Faz 29,
 * §7.8) is the one real multi-module case built so far: when
 * `coverdict.reportPath` resolves under a repo subdirectory rather than at
 * the workspace root, coverdict needs an explicit `--module <id>=<root>` so
 * its own default source/test roots (`<root>/src/main/java`/`src/test/java`)
 * land in the right place - the CLI's own defaults do the rest, so no
 * `--source-roots`/`--test-roots` flags are built here. A full multi-module
 * config UI (binding several modules in one run) is still F8, not this.
 */

export type DiffMode =
	| { kind: 'no-vcs' }
	| { kind: 'uncommitted' }
	| { kind: 'base'; ref: string };

export interface AnalyzeArgsInput {
	repo: string;
	diffMode: DiffMode;
	reportPath: string;
	/**
	 * Faz 29 (§7.8): when the report lives under a module subdirectory
	 * (`reportDiscovery.ts` found it, not the configured/default workspace-root
	 * path), this names that module so `--report` becomes `<id>=<reportPath>`
	 * instead of the bare single-module shorthand, alongside a matching
	 * `--module <id>=<root>`. Absent for the unchanged single-module case.
	 */
	module?: { id: string; root: string };
	outPath: string;
	fileCoverage?: boolean;
	/** Sonar-style `sonar.coverage.exclusions` globs (D-05) - passed through verbatim, one authored list, never merged with a repo's own coverdict.config.json. */
	coverageExclusions?: readonly string[];
	/**
	 * F3 (Plan.md Bölüm 4): L2 per-test evidence. Requires perTestClasspathPath
	 * - both or neither, never one alone. `targets` (Faz 14b) names explicit
	 * FQCNs via `--per-test-target`, the CLI's diff-free entry point (Faz
	 * 14a) - when given, it lifts the CLI's own --no-vcs rejection, so this
	 * builder does not need to know or enforce the diff-mode rule itself.
	 */
	perTest?: { classpathModuleId: string; classpathPath: string; targets?: readonly string[] };
	/**
	 * Faz 20: L3 mutasyon kanıtı. `perTest` ile aynı şekil ve aynı kural -
	 * `targets` (D-71'in `--mutation-target`'ı) verildiğinde CLI'ın diff
	 * zorunluluğu kalkar, yani `--no-vcs` altında da çalışır. Ayrı bir
	 * classpath bayrağı var (`--mutation-classpath`), dosya biçimi
	 * `--per-test-classpath` ile aynı olsa da: CLI ikisini ayrı opt-in
	 * sayıyor, burada da birleştirilmiyor.
	 *
	 * `timeoutSeconds` bir modülün bütçesi; CLI varsayılanı 300. Aşılırsa
	 * koşu öldürülür ve `MUTATION_BUDGET_EXCEEDED` ile döner - kısmi sonuç
	 * yine yazılır.
	 */
	mutation?: { classpathModuleId: string; classpathPath: string; targets?: readonly string[]; timeoutSeconds?: number };
}

export function buildAnalyzeArgs(input: AnalyzeArgsInput): string[] {
	const args: string[] = ['analyze', '--repo', input.repo];

	switch (input.diffMode.kind) {
		case 'no-vcs':
			args.push('--no-vcs');
			break;
		case 'uncommitted':
			args.push('--uncommitted');
			break;
		case 'base':
			args.push('--base', input.diffMode.ref);
			break;
	}

	if (input.module) {
		args.push('--module', `${input.module.id}=${input.module.root}`, '--report', `${input.module.id}=${input.reportPath}`);
	} else {
		args.push('--report', input.reportPath);
	}
	if (input.fileCoverage) {
		args.push('--file-coverage');
	}
	if (input.coverageExclusions && input.coverageExclusions.length > 0) {
		args.push('--coverage-exclusions', input.coverageExclusions.join(','));
	}
	if (input.perTest) {
		args.push('--per-test-report', '--per-test-classpath', `${input.perTest.classpathModuleId}=${input.perTest.classpathPath}`);
		for (const target of input.perTest.targets ?? []) {
			args.push('--per-test-target', `${input.perTest.classpathModuleId}=${target}`);
		}
	}
	if (input.mutation) {
		args.push('--mutation-report', '--mutation-classpath', `${input.mutation.classpathModuleId}=${input.mutation.classpathPath}`);
		for (const target of input.mutation.targets ?? []) {
			args.push('--mutation-target', `${input.mutation.classpathModuleId}=${target}`);
		}
		if (input.mutation.timeoutSeconds !== undefined) {
			args.push('--mutation-timeout', String(input.mutation.timeoutSeconds));
		}
	}
	args.push('--out', input.outPath);

	return args;
}
