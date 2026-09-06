import * as vscode from 'vscode';

import { testsForClass } from '../../model/lineIndex';
import { allMutantsNoCoverage, bucketOf, classesOf, findMutatedMethod, formatRelativeTime, methodLabel, mutatorLabel, productionMethodKey, scoreOf, scoreOfMethods, targetSummary, type MutantBucket, type MutationScore } from '../../model/mutationModel';
import { toAbsolutePath } from '../../model/pathIndex';
import { buildProductionClassIndex, productionSourceRoots, testSourceRoots } from '../../model/productionClassIndex';
import { getCoverageState, getMutationState, getPerTestState } from '../../model/store';
import { parseTestIdentity } from '../../verdict/testIdentity';
import type { Finding, MutatedMethod, Mutant } from '../../verdict/types';
import { locateTestFile } from '../testFileLocator';

/**
 * Faz 20: mutasyon raporu. Kullanıcının isteği: "mutasyon testinde ne kadar
 * ilerledi yüzde vs kapsamlı rapor vs baya birşey istiyorum."
 *
 * Hiyerarşi **sınıf → metot → mutant**. Her düzeyde skor
 * `öldürülen/(öldürülen+hayatta kalan)`; belirsizler paydaya girmez ve
 * **ayrıca sayılır** (hard rule 3a - bkz. `model/mutationModel.ts`).
 * Bir mutanta tıklamak onu üreten satıra gider; öldüren testler mutantın
 * altında okunabilir adlarıyla listelenir.
 *
 * "Hayatta kalan" mutant, gerçek bulgudur: kodu bozduk, hiçbir test fark
 * etmedi. O yüzden varsayılan olarak sınıflar/metotlar hayatta kalanı
 * olanlar üstte sıralanmaz - CLI'ın sırası korunur (deterministik çıktı),
 * ama hayatta kalan sayısı her düzeyde açıklamada görünür.
 */
export type MutationNode =
	| { kind: 'empty'; message: string }
	| { kind: 'runHint' }
	/** Faz 31: diff hiç değişen sınıf bulamadığında ("ben değişiklik yapmadan tüm repoda tarama yapabilmeliyim") - diff'ten bağımsız, modüldeki her production sınıfını hedefleyen kurtarma eylemi. */
	| { kind: 'scanAllHint' }
	/** Faz 22: "bu sonuç neyin, ne zaman?" - dosyadan dosyaya geçince panel değişmediği için hangi koşuya baktığı belli değildi. */
	| { kind: 'header'; text: string }
	| { kind: 'class'; className: string; methods: readonly MutatedMethod[] }
	| { kind: 'method'; className: string; method: MutatedMethod; siblings: readonly MutatedMethod[] }
	| { kind: 'mutant'; className: string; mutant: Mutant }
	| { kind: 'killingTest'; rawTestId: string };

export class MutationTreeProvider implements vscode.TreeDataProvider<MutationNode> {
	private readonly changeEmitter = new vscode.EventEmitter<MutationNode | undefined>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	/** Faz 20: yalnızca hayatta kalan mutantı olan metotlar - "asıl bakılması gereken" süzgeci. */
	private survivorsOnly = false;

	refresh(): void {
		this.changeEmitter.fire(undefined);
	}

	toggleSurvivorsOnly(): boolean {
		this.survivorsOnly = !this.survivorsOnly;
		this.changeEmitter.fire(undefined);
		return this.survivorsOnly;
	}

	isSurvivorsOnly(): boolean {
		return this.survivorsOnly;
	}

