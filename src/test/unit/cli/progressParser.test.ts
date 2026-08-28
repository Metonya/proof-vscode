import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { incrementFor, parseProgressLine, progressMessage } from '../../../cli/progressParser';

/**
 * Faz 20: satır biçimleri gerçek CLI kaynağından alındı
 * (`MutationCollector`/`MutationRunner`/`PerTestCollector`/`PerTestRunner`)
 * ve gerçek bir playground koşusunda doğrulandı (2026-08-28) - iki başlangıç
 * ve bir bitiş satırı birebir o koşunun stderr'inden.
 */
test('gerçek bir mutasyon koşusunun başlangıç satırı: hedef sayısı ve bütçe', () => {
	const event = parseProgressLine("coverdict: mutation: module 'root' - 1 target class(es), budget 300s");
	assert.deepEqual(event, { kind: 'mutation', phase: 'start', moduleId: 'root', total: 1, budgetSeconds: 300 });
});

test('gerçek bir L2 koşusunun başlangıç satırı: bütçe yok', () => {
	const event = parseProgressLine("coverdict: per-test: module 'root' - 4 target class(es)");
	assert.deepEqual(event, { kind: 'perTest', phase: 'start', moduleId: 'root', total: 4, budgetSeconds: undefined });
});

test('heartbeat: sınıf sayacı ve geçen süre', () => {
	const event = parseProgressLine("coverdict: mutation: module 'root' - 2/3 class(es), 6m12s elapsed");
	assert.deepEqual(event, { kind: 'mutation', phase: 'heartbeat', moduleId: 'root', done: 2, total: 3, elapsed: '6m12s' });
});

test('L2 heartbeat sayaçsızdır - done/total undefined kalır, uydurulmaz', () => {
	const event = parseProgressLine("coverdict: per-test: module 'root' - collecting coverage, 48s elapsed");
	assert.deepEqual(event, { kind: 'perTest', phase: 'heartbeat', moduleId: 'root', elapsed: '48s' });
});

test('gerçek bir koşunun bitiş satırı', () => {
	const event = parseProgressLine("coverdict: mutation: module 'root' - done, 16 method(s) with mutants");
	assert.deepEqual(event, { kind: 'mutation', phase: 'done', moduleId: 'root', message: 'done, 16 method(s) with mutants' });
});

test('bütçe aşımı bir başarısızlıktır, bitiş değil', () => {
	const event = parseProgressLine("coverdict: mutation: module 'root' - FAILED, budget of 300s exhausted after 2/3 class(es) completed");
	assert.equal(event?.phase, 'failed');
});

test('"no mutable target" da bir bitiş değil, açıklanması gereken bir hâldir', () => {
	const event = parseProgressLine("coverdict: mutation: module 'root' - no mutable target found by the engine");
	assert.equal(event?.phase, 'failed');
});

test('coverdict: öneki olmadan da ayrıştırılır (runner satırı zaten soyabilir)', () => {
	assert.equal(parseProgressLine("mutation: module 'root' - 2/3 class(es), 1m elapsed")?.phase, 'heartbeat');
});

/** Hard rule 3a: tanınmayan satır yutulmaz - `undefined` döner ve çağıran onu Output'a aynen yazar. */
test('tanınmayan satır undefined döner, uydurulmuş bir olay değil', () => {
	assert.equal(parseProgressLine('coverdict: analysis complete (no-vcs)'), undefined);
	assert.equal(parseProgressLine('  jacoco-line        89.5% (17/19)'), undefined);
	assert.equal(parseProgressLine(''), undefined);
	assert.equal(parseProgressLine("coverdict: mutation: module 'root' - something we have never seen"), undefined);
});

test('progressMessage geçen süreyi her zaman yazar - 30sn heartbeat yüzünden yüzde donmuş görünmemeli', () => {
	const heartbeat = parseProgressLine("coverdict: mutation: module 'root' - 2/3 class(es), 6m12s elapsed")!;
	assert.equal(progressMessage(heartbeat), '2/3 sınıf · 6m12s');

	const plain = parseProgressLine("coverdict: per-test: module 'root' - collecting coverage, 48s elapsed")!;
	assert.equal(progressMessage(plain), 'kanıt toplanıyor · 48s');
});

test('progressMessage başlangıçta bütçeyi de söyler', () => {
	const start = parseProgressLine("coverdict: mutation: module 'root' - 3 target class(es), budget 300s")!;
	assert.equal(progressMessage(start), '3 sınıf taranacak · bütçe 300s');
});

test('incrementFor mutlak yüzde değil fark verir', () => {
	const at2of4 = parseProgressLine("coverdict: mutation: module 'root' - 2/4 class(es), 1m elapsed")!;
	assert.deepEqual(incrementFor(at2of4, 0), { increment: 50, done: 2 });
	assert.deepEqual(incrementFor(at2of4, 1), { increment: 25, done: 2 });
});

/** Toplam bilinmiyorsa uydurma bir ilerleme çubuğu, ilerleme çubuğu olmamasından kötüdür. */
test('incrementFor sayaçsız heartbeat ve geriye gidiş için artış yayınlamaz', () => {
	const plain = parseProgressLine("coverdict: per-test: module 'root' - collecting coverage, 48s elapsed")!;
	assert.equal(incrementFor(plain, 0), undefined);

	const at2of4 = parseProgressLine("coverdict: mutation: module 'root' - 2/4 class(es), 1m elapsed")!;
	assert.equal(incrementFor(at2of4, 2), undefined, 'aynı sayaç tekrar gelirse ilerleme çubuğu ileri atlamamalı');
	assert.equal(incrementFor(at2of4, 3), undefined, 'geriye giden bir sayaç negatif artış üretmemeli');

	const start = parseProgressLine("coverdict: mutation: module 'root' - 3 target class(es), budget 300s")!;
	assert.equal(incrementFor(start, 0), undefined);
});
