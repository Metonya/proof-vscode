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
				{ kind: 'empty', message: 'Henüz mutasyon testi çalıştırılmadı.' },
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
					message: 'Hayatta kalan mutant yok - üretilen her mutantı en az bir test yakaladı. (Süzgeci kaldırmak için başlıktaki filtreye tıklayın.)',
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
					: 'Bu koşuda hiçbir production metodu için mutant üretilmedi. Hedeflenen sınıflar mutasyona uygun kod içermiyor olabilir. (Test sınıflarının kendi mutantları kasten gösterilmiyor.)',
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
		return 'Mutasyon koşusu zaman bütçesini aştı ve sonuç üretemeden durduruldu. coverdict.mutationTimeout ayarını artırın ya da tek bir sınıf hedefleyin (dosyada sağ tık).';
	}
	if (warningFor('MUTATION_COLLECTION_FAILED')) {
		return 'Mutasyon koşusu başarısız oldu. Sebep için Output → coverdict kanalına bakın.';
	}
	if (warningFor('MUTATION_TARGET_UNRESOLVED')) {
		return 'Hedeflenen sınıf hiçbir kaynak kökü altında bulunamadı - sınıf adı ya da kaynak kökleri beklenenden farklı olabilir.';
	}
	if (warningFor('MUTATION_CLASSPATH_MISSING')) {
		return 'Mutasyon için classpath listesi bağlanmamış. Komutu tekrar çalıştırın; eklenti listeyi Maven ile üretmeyi teklif edecek.';
	}
	if (warningFor('MUTATION_NO_CHANGED_TARGETS')) {
		return 'Bu koşuda değişen production sınıfı yok, bu yüzden mutasyona sokulacak hedef de yok. Tek bir sınıf için çalıştırmak isterseniz o dosyada sağ tık → "Bu Sınıf İçin Mutasyon Testi", ya da aşağıdaki düğmeyle diff\'ten bağımsız tüm modülü tarayın.';
	}
	if (warningFor('MUTATION_TRUNCATED')) {
		return 'Mutant kayıtları üst sınıra takıldı - gösterilenler eksik. Daha dar bir hedefle tekrar çalıştırın.';
	}
	return 'Bu koşu mutasyon kanıtı üretmedi. MUTATION_* uyarıları için Output → coverdict kanalına bakın.';
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
	const when = state.ranAt === undefined ? 'kaydedilmiş sonuç - bu pencerede ne zaman çalıştığı bilinmiyor' : formatRelativeTime(state.ranAt, Date.now());
	return `Hedef: ${target} · ${when}`;
}

function headerItem(text: string): vscode.TreeItem {
	const item = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon('history');
	item.contextValue = 'coverdict.mutationHeader';
	return item;
}