	/**
	 * Faz 24 (§7.6 madde 5): Test Kalitesi ↔ Mutasyon köprüsü `reveal()`
	 * kullanıyor, o da (sınıfın altında henüz açılmamış bir metodu
	 * bulabilmek için) `getParent`'a ihtiyaç duyuyor. Yalnızca `method` ->
	 * `class` yönü gerekli - köprünün hedefi metot düzeyi, tek tek mutant
	 * değil. `siblings` zaten `getChildren`'ın ürettiği (süzgeçlenmiş)
	 * metot listesinin aynısı, o yüzden yeniden hesaplamadan doğrudan
	 * kullanılabilir.
	 */
	getParent(node: MutationNode): MutationNode | undefined {
		return node.kind === 'method' ? { kind: 'class', className: node.className, methods: node.siblings } : undefined;
	}

	getTreeItem(node: MutationNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
		switch (node.kind) {
			case 'empty':
				return leaf(node.message, 'info');
			case 'runHint':
				return runHintItem();
			case 'scanAllHint':
				return scanAllHintItem();
			case 'header':
				return headerItem(node.text);
			case 'class':
				return classItem(node.className, node.methods);
			case 'method':
				return methodItem(node);
			case 'mutant':
				return mutantItem(node.className, node.mutant);
			case 'killingTest':
				return killingTestItem(node.rawTestId);
		}
	}

	getChildren(node?: MutationNode): MutationNode[] {
		if (!node) {
			return this.rootChildren();
		}
		if (node.kind === 'class') {
			return this.visibleMethods(node.methods).map((method): MutationNode => ({
				kind: 'method', className: node.className, method, siblings: node.methods,
			}));
		}
		if (node.kind === 'method') {
			return node.method.mutants.map((mutant): MutationNode => ({ kind: 'mutant', className: node.className, mutant }));
		}
		if (node.kind === 'mutant') {
			return node.mutant.killingTests.map((rawTestId): MutationNode => ({ kind: 'killingTest', rawTestId }));
		}
		return [];
	}

	private rootChildren(): MutationNode[] {
		const state = getMutationState();
		if (!state) {
			return [
				{ kind: 'empty', message: 'No mutation test has run yet.' },
				{ kind: 'runHint' },
			];
		}
		if (!state.mutation) {
			const nodes: MutationNode[] = [{ kind: 'empty', message: noMutationEvidenceMessage() }, { kind: 'runHint' }];
			if (hasNoChangedTargetsWarning(state)) {
				nodes.push({ kind: 'scanAllHint' });
			}
			return nodes;
		}

		const header: MutationNode = { kind: 'header', text: headerText(state) };
		const classes = classesOf(state.mutation, productionClassFilter())
			.map((c) => ({ ...c, methods: this.visibleMethods(c.methods) }))
			.filter((c) => c.methods.length > 0);

		if (classes.length === 0) {
			if (this.survivorsOnly) {
				return [header, {
					kind: 'empty',
					message: 'No surviving mutants - every generated mutant was caught by at least one test. (Click the title-bar filter to remove this filter.)',
				}];
			}
			// Faz 31 düzeltmesi: CLI, MUTATION_NO_CHANGED_TARGETS'ta bile boş
			// (ama null olmayan) bir mutation nesnesi döndürüyor - state.mutation
			// bu yüzden burada "var" görünüyor ve yukarıdaki !state.mutation dalı
			// hiç çalışmıyor, "Tüm Modülü Tara" düğmesi gerçek bir sebep varken
			// bile hiç görünmüyordu (gson dogfood'unda yakalandı). Aynı uyarı
			// kontrolü burada da yapılmalı. `runHint` da eksikti - bir koşu zaten
			// olsa bile (boş de olsa) "aktif dosya için çalıştır" seçeneği hep
			// anlamlı, `!state.mutation` dalıyla aynı davranış (kullanıcı isteği).
			const nodes: MutationNode[] = [header, {
				kind: 'empty',
				message: hasNoChangedTargetsWarning(state)
					? noMutationEvidenceMessage()
					: 'No mutants were generated for any production method in this run. The targeted classes may not contain mutable code. (Test classes\' own mutants are deliberately not shown.)',
			}, { kind: 'runHint' }];
			if (hasNoChangedTargetsWarning(state)) {
				nodes.push({ kind: 'scanAllHint' });
			}
			return nodes;
		}
		// Kullanıcı isteği: gerçek bir sonuç ekrandayken (ör. bir sınıfın
		// mutasyon sonucuna bakılırken) başka bir dosyaya geçince "aktif
		// dosya için çalıştır"/"tüm modülü tara" seçenekleri tamamen
		// kayboluyordu - sadece boş sonuç durumlarında vardı. Artık her
		// zaman görünürler - başlığın hemen altında, sınıf sonuçlarının
		// üstünde (kullanıcı isteği: uzun bir listeyi kaydırmadan
		// erişilebilir olsunlar).
		return [
			header,
			{ kind: 'runHint' },
			{ kind: 'scanAllHint' },
			...classes.map((c): MutationNode => ({ kind: 'class', className: c.className, methods: c.methods })),
		];
	}

