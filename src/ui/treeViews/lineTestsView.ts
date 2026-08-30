import * as vscode from 'vscode';

import { detectClassName } from '../../model/classNameDetector';
import { allClasses, groupConsecutiveLines, testsForClass, testsToLines, type TestLineRef } from '../../model/lineIndex';
import { findKillContribution, type KillContribution } from '../../model/mutationModel';
import { classifySourcePath, toAbsolutePath, toRepoRelativePath, type SourceKind } from '../../model/pathIndex';
import { buildProductionClassIndex, productionSourceRoots, testSourceRoots } from '../../model/productionClassIndex';
import { getCoverageState, getMutationState, getPerTestState } from '../../model/store';
import { indexFindingsByTestMethod, lineQuality, type TestVerdict } from '../../model/testQuality';
import { parseTestIdentity } from '../../verdict/testIdentity';
import type { Finding } from '../../verdict/types';
import { locateTestFile } from '../testFileLocator';

/**
 * Faz 15c: replaces the webview panel that used to show "which tests cover
 * this line" (deleted, `panelView.ts`) - that panel emptied itself the
 * instant a user clicked into it, because clicking moved focus off the
 * Java editor and its content depended on `vscode.window.activeTextEditor`
 * being that exact editor. A `TreeView` never has this problem: clicking a
 * node does not change which editor VS Code considers "active" for our
 * purposes, because this provider tracks the last Java editor itself
 * (`setActiveDocument`, driven by `extension.ts`) instead of reading
 * `activeTextEditor` live on every render.
 *
 * Two directions from the same `model/testQuality.ts`/`model/lineIndex.ts`
 * join `ui/hoverProvider.ts` uses, so the two surfaces can never disagree:
 * a production file lists its lines with test-quality counts; a test file
 * lists its methods with the production lines they run (reverse, Faz 15a).
 */

export type LineTestsNode =
	| { kind: 'empty'; message: string }
	| { kind: 'collectHint' }
	/** Faz 31: diff hiç değişen sınıf bulamadığında ("ben değişiklik yapmadan tüm repoda tarama yapabilmeliyim") - diff'ten bağımsız, modüldeki her production sınıfını hedefleyen kurtarma eylemi. */
	| { kind: 'scanAllHint' }
	/** Faz 31: root shown when no Java file is active - mirrors the mutation view's "always show the whole run" landing. */
	| { kind: 'class'; className: string; linesToTests: ReadonlyMap<number, readonly string[]>; linesToMethod: ReadonlyMap<number, string> }
	| { kind: 'prodLine'; startLine: number; endLine: number; tests: readonly string[]; methodName: string | undefined; className?: string }
	| { kind: 'prodTest'; startLine: number; endLine: number; rawTestId: string; verdict: TestVerdict; finding: Finding | undefined }
	| { kind: 'testMethod'; methodName: string; refs: readonly TestLineRef[] }
	| { kind: 'testLine'; methodName: string; ref: TestLineRef };

export class LineTestsTreeProvider implements vscode.TreeDataProvider<LineTestsNode> {
	private readonly changeEmitter = new vscode.EventEmitter<LineTestsNode | undefined>();
	readonly onDidChangeTreeData = this.changeEmitter.event;

	private activeDocument: vscode.TextDocument | undefined;
	private problemsOnly = false;

	/** `extension.ts` calls this on `onDidChangeActiveTextEditor` - the provider never reads `vscode.window.activeTextEditor` itself, so a click into the tree cannot empty it. */
	setActiveDocument(document: vscode.TextDocument | undefined): void {
		this.activeDocument = document?.languageId === 'java' ? document : undefined;
		this.changeEmitter.fire(undefined);
	}

	/**
	 * Faz 19: "sorunsuzları kaldır, sadece cover edilmeyenleri göster gibi".
	 * Açıkken yalnızca gerçekten bakılması gereken satırlar kalır: cover
	 * eden testlerden en az birinin doğrulaması eksik/zayıf ya da
	 * çözülemedi. Hepsi `ok` olan satırlar gizlenir. Kapalıyken hiçbir şey
	 * gizlenmez - varsayılan bu, çünkü bir şeyi gizlemek varsayılan
	 * davranış olmamalı.
	 */
	toggleProblemsOnly(): boolean {
		this.problemsOnly = !this.problemsOnly;
		this.changeEmitter.fire(undefined);
		return this.problemsOnly;
	}

