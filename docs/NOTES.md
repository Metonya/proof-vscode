# Faz 12 (mutasyon) öncesi çözülmesi gereken sorunlar

Kullanıcı testinde (2026-08-27, Faz 11 sonrası) çıkan gerçek kullanım
sorunları. Mutasyon görünümüne (Faz 12) geçmeden önce bunlar kapatılmalı —
kullanıcının kendi önceliği bu.

**Faz 13 (2026-08-28) durumu:** 1-5, 9, 10 kodlandı. Madde 8 araştırıldı ve
**kod hatası değil** olduğu doğrulandı (aşağıdaki madde 8'in sonuna bakın).

**Faz 14 (2026-08-28) - elle test sonrası ek geri bildirim:** kullanıcı
Faz 13'ü playground'da test ederken üç yeni sorun bildirdi ve bunlar da
çözüldü:
- Satır → Testler paneli okunmuyordu (`@ParameterizedTest` id'leri ham
  basılıyordu) - `verdict/testIdentity.ts` test-template desteği,
  `ui/panelView.ts` gruplu/katlanır görünüm.
- `coverdict-cli`'a yeni `--per-test-target` (Faz 14a, `--mutation-target`
  ile aynı desen) + eklentide yeni "Bu Sınıf İçin Hangi Test Hangi Satırı
  Kapsıyor" komutu (Faz 14b) - artık kod değiştirmeden/diff yaratmadan
  L2 kanıtı toplanabiliyor.
- "Yeni Kod: yok" artık nedenini yazıyor, `warnings[]` artık Kapsama
  ağacında "Uyarılar" bölümünde görünüyor (Faz 14d).
- `lineIndex.ts`'in ambient/entries karışması ayrıştırıldı (hata D-6,
  Faz 14c).
- Bayatlık tespiti eklendi (eski planın hiç yazılmamış "Açık risk 5"i,
  Faz 14e): tarama sonrası dosya düzenlenince gutter/rozet artık "bayat"
  diyor, eski veriyi göstermeye devam etmiyor.

