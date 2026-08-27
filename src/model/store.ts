import type { FileCoverageBlock, MetricSet } from '../verdict/types';

/**
 * The one place the last analyze run's coverage data lives (Plan.md Bölüm
 * 2's model/store) - `ui/` reads it to redecorate editors on visibility
 * changes without re-running analyze. A minimal pub-sub of its own rather
 * than `vscode.EventEmitter`, so this file stays `vscode`-free like the
 * rest of `model/`.
 */

export interface CoverageState {
	workspaceRoot: string;
	fileCoverage: FileCoverageBlock | undefined;
	overall: MetricSet;
}

let state: CoverageState | undefined;
let gutterVisible = true;
const listeners = new Set<(state: CoverageState) => void>();

export function setCoverageState(next: CoverageState): void {
	state = next;
	gutterVisible = true; // a fresh scan always shows - F4's toggle is a per-run choice, not sticky across runs
	for (const listener of listeners) {
		listener(next);
	}
}

export function getCoverageState(): CoverageState | undefined {
	return state;
}

/** F4 (Plan.md Bölüm 4): whether the gutter is currently meant to be shown - `ui/commands.ts`'s toggle command flips this and republishes or clears accordingly. */
export function isGutterVisible(): boolean {
	return gutterVisible;
}

export function setGutterVisible(next: boolean): void {
	gutterVisible = next;
}

export function onCoverageStateChanged(listener: (state: CoverageState) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
