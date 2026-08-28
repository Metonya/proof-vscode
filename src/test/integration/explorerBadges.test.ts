import * as assert from 'node:assert';
import * as path from 'node:path';
import * as vscode from 'vscode';

import type { FileCoverageBlock } from '../../verdict/types';
import { ExplorerBadgeProvider } from '../../ui/explorerBadges';

// Gerçek kullanımda workspaceRoot her zaman `folder.uri.fsPath`'ten gelir (bkz.
// `ui/commands.ts`'in `paintCoverage`'ı) - VS Code'un kendi normalize ettiği
// biçim (Windows'ta örn. sürücü harfi küçük). Burada da aynı yoldan
// üretiliyor, aksi halde bir Uri.file() lookup'ıyla ham bir string literal
// arasında yapay bir büyük/küçük harf uyuşmazlığı test edilmiş olurdu.
const WORKSPACE_ROOT = vscode.Uri.file('C:/Users/Mert/Desktop/coverdict-playground').fsPath;

/**
 * Faz 13 madde 8: NOTES.md'nin "rozetler sadece Calculator.java'da görünüyor"
 * gözlemini gerçek playground verisiyle doğrulamak için. Gerçek bir
 * `analyze --file-coverage` koşusundan alınan üç dosyalık blok (2026-08-28):
 * `Notifier.java` saf bir arayüz (`void notify(String)`, gövdesiz) - üçü de
 * `denominator: 0` -> `percent: null` veriyor, hard rule 3a'ya göre rozetsiz
 * kalması **doğru**. `Calculator.java` (sonar-compatible 80%) ve
 * `NotifyingCalculator.java` (sonar-compatible 100%) ikisi de gerçek veriye
 * sahip - ikisinin de rozet alması gerekir. Bu test, üç dosyanın üçünün de
 * `byAbsolutePath` eşleştirmesinden geçtiğini kanıtlıyor; yalnızca
 * `Notifier.java`'nın kendi verisi yüzünden (yol çakışması değil) rozetsiz
 * kaldığını gösteriyor.
 */
const FILE_COVERAGE: FileCoverageBlock = {
	files: [
		{
			module: 'root',
			path: 'src/main/java/dev/coverdict/playground/Calculator.java',
			metrics: {
				'jacoco-line': { numeratorName: 'coveredLines', numerator: 11, denominatorName: 'executableLines', denominator: 12, percent: 91.7 },
				'strict-line': { numeratorName: 'fullyCoveredLines', numerator: 9, denominatorName: 'executableLines', denominator: 12, percent: 75 },
				'sonar-compatible': { numeratorName: 'coveredBranchesPlusCoveredLines', numerator: 16, denominatorName: 'branchesPlusExecutableLines', denominator: 20, percent: 80 },
			},
			lines: [],
		},
		{
			module: 'root',
			path: 'src/main/java/dev/coverdict/playground/Notifier.java',
			metrics: {
				'jacoco-line': { numeratorName: 'coveredLines', numerator: 0, denominatorName: 'executableLines', denominator: 0, percent: null },
				'strict-line': { numeratorName: 'fullyCoveredLines', numerator: 0, denominatorName: 'executableLines', denominator: 0, percent: null },
				'sonar-compatible': { numeratorName: 'coveredBranchesPlusCoveredLines', numerator: 0, denominatorName: 'branchesPlusExecutableLines', denominator: 0, percent: null },
			},
			lines: [],
		},
		{
			module: 'root',
			path: 'src/main/java/dev/coverdict/playground/NotifyingCalculator.java',
			metrics: {
				'jacoco-line': { numeratorName: 'coveredLines', numerator: 6, denominatorName: 'executableLines', denominator: 6, percent: 100 },
				'strict-line': { numeratorName: 'fullyCoveredLines', numerator: 6, denominatorName: 'executableLines', denominator: 6, percent: 100 },
				'sonar-compatible': { numeratorName: 'coveredBranchesPlusCoveredLines', numerator: 6, denominatorName: 'branchesPlusExecutableLines', denominator: 6, percent: 100 },
			},
			lines: [],
		},
	],
	excluded: [],
};