**Faz 15 (2026-08-28) - panel bug + coverdict'in asıl kayıp değeri:**
kullanıcı Faz 14b'nin yeni "Satır → Testler" panelini test ederken iki şey
bildirdi: (1) panele tıklar tıklamaz kendini siliyor ("kendine tıklayınca
`activeTextEditor` değişip `noActiveEditor`'a düşüyor" - gerçek bug), (2)
bu gösterimin daha iyisi olmalı. İkinci soruyu araştırırken çok daha büyük
bir şey bulundu: `findings[].testMethod` ile `perTest`'in test id'leri
**birebir eşleşiyor** (17 tam eşleşme, gerçek veriyle doğrulandı) ama
eklenti bu bağı hiç kurmuyordu - `Calculator.java:37` gutter'da yeşildi
ama onu kapsayan tek test (`squareHasNoAssertion`) hiçbir şey doğrulamıyor.
- Webview panel (`ui/panelView.ts`) tamamen silindi - kendini silme hatası
  o mimarinin doğasındaydı. Yerine: `ui/hoverProvider.ts` (satıra/test
  metoduna hover, iki yönlü) + `ui/treeViews/lineTestsView.ts`
  (`window.createTreeView`, imleç takibi, kendini asla boşaltmaz).
- `model/testQuality.ts`: `findings[]` ↔ `perTest` birleştirme katmanı -
  her testi ok/noOracle/weak/redundant/inconclusive'a sınıflandırır, bir
  satırın "yalancı yeşil" olup olmadığını (kapsayan HİÇBİR testin oracle'ı
  yok) hesaplar.
- Gutter'a 5. durum: "oracleless" (turuncu) - `coverdict.show.oraclelessLines`
  ile kapatılabilir.
- Ters yön eklendi: bir test metoduna hover → hangi production satırlarını
  çalıştırdığı.

Kalan: madde 6/7 (kullanıcının playground'da kendi yapacağı adım).

---

# Faz 16 — Faz 15 sonrası elle test bulguları (2026-08-28, ekran görüntüleriyle)

Kullanıcı Faz 15'i (hover + "Satır → Testler" ağacı + oracleless gutter)
playground'da elle test etti, beş ekran görüntüsü + yazılı not bıraktı.
Hiçbiri implement edilmedi - sadece bulgu. Aşağıdaki sıraya göre ele
alınmalı (1 ve 2 gerçek hata, geri kalanı iyileştirme isteği).

## 1. GERÇEK HATA: bir test dosyası açılınca ters yön yerine "kendi kendini kapsıyor" görünümü çıkıyor

**Gözlem** (CalculatorNullCheckOnlyTest.java açıkken "Satır → Testler"
ağacı): kök düğümler `Satır 15`, `Satır 17`, `Satır 21`, `Satır 22`,
`Satır 23` - her biri `1 test (1 oracle'sız/zayıf)` açıklaması ve turuncu
uyarı ikonuyla, altında tek çocuk
`CalculatorNullCheckOnlyTest#describeOnlyChecksNonNull() NULL_CHECK_ONLY`.
Bu **`prodLineItem`/`prodTestItem`'in tam formatı** (`ui/treeViews/
lineTestsView.ts:70-73`, `Satır ${node.line}` + `${n} test
(${weak} oracle'sız/zayıf)`) - yani test dosyası **production yönünde**
render ediliyor. Doğru davranış: `Satır → Testler` bir test dosyasında
**ters yönü** göstermeli - tek bir `testMethod` düğümü
(`describeOnlyChecksNonNull()`) + altında çalıştırdığı production
satırları (`testLine` düğümleri, `Calculator.java : N` biçiminde).

**Kök neden hipotezi (doğrulanmadı, ilk adım bu olmalı):**
`computeView()` (`lineTestsView.ts` içinde, `private computeView()`)
önce `testsForClass(perTestState.perTest, moduleId, className)`'ı dener;
`'found'` dönerse **production** kabul edip orada durur, `testsToLines`
ters indeksine hiç bakmaz (`rootChildren`/`nodeForLine`/`getParent`'ın
hepsi aynı sırayı izliyor). `testsForClass` yalnızca `perTest.modules[].
entries[].className` içinde eşleşme arıyor
(`model/lineIndex.ts:23-37`). Ekran görüntüsündeki satır numaraları
(15, 17, 21, 22, 23) **production `Calculator.java`'nın değil, test
dosyasının kendi satırları** (dosyanın kendi editöründe aynı satırlarda
metot gövdesi/assertion var). Bu, coverdict-cli'ın L2 (PIT tabanlı)
toplayıcısının **test sınıfının kendi satırlarını da** `entries`'e
kendi kendine kapsayan bir "test" olarak yazdığını düşündürüyor (test
metodu kendi gövdesini "çalıştırıyor" sayılmış olabilir).

**Doğrulama adımı:** gerçek bir `--per-test-target` koşusunun çıktısında
(`perTest.modules[0].entries`) `className` alanı
`dev.coverdict.playground.CalculatorNullCheckOnlyTest` gibi bir **test**
sınıfı adı taşıyan bir girdi var mı, bak. Varsa hipotez doğrulanır.

**Olası düzeltme yönleri (karar verilmedi, sonraki oturum seçsin):**
- `computeView()` önce dosyanın bir test dosyası olup olmadığını
  (`inputs.modules[].testRoots` altında mı, ya da `changedFiles[]`'ta
  `test` sınıflandırması var mı) kontrol etsin, öyleyse doğrudan
  `testsToLines` ters indeksini kullansın - `testsForClass`'a hiç
  bakmasın.
- Ya da `testsForClass`/`collectLines` (`model/lineIndex.ts`) zaten
  kendi kendini kapsayan (`entry.className === kapsayan tek test'in
  sınıfı`) girdileri filtrelesin - ama bu, üretim kodunda meşru
  "kendi kendine referans" bir durum varsa yanlış olabilir, temkinli
  olunmalı.
- En temiz çözüm muhtemelen ilki: dosyanın test mi production mu
  olduğuna **önce, bağımsız olarak** karar vermek (yol tabanlı), sonra
  o yöne göre tek bir sorgu yapmak - şu anki "önce production'ı dene,
  bulamazsan test'e düş" sırası yanlış varsayım üretiyor.

**Kullanıcının kendi sorusu, aynen not edildi (tasarım netleşsin):**
"unit teste girince Satır->test ekranında ne görmem lazım: koda gidince
ne görmem lazımdı?" - yani üstteki "doğru davranış" bölümü net şekilde
yazılıp bir sonraki oturumda onaylanmalı: **test dosyasında ters yön
(hangi production satırlarını çalıştırıyorum), production dosyasında
düz yön (bu satırı kim kapsıyor, oracle'ı var mı)** - Faz 15c'nin
tasarım niyeti buydu, kod bunu tutmuyor.

## 2. GERÇEK HATA (OLASI): NotifyingCalculator.java'da gutter yeşil ama Explorer'da rozet yok

**Gözlem:** `NotifyingCalculator.java` açıkken editör gutter'ında gerçek
yeşil kapsama çizgileri var (satır 9-11, 14-16 gibi) - yani bu dosya için
`fileCoverage.files[]`'ta gerçek, sıfır olmayan veri var. Ama Dosya
Gezgini'nde bu dosyanın (ve o anki ekran görüntüsünde görünen diğer
dosyaların da) yanında **hiçbir yüzde rozeti yok**.

**Not:** Bu, Faz 13 madde 8'de kapatılan `Notifier.java` sorunundan
**farklı** - o zaman `Notifier.java`'nın gerçekten 0 çalıştırılabilir
satırı olduğu (saf arayüz) kanıtlanmış ve rozetsiz kalması doğru
bulunmuştu. Burada `NotifyingCalculator.java`'nın **gerçek, gutter'da
görünen kapsaması var**, dolayısıyla o kapanışın gerekçesi burada
geçerli değil - bu ayrı, hâlâ açık bir olası regresyon.

**Doğrulama adımı (Faz 13 madde 8'in aynısı, o oturumda izlenen yöntem):**
playground'a karşı gerçek bir `--file-coverage` koşusu çalıştır,
`fileCoverage.files[]`'ta `NotifyingCalculator.java`'nın gerçekten olup
olmadığını, `path` alanının `ExplorerBadgeProvider`'ın beklediği
biçimde olup olmadığını kontrol et (`ui/explorerBadges.ts`). Ekran
görüntüsü alındığı an hangi komut en son çalıştırılmıştı bilinmiyor -
`coverdict.perTestForFile` (Faz 14b/15b, tek sınıf hedefli) son koşu
olduysa `fileCoverage` yine de **tüm** filtrelenmiş dosyaları içermeli
(`buildAnalyzeArgs`'da `fileCoverage: true` her koşuda sabit) - yani
tek-hedefli bir koşunun bu rozeti bir şekilde bastırıp bastırmadığı da
ayrıca kontrol edilmeli.

## 3. İyileştirme: Test Kalitesi görünümü zayıf

Kullanıcının kendi cümleleri (aynen): "Test kalitesi filterelenebilir
search edilebilir dosya bazlı gösterilebilir. kural bazlı gösterilebilir
kurallara daha doğru display ismi verilmeli. üstüne gidildiğinde
açıklaması olmalı."

Madde madde:
- **Filtrelenebilir/aranabilir** - şu an `ui/treeViews/qualityView.ts`
  sadece kural bazlı statik gruplama yapıyor, VS Code'un TreeView arama
  desteği (`view/title`'da bir arama widget'ı yok bugün) eklenmeli.
- **Dosya bazlı gösterim seçeneği** - şu an tek gruplama modu (kurala
  göre); kullanıcı dosyaya göre gruplamayı da istiyor. Muhtemelen
  `view/title` menüsünde bir "gruplama: kural/dosya" toggle'ı.
- **Kural adları için daha iyi display ismi** - şu an ham
  `RuleId` enum değeri gösteriliyor (örn. `CATCH_ORACLE_WITHOUT_FAIL`).
  İnsan okunur bir eşleme lazım (örn. "Yakalanıp Yutulan İstisna" gibi -
  gerçek metin coverdict-cli'ın `docs/rules/<RULE>.md` dosyalarından
  alınabilir, uydurulmamalı).
- **Üstüne gelince açıklama (hover/tooltip)** - kural grubu düğümünün
  kendisinde bugün tooltip yok (yalnızca tek tek bulgu yapraklarında var,
  `qualityView.ts`'in `finding` node'u). Grup düğümüne de "bu kural ne
  demek" tooltip'i eklenmeli - `docs/rules/<RULE>.md`'nin bir özeti,
  Problems panelindeki `diagnostic.code.target` linkiyle tutarlı kalmalı.

## Genel not

Yukarıdaki 1 ve 2 numaralı maddeler **gerçek hata şüphesi** taşıyor ve
Faz 15'in "artık coverdict'in asıl değeri görünüyor" iddiasını
zedeliyor - production/test yön karışıklığı özellikle ciddi, çünkü
kullanıcının en son "bu daha iyi" dediği tam olarak bu ekran. Bir
sonraki oturum önce 1'i (gerçek veriyle doğrulayıp) düzeltmeli, sonra 2'yi
araştırmalı, 3 en sona kalabilir.

## 1. Toggle'ın geri bildirimi yok

"Kapsama Görünümünü Aç/Kapat" tıklanınca (durum çubuğundan ya da "Çalıştır"
ağacındaki öğeden) hiçbir görsel geri bildirim gelmiyor — kullanıcı tıkladı
mı tıklamadı mı emin olamıyor. Durum çubuğu metni değişiyor olabilir ama bu
yeterince fark edilir değil. "Çalıştır" ağacındaki öğenin kendisi de
(ikon/description) o an açık mı kapalı mı göstermeli, ya da tıklandığında
kısa bir bildirim (`showInformationMessage` gibi, ama rahatsız etmeyen)
çıkmalı.

## 2. Durum çubuğundaki yüzde, seçili `badgeMetric`'i yansıtmıyor

Kullanıcı `coverdict.badgeMetric`'i `sonar-compatible` yaptı, ama durum
çubuğundaki `$(eye) coverdict NN%` hâlâ `jacoco-line`'ı gösteriyor
(`ui/statusBar.ts`'in `showCoverageSummary` fonksiyonu sabit `overall['jacoco-line']`
okuyor). Explorer rozetleri ve gutter zaten `badgeMetric`'e göre boyanıyor
(Faz 9) — durum çubuğunun *başlık* sayısı da aynı ayarı kullanmalı, tooltip
zaten üç modu birden gösteriyor, o kalabilir.

## 3. "Analiz Et" ile "Analiz Et (test bazlı)" arasındaki fark anlaşılır değil

İki ayrı komut var ama aralarındaki fark (biri sadece kapsama, diğeri
ayrıca L2 - hangi testin hangi satırı kapsadığı kanıtını da topluyor,
"Satır → Testler" panelini besliyor) kullanıcıya açık değil. Şu an
"Çalıştır" ağacındaki description'da kısa bir ipucu var ama yetersiz.
Daha iyi bir çözüm bulunmalı — seçenekler:
- Tek bir "Analiz Et" komutu + bir ayar/checkbox ("test bazlı kanıtı da
  topla") — iki ayrı komut yerine tek akış.
- Ya da isimlendirme ve açıklamayı net biçimde "ne zaman hangisini
  seçmelisin" diye yeniden yazmak (örn. "Analiz Et" → "Kapsama Taraması",
  "Analiz Et (test bazlı)" → "Kapsama + Hangi Test Hangi Satırı Kapsıyor").

## 4. `--no-vcs` ile test bazlı analiz neden çalışmıyor, kullanıcı anlamıyor

CLI'ın kendi kısıtı: `--per-test-report` bir diff gerektirir (`AnalyzeCommand.java`),
çünkü L2 hedefleri sadece **diff'te değişen** production sınıflarından
geliyor — `--no-vcs`'te diff kavramı hiç yok, hedeflenecek hiçbir sınıf
olamaz. Bu CLI tarafında değişmeyecek bir tasarım kararı. Ama UI bunu daha
iyi anlatmalı:
- Şu anki hata mesajı teknik doğru ama "neden" kısmı eksik. "L2 kanıtı
  sadece değişen dosyaları hedefleyebilir; no-vcs'te 'değişen dosya' diye
  bir kavram yok" gibi bir cümle eklenebilir.
- Alternatif: `coverdict.diffMode` `no-vcs` iken "Analiz Et (test bazlı)"
  komutu/ağaç öğesi baştan devre dışı/gri gösterilebilir, kullanıcı
  tıklayıp hata almadan önce zaten neden yapamayacağını görür.

## 5. `base` modunda mevcut commit'i base verince yine sonuç boş çıktı

Kullanıcı `coverdict.diffMode`'u `base` yapıp `coverdict.baseRef`'e
**şu an üzerinde olduğu commit'i** girdi (yani HEAD'i baseRef yaptı) —
sonuç yine "değişen sınıf yok" oldu. Bu **beklenen davranış**: `base`
modu `merge-base(baseRef, HEAD)`'ten çalışma ağacına diff alıyor; baseRef
zaten HEAD'in kendisiyse (ya da HEAD'in atası değilse/aynıysa) diff boş
çıkar, çünkü karşılaştıracak gerçek bir fark yok. Sorun kodda değil,
kullanıcının "hangi commit'i baseRef'e yazmalıyım" konusunda net bir
yönü olmamasında. Bkz. madde 7 — gerçek bir branch/diff senaryosu
kurulunca bu netleşecek. UI tarafında yapılabilecek: `baseRef` ayarının
açıklamasına "HEAD'in kendisini veya HEAD'in atası olmayan bir ref'i
girerseniz diff boş çıkar" notu eklenebilir.

## 6. Playground'a test amaçlı kod yazıp commit'lemeyelim

`coverdict-playground`'da gerçek bir diff/yeni-kod senaryosunu denemek
için doğrudan mevcut dosyalarda değişiklik yapıp commit atmak istenmiyor
— playground'un mevcut senaryo haritası (README'deki tablo) bozulmasın
diye. Bunun yerine madde 7'deki branch yaklaşımı kullanılacak.

## 7. Denenecek gerçek "yeni kod" senaryosu: ayrı branch + push

Plan: `coverdict-playground`'da yeni bir **feature branch** açılacak, o
branch'e gerçek bir değişiklik/yeni dosya eklenip **push'lanacak**
(uzak repoya). Sonra `coverdict.diffMode` `base` yapılıp
`coverdict.baseRef`'e `main` (ya da `origin/main`) girilerek bu iki
branch arasındaki gerçek fark üzerinden "yeni kod" kapsaması denenecek.
Bu hem madde 5'in "boş diff" durumunu netleştirecek hem de Kapsama
ağacındaki "Yeni Kod" ve "Kapsanmayan Yeni Satırlar" bölümlerini gerçek
veriyle test edecek ilk senaryo olacak.

## 8. Explorer rozetleri artık sadece `Calculator.java`'da görünüyor - eskiden daha fazla dosyada vardı

Faz 9'dan önce (native Test Coverage API'yle) `Notifier.java` ve
`NotifyingCalculator.java` gibi dosyalarda da (örn. %100) rozet
görünüyordu; Faz 9'un kendi `ExplorerBadgeProvider`'ıyla artık sadece
`Calculator.java` üzerinde rozet var, klasör rozetleri (`src`,
`.../playground`) de görünüyor ama tek dosyadan geliyor. Kullanıcı eski
görünümü ("daha güzeldi") tercih ediyor. Olası neden: `ExplorerBadgeProvider`
sadece `fileCoverage.files[]`'ta **gerçekten olan** dosyaları
rozetliyor - `Notifier`/`NotifyingCalculator` JaCoCo raporunda hiç
görünmüyor olabilir (hiç test edilmemiş/instrumente edilmemiş dosyalar
JaCoCo'nun raporuna hiç girmeyebilir), native API'nin bunları nasıl
%100 gösterdiği (belki VS Code'un kendi "test edilmeyen dosya = kapsam
dışı, göstermeye gerek yok" farklı bir varsayılan davranışı vardı, ya da
eskiden farklı bir veri seti kullanılıyordu) araştırılmalı. Yapılacak:
gerçek `fileCoverage.files[]` içeriğini (playground'un son taramasından)
inceleyip hangi dosyaların hiç girmediğini doğrula, sonra native'in eski
davranışıyla kıyasla - kasıtlı bir fark mı (JaCoCo'da olmayan dosya
gerçekten "veri yok" demektir, hard rule 3a'ya göre boyanmaması doğru
olabilir) yoksa gerçek bir regresyon mu, karar ver.

**Sonuç (2026-08-28, Faz 13):** kod hatası değil. Playground'a karşı gerçek
bir `analyze --file-coverage` koşusu çalıştırıldı: `Notifier.java` saf bir
arayüz (`void notify(String)`, gövdesiz) - üç metrik modunda da
`denominator: 0` / `percent: null` veriyor, çünkü çalıştırılabilir hiç
satırı yok. `Calculator.java` (sonar-compatible %80) ve
`NotifyingCalculator.java` (sonar-compatible %100) ikisi de gerçek veriyle
geldi. `src/test/integration/explorerBadges.test.ts`'e bu tam üç dosyalık
gerçek veri fixture'ıyla bir regresyon testi eklendi: ikisi de doğru rozeti
alıyor, `Notifier.java` haklı olarak rozetsiz kalıyor (hard rule 3a - "veri
yok" ile "kapsanmadı" aynı görünmemeli). Eski native API'nin `Notifier.java`
için gösterdiği "%100" aslında **yanıltıcıydı** (çalıştırılabilir kod
olmadığı hâlde "tam kapsandı" diyordu) - Faz 9'da onu bırakmak bilinçli bir
karardı, bu bir regresyon değil. Kullanıcının elle testinde sadece
Calculator.java'yı görmesi muhtemelen daha eski bir build'e (Faz 9 öncesi
ya da ara bir commit) denk geldi.

## 9. Analiz sonrası sağ alttan çıkan bildirim mesajının formatı kötü

`runAnalyzeCore`'un sonunda `showInformationMessage` ile gösterilen
"coverdict: complete - jacoco-line 94.4% · strict-line 83.3% ·
sonar-compatible 84.6%" mesajı ekran görüntüsünde çirkin/okunaksız
duruyor. Format, satır sonu davranışı, hangi bilginin öne çıkarılacağı
(belki sadece seçili `badgeMetric` öne çıkıp diğer ikisi küçük harfle
yanında, ya da bildirim yerine sadece durum çubuğuna/ağaçlara
bırakılıp bu bildirim tamamen kaldırılıp yerine daha sade bir şey
konması) yeniden tasarlanmalı.

## 10. Üç metrik modunun (jacoco-line/strict-line/sonar-compatible) nasıl hesaplandığını anlatan bir yer yok

Kullanıcı üç sayının neden farklı çıktığını biliyor ama **nasıl**
hesaplandığını bilmiyor - şu an hiçbir yerde (tooltip, panel, ağaç) bu
üç modun formülü basitçe anlatılmıyor, sadece sayılar yan yana duruyor.
Eklenecek kısa, sade bir açıklama (CLI'ın kendi `MetricsEngine.java`'sından,
D-04/D-19 kararlarından - hesaplama mantığı zaten coverdict'in kendi
dokümantasyonunda var, sadece kullanıcıya görünür kılınmalı):

- **jacoco-line**: bir satırdaki **herhangi bir** komut çalıştıysa o
  satır kapsanmış sayılır. En "cömert" sayı, JaCoCo'nun ham satır
  kapsamasıyla birebir aynı.
- **strict-line**: bir satırın kapsanmış sayılması için o satırdaki
  **her** komutun çalışmış olması gerekir (kısmen çalışan satır
  kapsanmamış sayılır). En "katı" sayı, genelde en düşük çıkar.
- **sonar-compatible**: JaCoCo'nun satır kapsamasına **dal (branch)
  kapsamasını da** ekler - `if`/`else` gibi bir satırda birden fazla
  yol varsa, sadece satırın çalışması yetmez, o dalların da (mb/cb)
  kapsanmış olması gerekir. SonarQube'un kendi UI'ında gösterdiği
  yüzdeyle ±0.1 içinde eşleşen formül budur; jacoco-line'dan genelde
  daha düşük çıkmasının sebebi tam olarak bu (dal verisi olan satırlar
  jacoco-line'da tam kapsanmış görünse bile sonar-compatible'da
  kısmi/kapsanmamış sayılabilir).

Nereye eklenebilir: durum çubuğu tooltip'inin altına bir cümlelik özet,
ya da Kapsama ağacındaki her metrik satırının kendi tooltip'ine (hover
edince "bu nasıl hesaplanıyor" açıklaması), ya da ayarlardaki
`coverdict.badgeMetric`'in description'ına zaten kısmen var - ana metin
görünümüne (tooltip/panel) de taşınmalı.

---

**Sıra:** yukarıdaki maddeler (1-5, 8, 9, 10) kodda çözülecek, sonra
madde 7'deki branch senaryosuyla gerçek "yeni kod" akışı doğrulanacak,
ondan sonra Faz 12'ye (mutasyon) geçilecek.
