import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { incrementFor, parseDoctorProgressLine, parseProgressLine, progressMessage } from '../../../cli/progressParser';

/**
 * Faz 20: satır biçimleri gerçek CLI kaynağından alındı
 * (`MutationCollector`/`MutationRunner`/`PerTestCollector`/`PerTestRunner`)
 * ve gerçek bir playground koşusunda doğrulandı (2026-08-28) - iki başlangıç
 * ve bir bitiş satırı birebir o koşunun stderr'inden.
 */
test('gerçek bir mutasyon koşusunun başlangıç satırı: hedef sayısı ve bütçe', () => {
	const event = parseProgressLine("proof-java: mutation: module 'root' - 1 target class(es), budget 300s");
	assert.deepEqual(event, { kind: 'mutation', phase: 'start', moduleId: 'root', total: 1, budgetSeconds: 300 });
});

test('gerçek bir L2 koşusunun başlangıç satırı: bütçe yok', () => {
	const event = parseProgressLine("proof-java: per-test: module 'root' - 4 target class(es)");
	assert.deepEqual(event, { kind: 'perTest', phase: 'start', moduleId: 'root', total: 4, budgetSeconds: undefined });
});

test('heartbeat: sınıf sayacı ve geçen süre', () => {
	const event = parseProgressLine("proof-java: mutation: module 'root' - 2/3 class(es), 6m12s elapsed");
	assert.deepEqual(event, { kind: 'mutation', phase: 'heartbeat', moduleId: 'root', done: 2, total: 3, elapsed: '6m12s' });
});

test('L2 heartbeat sayaçsızdır - done/total undefined kalır, uydurulmaz', () => {
	const event = parseProgressLine("proof-java: per-test: module 'root' - collecting coverage, 48s elapsed");
	assert.deepEqual(event, { kind: 'perTest', phase: 'heartbeat', moduleId: 'root', elapsed: '48s' });
});

test('gerçek bir koşunun bitiş satırı', () => {
	const event = parseProgressLine("proof-java: mutation: module 'root' - done, 16 method(s) with mutants");
	assert.deepEqual(event, { kind: 'mutation', phase: 'done', moduleId: 'root', message: 'done, 16 method(s) with mutants' });
});

test('bütçe aşımı bir başarısızlıktır, bitiş değil', () => {
	const event = parseProgressLine("proof-java: mutation: module 'root' - FAILED, budget of 300s exhausted after 2/3 class(es) completed");
	assert.equal(event?.phase, 'failed');
});

test('"no mutable target" da bir bitiş değil, açıklanması gereken bir hâldir', () => {
	const event = parseProgressLine("proof-java: mutation: module 'root' - no mutable target found by the engine");
	assert.equal(event?.phase, 'failed');
});

test('proof-java: öneki olmadan da ayrıştırılır (runner satırı zaten soyabilir)', () => {
	assert.equal(parseProgressLine("mutation: module 'root' - 2/3 class(es), 1m elapsed")?.phase, 'heartbeat');
});

/** Hard rule 3a: tanınmayan satır yutulmaz - `undefined` döner ve çağıran onu Output'a aynen yazar. */
test('tanınmayan satır undefined döner, uydurulmuş bir olay değil', () => {
	assert.equal(parseProgressLine('proof-java: analysis complete (no-vcs)'), undefined);
	assert.equal(parseProgressLine('  jacoco-line        89.5% (17/19)'), undefined);
	assert.equal(parseProgressLine(''), undefined);
	assert.equal(parseProgressLine("proof-java: mutation: module 'root' - something we have never seen"), undefined);
});

test('progressMessage geçen süreyi her zaman yazar - 30sn heartbeat yüzünden yüzde donmuş görünmemeli', () => {
	const heartbeat = parseProgressLine("proof-java: mutation: module 'root' - 2/3 class(es), 6m12s elapsed")!;
	assert.equal(progressMessage(heartbeat), '2/3 class(es) · 6m12s');

	const plain = parseProgressLine("proof-java: per-test: module 'root' - collecting coverage, 48s elapsed")!;
	assert.equal(progressMessage(plain), 'collecting evidence · 48s');
});

test('progressMessage başlangıçta bütçeyi de söyler', () => {
	const start = parseProgressLine("proof-java: mutation: module 'root' - 3 target class(es), budget 300s")!;
	assert.equal(progressMessage(start), '3 class(es) to scan · budget 300s');
});

test('incrementFor mutlak yüzde değil fark verir', () => {
	const at2of4 = parseProgressLine("proof-java: mutation: module 'root' - 2/4 class(es), 1m elapsed")!;
	assert.deepEqual(incrementFor(at2of4, 0), { increment: 50, done: 2 });
	assert.deepEqual(incrementFor(at2of4, 1), { increment: 25, done: 2 });
});

