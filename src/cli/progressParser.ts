/**
 * Faz 20: `cli/runner.ts` bu dosyaya baştan beri (Faz 1'den) yorumunda
 * atıfta bulunuyordu ama dosya hiç yazılmamıştı - CLI'ın ilerleme akışı
 * bugüne kadar ham metin olarak Output kanalına dökülüyor, kullanıcı uzun
 * bir mutasyon koşusunda ne kadar ilerlediğini göremiyordu.
 *
 * CLI her ilerleme satırını **stderr**'e, `proof-java: ` önekiyle, anında
 * flush ederek basar (D-64: stdout metin raporunu taşır ve JSON'un byte
 * düzeyinde deterministik kalması gerekir). Heartbeat 30 saniyedir.
 * Gerçek biçimler (`MutationCollector`/`MutationRunner`/`PerTestCollector`/
 * `PerTestRunner`, doğrulandı 2026-08-28):
 *
 *   proof-java: mutation: module 'root' - 3 target class(es), budget 300s
 *   proof-java: mutation: module 'root' - 2/3 class(es), 6m12s elapsed
 *   proof-java: mutation: module 'root' - done, 5 method(s) with mutants
 *   proof-java: mutation: module 'root' - FAILED, budget of 300s exhausted after 2/3 class(es) completed
 *   proof-java: per-test: module 'root' - 4 target class(es)
 *   proof-java: per-test: module 'root' - collecting coverage, 48s elapsed
 *
 * Saf - `vscode` import etmez (`cli/argsBuilder.ts` ile aynı sözleşme).
 *
 * Tanımadığı satır için `undefined` döner ve **yutmaz**: çağıran onu
 * Output'a aynen yazar (hard rule 3a). Bu biçimler CLI'ın iç detayı,
 * sözleşmesi değil - değişirlerse burası sessizce yanlış yüzde göstermek
 * yerine hiç yüzde göstermez.
 */

export type ProgressEventKind = 'mutation' | 'perTest';

export type ProgressEvent =
	/** Koşu başladı; kaç hedef sınıf olduğu belli, henüz hiçbiri bitmedi. */
	| { kind: ProgressEventKind; phase: 'start'; moduleId: string; total: number; budgetSeconds?: number }
	/** 30 saniyelik heartbeat. `done`/`total` yalnızca mutasyonda vardır; L2 sınıf sayacı yayınlamaz. */
	| { kind: ProgressEventKind; phase: 'heartbeat'; moduleId: string; done?: number; total?: number; elapsed: string }
	| { kind: ProgressEventKind; phase: 'done'; moduleId: string; message: string }
	| { kind: ProgressEventKind; phase: 'failed'; moduleId: string; message: string };

const PREFIX = 'proof-java: ';
const HEAD = /^(mutation|per-test): module '([^']*)' - (.*)$/;
const START = /^(\d+) target class\(es\)(?:, budget (\d+)s)?$/;
const HEARTBEAT_WITH_COUNT = /^(\d+)\/(\d+) class\(es\), (.+) elapsed$/;
const HEARTBEAT_PLAIN = /^collecting coverage, (.+) elapsed$/;

export function parseProgressLine(line: string): ProgressEvent | undefined {
	const trimmed = line.startsWith(PREFIX) ? line.slice(PREFIX.length) : line;
	const head = HEAD.exec(trimmed.trim());
	if (!head) {
		return undefined;
	}
	const kind: ProgressEventKind = head[1] === 'mutation' ? 'mutation' : 'perTest';
	const moduleId = head[2];
	const rest = head[3];

	const start = START.exec(rest);
	if (start) {
		return { kind, phase: 'start', moduleId, total: Number(start[1]), budgetSeconds: start[2] ? Number(start[2]) : undefined };
	}

	const counted = HEARTBEAT_WITH_COUNT.exec(rest);
	if (counted) {
		return { kind, phase: 'heartbeat', moduleId, done: Number(counted[1]), total: Number(counted[2]), elapsed: counted[3] };
	}

	const plain = HEARTBEAT_PLAIN.exec(rest);
	if (plain) {
		return { kind, phase: 'heartbeat', moduleId, elapsed: plain[1] };
	}

	if (rest.startsWith('done,') || rest === 'done') {
		return { kind, phase: 'done', moduleId, message: rest };
	}
	// "FAILED, ..." ve "no mutable target found by the engine" gibi bitiş
	// halleri: ikisi de koşunun bittiğini söyler ama başarı değildir.
	if (rest.startsWith('FAILED') || rest.startsWith('no mutable target')) {
		return { kind, phase: 'failed', moduleId, message: rest };
	}
	return undefined;
}

