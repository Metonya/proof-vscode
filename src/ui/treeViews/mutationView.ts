import * as vscode from 'vscode';

import { bucketOf, classesOf, formatRelativeTime, methodLabel, mutatorLabel, scoreOf, scoreOfMethods, targetSummary, type MutantBucket, type MutationScore } from '../../model/mutationModel';
import { toAbsolutePath } from '../../model/pathIndex';
import { buildProductionClassIndex, productionSourceRoots } from '../../model/productionClassIndex';
import { getCoverageState, getMutationState } from '../../model/store';
import { parseTestIdentity } from '../../verdict/testIdentity';
import type { MutatedMethod, Mutant } from '../../verdict/types';

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

	getTreeItem(node: MutationNode): vscode.TreeItem {
		switch (node.kind) {
			case 'empty':
				return leaf(node.message, 'info');
			case 'runHint':
				return runHintItem();
			case 'header':
				return headerItem(node.text);
			case 'class':
				return classItem(node.className, node.methods);
			case 'method':
				return methodItem(node);
			case 'mutant':
				return mutantItem(node.className, node.mutant);
			case 'killingTest':
				return leaf(parseTestIdentity(node.rawTestId).display, 'check');
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
			return [{ kind: 'empty', message: noMutationEvidenceMessage() }, { kind: 'runHint' }];
		}

		const header: MutationNode = { kind: 'header', text: headerText(state) };
		const classes = classesOf(state.mutation, state.moduleId, productionClassFilter())
			.map((c) => ({ ...c, methods: this.visibleMethods(c.methods) }))
			.filter((c) => c.methods.length > 0);

		if (classes.length === 0) {
			return [header, {
				kind: 'empty',
				message: this.survivorsOnly
					? 'Hayatta kalan mutant yok - üretilen her mutantı en az bir test yakaladı. (Süzgeci kaldırmak için başlıktaki filtreye tıklayın.)'
					: 'Bu koşuda hiçbir production metodu için mutant üretilmedi. Hedeflenen sınıflar mutasyona uygun kod içermiyor olabilir. (Test sınıflarının kendi mutantları kasten gösterilmiyor.)',
			}];
		}
		return [header, ...classes.map((c): MutationNode => ({ kind: 'class', className: c.className, methods: c.methods }))];
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
function noMutationEvidenceMessage(): string {
	const state = getMutationState();
	const warningFor = (code: string) => state?.warnings.find((w) => w.code === code && (w.module === undefined || w.module === state.moduleId));

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
		return 'Bu koşuda değişen production sınıfı yok, bu yüzden mutasyona sokulacak hedef de yok. Tek bir sınıf için çalıştırmak isterseniz o dosyada sağ tık → "Bu Sınıf İçin Mutasyon Testi".';
	}
	if (warningFor('MUTATION_TRUNCATED')) {
		return 'Mutant kayıtları üst sınıra takıldı - gösterilenler eksik. Daha dar bir hedefle tekrar çalıştırın.';
	}
	return 'Bu koşu mutasyon kanıtı üretmedi. MUTATION_* uyarıları için Output → coverdict kanalına bakın.';
}

/** Faz 22: "Hedef: Calculator · 5 dakika önce" ya da diskten geri yüklenmiş bir sonuçta "Hedef: Calculator · kaydedilmiş sonuç". */
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
	const item = new vscode.TreeItem(methodLabel(node.method, node.siblings), vscode.TreeItemCollapsibleState.Collapsed);
	item.description = scoreText(score);
	item.iconPath = score.survived > 0
		? new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'))
		: new vscode.ThemeIcon('symbol-method');
	item.tooltip = new vscode.MarkdownString(
		`\`${node.className}#${node.method.methodName}${node.method.methodDescription}\`\n\n`
		+ `Satır ${node.method.firstLine}-${node.method.lastLine}\n\n${scoreTooltip(score)}`,
	);
	item.command = openCommandFor(node.className, node.method.firstLine, 'Metoda Git');
	item.contextValue = 'coverdict.mutationMethod';
	return item;
}

function mutantItem(className: string, mutant: Mutant): vscode.TreeItem {
	const bucket = bucketOf(mutant.status);
	const collapsible = mutant.killingTests.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
	const item = new vscode.TreeItem(`Satır ${mutant.line} · ${mutatorLabel(mutant.mutator)}`, collapsible);
	item.description = bucketText(bucket, mutant.status);
	item.iconPath = new vscode.ThemeIcon(bucketIcon(bucket), bucketColor(bucket));
	item.tooltip = new vscode.MarkdownString(mutantTooltip(bucket, mutant));
	item.command = openCommandFor(className, mutant.line, 'Satıra Git');
	item.contextValue = 'coverdict.mutant';
	return item;
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

/** Skoru asla tek başına yüzde olarak göstermiyoruz: belirsiz sayısı görünmezse "%100" yanıltıcı olur (hard rule 3a). */
function scoreText(score: MutationScore): string {
	const base = score.percent === null
		? 'skor yok'
		: `${Math.round(score.percent)}% · ${score.killed}/${score.killed + score.survived} öldürüldü`;
	return score.indeterminate > 0 ? `${base} · ${score.indeterminate} belirsiz` : base;
}

function scoreTooltip(score: MutationScore): string {
	const lines = [
		`Öldürüldü: ${score.killed}`,
		`Hayatta kaldı: ${score.survived}`,
		`Belirsiz: ${score.indeterminate}`,
	];
	lines.push(score.percent === null
		? '\nSkor hesaplanamıyor: karara bağlanmış (öldürülen ya da hayatta kalan) mutant yok.'
		: `\nSkor = öldürülen / (öldürülen + hayatta kalan) = ${score.percent.toFixed(1)}%. Belirsizler paydaya girmez.`);
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
	const index = buildProductionClassIndex(state.fileCoverage, productionSourceRoots(state.modules));
	return (className) => index.has(className);
}

/** Sınıfın dosyası `fileCoverage.files[]`'ten çözülür; bilinmiyorsa komut yok - yanlış dosyaya atlamaktansa atlamamak yeğdir. */
function openCommandFor(className: string, line: number, title: string): vscode.Command | undefined {
	const state = getCoverageState();
	if (!state?.fileCoverage) {
		return undefined;
	}
	const path = buildProductionClassIndex(state.fileCoverage, productionSourceRoots(state.modules)).get(className);
	if (!path) {
		return undefined;
	}
	const uri = vscode.Uri.file(toAbsolutePath(state.workspaceRoot, path));
	const selection = new vscode.Range(line - 1, 0, line - 1, 0);
	return { command: 'vscode.open', title, arguments: [uri, { selection }] };
}

function leaf(label: string, icon: string): vscode.TreeItem {
	const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon(icon);
	return item;
}

function shortName(fqcn: string): string {
	const dot = fqcn.lastIndexOf('.');
	return dot < 0 ? fqcn : fqcn.slice(dot + 1);
}
