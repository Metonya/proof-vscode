import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { formatRelativeTime } from '../../model/mutationModel';
import { getMutationState, isGutterVisible } from '../../model/store';
import { PERTEST_STORAGE_FILE, resolveStorageRoot } from '../commands';
import { detectRunTestsBuildTool } from '../preflight';

/**
 * Faz 11b: "proof-java: Çalıştır" - komut paletine gitmeden analiz
 * başlatmak için sol kenar çubuğu görünümü.
 *
 * **Faz 18 - iki butona indirildi.** Kullanıcının kendi geri bildirimi:
 * "son kullanıcı olarak fazla buton var... benim isteğim proof-java'in
 * kullanılması, kötü testleri tespit, coverage'ın overall ve new code
 * olarak hesaplanması, hangi test hangi yeri cover ediyor görmek,
 * mutasyon başlatmak". Beş komut yerine iki tarama var, ikisi de ne
 * yaptığını ve ne kadar süreceğini söylüyor:
  *   - **Hızlı Tarama**: coverage (overall + yeni kod) + kötü test bulguları.
 *   - **Derin Tarama**: ayrıca hangi test hangi satırı cover ediyor (L2).
 * Dar kapsamlı "bu sınıf için" işi editör sağ-tık menüsüne taşındı
 * (`package.json`'daki `editor/context`), ağaçtan kalktı. Aç/kapa ve
 * görünüme odaklanma da eylem değil, durum - onlar da kalktı; aç/kapa
 * zaten durum çubuğundan tek tıkla yapılıyor.
 */
