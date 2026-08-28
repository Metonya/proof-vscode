import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { bucketOf, classesOf, formatRelativeTime, methodLabel, mutatorLabel, scoreOf, targetSummary } from '../../../model/mutationModel';
import type { MutatedMethod, MutationBlock, Mutant } from '../../../verdict/types';

const mutant = (status: string, line = 10, killingTests: string[] = []): Mutant => ({
	mutator: 'org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator', line, status, killingTests,
});

/**
 * Faz 20, PLAN.md §8.3 - kullanıcının onayladığı eşleme. Dokuz statünün
 * hepsi burada tek tek doğrulanıyor: yeni bir PIT sürümü listeyi
 * değiştirirse bu test kırılır, sessizce yanlış kovaya sayılmaz.
 */
test('PIT\'in dokuz statüsünün üçe eşlenmesi', () => {
	assert.equal(bucketOf('KILLED'), 'killed');
	assert.equal(bucketOf('TIMED_OUT'), 'killed', 'PIT geleneği: mutant sonsuz döngüye soktu = davranış değişikliği tespit edildi');
	assert.equal(bucketOf('SURVIVED'), 'survived');
	for (const status of ['NON_VIABLE', 'MEMORY_ERROR', 'NOT_STARTED', 'STARTED', 'RUN_ERROR', 'NO_COVERAGE']) {
		assert.equal(bucketOf(status), 'indeterminate', `${status} ne öldürüldü ne hayatta kaldı sayılmalı`);
	}
});

/** Hard rule 3a: tanımadığımız bir statü belirsizdir - iyimser ya da kötümser tarafa yuvarlanmaz. */
test('tanınmayan bir statü belirsiz sayılır, killed/survived\'a katlanmaz', () => {
	assert.equal(bucketOf('SOMETHING_NEW_IN_PIT_2'), 'indeterminate');
	assert.equal(bucketOf(''), 'indeterminate');
});

test('skor: belirsizler paydaya girmez ve ayrıca sayılır', () => {
	const score = scoreOf([mutant('KILLED'), mutant('SURVIVED'), mutant('NO_COVERAGE'), mutant('RUN_ERROR')]);
	assert.deepEqual({ killed: score.killed, survived: score.survived, indeterminate: score.indeterminate }, { killed: 1, survived: 1, indeterminate: 2 });
	assert.equal(score.percent, 50, 'payda 2 (karara bağlananlar), 4 değil');
});

/** "Skor yok" ile "skor %0" farklı iddialardır. */
test('karara bağlanmış mutant yoksa yüzde null olur, sıfır değil', () => {
	const score = scoreOf([mutant('NO_COVERAGE'), mutant('NON_VIABLE')]);
	assert.equal(score.percent, null);
	assert.equal(score.indeterminate, 2);
});

test('hiç mutant yoksa da yüzde null', () => {
	assert.equal(scoreOf([]).percent, null);
});

const method = (className: string, methodName: string, firstLine: number, mutants: Mutant[], methodDescription = '(I)I'): MutatedMethod => ({
	className, methodName, methodDescription, firstLine, lastLine: firstLine, mutants,
});

/**
 * Gerçek koşudan (2026-08-28) çıkan tuzak: PIT test sınıflarını da mutasyona
 * sokuyor - tek bir `--mutation-target root=...Calculator` koşusunda üretilen
 * 16 metodun 8'i test sınıflarındandı. Testin kendi mutant skoru kullanıcıya
 * hiçbir şey söylemez ve production skorunu bozar.
 */
const BLOCK: MutationBlock = {
	engine: 'pitest',
	engineVersion: '1.15.8',
	modules: [{
		id: 'root',
		methods: [
			method('dev.coverdict.playground.Calculator', 'square', 37, [mutant('SURVIVED', 37)]),
			method('dev.coverdict.playground.Calculator', 'divide', 22, [mutant('KILLED', 22, ['CalcTest#divideNarrow()'])], '(II)I'),
			method('dev.coverdict.playground.CalculatorSubsumedTest', 'divideNarrow', 19, [mutant('SURVIVED', 19)]),
		],
	}],
};

