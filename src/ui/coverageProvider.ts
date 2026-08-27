import * as vscode from 'vscode';

import { toAbsolutePath } from '../model/pathIndex';
import { classifyLine, mapLines, type MappedLine, type PartialLineMode } from '../verdict/coverageMapping';
import type { FileCoverageBlock } from '../verdict/types';

/**
 * F2 (Plan.md Bölüm 3): primary path only - the built-in Test Coverage API.
 * VS Code owns the gutter bar, overview ruler, and file/folder percentages;
 * this module's only job is turning `fileCoverage.files[]` into real
 * `vscode.FileCoverage`/`StatementCoverage`/`BranchCoverage` instances and
 * handing them to a `TestRun`. No test items are registered - coverage is
 * attached to the run itself, not to any test, which is enough for the
 * gutter/ruler to render.
 *
 * The API stabilized after this extension's `engines.vscode` floor
 * (^1.88.0) - detected once here rather than assumed, matching Plan.md
 * Bölüm 3's own note that a lagging fork may carry the classes but not run
 * `loadDetailedCoverage` correctly. F7 adds the actual decoration fallback;
 * for now an unsupported host just skips painting and says so, never half-
 * renders or throws out of the analyze command.
 */
export function hasNativeCoverageApi(): boolean {
	const v = vscode as unknown as Record<string, unknown>;
	return typeof v.FileCoverage === 'function'
		&& typeof v.StatementCoverage === 'function'
		&& typeof v.BranchCoverage === 'function'
		&& (v.TestRunProfileKind as Record<string, unknown> | undefined)?.Coverage !== undefined;
}

export function createCoverageController(): vscode.TestController {
	const controller = vscode.tests.createTestController('coverdict', 'coverdict');
	if (hasNativeCoverageApi()) {
		// A no-op run handler: coverage is published programmatically from
		// ui/commands.ts after a real analyze run, never by the user pressing
		// "run" in the Test Explorer (there are no test items to run here yet -
		// that is F3's per-test panel, a different data source).
		controller.createRunProfile('coverdict coverage', vscode.TestRunProfileKind.Coverage, () => { /* not used */ }, true);
	}
	return controller;
}

/**
 * `'detailed'` publishes real per-line `StatementCoverage`/`BranchCoverage`
 * (drives both the Explorer % badge and the editor gutter marks - native
 * ties the two together through `FileCoverage.fromDetails`). `'summary'`
 * publishes only the aggregate count (`new vscode.FileCoverage(uri, count)`,
 * no details attached) - Explorer still shows the % badge, but there is
 * nothing for VS Code to paint in the gutter. This is how
 * `coverdict.gutter.showFileCoverage` and `coverdict.gutter.showLineGutter`
 * can be toggled independently even though the native API itself has no
 * separate on/off for each.
 */
export type FileCoveragePublishMode = 'detailed' | 'summary';

/** @returns true if coverage was actually published (false: unsupported host, or a real addCoverage failure - see Plan.md Bölüm 3's fork caveat). */
export function publishFileCoverage(controller: vscode.TestController, workspaceRoot: string, block: FileCoverageBlock, mode: FileCoveragePublishMode): boolean {
	if (!hasNativeCoverageApi()) {
		return false;
	}
	const partialLineMode = readPartialLineMode();
	const run = controller.createTestRun(new vscode.TestRunRequest());
	try {
		for (const entry of block.files) {
			const uri = vscode.Uri.file(toAbsolutePath(workspaceRoot, entry.path));
			const mapped = mapLines(entry.lines, partialLineMode);
			if (mode === 'detailed') {
				const details = mapped.map(toStatementCoverage);
				run.addCoverage(vscode.FileCoverage.fromDetails(uri, details));
			} else {
				const covered = mapped.filter((m) => classifyLine(m) !== 'uncovered').length;
				run.addCoverage(new vscode.FileCoverage(uri, new vscode.TestCoverageCount(covered, mapped.length)));
			}
		}
		return true;
	} catch {
		// A fork carries the classes but addCoverage/loadDetailedCoverage
		// itself fails at runtime (Plan.md Bölüm 3) - degrade quietly rather
		// than crash the whole analyze command over a gutter.
		return false;
	} finally {
		run.end();
	}
}

/**
 * F4's toggle-off: an empty `TestRun` does NOT reliably clear a prior run's
 * coverage in real VS Code (confirmed by hand, 2026-08-27 - Explorer file-
 * percentage badges kept the old numbers) - VS Code has no "remove this
 * coverage" call at all, so the only guaranteed clear is destroying the
 * `TestController` itself and building a fresh one. The caller must replace
 * its stored controller reference with the return value and re-subscribe it
 * for disposal - the old one is fully disposed here, unusable afterwards.
 */
export function resetCoverageController(oldController: vscode.TestController): vscode.TestController {
	oldController.dispose();
	return createCoverageController();
}

function toStatementCoverage(mapped: MappedLine): vscode.StatementCoverage {
	const position = new vscode.Position(Math.max(0, mapped.line - 1), 0);
	if (mapped.branches.length === 0) {
		return new vscode.StatementCoverage(mapped.executed, position);
	}
	// Real branches (mb/cb from JaCoCo) are exactly the lines dragging
	// sonar-compatible below jacoco-line (D-04) - labeled as such so hovering
	// the gutter answers "which line, and why" without a separate view.
	// Synthetic branch-approximation pairs are labeled as the approximation
	// they are, never presented as if JaCoCo reported them.
	const label = mapped.branchesAreSynthetic
		? 'kısmi satır (uydurulmuş - bkz. coverdict.gutter.partialLineMode)'
		: 'gerçek dal (coverdict\'in sonar-compatible metriğine de dahildir)';
	const branches = mapped.branches.map((state) => new vscode.BranchCoverage(state === 'covered', position, label));
	return new vscode.StatementCoverage(mapped.executed, position, branches);
}

export function readPartialLineMode(): PartialLineMode {
	const configured = vscode.workspace.getConfiguration('coverdict').get<string>('gutter.partialLineMode');
	return configured === 'strict' ? 'strict' : 'branch-approximation';
}