/**
 * Bir ilerleme olayının kullanıcıya gösterilecek tek satırı. Yüzde 30
 * saniyede bir ilerlediği için geçen süre **her zaman** yazılır - yoksa
 * arayüz donmuş görünür (mutasyon koşusu bir modülde 70-90 dakika
 * sürebiliyor). `showModule` (çok-modüllü bir koşuda `true`) modül id'sini
 * öne ekler - tek modüllü koşularda gürültü olurdu, o yüzden isteğe bağlı.
 */
export function progressMessage(event: ProgressEvent, showModule = false): string {
	const prefix = showModule ? `${event.moduleId} · ` : '';
	switch (event.phase) {
		case 'start':
			return prefix + (event.budgetSeconds === undefined
				? `${event.total} sınıf taranacak`
				: `${event.total} sınıf taranacak · bütçe ${event.budgetSeconds}s`);
		case 'heartbeat':
			return prefix + (event.done !== undefined && event.total !== undefined
				? `${event.done}/${event.total} sınıf · ${event.elapsed}`
				: `kanıt toplanıyor · ${event.elapsed}`);
		case 'done':
			return `${prefix}bitti`;
		case 'failed':
			return prefix + event.message;
	}
}

/**
 * `withProgress`'in `increment`'i **fark** ister, mutlak yüzde değil.
 * Toplam bilinmiyorsa (L2'nin sayaçsız heartbeat'i) artış yayınlanmaz:
 * uydurma bir ilerleme çubuğu, ilerleme çubuğu olmamasından kötüdür.
 *
 * `previousDone` çağıran tarafından **modül başına** tutulmalı - CLI
 * modülleri sırayla tarar, bir modül `3/3`'e ulaştıktan sonra bir sonraki
 * modül kendi `1/5`'i ile başlar; tek bir paylaşılan sayaç bunu negatif bir
 * fark olarak görüp düşürür ve bar donmuş görünür (gerçek bir regresyondu,
 * bu fonksiyon çağıranın `moduleId`'ye göre ayrı sayaç tutmasını zorunlu
 * kılacak şekilde tasarlanmıştır). `moduleCount` bilinen modül sayısına göre
 * bu modülün payını ölçekler, böylece N modüllü bir koşuda toplam yüzde
 * 100'ü aşmaz.
 */
export function incrementFor(event: ProgressEvent, previousDone: number, moduleCount = 1): { increment: number; done: number } | undefined {
	if (event.phase !== 'heartbeat' || event.done === undefined || event.total === undefined || event.total === 0) {
		return undefined;
	}
	const increment = ((event.done - previousDone) / event.total) * (100 / moduleCount);
	return increment > 0 ? { increment, done: event.done } : undefined;
}

const DOCTOR_FIX_LINE = /^proof-java: doctor: fixing classpath for '([^']*)'\.\.\.$/;

/**
 * `doctor --fix`'in kendi ilerleme satırı (`DoctorCommand.applyFixes`,
 * doğrulandı): CLI toplam modül sayısını basmaz (sadece zaten kullanılabilir
 * olmayan her modül için bir satır), o yüzden "kaçıncı modül" burada değil,
 * çağıranın zaten bildiği `modules.length`'e göre hesaplanır - CLI'ın
 * vermediği bir sayıyı burada uydurmamak için.
 */
export function parseDoctorProgressLine(line: string): { moduleId: string } | undefined {
	const trimmed = line.trim();
	const match = DOCTOR_FIX_LINE.exec(trimmed);
	return match ? { moduleId: match[1] } : undefined;
}