	isProblemsOnly(): boolean {
		return this.problemsOnly;
	}

	refresh(): void {
		this.changeEmitter.fire(undefined);
	}

	/** Used by `extension.ts` to `reveal()` the node under the cursor on selection change. */
	nodeForLine(line1Based: number): LineTestsNode | undefined {
		const view = this.computeView();
		if (view?.kind !== 'production') {
			return undefined;
		}
		const group = groupConsecutiveLines(view.linesToTests, view.linesToMethod).find((g) => g.startLine <= line1Based && line1Based <= g.endLine);
		return group ? { kind: 'prodLine', startLine: group.startLine, endLine: group.endLine, tests: group.tests, methodName: group.methodName } : undefined;
	}

	getTreeItem(node: LineTestsNode): vscode.TreeItem | Thenable<vscode.TreeItem> {
		switch (node.kind) {
			case 'empty':
				return leaf(node.message, 'info');
			case 'collectHint':
				return collectHintItem();
			case 'scanAllHint':
				return scanAllHintItem();
			case 'class':
				return classItem(node);
			case 'prodLine':
				return prodLineItem(node);
			case 'prodTest':
				return prodTestItem(node);
			case 'testMethod': {
				const item = new vscode.TreeItem(`${node.methodName}()`, vscode.TreeItemCollapsibleState.Collapsed);
				item.description = `${node.refs.length} production satırı`;
				item.iconPath = new vscode.ThemeIcon('symbol-method');
				return item;
			}
			case 'testLine':
				return testLineItem(node);
		}
	}

	getChildren(node?: LineTestsNode): LineTestsNode[] {
		if (!node) {
			return this.rootChildren();
		}
		if (node.kind === 'class') {
			const findingsByTestMethod = indexFindingsByTestMethod(getCoverageState()?.findings ?? []);
			const groups = groupConsecutiveLines(node.linesToTests, node.linesToMethod)
				.filter((group) => !this.problemsOnly || hasProblem(group.tests, findingsByTestMethod));
			return groups.map((group): LineTestsNode => ({ kind: 'prodLine', startLine: group.startLine, endLine: group.endLine, tests: group.tests, methodName: group.methodName, className: node.className }));
		}
		if (node.kind === 'prodLine') {
			const findingsByTestMethod = indexFindingsByTestMethod(getCoverageState()?.findings ?? []);
			const quality = lineQuality(node.tests, findingsByTestMethod);
			return quality.tests.map((t): LineTestsNode => ({
				kind: 'prodTest', startLine: node.startLine, endLine: node.endLine, rawTestId: t.rawTestId, verdict: t.verdict, finding: t.finding,
			}));
		}
		if (node.kind === 'testMethod') {
			return node.refs
				.slice()
				.sort((a, b) => a.outerClassName.localeCompare(b.outerClassName) || a.line - b.line)
				.map((ref): LineTestsNode => ({ kind: 'testLine', methodName: node.methodName, ref }));
		}
		return [];
	}

	getParent(node: LineTestsNode): LineTestsNode | undefined {
		const view = this.computeView();
		if (view?.kind === 'production' && node.kind === 'prodTest') {
			return { kind: 'prodLine', startLine: node.startLine, endLine: node.endLine, tests: view.linesToTests.get(node.startLine) ?? [], methodName: view.linesToMethod.get(node.startLine) };
		}
		if (view?.kind === 'test' && node.kind === 'testLine') {
			const refs = view.reverse.get(`${view.className}#${node.methodName}()`);
			return refs ? { kind: 'testMethod', methodName: node.methodName, refs } : undefined;
		}
		// Faz 31: "tüm sınıflar" kökü (hiç aktif dosya yok) - bir prodLine kendi
		// className'ini taşıyor, o yüzden aktif-dosya görünümüne ihtiyaç
		// duymadan üst class düğümü yeniden kurulabiliyor.
		if (!view && node.kind === 'prodLine' && node.className) {
			return this.classNodeFor(node.className);
		}
		return undefined;
	}

