/**
 * Pure: builds the `analyze` argv from already-resolved inputs, never
 * touches the filesystem or `vscode` (Plan.md Bölüm 2/6 - unit-testable
 * with plain `node --test`). Single-module shorthand only for now (F1's
 * self-scan case); multi-module bindings and their all-or-nothing rule
 * (D-27's bare-vs-id-report conflict) land with F8's config UI, when there
 * is a real multi-module case to build it against.
 */

export type DiffMode =
	| { kind: 'no-vcs' }
	| { kind: 'uncommitted' }
	| { kind: 'base'; ref: string };

export interface AnalyzeArgsInput {
	repo: string;
	diffMode: DiffMode;
	reportPath: string;
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

	args.push('--report', input.reportPath);
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
	args.push('--out', input.outPath);

	return args;
}
