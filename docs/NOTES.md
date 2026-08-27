# Faz 12 (mutasyon) öncesi çözülmesi gereken sorunlar

Kullanıcı testinde (2026-08-27, Faz 11 sonrası) çıkan gerçek kullanım
sorunları. Mutasyon görünümüne (Faz 12) geçmeden önce bunlar kapatılmalı —
kullanıcının kendi önceliği bu.

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

---

**Sıra:** yukarıdaki 5 madde (1-5) kodda çözülecek, sonra madde 7'deki
branch senaryosuyla gerçek "yeni kod" akışı doğrulanacak, ondan sonra
Faz 12'ye (mutasyon) geçilecek.
