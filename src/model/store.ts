import type { FileCoverageBlock } from '../verdict/types';

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
}

let state: CoverageState | undefined;
const listeners = new Set<(state: CoverageState) => void>();

export function setCoverageState(next: CoverageState): void {
	state = next;
	for (const listener of listeners) {
		listener(next);
	}
}

export function getCoverageState(): CoverageState | undefined {
	return state;
}

export function onCoverageStateChanged(listener: (state: CoverageState) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
