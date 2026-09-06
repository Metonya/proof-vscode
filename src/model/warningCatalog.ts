import type { Reason } from '../verdict/types';

/**
 * Faz 18: `warnings[]` Faz 14d'de görünür oldu ama ham CLI mesajıyla -
 * kullanıcının kendi sözleri: "uyarılar neler anlamadım". Kodlar
 * İngilizce ve teknik ("CHANGED_LINES_ABSENT_FROM_REPORT: 3 changed
 * line(s) ... are absent from the bound report(s)"), ne anlama geldiği ve
 * ne yapılacağı hiçbir yerde yazmıyor.
 *
 * Burada her kod için düz Türkçe bir başlık + "ne demek" + "ne yapmalı"
 * var. Ham mesaj **atılmıyor** - tooltip'te aynen duruyor, çünkü içinde
 * CLI'ın kendi saydığı gerçek sayılar var (kaç satır, kaç dosya) ve
 * uydurulamaz. Bilinmeyen bir kod gelirse ham hali gösterilir (hard rule
 * 3a: tanımadığımız bir şeyi tanıyormuş gibi yapmayız).
 * Pure - no `vscode`.
 */
export interface WarningInfo {
	code: string;
	title: string;
	/** `undefined` when the code is not in the catalogue - the caller falls back to the raw CLI message. */
	explanation: string | undefined;
	action: string | undefined;
}

const CATALOG: Record<string, { title: string; explanation: string; action: string }> = {
	CHANGED_LINES_ABSENT_FROM_REPORT: {
		title: 'Değişen bazı satırlar coverage raporunda yok',
		explanation: 'Değiştirdiğiniz satırların bir kısmı JaCoCo raporunda hiç geçmiyor, bu yüzden "yeni kod" yüzdesinin ne payına ne paydasına katıldılar. '
			+ 'İki sebebi olabilir ve proof-java bunları birbirinden ayıramaz: (1) o satırlar zaten çalıştırılabilir kod değil - süslü parantez, metot imzası, boş satır; JaCoCo bunları hiç listelemez, bu tamamen normaldir. '
			+ '(2) Rapor bu değişiklikten eski - yani testleri son düzenlemenizden sonra çalıştırmadınız.',
		action: 'Sayı beklediğinizden düşükse önce testleri yeniden çalıştırıp raporu tazeleyin (mvn test). Sonra hâlâ görünüyorsa, geri kalan satırlar muhtemelen sadece parantez/imza satırlarıdır.',
	},
	CHANGED_FILES_EXCLUDED: {
		title: 'Bazı değişen dosyalar coverage dışı bırakıldı',
		explanation: 'Değiştirdiğiniz dosyalardan bazıları proof.coverageExclusions desenlerine (ya da bir test klasörüne) uyduğu için yeni kod hesabına hiç girmedi.',
		action: 'Bu kasıtlıysa yapacak bir şey yok. Değilse proof.coverageExclusions ayarınızı gözden geçirin.',
	},
	MODULE_WITHOUT_REPORT: {
		title: 'Bir modülün coverage raporu yok',
		explanation: 'Tanımlanmış bir modüle hiçbir JaCoCo raporu bağlanmamış, bu yüzden o modül analiz edilen kümeden tamamen çıkarıldı - coverage\'ı %0 değil, hiç bilinmiyor.',
		action: 'O modül için testleri JaCoCo ile çalıştırın ve proof.reportPath ayarının doğru dosyayı gösterdiğinden emin olun.',
	},
	PER_TEST_NO_CHANGED_TARGETS: {
		title: 'Test bazlı kanıt için hedef sınıf yok',
		explanation: 'Derin tarama yalnızca diff\'te değişen production sınıflarını hedefleyebilir; bu koşuda değişen sınıf olmadığı için hiçbir şey toplanmadı. Bu bir hata değil.',
		action: 'Bir dosyada gerçek bir değişiklik yapıp tekrar tarayın, ya da tek bir sınıf için: o dosyada sağ tık → "Bu Sınıf İçin Hangi Test Hangi Satırı Kapsıyor".',
	},
	PER_TEST_CLASSPATH_MISSING: {
		title: 'Test bazlı kanıt için classpath dosyası bağlı değil',
		explanation: 'Derin tarama testleri PIT altında yeniden çalıştırır ve bunun için tam test classpath\'ini satır satır listeleyen bir dosyaya ihtiyaç duyar; bu modüle böyle bir dosya bağlanmamış.',
		action: 'Classpath listesini üretin (mvn dependency:build-classpath) ve proof.perTestClasspathPath ayarının o dosyayı gösterdiğinden emin olun.',
	},
	PER_TEST_TRUNCATED: {
		title: 'Test bazlı kanıt kırpıldı',
		explanation: 'Toplanan kanıtın bir kısmı düşürüldü. Gösterilenler eksik olabilir - bir satırın burada görünmemesi "onu hiçbir test kapsamıyor" anlamına GELMEZ.',
		action: 'Eksiksiz kanıt gerekiyorsa taramayı daha dar bir kapsamla (tek sınıf) tekrarlayın.',
	},
	PER_TEST_EMPTY_EVIDENCE: {
		title: 'Test bazlı kanıt çalıştı ama boş döndü',
		explanation: 'Motor çalıştı fakat hiçbir test-satır kaydı çözemedi. İstenmesine rağmen kanıt yok - yani "bu satırları hiçbir test kapsamıyor" değil, "bilemedik".',
		action: 'Testlerin gerçekten çalıştığını ve classpath listesinin derlenmiş sınıfları (target/classes, target/test-classes) içerdiğini doğrulayın.',
	},
	PER_TEST_TARGET_UNRESOLVED: {
		title: 'Hedeflenen sınıf bulunamadı',
		explanation: 'Test bazlı kanıt için verilen sınıf adı, tanımlı kaynak klasörlerinin altında bir .java dosyasına çözülemedi, bu yüzden atlandı.',
		action: 'Sınıf adının tam nitelikli (paket dahil) olduğundan ve dosyanın src/main/java altında bulunduğundan emin olun.',
	},
	PER_TEST_TARGET_NOT_BOUND: {
		title: 'Bir modüle hedef sınıf verilmedi',
		explanation: 'Tanımlı bir modüle bu koşuda hiçbir hedef sınıf bağlanmadı, bu yüzden test bazlı kanıttan tamamen çıkarıldı. Çok modüllü bir projede tek modülü hedeflerken normaldir.',
		action: 'Kasıtlıysa yapacak bir şey yok.',
	},
	PER_TEST_COLLECTION_FAILED: {
		title: 'Test bazlı kanıt toplanamadı',
		explanation: 'Motor bu modül için hata verdi; o modülün test bazlı kanıtı atlandı. Coverage sayıları etkilenmedi, yalnızca "hangi test hangi satırı kapsıyor" bilgisi eksik.',
		action: 'Ayrıntı için proof-java çıktı kanalına bakın (Output → proof-java).',
	},
};

export function warningInfo(reason: Reason): WarningInfo {
	const known = CATALOG[reason.code];
	return {
		code: reason.code,
		title: known?.title ?? reason.code,
		explanation: known?.explanation,
		action: known?.action,
	};
}
