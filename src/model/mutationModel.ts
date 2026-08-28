import type { MutatedMethod, MutationBlock, Mutant } from '../verdict/types';

/**
 * Faz 20: PIT'in dokuz `DetectionStatus` değerini kullanıcının okuyabileceği
 * üç kovaya indirir. Saf - `vscode` import etmez.
 *
 * Kova kararı (PLAN.md §8.3, kullanıcı onayladı):
 *   killed      KILLED, TIMED_OUT
 *   survived    SURVIVED
 *   indeterminate  geri kalan altısı + tanımadığımız her statü
 *
 * `TIMED_OUT` neden "killed": PIT'in kendi geleneği - mutasyon kodu sonsuz
 * döngüye soktuysa davranış değişikliği **tespit edilmiştir**. Bu tek
 * tartışmalı karardı; kasten tek bir sabit listeden okunuyor ki fikir
 * değişirse tek satır düzenlensin.
 *
 * Belirsiz olan asla killed/survived'a katlanmaz ve asla gizlenmez (hard
 * rule 3a): `NO_COVERAGE` "test bu satıra hiç uğramadı", `RUN_ERROR`
 * "koşu patladı", `NON_VIABLE` "mutant JVM'ce reddedildi" demektir -
 * hiçbiri "test iyi" ya da "test kötü" değildir. Tanımadığımız bir statü
 * de buraya düşer: yeni bir PIT sürümü yeni bir değer getirirse sessizce
 * yanlış tarafa sayılmaz.
 */
export type MutantBucket = 'killed' | 'survived' | 'indeterminate';

const KILLED_STATUSES: ReadonlySet<string> = new Set(['KILLED', 'TIMED_OUT']);
const SURVIVED_STATUSES: ReadonlySet<string> = new Set(['SURVIVED']);

export function bucketOf(status: string): MutantBucket {
	if (KILLED_STATUSES.has(status)) {
		return 'killed';
	}
	if (SURVIVED_STATUSES.has(status)) {
		return 'survived';
	}
	return 'indeterminate';
}

export interface MutationScore {
	killed: number;
	survived: number;
	indeterminate: number;
	/**
	 * `killed / (killed + survived)`, 0-100, tam sayıya yuvarlanmadan.
	 * Belirsizler paydaya **girmez** - onlar hakkında bir şey bilmiyoruz,
	 * ne lehte ne aleyhte sayılırlar. Payda sıfırsa `null`: skor yok
	 * demektir, sıfır değil.
	 */
	percent: number | null;
}

export function scoreOf(mutants: readonly Mutant[]): MutationScore {
	let killed = 0;
	let survived = 0;
	let indeterminate = 0;
	for (const mutant of mutants) {
		switch (bucketOf(mutant.status)) {
			case 'killed':
				killed++;
				break;
			case 'survived':
				survived++;
				break;
			default:
				indeterminate++;
		}
	}
	const decided = killed + survived;
	return { killed, survived, indeterminate, percent: decided === 0 ? null : (killed / decided) * 100 };
}

export function scoreOfMethods(methods: readonly MutatedMethod[]): MutationScore {
	return scoreOf(methods.flatMap((m) => m.mutants));
}

/** Bir sınıfın altındaki metotlar, `mutation.modules[].methods[]`'ten gruplanmış. Sınıflar ve metotlar ada göre sıralı - CLI zaten sıralı yayınlıyor ama ona bel bağlamıyoruz. */
export interface MutatedClass {
	className: string;
	methods: readonly MutatedMethod[];
}