	private classNodeFor(className: string): LineTestsNode | undefined {
		const perTest = getPerTestState()?.perTest;
		if (!perTest) {
			return undefined;
		}
		const found = allClasses(perTest, productionClassFilter()).find((c) => c.className === className);
		return found ? { kind: 'class', className: found.className, linesToTests: found.linesToTests, linesToMethod: found.linesToMethod } : undefined;
	}

	private rootChildren(): LineTestsNode[] {
		const view = this.computeView();
		if (!view) {
			return this.allClassesRoot();
		}
		if (view.kind === 'noPerTestData') {
			// Faz 21: bir test dosyasında "topla" düğmesi test sınıfının
			// kendisini hedeflerdi - ters yön için gereken şey o değil,
			// production sınıflarını hedefleyen bir koşu. Yanlış düğmeye
			// yönlendirmektense ne yapılacağını söylüyoruz.
			if (this.activeDocument && this.classifyActiveDocument(this.activeDocument) === 'test') {
				return [{ kind: 'empty', message: 'Bu test sınıfının bu koşuda çalıştırdığı production satırı kaydı yok. Ters yön ancak production sınıfları hedeflenmiş bir koşuda dolar: bir production dosyası açıp "Bu Sınıf İçin Topla" deyin ya da Derin Tarama çalıştırın.' }];
			}
			const nodes: LineTestsNode[] = [{ kind: 'empty', message: noPerTestDataMessage() }, { kind: 'collectHint' }];
			if (hasNoChangedTargetsWarning()) {
				nodes.push({ kind: 'scanAllHint' });
			}
			return nodes;
		}
		if (view.kind === 'production') {
			const findingsByTestMethod = indexFindingsByTestMethod(getCoverageState()?.findings ?? []);
			const groups = groupConsecutiveLines(view.linesToTests, view.linesToMethod)
				.filter((group) => !this.problemsOnly || hasProblem(group.tests, findingsByTestMethod));
			if (groups.length === 0) {
				return [{ kind: 'empty', message: this.problemsOnly ? 'Bu dosyada sorunlu satır yok - cover eden her testin doğrulaması var. (Filtreyi kaldırmak için başlıktaki süzgece tıklayın.)' : 'Bu sınıf için satır kaydı yok.' }];
			}
			return groups.map((group): LineTestsNode => ({ kind: 'prodLine', startLine: group.startLine, endLine: group.endLine, tests: group.tests, methodName: group.methodName }));
		}
		// test file: group the reverse index's flat refs back into per-method nodes for this class
		const methods = [...view.reverse.entries()]
			.filter(([key]) => key.startsWith(`${view.className}#`))
			.map(([key, refs]): LineTestsNode => ({ kind: 'testMethod', methodName: key.slice(view.className.length + 1, -2), refs }));
		return methods.length === 0
			? [{ kind: 'empty', message: 'Bu sınıfın hiçbir test metodu bu koşuda hedeflenen production kodunu çalıştırmadı.' }]
			: methods;
	}

	/**
	 * Faz 31: hiç Java dosyası açık değilken kök - mutasyon görünümünün her
	 * zaman yaptığı gibi ("hiçbir şeye bağlı olmadan tüm koşuyu göster").
	 * `allClasses()`'in bulduğu her sınıf, `problemsOnly` açıkken tüm
	 * satırları filtrelenip **boş kalan** sınıflar listeden tamamen düşer -
	 * `mutationView.ts`'in `rootChildren`'ının aynı deseni (boş sınıfı
	 * göstermek yerine hiç listelememek).
	 */
	private allClassesRoot(): LineTestsNode[] {
		const perTest = getPerTestState()?.perTest;
		if (!perTest) {
			const nodes: LineTestsNode[] = [{ kind: 'empty', message: noPerTestDataMessage() }];
			if (hasNoChangedTargetsWarning()) {
				nodes.push({ kind: 'scanAllHint' });
			}
			return nodes;
		}
		const findingsByTestMethod = indexFindingsByTestMethod(getCoverageState()?.findings ?? []);
		const classes = allClasses(perTest, productionClassFilter())
			.filter((c) => groupConsecutiveLines(c.linesToTests, c.linesToMethod).some((g) => !this.problemsOnly || hasProblem(g.tests, findingsByTestMethod)));
		if (classes.length === 0) {
			return [{
				kind: 'empty',
				message: this.problemsOnly
					? 'Sorunlu satır yok - cover eden her testin doğrulaması var. (Filtreyi kaldırmak için başlıktaki süzgece tıklayın.)'
					: 'Bu koşuda hiçbir sınıf için satır kaydı yok.',
			}];
		}
		return classes.map((c): LineTestsNode => ({ kind: 'class', className: c.className, linesToTests: c.linesToTests, linesToMethod: c.linesToMethod }));
	}

