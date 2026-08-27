import type { LineTuple } from './types';

/**
 * Pure: turns coverdict's `[line, mi, ci, mb, cb]` tuples into a shape
 * `ui/coverageProvider.ts` wraps as real `vscode.StatementCoverage`/`vscode.
 * BranchCoverage` instances - kept out of `verdict/` proper only because it
 * is coverage-specific, not because it needs `vscode` (it doesn't; see
 * Plan.md Bölüm 2's first invariant and Bölüm 3's partial-line note).
 *
 * VS Code has no "partially covered line" concept of its own - yellow comes
 * only from branch data. A line with real branch counts (mb+cb>0) uses them
 * as-is (real fidelity). A line that is covered but not fully covered
 * (mi>0 && ci>0) with zero real branches has no branch data to report -
 * `branch-approximation` mode (default) synthesizes one covered + one
 * missed branch so it renders yellow instead of green; `strict` mode leaves
 * it branchless (green), the honest-but-less-visible choice. This is a bet
 * on real VS Code rendering, not a validated one - see Plan.md's open risk 3.
 */
export type PartialLineMode = 'branch-approximation' | 'strict';

export type BranchState = 'covered' | 'missed';

export interface MappedLine {
	line: number;
	executed: boolean;
	branches: readonly BranchState[];
}

export function mapLines(lines: readonly LineTuple[], partialLineMode: PartialLineMode): MappedLine[] {
	return lines.map((tuple) => mapLine(tuple, partialLineMode));
}

function mapLine([line, missedInstructions, coveredInstructions, missedBranches, coveredBranches]: LineTuple, partialLineMode: PartialLineMode): MappedLine {
	const executed = coveredInstructions > 0;
	const hasRealBranches = missedBranches + coveredBranches > 0;
	const isPartial = executed && missedInstructions > 0;

	if (hasRealBranches) {
		return { line, executed, branches: realBranches(missedBranches, coveredBranches) };
	}
	if (isPartial && partialLineMode === 'branch-approximation') {
		return { line, executed, branches: ['covered', 'missed'] };
	}
	return { line, executed, branches: [] };
}

function realBranches(missedBranches: number, coveredBranches: number): BranchState[] {
	const branches: BranchState[] = [];
	for (let i = 0; i < coveredBranches; i++) {
		branches.push('covered');
	}
	for (let i = 0; i < missedBranches; i++) {
		branches.push('missed');
	}
	return branches;
}
