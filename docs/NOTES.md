# Faz 12 (mutasyon) öncesi çözülmesi gereken sorunlar

Kullanıcı testinde (2026-08-27, Faz 11 sonrası) çıkan gerçek kullanım
sorunları. Mutasyon görünümüne (Faz 12) geçmeden önce bunlar kapatılmalı —
kullanıcının kendi önceliği bu.

**Faz 13 (2026-08-28) durumu:** 1-5, 9, 10 kodlandı. Madde 8 araştırıldı ve
**kod hatası değil** olduğu doğrulandı (aşağıdaki madde 8'in sonuna bakın).
Kalan: madde 6/7 (kullanıcının playground'da kendi yapacağı adım).

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
