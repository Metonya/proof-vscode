/**
 * Pure: builds the `analyze` argv for proof-python, mirroring
 * `argsBuilder.ts`'s Java version at the scope this engine actually has
 * today - one module, no per-test classpath resolution (proof-python reads
 * L2 straight out of the coverage report's own measurement contexts, no
 * separate classpath file the way PIT needs one). Deliberately narrower
 * than the Java builder: multi-module binding, mutation evidence, and
 * explicit per-test targets have no proof-python counterpart yet.
 */

import type { DiffMode } from './argsBuilder';

export interface PythonAnalyzeArgsInput {
	repo: string;
	diffMode: DiffMode;
	reportPath: string;
	sourceRoots: string;
	testRoots: string;
	outPath: string;
	fileCoverage?: boolean;
	perTestReport?: boolean;
	coverageExclusions?: readonly string[];
}

export function buildPythonAnalyzeArgs(input: PythonAnalyzeArgsInput): string[] {
	const args: string[] = ['-m', 'proof_python.cli', 'analyze', '--repo', input.repo];

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

	args.push('--report', input.reportPath, '--source-roots', input.sourceRoots, '--test-roots', input.testRoots);

	if (input.fileCoverage) {
		args.push('--file-coverage');
	}
	if (input.perTestReport) {
		args.push('--per-test-report');
	}
	if (input.coverageExclusions && input.coverageExclusions.length > 0) {
		args.push('--coverage-exclusions', input.coverageExclusions.join(','));
	}

	args.push('--out', input.outPath);
	return args;
}