function runHintItem(): vscode.TreeItem {
	const item = new vscode.TreeItem('Mutasyon Testi Çalıştır', vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon('play');
	item.command = { command: 'coverdict.mutationForFile', title: 'Mutasyon Testi Çalıştır' };
	item.tooltip = 'Açık Java dosyasındaki sınıf için mutasyon testi çalıştırır (tek sınıf: genelde saniyeler). Modül geneli için "Çalıştır" görünümündeki Mutasyon Testi maddesini kullanın.';
	return item;
}

/** Faz 31: "ben değişiklik yapmadan tüm repoda tarama yapabilmeliyim" - diff hiç hedef bulamadığında sunulan kurtarma eylemi, `coverdict.mutationForModuleAll`. Diff-tabanlı koşudan daha pahalı olabileceği için kendi onay modalının arkasında. */
function scanAllHintItem(): vscode.TreeItem {
	const item = new vscode.TreeItem('Yine de Tüm Modülü Tara (diff\'siz)', vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon('play');
	item.command = { command: 'coverdict.mutationForModuleAll', title: 'Tüm Modülü Tara' };
	item.tooltip = 'Diff\'ten bağımsız, bu modüldeki her production sınıfını hedefler - değişmemiş sınıflar da dahil olduğu için diff-tabanlı "modül geneli" koşudan daha uzun sürebilir.';
	return item;
}

function classItem(className: string, methods: readonly MutatedMethod[]): vscode.TreeItem {
	const score = scoreOfMethods(methods);
	const item = new vscode.TreeItem(shortName(className), vscode.TreeItemCollapsibleState.Expanded);
	item.description = scoreText(score);
	item.iconPath = new vscode.ThemeIcon('symbol-class');
	item.tooltip = new vscode.MarkdownString(`\`${className}\`\n\n${scoreTooltip(score)}`);
	item.contextValue = 'coverdict.mutationClass';
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
	const bridgeNote = pseudoTestedFinding ? '\n\n---\n\nTest Kalitesi\'nde `PSEUDO_TESTED_METHOD` bulgusu var - sağ tık → "Test Kalitesi\'nde Göster".' : '';
	item.tooltip = new vscode.MarkdownString(
		`\`${node.className}#${node.method.methodName}${node.method.methodDescription}\`\n\n`
		+ `Satır ${node.method.firstLine}-${node.method.lastLine}\n\n${scoreTooltip(score, allNoCoverage)}${bridgeNote}`,
	);
	item.command = openCommandFor(node.className, node.method.firstLine, 'Metoda Git');
	item.id = `coverdict.mutationMethod:${node.className}#${node.method.methodName}${node.method.methodDescription}`;
	item.contextValue = pseudoTestedFinding ? 'coverdict.mutationMethod.pseudoTested' : 'coverdict.mutationMethod';
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
			item.command = { command: 'vscode.open', title: 'Test Dosyasını Aç', arguments: [uri, { selection: new vscode.Range(0, 0, 0, 0) }] };
		}
	}
	if (identity.className && identity.methodName) {
		const key = `${identity.className}#${identity.methodName}()`;
		const finding = getCoverageState()?.findings.find((f) => f.confidence === 'INCONCLUSIVE' && f.testMethod === key);
		if (finding) {
			item.tooltip = new vscode.MarkdownString(
				`Bu testin L0 statik oracle taramasında **belirsiz** (\`${finding.rule}\`, INCONCLUSIVE) kaldığı bir bulgu var, ama burada gördüğün gibi gerçekten bir mutant öldürdü - davranışı gözlüyor. "Satır → Testler"de bu testin INCONCLUSIVE etiketine bak.`,
			);
			item.contextValue = 'coverdict.killingTest.contradiction';
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
	const item = new vscode.TreeItem(`Satır ${mutant.line} · ${mutatorLabel(mutant.mutator)}`, collapsible);
	item.description = bucketText(bucket, mutant.status);
	item.iconPath = new vscode.ThemeIcon(bucketIcon(bucket), bucketColor(bucket));
	// Faz 26: SURVIVED bir mutantın `killingTests`'i boştur - "onu
	// yakalayamayan" testleri görmenin tek yolu perTest verisidir (bu
	// satırı kapsayan testler, oracle kaliteleriyle birlikte). Yalnızca
	// gerçekten kanıt varsa köprü affordance'ı gösterilir.
	const hasLineEvidence = lineHasPerTestEvidence(className, mutant.line);
	const bridgeNote = hasLineEvidence ? '\n\n---\n\nBu satırı kapsayan testler için sağ tık → "Satır → Testler\'de Göster".' : '';
	item.tooltip = new vscode.MarkdownString(mutantTooltip(bucket, mutant) + bridgeNote);
	item.command = openCommandFor(className, mutant.line, 'Satıra Git');
	item.contextValue = hasLineEvidence ? 'coverdict.mutant.hasLineEvidence' : 'coverdict.mutant';
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
	// Kısa ad etikette, PIT'in tam mutator sınıf adı burada - kısaltma bir gösterim tercihi, veri kaybı değil.
	const head = `**${mutatorLabel(mutant.mutator)}** · satır ${mutant.line} · \`${mutant.status}\`\n\n\`${mutant.mutator}\`\n\n`;
	switch (bucket) {
		case 'killed':
			return head + (mutant.status === 'TIMED_OUT'
				? 'Mutasyon kodu sonsuz döngüye soktu ve koşu zaman aşımına uğradı. PIT bunu **tespit edilmiş** sayar: davranış değişikliği fark edildi.'
				: `Kod bozuldu ve ${mutant.killingTests.length} test bunu yakaladı. İstenen sonuç bu.`);
		case 'survived':
			return head + '**Kodu bozduk, hiçbir test fark etmedi.** Bu satırın davranışını gerçekten doğrulayan bir assertion eksik.';
		default:
			return head + 'Bu mutant hakkında bir şey söylenemez - ne öldürüldü ne hayatta kaldı sayılır, skora da girmez. '
				+ 'Yaygın sebepler: `NO_COVERAGE` (hiçbir test bu satıra uğramadı), `NON_VIABLE` (JVM mutantı reddetti), '
				+ '`RUN_ERROR`/`MEMORY_ERROR` (koşu patladı), `NOT_STARTED`/`STARTED` (sıraya girmedi ya da yarım kaldı).';
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
		return 'skor yok - hiçbir test bu metoda uğramıyor';
	}
	const base = score.percent === null
		? 'skor yok'
		: `${Math.round(score.percent)}% · ${score.killed}/${score.killed + score.survived} öldürüldü`;
	return score.indeterminate > 0 ? `${base} · ${score.indeterminate} belirsiz` : base;
}

function scoreTooltip(score: MutationScore, allNoCoverage = false): string {
	const lines = [
		`Öldürüldü: ${score.killed}`,
		`Hayatta kaldı: ${score.survived}`,
		`Belirsiz: ${score.indeterminate}`,
	];
	if (score.percent === null && allNoCoverage) {
		lines.push('\nSkor hesaplanamıyor: üretilen her mutant `NO_COVERAGE` - hiçbir test bu metoda hiç uğramıyor, mutasyon motoru davranışını gözlemleyemiyor bile.');
	} else {
		lines.push(score.percent === null
			? '\nSkor hesaplanamıyor: karara bağlanmış (öldürülen ya da hayatta kalan) mutant yok.'
			: `\nSkor = öldürülen / (öldürülen + hayatta kalan) = ${score.percent.toFixed(1)}%. Belirsizler paydaya girmez.`);
	}
	return lines.join('\n\n');
}

function bucketText(bucket: MutantBucket, status: string): string {
	switch (bucket) {
		case 'killed':
			return status === 'TIMED_OUT' ? 'öldürüldü (zaman aşımı)' : 'öldürüldü';
		case 'survived':
			return 'HAYATTA KALDI';
		default:
			return `belirsiz (${status})`;
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
