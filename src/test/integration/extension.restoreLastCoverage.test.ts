import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { restoreLastCoverageFrom } from '../../extension';
import { createDiagnosticCollection } from '../../ui/diagnostics';
import { ExplorerBadgeProvider } from '../../ui/explorerBadges';
import { createGutterDecorationTypes } from '../../ui/gutterRenderer';
import { createStatusBarItem } from '../../ui/statusBar';
import { MUTATION_STORAGE_FILE, type CoverageSinks, type MutationSnapshot } from '../../ui/commands';
import { CoverageTreeProvider } from '../../ui/treeViews/coverageView';
import { LineTestsTreeProvider, type LineTestsNode } from '../../ui/treeViews/lineTestsView';
import { MutationTreeProvider, type MutationNode } from '../../ui/treeViews/mutationView';
import { QualityTreeProvider, type QualityNode } from '../../ui/treeViews/qualityView';
import { RunTreeProvider } from '../../ui/treeViews/runView';

const METRIC = { numeratorName: 'a', numerator: 1, denominatorName: 'b', denominator: 1, percent: 100 };
const METRIC_SET = { 'jacoco-line': METRIC, 'strict-line': METRIC, 'sonar-compatible': METRIC };

/**
 * Real shape from a live `--no-vcs --file-coverage --per-test-report
 * --mutation-report` run (verbatim field names from PLAN.md §7.0/§8) - one
 * production class, one per-test entry, one mutation method.
 */
function realVerdictJson(): unknown {
	return {
		schemaVersion: '1', tool: { name: 'coverdict', version: '0.0.0' },
		analysis: { status: 'complete', exitCode: 0, incompleteReasons: [] },
		inputs: { modules: [{ id: 'root', root: '.', sourceRoots: ['src/main/java'], testRoots: ['src/test/java'] }] },
		coverage: { overall: METRIC_SET, newCode: { status: 'unavailable_no_vcs' } },
		changedFiles: [], findings: [], warnings: [],
		fileCoverage: {
			files: [{ module: 'root', path: 'src/main/java/dev/coverdict/playground/Calculator.java', metrics: METRIC_SET, lines: [] }],
			excluded: [],
		},
		perTest: {
			engine: 'pitest', engineVersion: '1.15.8',
			modules: [{
				id: 'root',
				entries: [{
					className: 'dev.coverdict.playground.Calculator', methodName: 'square',
					lines: [{ line: 37, tests: ['[class:dev.coverdict.playground.CalculatorGoodTest]/[method:squareWorks()]'] }],
				}],
				ambient: [],
			}],
		},
		// Faz 25 (§7.5): deliberately no `mutation` block here anymore -
		// mutation restoration now comes from its own file (mutation-current.json,
		// written by writeMutationSnapshot), independent of this one, because a
		// later Hızlı/Derin Tarama overwrites this file without a mutation block
		// and used to silently erase the last mutation result on the next reload
		// (the real bug the user hit, 2026-08-28).
	};
}

/** Real shape `writeMutationSnapshot` (`ui/commands.ts`) produces - same mutation method as `realVerdictJson`'s per-test entry, so both views describe the same class consistently. */
function realMutationSnapshot(ranAtMs: number): MutationSnapshot {
	return {
		moduleId: 'root',
		mutation: {
			engine: 'pitest', engineVersion: '1.15.8',
			modules: [{
				id: 'root',
				methods: [{
					className: 'dev.coverdict.playground.Calculator', methodName: 'square', methodDescription: '(I)I',
					firstLine: 37, lastLine: 37,
					mutants: [{
						mutator: 'org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator',
						line: 37, status: 'SURVIVED', killingTests: [],
					}],
				}],
			}],
		},
		warnings: [],
		targets: ['dev.coverdict.playground.Calculator'],
		ranAtMs,
	};
}

