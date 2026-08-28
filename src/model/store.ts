import type { ChangedFile, FileCoverageBlock, Finding, MetricSet, ModuleInput, MutationBlock, NewCodeCoverage, PerTestBlock, Reason } from '../verdict/types';

/**
 * The one place the last analyze run's data lives (Plan.md Bölüm 2's
 * model/store) - `ui/` reads it to redecorate editors on visibility
 * changes and to feed the sidebar tree views without re-running analyze.
 */

export interface CoverageState {
	workspaceRoot: string;
	fileCoverage: FileCoverageBlock | undefined;
	overall: MetricSet;
	newCode: NewCodeCoverage;
	changedFiles: readonly ChangedFile[];
	findings: readonly Finding[];
	warnings: readonly Reason[];
	/**
	 * Faz 21: CLI'ın `inputs.modules[]` beyanı - kaynak/test kökleri.
	 * "Bu dosya test mi production mı" sorusunun tek doğru cevabı burada;
	 * `model/pathIndex.ts`'in `classifySourcePath`'i bunu okur. Eski bir
	 * verdict'ten geri yüklenirken boş olabilir - o zaman cevap `'unknown'`
	 * olur, uydurulmaz.
	 */
	modules: readonly ModuleInput[];
}

let state: CoverageState | undefined;
let gutterVisible = true;
let staleFiles = new Set<string>();

export function setCoverageState(next: CoverageState): void {
	state = next;
	gutterVisible = true; // a fresh scan always shows - F4's toggle is a per-run choice, not sticky across runs
	staleFiles = new Set(); // a fresh scan is by definition current - Faz 14e
}

/**
 * Faz 14e (eski planın hiç yazılmamış "Açık risk 5"i): bir tarama
 * bittikten sonra dosya düzenlenirse gutter/rozet artık o dosya için
 * eski satır numaralarını boyamaya devam etmemeli - "veri yok" ile
 * "veri bayat" aynı görünmemeli (hard rule 3a). Absolute path anahtarlı,
 * `model/` hâlâ `vscode` import etmiyor (Plan.md Bölüm 2).
 */
export function markFileStale(absolutePath: string): void {
	staleFiles.add(absolutePath);
}

export function isFileStale(absolutePath: string): boolean {
	return staleFiles.has(absolutePath);
}

export function getStaleFiles(): ReadonlySet<string> {
	return staleFiles;
}

export function getCoverageState(): CoverageState | undefined {
	return state;
}

/** F4 (Plan.md Bölüm 4): whether coverage is currently meant to be shown - `ui/commands.ts`'s toggle command flips this and republishes or clears accordingly. */
export function isGutterVisible(): boolean {
	return gutterVisible;
}

export function setGutterVisible(next: boolean): void {
	gutterVisible = next;
}

/** F3: the last run's L2 evidence, set only by `coverdict.analyzePerTest` (a separate command from the main scan - --per-test-report needs a diff mode, D-55). */
export interface PerTestState {
	moduleId: string;
	perTest: PerTestBlock | undefined;
	warnings: readonly Reason[];
}

let perTestState: PerTestState | undefined;

export function setPerTestState(next: PerTestState): void {
	perTestState = next;
}

export function getPerTestState(): PerTestState | undefined {
	return perTestState;
}

/**
 * Faz 20: son mutasyon koşusunun L3 kanıtı. `perTest` gibi ayrı tutuluyor -
 * mutasyon kendi komutundan gelir ve dakikalar/saatler sürebilir, bir
 * kapsama taraması onu ezmemeli. `targets` koşunun neyi hedeflediğini
 * söyler: "sonuç boş" ile "hiç sorulmadı" ayırt edilebilsin diye
 * (hard rule 3a).
 */
export interface MutationState {
	moduleId: string;
	mutation: MutationBlock | undefined;
	warnings: readonly Reason[];
	targets: readonly string[];
	/**
	 * Faz 22: bu koşunun bittiği an (`Date.now()`), mutasyon panelinin
	 * "ne kadar önce" başlığı için. Diskten geri yüklenen bir sonuçta
	 * `undefined` - CLI'ın çıktısı zaman damgası taşımaz (byte-deterministik
	 * kalması için), o yüzden bir dosya mtime'ından "koşu bitti" anını
	 * tahmin etmek yanıltıcı olurdu (hard rule 3a).
	 */
	ranAt: number | undefined;
}

let mutationState: MutationState | undefined;

export function setMutationState(next: MutationState): void {
	mutationState = next;
}

export function getMutationState(): MutationState | undefined {
	return mutationState;
}