	private visibleMethods(methods: readonly MutatedMethod[]): readonly MutatedMethod[] {
		return this.survivorsOnly
			? methods.filter((m) => m.mutants.some((mutant) => bucketOf(mutant.status) === 'survived'))
			: methods;
	}
}

/**
 * Faz 20: kanıt yok - ama neden yok? CLI'ın uyarı kodları farklı sebepler
 * söyler ve her biri farklı bir çözüm ister; hepsini "sonuç yok" diye
 * göstermek hard rule 3a ihlali olurdu.
 */
/** Faz 31 düzeltmesi: paylaşılan kontrol, hem `!state.mutation` hem `classes.length === 0` dallarında kullanılıyor - bkz. rootChildren'daki not. */
function hasNoChangedTargetsWarning(state: NonNullable<ReturnType<typeof getMutationState>>): boolean {
	return state.warnings.some((w) => w.code === 'MUTATION_NO_CHANGED_TARGETS');
}

function noMutationEvidenceMessage(): string {
	const state = getMutationState();
	// Faz 30: `state.warnings` is already the complete, exact warning list this
	// run produced - there is no "wrong module" a warning in it could belong
	// to, so filtering by module (the old `w.module === state.moduleId` check)
	// never excluded anything real. Matching by code alone is the same
	// behavior without a moduleId to compare against.
	const warningFor = (code: string) => state?.warnings.find((w) => w.code === code);

	if (warningFor('MUTATION_BUDGET_EXCEEDED')) {
		return 'The mutation run exceeded its time budget and stopped before producing a result. Raise proof.mutationTimeout, or target a single class (right-click a file).';
	}
	if (warningFor('MUTATION_COLLECTION_FAILED')) {
		return 'The mutation run failed. See Output → proof-java for the reason.';
	}
	if (warningFor('MUTATION_TARGET_UNRESOLVED')) {
		return 'The targeted class wasn\'t found under any source root - the class name or source roots may be different from expected.';
	}
	if (warningFor('MUTATION_CLASSPATH_MISSING')) {
		return 'No classpath list is bound for mutation. Re-run the command; the extension will offer to generate the list with Maven.';
	}
	if (warningFor('MUTATION_NO_CHANGED_TARGETS')) {
		return 'No production class changed in this run, so there\'s no target to mutate. To run this for a single class: right-click that file → "Mutation Test This Class", or use the button below to scan the whole module regardless of the diff.';
	}
	if (warningFor('MUTATION_TRUNCATED')) {
		return 'Mutant records hit their upper limit - what\'s shown is incomplete. Re-run with a narrower target.';
	}
	return 'This run produced no mutation evidence. See Output → proof-java for the MUTATION_* warnings.';
}

/**
 * Faz 22: "Hedef: Calculator · 5 dakika önce" ya da `ranAt` bilinmiyorsa
 * "Hedef: Calculator · kaydedilmiş sonuç". Faz 25'ten beri pencere
 * yenilemesi de gerçek bir `ranAt` taşıyor (`mutation-current.json` kendi
 * zaman damgasını tutuyor) - bu dal artık yalnızca eski bir eklenti
 * sürümünden kalma damgasız bir dosya gibi gerçekten bilinmeyen durumlar
 * için var.
 */
