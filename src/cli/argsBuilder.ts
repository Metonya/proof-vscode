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
	args.push('--out', input.outPath);

	return args;
}
