import type { RuleId } from '../verdict/types';

/**
 * Faz 18: the six rule codes, in plain Turkish. Until now every surface
 * showed the raw enum (`CATCH_ORACLE_WITHOUT_FAIL`) with no explanation
 * anywhere - the user's own words: "CATCH_ORACLE bık bık bana ne".
 *
 * Every `title`/`summary` here is a condensed translation of that rule's
 * own doc in the coverdict repo (`docs/rules/<RULE>.md`) - nothing is
 * invented. `code` stays visible next to the title everywhere, so the
 * enum remains greppable/searchable and the docs link still matches.
 * Pure - no `vscode` (Plan.md Bölüm 2's first invariant).
 */
export interface RuleInfo {
	/** The raw enum - kept visible so the user can still search/grep for it and match the docs URL. */
	code: RuleId;
	/** Short human-readable name, shown as the primary label. */
	title: string;
	/** One or two sentences: what fired and why it matters. Shown on hover. */
	summary: string;
	/** What the developer should actually do about it. */
	action: string;
}

const CATALOG: Record<RuleId, Omit<RuleInfo, 'code'>> = {
	NO_RECOGNIZED_ORACLE: {
		title: 'Doğrulama yok',
		summary: 'Test metodunda tanınan hiçbir doğrulama yok: ne bir assertion/verification çağrısı, ne de beklenen bir istisna. Kod çalışıyor ama sonucuna kimse bakmıyor - bu satırlar kapsanmış görünür, gerçekte test edilmez.',
		action: 'Testin gerçekten ne beklediğini söyleyen en az bir assertion ekleyin.',
	},
	TAUTOLOGICAL_ORACLE: {
		title: 'Her zaman doğru olan doğrulama',
		summary: 'Doğrulamanın sonucu test edilen koda hiç bağlı değil - hangi implementasyon olursa olsun aynı sonucu verir (örn. iki sabitin karşılaştırılması, literal bir boolean).',
		action: 'Doğrulamayı test edilen kodun gerçek çıktısı üzerine kurun.',
	},
	CATCH_ORACLE_WITHOUT_FAIL: {
		title: 'Yutulan istisna',
		summary: 'try/catch içinde, kod istisna fırlatırsa bütün doğrulamalar atlanıyor ve test yine de geçiyor. Yani test, hata durumunu sessizce başarılı sayıyor.',
		action: 'catch bloğuna bir fail() ekleyin, ya da beklenen istisnayı assertThrows ile doğrulayın.',
	},
	NULL_CHECK_ONLY: {
		title: 'Sadece null kontrolü',
		summary: 'Testteki bütün doğrulamalar yalnızca "null değil" diyor; değerin içeriğine hiç bakılmıyor. Zayıf bir test - bozuk değil, ama yanlış bir sonucu yakalayamaz.',
		action: 'Değerin ne olması gerektiğini de doğrulayın, sadece var olduğunu değil.',
	},
	PSEUDO_TESTED_METHOD: {
		title: 'Sözde test edilen metot',
		summary: 'Production metodu bir test tarafından çalıştırılıyor ama üretilen bütün mutantlar hayatta kaldı - yani metodun ne yaptığını hiçbir test gözlemlemiyor. Mutasyon (L3) kanıtından gelir.',
		action: 'Metodun dönüş değerini veya yan etkisini gerçekten doğrulayan bir test ekleyin.',
	},
	SUBSUMED_TEST: {
		title: 'Gereksiz (kapsanan) test',
		summary: 'Bu testin öldürdüğü mutant kümesi, başka bir testin öldürdüklerinin tam alt kümesi - bu koşuda çalıştırılan mutatörlere göre kendi başına yeni hiçbir şey yakalamıyor. Mutasyon (L3) kanıtından gelir.',
		action: 'Bilgilendirme amaçlı: silmeden önce daha geniş testin gerçekten bu senaryoyu kapsadığını doğrulayın.',
	},
};

export function ruleInfo(rule: RuleId): RuleInfo {
	return { code: rule, ...CATALOG[rule] };
}

/** `Problems` panelindeki `diagnostic.code.target` ile aynı adres - tek kaynak, ayrışamazlar. */
export function ruleDocsUrl(rule: RuleId): string {
	return `https://github.com/Metonya/coverdict/blob/main/docs/rules/${rule}.md`;
}