function headerText(state: NonNullable<ReturnType<typeof getMutationState>>): string {
	const target = targetSummary(state.targets);
	const when = state.ranAt === undefined ? 'saved result - when it ran in this window is unknown' : formatRelativeTime(state.ranAt, Date.now());
	return `Target: ${target} · ${when}`;
}

function headerItem(text: string): vscode.TreeItem {
	const item = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon('history');
	item.contextValue = 'proof.mutationHeader';
	return item;
}

function runHintItem(): vscode.TreeItem {
	const item = new vscode.TreeItem('Run Mutation Testing', vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon('play');
	item.command = { command: 'proof.mutationForFile', title: 'Run Mutation Testing' };
	item.tooltip = 'Runs mutation testing for the class in the open Java file (a single class: usually seconds). For a module-wide run, use the Mutation Testing item in the Run view.';
	return item;
}

/** User request: "I should be able to scan the whole repo without making a change" - the recovery action offered when the diff finds no target at all, `proof.mutationForModuleAll`. Sits behind its own confirmation since it can be more expensive than the diff-based run. */
function scanAllHintItem(): vscode.TreeItem {
	const item = new vscode.TreeItem('Scan Whole Module Anyway (no diff)', vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon('play');
	item.command = { command: 'proof.mutationForModuleAll', title: 'Scan Whole Module' };
	item.tooltip = 'Targets every production class in this module regardless of the diff - can take longer than the diff-based "whole module" run since it includes unchanged classes too.';
	return item;
}

function classItem(className: string, methods: readonly MutatedMethod[]): vscode.TreeItem {
	const score = scoreOfMethods(methods);
	const item = new vscode.TreeItem(shortName(className), vscode.TreeItemCollapsibleState.Expanded);
	item.description = scoreText(score);
	item.iconPath = new vscode.ThemeIcon('symbol-class');
	item.tooltip = new vscode.MarkdownString(`\`${className}\`\n\n${scoreTooltip(score)}`);
	item.contextValue = 'proof.mutationClass';
	return item;
}

function methodItem(node: Extract<MutationNode, { kind: 'method' }>): vscode.TreeItem {
	const score = scoreOf(node.method.mutants);
	const allNoCoverage = allMutantsNoCoverage(node.method.mutants);
	const item = new vscode.TreeItem(methodLabel(node.method, node.siblings), vscode.TreeItemCollapsibleState.Collapsed);
	item.description = scoreText(score, allNoCoverage);
	item.iconPath = score.survived > 0
		? new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'))
		: new vscode.ThemeIcon('symbol-method');
	// Faz 24 (§7.6 madde 5): Test Kalitesi'nin `PSEUDO_TESTED_METHOD`
	// bulgusuyla aynı metodu mu anlatıyoruz - gerçek `findings[]`'e bakılır,
	// kural kendi kendine yeniden türetilmez (CLI zaten hesapladı).
	const pseudoTestedFinding = findPseudoTestedFinding(node.className, node.method.methodName, node.method.methodDescription);
	const bridgeNote = pseudoTestedFinding ? '\n\n---\n\nThere\'s a `PSEUDO_TESTED_METHOD` finding for this in Test Quality - right-click → "Show in Test Quality".' : '';
	item.tooltip = new vscode.MarkdownString(
		`\`${node.className}#${node.method.methodName}${node.method.methodDescription}\`\n\n`
		+ `Line ${node.method.firstLine}-${node.method.lastLine}\n\n${scoreTooltip(score, allNoCoverage)}${bridgeNote}`,
	);
	item.command = openCommandFor(node.className, node.method.firstLine, 'Go to Method');
	item.id = `proof.mutationMethod:${node.className}#${node.method.methodName}${node.method.methodDescription}`;
	item.contextValue = pseudoTestedFinding ? 'proof.mutationMethod.pseudoTested' : 'proof.mutationMethod';
	return item;
}

/** `getCoverageState()?.findings`'te bu tam metoda ait bir `PSEUDO_TESTED_METHOD` bulgusu var mı - varsa köprünün hedefi. */
function findPseudoTestedFinding(className: string, methodName: string, methodDescription: string): Finding | undefined {
	const key = productionMethodKey(className, methodName, methodDescription);
	return getCoverageState()?.findings.find((f) => f.rule === 'PSEUDO_TESTED_METHOD' && f.productionMethod === key);
}

/**
 * Faz 24 (§7.6 madde 6, ters yön - bilgilendirme amaçlı). Bir mutantı
 * öldüren test, L0'ın statik taramasında `INCONCLUSIVE` kaldıysa bunu
 * burada da söylemek gerekir - "Satır → Testler"deki köprü zaten diğer
 * yöne gidiyor (madde 6'nın asıl komutu), burada sadece aynı çelişkiyi
 * unutmadığımızı gösteren bir not var, ayrı bir komut gerekmiyor (yön
 * zaten aktif dosyaya bağlı "Satır → Testler"den buraya geliniyor).
 * Rule'a göre değil `confidence === 'INCONCLUSIVE'`e göre arıyor - `model/
 * mutationModel.ts`'in `findKillContribution`'ıyla aynı, kuralı yeniden
 * türetmiyor.
 */
/**
 * Faz 31: bir mutantı öldüren test her zaman "başarılı" olduğu için burada
 * hiç `finding` yok - eskiden bu yüzden navigasyon hiç yoktu. `locateTestFile`
 * (`ui/testFileLocator.ts`, `hoverProvider.ts` ile aynı mekanizma) testin
 * kendi kaynak kökündeki dosyasını arar; bulunamazsa (hard rule 3a) komut
 * hiç eklenmez, sadece yaprak düğüm kalır.
 */
async function killingTestItem(rawTestId: string): Promise<vscode.TreeItem> {
	const identity = parseTestIdentity(rawTestId);
	const item = leaf(identity.display, 'check');
	const state = getCoverageState();
	if (state && identity.className) {
		const path = await locateTestFile(state.workspaceRoot, testSourceRoots(state.modules), identity.className, undefined);
		if (path) {
			const uri = vscode.Uri.file(toAbsolutePath(state.workspaceRoot, path));
			item.command = { command: 'vscode.open', title: 'Open Test File', arguments: [uri, { selection: new vscode.Range(0, 0, 0, 0) }] };
		}
	}
	if (identity.className && identity.methodName) {
		const key = `${identity.className}#${identity.methodName}()`;
		const finding = getCoverageState()?.findings.find((f) => f.confidence === 'INCONCLUSIVE' && f.testMethod === key);
		if (finding) {
			item.tooltip = new vscode.MarkdownString(
				`This test has a finding that was **inconclusive** (\`${finding.rule}\`, INCONCLUSIVE) in L0's static oracle scan, but as you can see here it genuinely killed a mutant - it does observe behavior. Look for this test's INCONCLUSIVE label in Line → Tests.`,
			);
			item.contextValue = 'proof.killingTest.contradiction';
		}
	}
	return item;
}

/**
 * Faz 24 (§7.6 madde 5): Test Kalitesi'nden gelen bir `PSEUDO_TESTED_METHOD`
 * bulgusuna karşılık gelen mutasyon ağacı düğümü - `ui/commands.ts`'in
 * köprü komutu bunu `reveal()`'e verir. Mutasyon verisi hiç yoksa ya da bu
 * koşuda metot artık orada değilse (güncel olmayan sonuç) `undefined`
 * döner, uydurulmaz (hard rule 3a).
 */
export function findMutationBridgeTarget(className: string, methodName: string, methodDescription: string): MutationNode | undefined {
	const state = getMutationState();
	if (!state?.mutation) {
		return undefined;
	}
	const classes = classesOf(state.mutation, productionClassFilter());
	const found = findMutatedMethod(classes, className, methodName, methodDescription);
	return found ? { kind: 'method', className: found.cls.className, method: found.method, siblings: found.cls.methods } : undefined;
}

function mutantItem(className: string, mutant: Mutant): vscode.TreeItem {
	const bucket = bucketOf(mutant.status);
	const collapsible = mutant.killingTests.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
	const item = new vscode.TreeItem(`Line ${mutant.line} · ${mutatorLabel(mutant.mutator)}`, collapsible);
	item.description = bucketText(bucket, mutant.status);
	item.iconPath = new vscode.ThemeIcon(bucketIcon(bucket), bucketColor(bucket));
	// Faz 26: a SURVIVED mutant's `killingTests` is empty - the only way to
	// see the tests that "failed to catch it" is perTest data (the tests
	// covering this line, with their oracle quality). The bridge
	// affordance only appears when there's real evidence for it.
	const hasLineEvidence = lineHasPerTestEvidence(className, mutant.line);
	const bridgeNote = hasLineEvidence ? '\n\n---\n\nFor the tests covering this line, right-click → "Show in Line → Tests".' : '';
	item.tooltip = new vscode.MarkdownString(mutantTooltip(bucket, mutant) + bridgeNote);
	item.command = openCommandFor(className, mutant.line, 'Go to Line');
	item.contextValue = hasLineEvidence ? 'proof.mutant.hasLineEvidence' : 'proof.mutant';
	return item;
}

/** `getPerTestState()`'te bu tam satır için gerçekten kayıt var mı - varsa "Satır → Testler'de Göster" köprüsünün hedefi. */
function lineHasPerTestEvidence(className: string, line: number): boolean {
	const perTestState = getPerTestState();
	if (!perTestState?.perTest) {
		return false;
	}
	const lookup = testsForClass(perTestState.perTest, className);
	return lookup.kind === 'found' && lookup.linesToTests.has(line);
}

function mutantTooltip(bucket: MutantBucket, mutant: Mutant): string {
	// The short name goes in the label; PIT's full mutator class name goes here - a display preference, not lost data.
	const head = `**${mutatorLabel(mutant.mutator)}** · line ${mutant.line} · \`${mutant.status}\`\n\n\`${mutant.mutator}\`\n\n`;
	switch (bucket) {
		case 'killed':
			return head + (mutant.status === 'TIMED_OUT'
				? 'The mutation sent the code into an infinite loop and the run timed out. PIT counts this as **killed**: the behavior change was noticed.'
				: `The code was broken and ${mutant.killingTests.length} test(s) caught it. This is the desired outcome.`);
		case 'survived':
			return head + '**We broke the code, and no test noticed.** An assertion that actually verifies this line\'s behavior is missing.';
		default:
			return head + 'Nothing can be said about this mutant - it counts as neither killed nor survived, and doesn\'t factor into the score. '
				+ 'Common causes: `NO_COVERAGE` (no test reaches this line), `NON_VIABLE` (the JVM rejected the mutant), '
				+ '`RUN_ERROR`/`MEMORY_ERROR` (the run crashed), `NOT_STARTED`/`STARTED` (never queued or left unfinished).';
	}
}

/**
 * Skoru asla tek başına yüzde olarak göstermiyoruz: belirsiz sayısı
 * görünmezse "%100" yanıltıcı olur (hard rule 3a). Faz 24 (§7.6 madde 7):
 * `allNoCoverage` true ise (bu metodun üretilen **her** mutantı
 * `NO_COVERAGE`) sebep tahmin değil veriden çıkarım - açıkça yazılır,
 * genel "N belirsiz"in arkasına gizlenmez.
 */
function scoreText(score: MutationScore, allNoCoverage = false): string {
	if (score.percent === null && allNoCoverage) {
		return 'no score - no test reaches this method';
	}
	const base = score.percent === null
		? 'no score'
		: `${Math.round(score.percent)}% · ${score.killed}/${score.killed + score.survived} killed`;
	return score.indeterminate > 0 ? `${base} · ${score.indeterminate} inconclusive` : base;
}

function scoreTooltip(score: MutationScore, allNoCoverage = false): string {
	const lines = [
		`Killed: ${score.killed}`,
		`Survived: ${score.survived}`,
		`Inconclusive: ${score.indeterminate}`,
	];
	if (score.percent === null && allNoCoverage) {
		lines.push('\nNo score can be computed: every generated mutant is `NO_COVERAGE` - no test ever reaches this method, so the mutation engine can\'t even observe its behavior.');
	} else {
		lines.push(score.percent === null
			? '\nNo score can be computed: no mutant has been decided (killed or survived).'
			: `\nScore = killed / (killed + survived) = ${score.percent.toFixed(1)}%. Inconclusive mutants don't count toward the denominator.`);
	}
	return lines.join('\n\n');
}

function bucketText(bucket: MutantBucket, status: string): string {
	switch (bucket) {
		case 'killed':
			return status === 'TIMED_OUT' ? 'killed (timed out)' : 'killed';
		case 'survived':
			return 'SURVIVED';
		default:
			return `inconclusive (${status})`;
	}
}

function bucketIcon(bucket: MutantBucket): string {
	switch (bucket) {
		case 'killed':
			return 'check';
		case 'survived':
			return 'error';
		default:
			return 'question';
	}
}

function bucketColor(bucket: MutantBucket): vscode.ThemeColor | undefined {
	return bucket === 'survived' ? new vscode.ThemeColor('editorError.foreground') : undefined;
}

/**
 * Faz 20: hangi sınıflar production - `fileCoverage.files[]` bu koşunun
 * yetkili listesi. PIT test sınıflarını da mutasyona sokuyor; süzülmezse
 * ağaç `CalculatorSubsumedTest`'in kendi mutant skorunu gösterirdi.
 * Blok yoksa süzgeç de yok (eksik bilgiyle elemek kanıt yok eder).
 */
function productionClassFilter(): ((className: string) => boolean) | undefined {
	const state = getCoverageState();
	if (!state?.fileCoverage) {
		return undefined;
	}
	const { byClassName } = buildProductionClassIndex(state.fileCoverage, productionSourceRoots(state.modules));
	return (className) => byClassName.has(className);
}

/** Sınıfın dosyası `fileCoverage.files[]`'ten çözülür; bilinmiyorsa komut yok - yanlış dosyaya atlamaktansa atlamamak yeğdir. */
function openCommandFor(className: string, line: number, title: string): vscode.Command | undefined {
	const state = getCoverageState();
	if (!state?.fileCoverage) {
		return undefined;
	}
	const path = buildProductionClassIndex(state.fileCoverage, productionSourceRoots(state.modules)).byClassName.get(className);
	if (!path) {
		return undefined;
	}
	const uri = vscode.Uri.file(toAbsolutePath(state.workspaceRoot, path));
	const selection = new vscode.Range(line - 1, 0, line - 1, 0);
	return { command: 'vscode.open', title, arguments: [uri, { selection }] };
}

/**
 * Faz 31: an explicit `.tooltip` (not VS Code's own implicit
 * label-overflow fallback) - a long `'empty'` explanation message wasn't
 * reliably copyable from the auto-truncation hover, real user report.
 * Harmless for short labels that already fit; callers that need a richer
 * tooltip (e.g. `killingTestItem`'s contradiction note) overwrite it after.
 */
function leaf(label: string, icon: string): vscode.TreeItem {
	const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon(icon);
	item.tooltip = label;
	return item;
}

function shortName(fqcn: string): string {
	const dot = fqcn.lastIndexOf('.');
	return dot < 0 ? fqcn : fqcn.slice(dot + 1);
}