/** Toplam bilinmiyorsa uydurma bir ilerleme çubuğu, ilerleme çubuğu olmamasından kötüdür. */
test('incrementFor sayaçsız heartbeat ve geriye gidiş için artış yayınlamaz', () => {
	const plain = parseProgressLine("proof-java: per-test: module 'root' - collecting coverage, 48s elapsed")!;
	assert.equal(incrementFor(plain, 0), undefined);

	const at2of4 = parseProgressLine("proof-java: mutation: module 'root' - 2/4 class(es), 1m elapsed")!;
	assert.equal(incrementFor(at2of4, 2), undefined, 'aynı sayaç tekrar gelirse ilerleme çubuğu ileri atlamamalı');
	assert.equal(incrementFor(at2of4, 3), undefined, 'geriye giden bir sayaç negatif artış üretmemeli');

	const start = parseProgressLine("proof-java: mutation: module 'root' - 3 target class(es), budget 300s")!;
	assert.equal(incrementFor(start, 0), undefined);
});

/**
 * The real multi-module regression: `gson` reaches 3/3 and then `extras`
 * starts its own 1/5 - a single shared `previousDone` sees `1 < 3` as
 * negative and drops the increment, freezing the bar. The caller must track
 * `previousDone` per moduleId (this function trusts whatever it is given),
 * so the fix is exercised here as two independent module counters.
 */
test('incrementFor: a second module starting its own count is not a regression against the first module\'s count', () => {
	const gsonDone3of3 = parseProgressLine("proof-java: mutation: module 'gson' - 3/3 class(es), 2m elapsed")!;
	assert.deepEqual(incrementFor(gsonDone3of3, 0, 2), { increment: 50, done: 3 });

	// extras tracks its own previousDone (0), not gson's (3) - the bug this fixes.
	const extrasDone1of5 = parseProgressLine("proof-java: mutation: module 'extras' - 1/5 class(es), 10s elapsed")!;
	assert.deepEqual(incrementFor(extrasDone1of5, 0, 2), { increment: 10, done: 1 });
});

test('incrementFor: moduleCount scales a module\'s share so an N-module run cannot exceed 100 total', () => {
	const fullModule = parseProgressLine("proof-java: mutation: module 'gson' - 3/3 class(es), 2m elapsed")!;
	assert.deepEqual(incrementFor(fullModule, 0, 3), { increment: 100 / 3, done: 3 });
});

test('incrementFor: moduleCount defaults to 1 (single-module run, unchanged from before Faz 30)', () => {
	const at2of4 = parseProgressLine("proof-java: mutation: module 'root' - 2/4 class(es), 1m elapsed")!;
	assert.deepEqual(incrementFor(at2of4, 0), { increment: 50, done: 2 });
});

test('progressMessage: showModule prefixes the module id, off by default', () => {
	const heartbeat = parseProgressLine("proof-java: mutation: module 'gson' - 2/3 class(es), 6m12s elapsed")!;
	assert.equal(progressMessage(heartbeat), '2/3 class(es) · 6m12s');
	assert.equal(progressMessage(heartbeat, true), "gson · 2/3 class(es) · 6m12s");
	assert.equal(progressMessage(heartbeat, false), '2/3 class(es) · 6m12s');
});

test('progressMessage: showModule prefixes start/done/failed too', () => {
	const start = parseProgressLine("proof-java: mutation: module 'gson' - 3 target class(es), budget 300s")!;
	assert.equal(progressMessage(start, true), "gson · 3 class(es) to scan · budget 300s");

	const done = parseProgressLine("proof-java: mutation: module 'gson' - done, 5 method(s) with mutants")!;
	assert.equal(progressMessage(done, true), 'gson · done');

	const failed = parseProgressLine("proof-java: mutation: module 'gson' - FAILED, budget of 300s exhausted after 2/3 class(es) completed")!;
	assert.equal(progressMessage(failed, true), "gson · FAILED, budget of 300s exhausted after 2/3 class(es) completed");
});

/** `DoctorCommand.applyFixes`'in gerçek satırı: `printErr("proof-java: doctor: fixing classpath for '" + module.id() + "'...")`. */
test("parseDoctorProgressLine: doctor --fix'in kendi satırından modül id'sini çıkarır", () => {
	assert.deepEqual(parseDoctorProgressLine("proof-java: doctor: fixing classpath for 'gson'..."), { moduleId: 'gson' });
	assert.deepEqual(parseDoctorProgressLine("proof-java: doctor: fixing classpath for 'root'..."), { moduleId: 'root' });
});

test('parseDoctorProgressLine: tanınmayan satır undefined döner - doctor\'ın diğer satırları (rapor, hata) uydurulmaz', () => {
	assert.equal(parseDoctorProgressLine("proof-java: doctor: 'gson' - Maven dependency resolution failed: ..."), undefined);
	assert.equal(parseDoctorProgressLine('proof-java: doctor: wrote proof.config.json'), undefined);
	assert.equal(parseDoctorProgressLine('  [ok] gson'), undefined);
	assert.equal(parseDoctorProgressLine(''), undefined);
});