	/**
	 * Faz 21 - Faz 16 madde 1'in düzeltmesi.
	 *
	 * Eskiden yön, "bu sınıfın `perTest.entries`'te satır kaydı var mı"
	 * sorusuyla seçiliyordu: önce `testsForClass` denenip `'found'`
	 * gelirse production yönü çiziliyordu. Bu yanlıştı, çünkü PIT tabanlı
	 * L2 toplayıcısı **test sınıflarını da** `entries`'e yazıyor (gerçek
	 * playground koşusunda doğrulandı, 2026-08-28: 10 test sınıfının onu
	 * da kendi satırlarını kendi test metotlarıyla "kapsıyor" olarak
	 * listeleniyordu). Sonuç: bir test dosyası açıldığında ters yön yerine
	 * "kendi kendini kapsıyor" görünümü çıkıyordu.
	 *
	 * Yön artık yol tabanlı, CLI'ın kendi `inputs.modules[]` beyanından
	 * (`classifySourcePath`). Beyan yoksa (`'unknown'`) yön **tahmin
	 * edilmez**: hangi yönde gerçek kanıt varsa o gösterilir, ikisi de
	 * varsa production yönü seçilip kullanıcıya bunun bir varsayım olduğu
	 * söylenir (hard rule 3a).
	 */
	private computeView():
		| { kind: 'production'; linesToTests: ReadonlyMap<number, readonly string[]>; linesToMethod: ReadonlyMap<number, string> }
		| { kind: 'test'; className: string; reverse: ReadonlyMap<string, readonly TestLineRef[]> }
		| { kind: 'noPerTestData' }
		| undefined {
		const document = this.activeDocument;
		const perTestState = getPerTestState();
		if (!document || !perTestState?.perTest) {
			return document ? { kind: 'noPerTestData' } : undefined;
		}
		const fileBaseName = document.fileName.split(/[\\/]/).pop()!.replace(/\.java$/, '');
		const className = detectClassName(document.getText(), fileBaseName);
		const kind = this.classifyActiveDocument(document);

		const reverseView = () => {
			const reverse = testsToLines(perTestState.perTest!, productionClassFilter());
			return [...reverse.keys()].some((key) => key.startsWith(`${className}#`))
				? { kind: 'test' as const, className, reverse }
				: undefined;
		};
		const productionView = () => {
			const production = testsForClass(perTestState.perTest!, className);
			return production.kind === 'found'
				? { kind: 'production' as const, linesToTests: production.linesToTests, linesToMethod: production.linesToMethod }
				: undefined;
		};

		if (kind === 'test') {
			return reverseView() ?? { kind: 'noPerTestData' };
		}
		if (kind === 'production') {
			return productionView() ?? { kind: 'noPerTestData' };
		}
		// 'unknown': modül beyanı yok ya da dosya beyan edilmiş hiçbir kökün
		// altında değil. Uydurmak yerine kanıtın kendisine bakılır.
		return productionView() ?? reverseView() ?? { kind: 'noPerTestData' };
	}

	/** Aktif dosyanın CLI beyanına göre test mi production mı olduğu; workspace kökü ya da modül listesi yoksa `'unknown'`. */
	private classifyActiveDocument(document: vscode.TextDocument): SourceKind {
		const state = getCoverageState();
		if (!state || state.modules.length === 0) {
			return 'unknown';
		}
		const relative = toRepoRelativePath(state.workspaceRoot, document.fileName);
		return relative === undefined ? 'unknown' : classifySourcePath(relative, state.modules);
	}
}

