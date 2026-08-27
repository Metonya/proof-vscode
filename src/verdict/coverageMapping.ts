import type { LineTuple } from './types';

/**
 * Pure: turns coverdict's `[line, mi, ci, mb, cb]` tuples into the shape
 * `ui/gutterRenderer.ts` paints as editor decorations and
 * `ui/explorerBadges.ts` rolls up into folder percentages. Kept out of
 * `verdict/` proper only because it is coverage-specific, not because it
 * needs `vscode` (it doesn't; see Plan.md Bölüm 2's first invariant).
 *
 * A line is `partial` when it executed but not every instruction or branch
 * on it did (`mi>0 || mb>0`) - this is the same real JaCoCo data the CLI's
 * own `sonar-compatible` metric already counts (D-04), never a synthesized
 * approximation.
 */

export interface MappedLine {
	line: number;
	executed: boolean;
	partial: boolean;
}

export function mapLines(lines: readonly LineTuple[]): MappedLine[] {
	return lines.map(mapLine);
}

export type LineState = 'covered' | 'partial' | 'uncovered';

/**
 * The single classification `ui/gutterRenderer.ts` renders from - one
 * implementation, so there is no second renderer that could quietly drift.
 */
export function classifyLine(mapped: MappedLine): LineState {
	if (!mapped.executed) {
		return 'uncovered';
	}
	return mapped.partial ? 'partial' : 'covered';
}

function mapLine([line, missedInstructions, coveredInstructions, missedBranches, _coveredBranches]: LineTuple): MappedLine {
	const executed = coveredInstructions > 0;
	const partial = executed && (missedInstructions > 0 || missedBranches > 0);
	return { line, executed, partial };
}
