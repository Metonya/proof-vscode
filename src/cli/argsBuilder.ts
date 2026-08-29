/**
 * Pure: builds the `analyze` argv from already-resolved inputs, never
 * touches the filesystem or `vscode` (Plan.md Bölüm 2/6 - unit-testable
 * with plain `node --test`).
 *
 * Two report-binding shapes (Faz 30 generalizes Faz 29's single-module one):
 *   - `reportPath` (+ optional `module`) - the original single-module
 *     shorthand. Omitting `module` reproduces the exact byte-identical
 *     bare `--report <path>` invocation from before Faz 29 - the
 *     self-scan/playground non-regression case.
 *   - `modules` - a real multi-module run (Faz 30, gson dogfood): repeats
 *     `--module <id>=<root>` and `--report <id>=<path>` once per bound
 *     module. Takes priority over `reportPath`/`module` when both are
 *     given (callers should only ever supply one or the other).
 *
 * L2/L3 evidence (`perTest`/`mutation`) similarly moved from a single
 * `classpathModuleId`/`classpathPath` pair to a `classpaths` list - a
 * multi-module run needs one `--per-test-classpath`/`--mutation-classpath`
 * per module, since the CLI validates each id independently and there is
 * no repo-wide classpath. `targets` now carries its own `moduleId` per
 * entry instead of assuming a single shared one, since a diff-derived or
 * per-file target legitimately belongs to a specific module.
 */

export type DiffMode =
	| { kind: 'no-vcs' }
	| { kind: 'uncommitted' }
	| { kind: 'base'; ref: string };

export interface ModuleReportBinding {
	id: string;
	root: string;
	reportPath: string;
}

export interface ClasspathBinding {
	moduleId: string;
	path: string;
}

export interface TargetBinding {
	moduleId: string;
	fqcn: string;
}

export interface AnalyzeArgsInput {
	repo: string;
	diffMode: DiffMode;
	/** Single-module shorthand - see file doc comment. Ignored when `modules` is given. */
	reportPath?: string;
	/** Single-module shorthand's optional explicit module binding. Ignored when `modules` is given. */
	module?: { id: string; root: string };
	/** Faz 30: real multi-module binding, repeated `--module`/`--report`. */
	modules?: readonly ModuleReportBinding[];
	outPath: string;
	fileCoverage?: boolean;
	/** Sonar-style `sonar.coverage.exclusions` globs (D-05) - passed through verbatim, one authored list, never merged with a repo's own coverdict.config.json. */
	coverageExclusions?: readonly string[];
	/**
	 * F3 (Plan.md Bölüm 4): L2 per-test evidence. `classpaths` requires at
	 * least one entry - each `--per-test-classpath <id>=<path>` matches one
	 * bound module. `targets` (Faz 14b) names explicit FQCNs via
	 * `--per-test-target`, the CLI's diff-free entry point (Faz 14a) - when
	 * given, it lifts the CLI's own --no-vcs rejection, so this builder does
	 * not need to know or enforce the diff-mode rule itself.
	 */
	perTest?: { classpaths: readonly ClasspathBinding[]; targets?: readonly TargetBinding[] };
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
	mutation?: { classpaths: readonly ClasspathBinding[]; targets?: readonly TargetBinding[]; timeoutSeconds?: number };
}

export function buildAnalyzeArgs(input: AnalyzeArgsInput): string[] {
	const args: string[] = ['analyze', '--repo', input.repo];
	appendDiffMode(args, input.diffMode);
	appendReportBinding(args, input);

	if (input.fileCoverage) {
		args.push('--file-coverage');
	}
	if (input.coverageExclusions && input.coverageExclusions.length > 0) {
		args.push('--coverage-exclusions', input.coverageExclusions.join(','));
	}
	if (input.perTest) {
		appendEvidenceFlags(args, '--per-test-report', '--per-test-classpath', '--per-test-target', input.perTest);
	}
	if (input.mutation) {
		appendEvidenceFlags(args, '--mutation-report', '--mutation-classpath', '--mutation-target', input.mutation);
		if (input.mutation.timeoutSeconds !== undefined) {
			args.push('--mutation-timeout', String(input.mutation.timeoutSeconds));
		}
	}
	args.push('--out', input.outPath);

	return args;
}

function appendDiffMode(args: string[], diffMode: DiffMode): void {
	switch (diffMode.kind) {
		case 'no-vcs':
			args.push('--no-vcs');
			break;
		case 'uncommitted':
			args.push('--uncommitted');
			break;
		case 'base':
			args.push('--base', diffMode.ref);
			break;
	}
}

function appendReportBinding(args: string[], input: Pick<AnalyzeArgsInput, 'reportPath' | 'module' | 'modules'>): void {
	if (input.modules && input.modules.length > 0) {
		for (const m of input.modules) {
			args.push('--module', `${m.id}=${m.root}`);
		}
		for (const m of input.modules) {
			args.push('--report', `${m.id}=${m.reportPath}`);
		}
	} else if (input.module) {
		args.push('--module', `${input.module.id}=${input.module.root}`, '--report', `${input.module.id}=${input.reportPath}`);
	} else if (input.reportPath) {
		args.push('--report', input.reportPath);
	}
}

/** Shared shape between `perTest` and `mutation`: one report-enabling flag, one `--*-classpath <id>=<path>` per bound module, one `--*-target <id>=<fqcn>` per explicit target. */
function appendEvidenceFlags(args: string[], reportFlag: string, classpathFlag: string, targetFlag: string, evidence: { classpaths: readonly ClasspathBinding[]; targets?: readonly TargetBinding[] }): void {
	args.push(reportFlag);
	for (const cp of evidence.classpaths) {
		args.push(classpathFlag, `${cp.moduleId}=${cp.path}`);
	}
	for (const target of evidence.targets ?? []) {
		args.push(targetFlag, `${target.moduleId}=${target.fqcn}`);
	}
}