function buildSinks(): CoverageSinks {
	return {
		context: {} as vscode.ExtensionContext,
		gutterTypes: createGutterDecorationTypes(),
		explorerBadges: new ExplorerBadgeProvider(),
		statusBarItem: createStatusBarItem(),
		diagnostics: createDiagnosticCollection(),
		runView: new RunTreeProvider(),
		coverageView: new CoverageTreeProvider(),
		qualityView: new QualityTreeProvider(),
		// restoreLastCoverageFrom never calls .reveal() - only the Faz 24
		// bridge commands do - so these don't need to be real TreeViews here.
		qualityTreeView: {} as vscode.TreeView<QualityNode>,
		lineTestsView: new LineTestsTreeProvider(),
		lineTestsTreeView: {} as vscode.TreeView<LineTestsNode>,
		mutationView: new MutationTreeProvider(),
		mutationTreeView: {} as vscode.TreeView<MutationNode>,
	};
}

/** Records a snapshot of `getChildren()` every time `refresh()` fires - the exact signal a real `TreeView` would re-render on. */
function spyRefresh<N>(view: { refresh(): void; getChildren(): N[] }): N[][] {
	const snapshots: N[][] = [];
	view.refresh = () => {
		snapshots.push(view.getChildren());
	};
	return snapshots;
}