suite('Explorer badges (Faz 9 / Faz 13 madde 8)', () => {
	test('every file with real data gets a badge; a file with zero coverable lines legitimately gets none', () => {
		const provider = new ExplorerBadgeProvider();
		provider.update(WORKSPACE_ROOT, FILE_COVERAGE, 'sonar-compatible');

		const calculator = provider.provideFileDecoration(vscode.Uri.file(path.join(WORKSPACE_ROOT, 'src/main/java/dev/coverdict/playground/Calculator.java')));
		assert.ok(calculator, 'Calculator.java (gerçek veri, %80) rozet almalı');
		assert.equal(calculator!.badge, '80');

		const notifying = provider.provideFileDecoration(vscode.Uri.file(path.join(WORKSPACE_ROOT, 'src/main/java/dev/coverdict/playground/NotifyingCalculator.java')));
		assert.ok(notifying, 'NotifyingCalculator.java (gerçek veri, %100) rozet almalı');
		assert.equal(notifying!.badge, '✓', '%100 iki karaktere sığmaz ("100"), VS Code onu reddedip dekorasyonu tamamen düşürür - Faz 18');

		const notifier = provider.provideFileDecoration(vscode.Uri.file(path.join(WORKSPACE_ROOT, 'src/main/java/dev/coverdict/playground/Notifier.java')));
		assert.equal(notifier, undefined, 'Notifier.java saf arayüz - 0 çalıştırılabilir satır, veri yok, rozet olmamalı (hard rule 3a)');

		const folder = provider.provideFileDecoration(vscode.Uri.file(path.join(WORKSPACE_ROOT, 'src/main/java/dev/coverdict/playground')));
		assert.ok(folder, 'klasör rozeti, veri taşıyan iki dosyanın rollup\'ından gelmeli');
		assert.equal(folder!.badge, '85');

		provider.dispose();
	});

	/**
	 * Faz 18, the constraint that silently broke every 100%-covered file:
	 * VS Code's extension host throws ("The 'badge'-property must be
	 * undefined or a short character") when a badge exceeds two code
	 * points, and drops that provider's decoration for the file entirely.
	 * It is not in the `.d.ts` - confirmed by reading the shipped 1.135.0
	 * extension host bundle. The previous test asserted `badge === '100'`
	 * and passed, because the throw happens when VS Code *consumes* the
	 * decoration, not when we construct it - so this asserts the real
	 * invariant instead: every badge we ever hand out must fit.
	 */
	test('no badge this provider produces ever exceeds two code points (VS Code rejects longer ones)', () => {
		const provider = new ExplorerBadgeProvider();
		provider.update(WORKSPACE_ROOT, FILE_COVERAGE, 'sonar-compatible');

		const uris = [
			'src/main/java/dev/coverdict/playground/Calculator.java',
			'src/main/java/dev/coverdict/playground/Notifier.java',
			'src/main/java/dev/coverdict/playground/NotifyingCalculator.java',
			'src/main/java/dev/coverdict/playground',
			'src/main/java',
			'src',
		].map((p) => vscode.Uri.file(path.join(WORKSPACE_ROOT, p)));

		for (const uri of uris) {
			const badge = provider.provideFileDecoration(uri)?.badge;
			if (badge !== undefined) {
				assert.ok([...badge].length <= 2, `badge ${JSON.stringify(badge)} for ${uri.fsPath} is longer than 2 code points - VS Code would reject it`);
			}
		}
		provider.dispose();
	});

	/** Faz 18: a file the user deliberately excluded must not look identical to a file coverdict simply has no data for. */
	test('an excluded file gets its own badge and gray color, distinct from "no data"', () => {
		const provider = new ExplorerBadgeProvider();
		provider.update(WORKSPACE_ROOT, { ...FILE_COVERAGE, excluded: ['src/main/java/dev/coverdict/playground/Generated.java'] }, 'sonar-compatible');

		const excluded = provider.provideFileDecoration(vscode.Uri.file(path.join(WORKSPACE_ROOT, 'src/main/java/dev/coverdict/playground/Generated.java')));
		assert.ok(excluded, 'kapsama dışı bırakılmış dosya da işaretlenmeli');
		assert.equal(excluded!.badge, '–');
		assert.match(String(excluded!.tooltip), /coverage dışı/);

		provider.dispose();
	});
});