/**
 * Faz 21: ters yönde "bu test hangi production satırlarını çalıştırıyor"
 * sorusunun cevabından test sınıflarının kendi satırlarını eler.
 * `fileCoverage.files[]` bu koşunun production dosyalarının tam listesi -
 * hangi sınıfın production olduğunun tek yetkili kaynağı o. Blok yoksa
 * süzgeç de yok: eksik bilgiyle elemektense hiç elememek yeğdir.
 */
function productionClassFilter(): ((outerClassName: string) => boolean) | undefined {
	const state = getCoverageState();
	if (!state?.fileCoverage) {
		return undefined;
	}
	const { byClassName } = buildProductionClassIndex(state.fileCoverage, productionSourceRoots(state.modules));
	return (outerClassName) => byClassName.has(outerClassName);
}

/** Bir satır "sorunlu" sayılır: cover eden testlerden en az biri `ok` değil (doğrulaması yok/zayıf/gereksiz ya da çözülemedi). */
function hasProblem(tests: readonly string[], findingsByTestMethod: ReturnType<typeof indexFindingsByTestMethod>): boolean {
	return lineQuality(tests, findingsByTestMethod).tests.some((t) => t.verdict !== 'ok');
}

/** Faz 31: "ben değişiklik yapmadan tüm repoda tarama yapabilmeliyim" - diff hiç hedef bulamadığında sunulan kurtarma eylemi, `coverdict.perTestForModuleAll`. */
function scanAllHintItem(): vscode.TreeItem {
	const item = new vscode.TreeItem('Yine de Tüm Modülü Tara (diff\'siz)', vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon('play');
	item.command = { command: 'coverdict.perTestForModuleAll', title: 'Tüm Modülü Tara' };
	return item;
}

function collectHintItem(): vscode.TreeItem {
	const item = new vscode.TreeItem('Bu Sınıf İçin Topla', vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon('play');
	item.command = { command: 'coverdict.perTestForFile', title: 'Bu Sınıf İçin Topla' };
	return item;
}

/** Faz 31: "tüm sınıflar" kökündeki bir sınıf düğümü - `mutationView.ts`'in `classItem`'ıyla aynı üslup. */
function classItem(node: Extract<LineTestsNode, { kind: 'class' }>): vscode.TreeItem {
	const item = new vscode.TreeItem(shortName(node.className), vscode.TreeItemCollapsibleState.Collapsed);
	item.description = `${node.linesToTests.size} satır`;
	item.iconPath = new vscode.ThemeIcon('symbol-class');
	item.tooltip = node.className;
	item.contextValue = 'coverdict.lineTestsClass';
	return item;
}

function prodLineItem(node: Extract<LineTestsNode, { kind: 'prodLine' }>): vscode.TreeItem {
	const findingsByTestMethod = indexFindingsByTestMethod(getCoverageState()?.findings ?? []);
	const quality = lineQuality(node.tests, findingsByTestMethod);
	const weak = quality.byVerdict.noOracle + quality.byVerdict.weak;
	const baseLabel = node.startLine === node.endLine ? `Satır ${node.startLine}` : `Satır ${node.startLine}-${node.endLine}`;
	// Faz 24 (§7.6 madde 4): gerçek `methodName` bilgisi biliniyorsa etikete
	// eklenir - JaCoCo/PIT bir sınıfın tek satırlık `<init>()`ını (parametresiz
	// constructor kodu yoksa) sınıf bildirim satırına yazar, o satır da her
	// nesne oluşturan testte "kapsanmış" görünür (gerçek playground verisi,
	// 2026-08-28: "Satır 4 · 14 test"). Gizlemek yerine hangi metoda ait
	// olduğu gösterilir (hard rule 3a) - "örtük" diye bir iddia yok, sadece
	// gerçek veri.
	const label = node.methodName ? `${baseLabel} · ${node.methodName}()` : baseLabel;
	const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
	item.description = weak > 0 ? `${node.tests.length} test (${weak} oracle'sız/zayıf)` : `${node.tests.length} test`;
	item.iconPath = new vscode.ThemeIcon(quality.isFalseGreen ? 'warning' : 'circle-filled', quality.isFalseGreen ? new vscode.ThemeColor('editorWarning.foreground') : undefined);
	const tooltipParts: string[] = [];
	if (node.methodName === '<init>' && node.startLine === node.endLine) {
		tooltipParts.push('Bu satır constructor\'a (`<init>()`) ait - nesne oluşturan her test bu satırı da kapsar, yüksek test sayısı bundan kaynaklanıyor olabilir.');
	}
	if (quality.isFalseGreen) {
		tooltipParts.push('Bu satırı kapsayan hiçbir testin oracle\'ı yok - kapsama yeşil ama satır gerçekte doğrulanmıyor.');
	}
	if (tooltipParts.length > 0) {
		item.tooltip = new vscode.MarkdownString(tooltipParts.join('\n\n'));
	}
	item.contextValue = 'coverdict.prodLine';
	return item;
}

async function prodTestItem(node: Extract<LineTestsNode, { kind: 'prodTest' }>): Promise<vscode.TreeItem> {
	const identity = parseTestIdentity(node.rawTestId);
	const item = new vscode.TreeItem(identity.display, vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon(verdictIcon(node.verdict), verdictColor(node.verdict));
	item.description = node.finding?.rule;
	const tooltipParts: string[] = [];
	if (node.finding) {
		tooltipParts.push(`**${node.finding.confidence}** - ${node.finding.message}\n\n${node.finding.suggestedAction}`);
	}
	// Faz 24 (§7.6 madde 6): L0 bu testi çözemeyip INCONCLUSIVE dediyse ama
	// L3 mutasyon kanıtı aynı testin gerçekten bir mutant öldürdüğünü
	// gösteriyorsa, bu statik belirsizliği çürüten gerçek bir kanıt -
	// aracın en değerli anı iki ayrı görünümde birbirinden habersiz
	// durmasın diye burada bağlanıyor.
	const contradiction = node.verdict === 'inconclusive' && identity.className && identity.methodName
		? findContradictionEvidence(identity.className, identity.methodName)
		: undefined;
	if (contradiction) {
		tooltipParts.push(
			'---\n\n'
			+ `**Mutasyon kanıtı bunu çürütüyor:** statik analiz bu testi çözemedi, ama bu test gerçekten \`${contradiction.className}#${contradiction.methodName}${contradiction.methodDescription}\`'in bir mutantını (satır ${contradiction.mutantLine}) öldürdü - davranışı gerçekten gözlüyor. Sağ tık → "Mutasyon Ağacında Göster".`,
		);
	}
	if (tooltipParts.length > 0) {
		item.tooltip = new vscode.MarkdownString(tooltipParts.join('\n\n'));
	}
	// Faz 31: `node.finding` yalnızca test `ok` değilse dolu - önceden bu
	// yüzden yalnızca sorunlu testler navigasyon alıyordu, sağlıklı bir
	// testte hiçbir şey olmuyordu. `finding.path` yoksa `locateTestFile`
	// (`hoverProvider.ts`'in zaten kullandığı aynı mekanizma) testin kendi
	// kaynak kökündeki gerçek dosyasını arar; hiçbiri bulunamazsa (hard rule
	// 3a) link hiç üretilmez.
	const state = getCoverageState();
	if (state && identity.className) {
		const path = await locateTestFile(state.workspaceRoot, testSourceRoots(state.modules), identity.className, node.finding?.path);
		if (path) {
			const uri = vscode.Uri.file(toAbsolutePath(state.workspaceRoot, path));
			const startLine = node.finding?.startLine ?? 1;
			const selection = new vscode.Range(startLine - 1, 0, startLine - 1, 0);
			item.command = { command: 'vscode.open', title: 'Test Dosyasını Aç', arguments: [uri, { selection }] };
		}
	}
	item.contextValue = contradiction ? 'coverdict.prodTest.contradiction' : 'coverdict.prodTest';
	return item;
}

/** `getMutationState()`'te bu test için gerçekten bir `killingTests` kaydı var mı - `ui/commands.ts`'in köprü komutu bunu `findMutationBridgeTarget`'a besler. */
function findContradictionEvidence(testClassName: string, testMethodName: string): KillContribution | undefined {
	const state = getMutationState();
	return state?.mutation ? findKillContribution(state.mutation, testClassName, testMethodName) : undefined;
}

function testLineItem(node: Extract<LineTestsNode, { kind: 'testLine' }>): vscode.TreeItem {
	const state = getCoverageState();
	const item = leaf(`${shortName(node.ref.outerClassName)}.java : ${node.ref.line}`, 'circle-filled');
	const productionIndex = state?.fileCoverage ? buildProductionClassIndex(state.fileCoverage, productionSourceRoots(state.modules)) : undefined;
	const path = productionIndex?.byClassName.get(node.ref.outerClassName);
	if (state && path) {
		const uri = vscode.Uri.file(toAbsolutePath(state.workspaceRoot, path));
		const selection = new vscode.Range(node.ref.line - 1, 0, node.ref.line - 1, 0);
		item.command = { command: 'vscode.open', title: 'Dosyayı Aç', arguments: [uri, { selection }] };
	}
	return item;
}

/**
 * Faz 31: an explicit `.tooltip` (not VS Code's own implicit
 * label-overflow fallback) - a long `'empty'` explanation message wasn't
 * reliably copyable from the auto-truncation hover, real user report.
 * Harmless for short labels that already fit (identical text either way).
 */
function leaf(label: string, icon: string): vscode.TreeItem {
	const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
	item.iconPath = new vscode.ThemeIcon(icon);
	item.tooltip = label;
	return item;
}

function verdictIcon(verdict: TestVerdict): string {
	switch (verdict) {
		case 'ok':
			return 'check';
		case 'inconclusive':
			return 'question';
		default:
			return 'warning';
	}
}

function verdictColor(verdict: TestVerdict): vscode.ThemeColor | undefined {
	return verdict === 'noOracle' || verdict === 'weak' ? new vscode.ThemeColor('editorWarning.foreground') : undefined;
}

/**
 * Eski webview panelinin (silindi, Faz 15) F3 kademesinin taşınmış hali:
 * `PER_TEST_TRUNCATED` (kanıt düşürüldü, "test yok" değil - hard rule 3a)
 * ve `PER_TEST_NO_CHANGED_TARGETS` (diff'te değişen sınıf yoktu -
 * kullanıcının 2026-08-27'de "anlamadım" dediği tam durum) hâlâ ayrı ve
 * çözümü söyleyen mesajlar üretir; hiçbiri yoksa "hiç kanıt yok" gösterir.
 */
function noPerTestDataMessage(): string {
	const perTestState = getPerTestState();
	// Faz 30: `perTestState.warnings` is already the complete, exact warning
	// list this run produced - there is no "wrong module" a warning in it
	// could belong to, so filtering by module (the old
	// `w.module === perTestState.moduleId` check) never excluded anything
	// real. Matching by code alone is the same behavior without a moduleId.
	const warningFor = (code: string) => perTestState?.warnings.find((w) => w.code === code);

	const truncated = warningFor('PER_TEST_TRUNCATED');
	if (truncated) {
		return `Bu modül için test bazlı kanıt düşürüldü: ${truncated.message} Gösterilenler eksik olabilir - "bu satırı hiçbir test kapsamıyor" anlamına gelmez.`;
	}
	if (warningFor('PER_TEST_NO_CHANGED_TARGETS')) {
		return 'Bu koşuda hiçbir sınıf değişmemiş, bu yüzden test bazlı kanıt boş - bu bir hata değil: L2 sadece diff\'te değişen production sınıflarını hedefler. '
			+ 'Bu dosyada gerçek bir değişiklik yapıp tekrar tarayın, coverdict.diffMode\'u "base" yapıp coverdict.baseRef\'e bu sınıfın değiştiği bir commit/branch girin, ya da aşağıdaki düğmeyle diff\'ten bağımsız tüm modülü tarayın.';
	}
	return 'Bu sınıf için test bazlı kanıt yok.';
}

/** Faz 31: `PER_TEST_NO_CHANGED_TARGETS` tam olarak buysa `'scanAllHint'` düğümü ekleniyor - başka bir `noPerTestData` sebebinde (kanıt kesildi, hiç kanıt yok) diff'siz tüm modül taraması bir çözüm değil. */
function hasNoChangedTargetsWarning(): boolean {
	return getPerTestState()?.warnings.some((w) => w.code === 'PER_TEST_NO_CHANGED_TARGETS') ?? false;
}

function shortName(fqcn: string): string {
	const dot = fqcn.lastIndexOf('.');
	return dot < 0 ? fqcn : fqcn.slice(dot + 1);
}