export function classesOf(
	mutation: MutationBlock,
	moduleId: string,
	isProductionClass?: (className: string) => boolean,
): MutatedClass[] {
	const module = mutation.modules.find((m) => m.id === moduleId);
	if (!module) {
		return [];
	}
	const byClass = new Map<string, MutatedMethod[]>();
	for (const method of module.methods) {
		// Faz 20: PIT test sınıflarını da mutasyona sokuyor - gerçek bir
		// playground koşusunda 16 metodun 8'i test sınıflarındandı
		// (`CalculatorSubsumedTest`, `CalculatorGoodTest`, ...). Testin
		// kendi kodunun mutant skoru kullanıcıya hiçbir şey söylemez ve
		// production skorunu bozar. `perTest.entries`'teki aynı tuzağın
		// mutasyon tarafındaki eşi (bkz. `model/lineIndex.ts`).
		// Süzgeç verilmezse hiçbir şey elenmez: eksik bilgiyle elemek
		// kanıt yok eder.
		if (isProductionClass && !isProductionClass(method.className)) {
			continue;
		}
		const existing = byClass.get(method.className);
		if (existing) {
			existing.push(method);
		} else {
			byClass.set(method.className, [method]);
		}
	}
	return [...byClass.entries()]
		.map(([className, methods]) => ({
			className,
			methods: [...methods].sort((a, b) => a.firstLine - b.firstLine || a.methodName.localeCompare(b.methodName)),
		}))
		.sort((a, b) => a.className.localeCompare(b.className));
}

/**
 * Bir metodun okunabilir imzası. `methodDescription` JVM descriptor'ı
 * (`(II)I`) - aynı isimli aşırı yüklemeleri ayırmanın tek yolu, o yüzden
 * atılmaz; ama etiketi kirletmemesi için yalnızca gerçekten gerektiğinde
 * (aynı sınıfta aynı isim birden fazla kez geçiyorsa) gösterilir.
 */
/**
 * Faz 22: mutasyon panelinin "bu sonuç neyin, ne zamanki?" başlığı için.
 * Kullanıcı geri bildirimi: dosyadan dosyaya geçince panel aynı kalıyor,
 * hangi sınıfın sonucuna baktığı belli değil. Saf - `vscode` import etmez,
 * çağıran (`ui/treeViews/mutationView.ts`) render anındaki `nowMs`'i verir.
 */
export function targetSummary(targets: readonly string[]): string {
	if (targets.length === 0) {
		return "diff'teki değişen sınıflar";
	}
	if (targets.length === 1) {
		return shortClassName(targets[0]);
	}
	return `${targets.length} sınıf`;
}

function shortClassName(fqcn: string): string {
	const dot = fqcn.lastIndexOf('.');
	return dot < 0 ? fqcn : fqcn.slice(dot + 1);
}

/**
 * `fromMs` bilinmiyorsa (diskten geri yüklenmiş bir sonuç - CLI'ın kendi
 * çıktısı D-xx'e göre zaman damgası taşımaz, "ne zaman çalıştı" bilgisi
 * yalnızca eklentinin o oturumdaki hafızasında vardır) çağıran bunu hiç
 * çağırmamalı - tahmini bir süre göstermek gerçek bir süreden daha
 * yanıltıcıdır (hard rule 3a).
 */
export function formatRelativeTime(fromMs: number, nowMs: number): string {
	const diffSeconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
	if (diffSeconds < 60) {
		return 'az önce';
	}
	const minutes = Math.round(diffSeconds / 60);
	if (minutes < 60) {
		return `${minutes} dakika önce`;
	}
	const hours = Math.round(minutes / 60);
	if (hours < 24) {
		return `${hours} saat önce`;
	}
	const days = Math.round(hours / 24);
	return `${days} gün önce`;
}

export function methodLabel(method: MutatedMethod, siblings: readonly MutatedMethod[]): string {
	const overloaded = siblings.filter((m) => m.methodName === method.methodName).length > 1;
	return overloaded ? `${method.methodName}${method.methodDescription}` : `${method.methodName}()`;
}

/**
 * PIT `mutator`'ı tam sınıf adı olarak yayınlıyor - gerçek veride
 * `org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator`
 * (şemanın golden örneğindeki kısa `TRUE_RETURNS` biçimi değil, 2026-08-28
 * doğrulandı). Ağaç etiketinde tam hâli okunamaz; son parçası alınıp
 * `Mutator` soneki atılıyor. Tam ad tooltip'te korunuyor - kısaltma bir
 * gösterim tercihi, veri kaybı değil.
 */
export function mutatorLabel(mutator: string): string {
	const last = mutator.slice(mutator.lastIndexOf('.') + 1);
	const trimmed = last.endsWith('Mutator') ? last.slice(0, -'Mutator'.length) : last;
	return trimmed.length > 0 ? trimmed : mutator;
}