export class RunTreeProvider implements vscode.TreeDataProvider<RunItem> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	refresh(): void {
		this.changeEmitter.fire();
	}

	getTreeItem(item: RunItem): vscode.TreeItem {
		return item;
	}

	getChildren(): RunItem[] {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return [new RunItem('Open a folder first', undefined, undefined, 'warning')];
		}

		const config = vscode.workspace.getConfiguration('proof', folder);
		const diffMode = config.get<string>('diffMode') ?? 'uncommitted';
		const scopeText = diffModeText(diffMode, config.get<string>('baseRef'));
		const noVcs = diffMode === 'no-vcs';

		// Faz 33 (user request): "no-vcs" used to disable Deep Scan/Mutation
		// Testing entirely, pointing only at the single-class right-click.
		// But the whole-module, diff-independent commands
		// (`perTestForModuleAll`/`mutationForModuleAll`) never needed a diff
		// in the first place - they list every production class directly -
		// so there is no real reason to disable the row; it just needs to
		// run that command instead of the diff-scoped one.
		const deepScanItem = noVcs
			? new RunItem(
				'Deep Scan (whole module, no diff)',
				`everything Quick Scan has + which test covers which line · ${deepScanFreshnessText(folder)}`,
				'proof.perTestForModuleAll',
				'beaker',
				'DEEP SCAN IS NOT MUTATION TESTING - mutation is its own separate item below.\n\n'
				+ 'Can take minutes (reruns the tests under the PIT engine, but only to record which test touches which line - it does not mutate the code).\n\nOn top of everything Quick Scan does:\n· Which tests execute each line ("Line → Tests" view)\n· "Falsely green" lines - covered, but none of the covering tests has a real assertion\n\nScope: every production class in the module - "no-vcs" mode has no concept of a changed file, so there\'s no diff to scope to.',
			)
			: new RunItem(
				'Deep Scan (+ line→test map)',
				`everything Quick Scan has + which test covers which line · ${deepScanFreshnessText(folder)}`,
				'proof.analyzePerTest',
				'beaker',
				'DEEP SCAN IS NOT MUTATION TESTING - mutation is its own separate item below.\n\n'
				+ `Can take minutes (reruns the tests under the PIT engine, but only to record which test touches which line - it does not mutate the code).\n\nOn top of everything Quick Scan does:\n· Which tests execute each line ("Line → Tests" view)\n· "Falsely green" lines - covered, but none of the covering tests has a real assertion\n\nScope: classes changed within ${scopeText}. Use the button on the right to scan the whole module regardless of the diff instead.`,
				'proof.runItem.deepScan',
			);

		// Faz 20: mutation is its own item. Never auto-triggered, and the
		// module-wide run sits behind a confirmation dialog - a single
		// class takes seconds, a large module can take over an hour.
		// Faz 33: same no-vcs fix as Deep Scan above.
		const mutationItem = noVcs
			? new RunItem(
				'Mutation Testing (whole module, no diff)',
				`deliberately break the code, find where no test notices · ${mutationFreshnessText()}`,
				'proof.mutationForModuleAll',
				'zap',
				'REAL MUTATION TESTING (different from Deep Scan).\n\n'
				+ 'Generates small variants ("mutants") of the code and reruns the tests. If a mutant survives, we broke the code and no test noticed - meaning an assertion verifying that behavior is missing.\n\n'
				+ 'TAKES A WHILE: can exceed an hour on a large module, so this asks for confirmation. A single class is usually seconds - right-click that file → "Mutation Test This Class".\n\n'
				+ 'Scope: every production class in the module - "no-vcs" mode has no concept of a changed file, so there\'s no diff to scope to. Results appear in the "Mutation" view.',
			)
			: new RunItem(
				'Mutation Testing (diff-scoped)',
				`deliberately break the code, find where no test notices · ${mutationFreshnessText()}`,
				'proof.mutationForModule',
				'zap',
				'REAL MUTATION TESTING (different from Deep Scan).\n\n'
				+ 'Generates small variants ("mutants") of the code and reruns the tests. If a mutant survives, we broke the code and no test noticed - meaning an assertion verifying that behavior is missing.\n\n'
				+ 'TAKES A WHILE: can exceed an hour on a large module, so this asks for confirmation. A single class is usually seconds - right-click that file → "Mutation Test This Class".\n\n'
				+ `Scope: classes changed within ${scopeText}. Results appear in the "Mutation" view. Use the button on the right to scan the whole module regardless of the diff instead.`,
				'proof.runItem.mutation',
			);

		return [
			// Faz 30 (§7.8): the user's explicit ask for an "easy re-run
			// button" - always available, without having to wait for a full
			// analyze run just because the report is missing.
			runTestsItem(folder),
			new RunItem(
				'Quick Scan (overall + new code)',
				`coverage + bad test findings · new code: ${scopeText} · ${quickScanFreshnessText(folder)}`,
				'proof.analyze',
				'play',
				`Takes seconds. Computes:\n· Overall coverage (whole repo)\n· New code coverage (${scopeText})\n· Test quality findings (tests with no or weak assertions)`,
			),
			deepScanItem,
			mutationItem,
			new RunItem(
				'Coverage View',
				isGutterVisible() ? 'on - click to hide' : 'off - click to show',
				'proof.toggleCoverage',
				isGutterVisible() ? 'eye' : 'eye-closed',
				'Toggles the editor line colors and Explorer badges together. Does not rerun the scan.',
			),
			// Faz 34 (user request): one-time setup actions, not scans - kept
			// separate from the run-a-scan rows above.
			new RunItem(
				'Download proof-java.jar',
				'from the latest GitHub release, workspace or user scope',
				'proof.downloadJar',
				'cloud-download',
				'Downloads proof-java.jar from proof-java\'s latest GitHub release and verifies it against the published SHA-256 checksum. Installs to either this workspace or a user-wide location every workspace on this machine can find - no other setting to change afterward.',
			),
			new RunItem(
				'Install Skill for AI Agent',
				'Claude Code, Windsurf, Antigravity, or the portable .agents/skills',
				'proof.installSkill',
				'cloud-download',
				'Fetches the current proof-java skill from GitHub and installs it for the AI coding agent of your choice, at either workspace or user scope. Always pulls the latest version - nothing is bundled with this extension.',
			),
		];
	}
}