suite('extension.restoreLastCoverageFrom (Faz 23/25 - pencere yenileme)', () => {
	test('a saved verdict with perTest, plus a separate mutation-current.json, leaves both views populated after restore, not stuck on their pre-restore snapshot', async () => {
		const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-restore-'));
		fs.writeFileSync(path.join(storageDir, 'verdict-current.json'), JSON.stringify(realVerdictJson()), 'utf8');
		fs.writeFileSync(path.join(storageDir, MUTATION_STORAGE_FILE), JSON.stringify(realMutationSnapshot(Date.now() - 60_000)), 'utf8');

		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-restore-ws-'));
		const classDir = path.join(workspaceRoot, 'src', 'main', 'java', 'dev', 'coverdict', 'playground');
		fs.mkdirSync(classDir, { recursive: true });
		const classFile = path.join(classDir, 'Calculator.java');
		fs.writeFileSync(classFile, 'package dev.coverdict.playground;\n\npublic class Calculator {\n}\n', 'utf8');
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(classFile));

		const sinks = buildSinks();
		// The Java file must already be "active" before the restore runs -
		// exactly like a real reload, where lineTestsView tracks whichever
		// editor was last active and only redraws on its own refresh() signal.
		sinks.lineTestsView.setActiveDocument(document);

		const lineTestsSnapshots = spyRefresh<LineTestsNode>(sinks.lineTestsView);
		const mutationSnapshots = spyRefresh<MutationNode>(sinks.mutationView);

		await restoreLastCoverageFrom(storageDir, workspaceRoot, sinks);

		// Faz 23 regression: before the fix, mutationView.refresh() is never
		// called at all on restore, so the real TreeView never re-queries and
		// stays on "Henüz mutasyon testi çalıştırılmadı" forever.
		assert.ok(mutationSnapshots.length > 0, 'mutationView.refresh() must fire at least once on restore');
		assert.equal(mutationSnapshots.at(-1)![0]?.kind, 'header', 'the last redraw mutationView would have done must show the restored result, not the empty state');

		// Faz 23 regression: publishAnalysis() fires lineTestsView.refresh()
		// once *before* setPerTestState runs, so the only redraw a real
		// TreeView would have done (pre-fix) is against stale/empty state.
		// A second, later refresh() (post-fix) is what makes it redraw again
		// with the now-populated perTest data.
		assert.ok(lineTestsSnapshots.length > 0, 'lineTestsView.refresh() must fire on restore');
		assert.equal(lineTestsSnapshots.at(-1)![0]?.kind, 'prodLine', 'the last redraw lineTestsView would have done must show the restored per-test data, not the pre-setPerTestState empty state');

		// Faz 25: mutation-current.json carries our own real timestamp, so a
		// restored result must say "N dakika önce", not "kaydedilmiş sonuç -
		// ne zaman çalıştığı bilinmiyor" (that message is for when we truly
		// don't know, which is no longer true once we own the timestamp).
		const header = mutationSnapshots.at(-1)![0];
		assert.equal(header?.kind, 'header');
		if (header?.kind === 'header') {
			assert.match(header.text, /dakika önce/);
		}
	});

	/**
	 * Faz 25 (§7.5) - the exact real bug the user hit (2026-08-28): ran a
	 * mutation test, then later ran a Derin Tarama, then reloaded the
	 * window - the mutation result was gone. `verdict-current.json` here
	 * has no `mutation` block at all (that is what the later Derin Tarama's
	 * own verdict looks like); the mutation result must still restore from
	 * its own independent file.
	 */
	test('mutation restores from its own file even when the latest verdict-current.json has no mutation block at all', async () => {
		const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-restore-'));
		fs.writeFileSync(path.join(storageDir, 'verdict-current.json'), JSON.stringify(realVerdictJson()), 'utf8');
		fs.writeFileSync(path.join(storageDir, MUTATION_STORAGE_FILE), JSON.stringify(realMutationSnapshot(Date.now() - 5 * 60_000)), 'utf8');

		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-restore-ws2-'));
		const sinks = buildSinks();
		const mutationSnapshots = spyRefresh<MutationNode>(sinks.mutationView);

		await restoreLastCoverageFrom(storageDir, workspaceRoot, sinks);

		assert.ok(mutationSnapshots.length > 0, 'mutation must restore independently of verdict-current.json having no mutation block');
		const header = mutationSnapshots.at(-1)![0];
		assert.equal(header?.kind, 'header');
		if (header?.kind === 'header') {
			assert.match(header.text, /Calculator/, 'the real target name must survive, not just the timestamp');
			assert.match(header.text, /5 dakika önce/);
		}
	});

	test('a missing mutation-current.json (never ran mutation, or a pre-Faz-25 install) leaves the mutation view in its normal "never run" state, not an error', async () => {
		const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-restore-'));
		fs.writeFileSync(path.join(storageDir, 'verdict-current.json'), JSON.stringify(realVerdictJson()), 'utf8');
		// No mutation-current.json written at all.

		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-restore-ws3-'));
		const sinks = buildSinks();
		const mutationSnapshots = spyRefresh<MutationNode>(sinks.mutationView);

		await restoreLastCoverageFrom(storageDir, workspaceRoot, sinks);

		assert.equal(mutationSnapshots.length, 0, 'no snapshot exists on disk - refresh() must not fire, view stays on its real initial "never run" render');
	});

	test('a corrupted mutation-current.json (truncated write, disk full mid-save) is ignored, not thrown', async () => {
		const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-restore-'));
		fs.writeFileSync(path.join(storageDir, 'verdict-current.json'), JSON.stringify(realVerdictJson()), 'utf8');
		fs.writeFileSync(path.join(storageDir, MUTATION_STORAGE_FILE), '{"moduleId": "root", "mutat', 'utf8');

		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-restore-ws4-'));
		const sinks = buildSinks();
		const mutationSnapshots = spyRefresh<MutationNode>(sinks.mutationView);

		await assert.doesNotReject(restoreLastCoverageFrom(storageDir, workspaceRoot, sinks));
		assert.equal(mutationSnapshots.length, 0);
	});

	test('a mutation-current.json missing a required field (e.g. from a hypothetical older shape) is ignored, not guessed at', async () => {
		const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-restore-'));
		fs.writeFileSync(path.join(storageDir, 'verdict-current.json'), JSON.stringify(realVerdictJson()), 'utf8');
		const withoutTimestamp: Record<string, unknown> = { ...realMutationSnapshot(Date.now()) };
		delete withoutTimestamp.ranAtMs;
		fs.writeFileSync(path.join(storageDir, MUTATION_STORAGE_FILE), JSON.stringify(withoutTimestamp), 'utf8');

		const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-restore-ws5-'));
		const sinks = buildSinks();
		const mutationSnapshots = spyRefresh<MutationNode>(sinks.mutationView);

		await restoreLastCoverageFrom(storageDir, workspaceRoot, sinks);

		assert.equal(mutationSnapshots.length, 0, 'a malformed snapshot must not be partially trusted');
	});
});