test('classesOf: production süzgeciyle test sınıfları elenir', () => {
	const classes = classesOf(BLOCK, 'root', (c) => c === 'dev.coverdict.playground.Calculator');
	assert.deepEqual(classes.map((c) => c.className), ['dev.coverdict.playground.Calculator']);
	assert.equal(classes[0].methods.length, 2);
});

test('classesOf: süzgeç verilmezse hiçbir şey elenmez - eksik bilgiyle elemek kanıt yok eder', () => {
	assert.equal(classesOf(BLOCK, 'root').length, 2);
});

test('classesOf: metotlar satır sırasına göre, sınıflar ada göre sıralanır', () => {
	const methods = classesOf(BLOCK, 'root', () => true).find((c) => c.className.endsWith('Calculator'))!.methods;
	assert.deepEqual(methods.map((m) => m.firstLine), [22, 37]);
});

test('classesOf: bilinmeyen modül id boş liste döner, hata değil', () => {
	assert.deepEqual(classesOf(BLOCK, 'nope'), []);
});

/**
 * PIT `mutator`'ı tam sınıf adı olarak yayınlıyor - şemanın golden
 * örneğindeki kısa `TRUE_RETURNS` biçimi gerçek çıktıda görülmedi
 * (2026-08-28 doğrulandı), o yüzden ikisi de okunabilir kalmalı.
 */
test('mutatorLabel gerçek PIT sınıf adını kısaltır', () => {
	assert.equal(mutatorLabel('org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator'), 'PrimitiveReturns');
	assert.equal(mutatorLabel('org.pitest.mutationtest.engine.gregor.mutators.VoidMethodCallMutator'), 'VoidMethodCall');
});

test('mutatorLabel kısa/beklenmedik bir adı bozmadan geçirir', () => {
	assert.equal(mutatorLabel('TRUE_RETURNS'), 'TRUE_RETURNS');
	assert.equal(mutatorLabel('Mutator'), 'Mutator', 'sonek atılınca boş kalacaksa ham ad korunur');
});

test('methodLabel yalnızca gerçekten aşırı yüklenmiş metotta descriptor gösterir', () => {
	const single = method('C', 'square', 1, []);
	assert.equal(methodLabel(single, [single]), 'square()');

	const a = method('C', 'add', 1, [], '(II)I');
	const b = method('C', 'add', 5, [], '(DD)D');
	assert.equal(methodLabel(a, [a, b]), 'add(II)I');
});

/** Faz 22: mutasyon panelinin "bu sonuç neyin?" başlığı için hedef özeti. */
test('targetSummary: tek hedef sınıfın kısa adını gösterir', () => {
	assert.equal(targetSummary(['dev.coverdict.playground.Calculator']), 'Calculator');
});

test('targetSummary: birden çok hedefte sayı gösterir, tek tek listelemez', () => {
	assert.equal(targetSummary(['a.B', 'a.C', 'a.D']), '3 sınıf');
});

test('targetSummary: hedef boşsa (modül geneli, diff\'ten türetilmiş) bunu söyler', () => {
	assert.equal(targetSummary([]), "diff'teki değişen sınıflar");
});

/** Faz 22: "ne kadar önce" - CLI zaman damgası taşımadığı için bu tamamen eklentinin kendi saatiyle hesaplanır. */
test('formatRelativeTime: bir dakikadan az "az önce"', () => {
	const now = Date.parse('2026-08-28T12:00:00Z');
	assert.equal(formatRelativeTime(now - 30_000, now), 'az önce');
});

test('formatRelativeTime: dakika, saat, gün eşikleri', () => {
	const now = Date.parse('2026-08-28T12:00:00Z');
	assert.equal(formatRelativeTime(now - 5 * 60_000, now), '5 dakika önce');
	assert.equal(formatRelativeTime(now - 90 * 60_000, now), '2 saat önce', '90 dakika en yakın saate yuvarlanır');
	assert.equal(formatRelativeTime(now - 50 * 3600_000, now), '2 gün önce');
});

test('formatRelativeTime: gelecekteki bir zaman (saat kayması) negatif süreye düşmez', () => {
	const now = Date.parse('2026-08-28T12:00:00Z');
	assert.equal(formatRelativeTime(now + 10_000, now), 'az önce');
});