/** Faz "Gradle support" G2: the button's own label used to hardcode "Maven" - stale now that Run Tests also runs a real Gradle build (via its own committed wrapper) on a Gradle workspace. Mirrors detectRunTestsBuildTool's own priority so this never disagrees with what actually runs when clicked. */
function runTestsItem(folder: vscode.WorkspaceFolder): RunItem {
	const buildTool = detectRunTestsBuildTool(folder);
	const label = buildTool === 'gradle' ? 'Run Tests (Gradle + JaCoCo)' : 'Run Tests (Maven + JaCoCo)';
	const tooltip = buildTool === 'gradle'
		? 'Runs "gradlew test jacocoTestReport" (in a visible terminal) and refreshes the report - only ever the workspace\'s own committed wrapper, never a bare \'gradle\' on PATH. Quick Scan runs automatically when it finishes.'
		: 'Runs the tests under JaCoCo via Maven (in a visible terminal) and refreshes the report. Adds the JaCoCo plugin from the command line if the pom doesn\'t declare one - never a permanent pom change. Quick Scan runs automatically when it finishes.';
	return new RunItem(label, reportFreshnessText(folder), 'proof.runTests', 'run-all', tooltip);
}

/** Best-effort: the configured report's own mtime, the same "is this stale?" signal `--file-coverage`-driven staleness already relies on elsewhere. A missing report is not an error here, just its own "not yet" state (hard rule 3a: absence gets its own state, not a guess). */
function reportFreshnessText(folder: vscode.WorkspaceFolder): string {
	const reportPath = vscode.workspace.getConfiguration('proof', folder).get<string>('reportPath') || 'target/site/jacoco/jacoco.xml';
	try {
		const stat = fs.statSync(path.join(folder.uri.fsPath, reportPath));
		return `report: ${formatRelativeTime(stat.mtimeMs, Date.now())}`;
	} catch {
		return 'report: not yet generated';
	}
}

/** Faz 33 (user request): the Run panel's own "last ran" freshness signal (same style as `reportFreshnessText` above) for Mutation Testing specifically - it has its own real timestamp (`MutationState.ranAt`, set at write time since the CLI's own output carries none, D-25/§7.5) independent of the JaCoCo report's mtime. */
function mutationFreshnessText(): string {
	const ranAt = getMutationState()?.ranAt;
	return ranAt === undefined ? 'never run' : `last run: ${formatRelativeTime(ranAt, Date.now())}`;
}

/** Faz 33 (user request): same freshness signal for Quick Scan, using `.proof/verdict-current.json`'s own mtime - that file is written fresh on every `proof.analyze` run, so its mtime is exactly "when did Quick Scan (or Deep Scan, a superset) last run" without needing a new state field. */
function quickScanFreshnessText(folder: vscode.WorkspaceFolder): string {
	try {
		const stat = fs.statSync(path.join(resolveStorageRoot(folder).fsPath, 'verdict-current.json'));
		return `last run: ${formatRelativeTime(stat.mtimeMs, Date.now())}`;
	} catch {
		return 'never run';
	}
}

/** Faz 33: same idea as `quickScanFreshnessText`, but reads `.proof/pertest-current.json`'s mtime specifically - that file is only ever written when per-test evidence was actually collected (Deep Scan's own step), so it does not go stale just because a plain Quick Scan ran afterward. */
function deepScanFreshnessText(folder: vscode.WorkspaceFolder): string {
	try {
		const stat = fs.statSync(path.join(resolveStorageRoot(folder).fsPath, PERTEST_STORAGE_FILE));
		return `last run: ${formatRelativeTime(stat.mtimeMs, Date.now())}`;
	} catch {
		return 'never run';
	}
}

function diffModeText(diffMode: string, baseRef: string | undefined): string {
	if (diffMode === 'base') {
		return `diff against ${baseRef?.trim() || '(baseRef not set)'}`;
	}
	if (diffMode === 'no-vcs') {
		return 'not computed (no-vcs)';
	}
	return 'uncommitted changes';
}

class RunItem extends vscode.TreeItem {
	/** `contextValue` (Faz 33) drives `package.json`'s `view/item/context` inline-icon menus - only Deep Scan/Mutation Testing's diff-scoped rows set one, for the "run this for the whole module instead" shortcut. */
	constructor(label: string, description: string | undefined, commandId: string | undefined, icon: string, tooltip?: string, contextValue?: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = description;
		this.iconPath = new vscode.ThemeIcon(icon);
		this.tooltip = tooltip;
		this.contextValue = contextValue;
		if (commandId) {
			this.command = { command: commandId, title: label };
		}
	}
}
