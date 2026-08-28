# coverdict-vscode — kullanılabilir bir arayüz (Faz 9-12)

## Context

`coverdict-vscode` (özel, yayınlanmamış, `C:\Users\Mert\Desktop\coverdict-vscode`)
`coverdict` CLI jar'ını çalıştırıp sonucu VS Code'da gösteriyor. Faz 0-8
bitti. Kullanıcı testinde (2026-08-27) üç şey birden çıktı:

1. **Kapsama aç/kapat ayarları çalışmıyor.** `showFileCoverage` kapatılınca
   Explorer rozetleri gitmiyor, `showLineGutter` hiçbir işe yaramıyor, toggle
   sadece satır renklerini etkiliyor, ayar açıklamaları anlaşılmıyor.
2. **Eklenti, CLI'ın ürettiği verinin çoğunu hiç göstermiyor.** Bulgular
   sadece Output kanalında düz metin; new-code kapsaması, kapsanmayan yeni
   satırlar, kötü test listesi hiçbir yerde yok. Sonar bunları gösteriyor.
3. **Her şey Ctrl+Shift+P'den ve her koşuda yol soruyor.** VS Code açılınca
   önceki tarama geri gelmiyor.

Hedef: CLI'ın zaten hesapladığı her şeyi görünür kılmak, ayarların gerçekten
çalışması, ve sol kenar çubuğundan komut paletine gerek kalmadan kullanım.

---

## Doğrulanmış kök nedenler

### A. Native Test Coverage API bu işi yapamaz (kesin)

`node_modules/@types/vscode@1.134.0/index.d.ts` ve `.vscode-test`'teki gerçek
VS Code 1.135.0 `vscode.d.ts` okundu (ikisi başlık yorumu dışında **bayt bayt
aynı**):

| Soru | Cevap | Kanıt |
|---|---|---|
| Yayınlanmış coverage silinebilir mi? | **Hayır.** `TestRun`'ın tek coverage üyesi `addCoverage`. `clearCoverage`/`removeCoverage`/`resetCoverage` grep = 0. `TestController.dispose()` dokümanı coverage'dan hiç söz etmiyor. | `index.d.ts:18727`, `:18650-18743`, `:18577-18581` |
| Explorer rozeti ↔ gutter ayrı kontrol edilebilir mi? | **Hayır.** `coverage` geçen 62 satırın hiçbirinde "explorer"/"gutter"/"badge"/"decoration" geçmiyor. | `index.d.ts:18292-19163` |
| `testing.closeCoverage` gibi bir komut? | `.d.ts`'te hiçbir `testing.*` komut id'si belgelenmemiş. | `index.d.ts:11027-11034` |

**Sonuç: mevcut `showFileCoverage`/`showLineGutter` tasarımı API'ye karşı
savaşıyor, native yolla düzeltilemez.**

Belgelenmiş alternatifler mevcut ve tam kontrol veriyor:
`FileDecorationProvider` (`index.d.ts:8286-8313`, kayıt `:11831`) ve
`DiagnosticCollection` — ikincisi coverage API'sinin aksine tam
`set`/`delete`/`clear` semantiğine sahip (`:7165-7248`).

### B. `paintCoverage`'ın mantığı, native'in gutter çizdiği varsayımına dayanıyor

`ui/commands.ts:319`'daki tek satır her şeyi belirliyor:
```ts
const gutterFromDecorations = showLineGutter && !(painted && nativeMode === 'detailed');
```
Varsayılan `true/true` ayarında `painted=true` ve `nativeMode='detailed'`
olduğu için bu **`false`** oluyor ve dekorasyonlar temizleniyor — yani gutter
tamamen native'e bırakılıyor. `showFileCoverage: false` ise dekorasyonları
devreye sokan **tek** yol oluyor. Kullanıcının "ayarı kapatınca satır renkleri
değişiyor, bir garip" gözlemi tam olarak bu ters mantık.

⚠ **Açık soru (çözülmedi, kararı değiştirmiyor):** `createCoverageController()`
(`ui/coverageProvider.ts:38`) `TestRunProfile.loadDetailedCoverage`'ı **hiç
atamıyor**. Dokümana göre editör satır detayını yalnızca o callback'ten alır
(`index.d.ts:18405-18414`), ki bu native'in hiç gutter çizmediği anlamına
gelirdi — ama kullanıcının ekran görüntüleri varsayılan ayarda gutter işareti
gösteriyor, yani VS Code `fromDetails`'in detaylarını kendi saklıyor olabilir.
**Bu belirsizlik planı etkilemiyor**: her iki durumda da native ne bölünebilir
ne temizlenebilir, dolayısıyla çıkarılıyor.

### C. Eklenti pencere açılışında hiç yüklenmiyor

`package.json:22` → `"activationEvents": []`. VS Code 1.74+ `contributes.commands`
için örtük `onCommand:` üretir, yani eklenti **yalnızca** dört komuttan biri
çalıştırılınca yükleniyor. `restoreLastCoverage()` kodu doğru ama
**hiç çalışmıyor**. Üstelik `extension.ts:89`'da `void` ile fire-and-forget
çağrıldığı için, eklentiyi uyandıran komut dosya okumasını beklemeden
çalışıyor: soğuk pencerede `toggleCoverageGutter` her seferinde "henüz kapsama
verisi yok" diyor, halbuki geçerli bir `verdict-current.json` diskte duruyor.

### D. Bu arada bulunan, bağımsız gerçek hatalar

| # | Hata | Yer |
|---|---|---|
| 1 | **İptal, hata olarak raporlanıyor.** `cancel()` → `child.kill()` → `exitCode: null` → `null !== 0 && null !== 3` → "analiz başarısız oldu (çıkış kodu null)" | `commands.ts:214`, `runner.ts:63` |
| 2 | **Controller sızıntısı.** `resetController` her çağrıda `context.subscriptions`'a yeni controller ekliyor, eskisini hiç çıkarmıyor; oturum boyunca sınırsız büyüyor | `commands.ts:330` |
| 3 | **`java` bulunamazsa unhandled rejection.** `await handle.result` try/catch'siz | `commands.ts:209` |
| 4 | **Ayarlar scope'suz okunuyor.** `getConfiguration('coverdict')` — klasör bazlı `.vscode/settings.json` override'ları sessizce yok sayılıyor | `commands.ts:297`, `coverageProvider.ts:118` |
| 5 | **Durum çubuğu yalan söylüyor.** `showCoverageSummary(..., true)` üç çağrı yerinde de sabit `true`; hiçbir şey boyanmamışken bile "kapsama görünümü açık" yazıyor | `commands.ts:81, 281, 96` |
| 6 | **`ambient` kanıtı `entries`'e karıştırılıyor**, D-50'nin ayrımı model katmanında yok ediliyor | `lineIndex.ts:21` |
| 7 | **`PER_TEST_TRUNCATED` dışındaki tüm uyarılar sessizce atılıyor** | `commands.ts:354` |
| 8 | **`coverage.newCode` parse edilmiyor bile** (`isVerdictDocument` onu hiç kontrol etmiyor) ve hiçbir yerde gösterilmiyor | `parse.ts:43-53` |
| 9 | **`base` diff modu `argsBuilder`'da var ve test edilmiş ama hiçbir UI'dan erişilemiyor** | `argsBuilder.ts:24` |
| 10 | **Entegrasyon testleri hiç workspace klasörü açmıyor** → hiçbir komut yolu test edilemiyor | `.vscode-test.mjs` |
| 11 | Ölü kod: `isPanelOpen()`, `onCoverageStateChanged()` — sıfır çağıran | `panelView.ts:28`, `store.ts:52` |
| 12 | `schemaVersion` okunuyor ama hiçbir şeyle karşılaştırılmıyor — uyumsuz bir CLI çıktısı sessizce güncelmiş gibi işlenir | `parse.ts:47` |

---

## Kullanıcının sorularına doğrudan cevaplar

CLI kaynağından doğrulandı, tahmin değil:

**"L2'de neyi alıyordum, coverage'ı mı?"** → Hayır. `perTest` bloğu **sadece**
"bu satırı hangi testler çalıştırıyor" haritası; içinde hiç yüzde, sayaç veya
metrik yok (`schema/coverdict-verdict.schema.json:573-646`). Ayrıca **diff'e
bağlı**: hedefler yalnızca değişmiş production sınıflarından geliyor
(`PerTestCollector.java:53` → `ChangedClassTargets.globsFor`).
`--mutation-target`'ın L2 karşılığı **yok** ve `--per-test-report` `--no-vcs`
altında reddediliyor. Değişiklik yoksa `PER_TEST_NO_CHANGED_TARGETS` uyarısı
çıkıyor — senin gördüğün tam da buydu.

**"New code'u neye göre belirliyoruz?"** → Değişen **satırlara** göre (dosyalara
değil), iki mod da mevcut:
- `--uncommitted` → `git diff --unified=0 HEAD`, commit bekleyen her şey
  (staged + unstaged). Verdict'te `diffMode: "working-tree"`.
- `--base <ref>` → `merge-base(ref, HEAD)`'ten çalışma ağacına — branch diff'i.
  Verdict'te `diffMode: "base-ref"`.
- `--no-vcs` → git hiç çalışmaz, `newCode: {"status":"unavailable_no_vcs"}`.

Yeni satırlar JaCoCo'nun çalıştırılabilir satırlarıyla kesiştiriliyor
(`ChangedFileClassifier.java:151-182`).

**"New code'lardan hangisi uncovered?"** → Veri zaten var:
`changedFiles[].uncoveredNewRanges`, `[[42,44],[51,51]]` biçiminde kapalı
aralıklar. ⚠ **Kapsanan** yeni satırların numaraları JSON'da yok (sadece
`coveredNewLines` sayısı) — "yeni ve kapsanmış" diye yeşil boyama yapılamaz,
uydurulmayacak.

**`mutation-classpath.txt` nereye?** → **`target/` altına.** `run.ps1`
tarafından `mvn dependency:build-classpath` çıktısından üretiliyor, içinde
makineye özel mutlak yollar var (`C:\Users\Mert\.m2\...`), zaten
`.gitignore`'da. Üretilmiş + makineye özel + sürüm kontrolü dışı bir dosyanın
yeri repo kökü değil `target/`. `run.ps1` `mvn clean`'den sonra zaten yeniden
üretiyor.

**`forceFallback` / `partialLineMode` neydi?** → İkisi de native API'nin
kısıtlarını telafi ediyordu. Native çıkınca gereksizler; **kaldırılıyorlar**
(kullanıcı kararı).

---

## Faz 9 — Çizimi biz üstleniyoruz + bekleyen gerçek hatalar

**Sil:** `src/ui/coverageProvider.ts` (tamamı), `CoverageSinks.controller`,
`extension.ts`'teki `createCoverageController()`,
`src/test/integration/coverageApi.test.ts`, `panelView.ts:28`'deki
`isPanelOpen`, `store.ts:52`'deki `onCoverageStateChanged`.

**Yeniden adlandır:** `src/ui/decorationFallback.ts` → `src/ui/gutterRenderer.ts`
(artık "yedek" değil, tek yol).
- `verdict/coverageMapping.ts`'ten `PartialLineMode` ve `branchesAreSynthetic`
  kaldırılır; kısmi satır artık doğrudan `ci>0 && (mi>0 || mb>0)`.
  `classifyLine()` üç durumu üretmeye devam eder.
- Sabit RGBA yerine `contributes.colors` ile katkı verilen `ThemeColor`
  kullanılır (`gutterRenderer.ts:24-26` bugün sabit renk; tema uyumlu değil).

**Yeni:** `src/ui/explorerBadges.ts` — bir `FileDecorationProvider`.
- Dosya rozeti: `fileCoverage.files[].metrics[<mode>].percent` — **CLI'ın
  kendi sayısı, asla yeniden hesaplanmaz** (D-70: `BigDecimal` HALF_UP
  TypeScript'te float-güvenli üretilemez).
- Klasör rozeti: alt dosyaların `numerator`/`denominator` toplamı, tek bölme.
  Bu, Plan.md Bölüm 2'nin açıkça izin verdiği tek aritmetik; yeni
  `src/model/metrics.ts`'e konur, `vscode` import etmez. `propagate: true`
  **kullanılmaz** (o çocuğun rozetini taşır, klasör yüzdesi üretmez).
- Renk: `ThemeColor`. Tooltip: üç metrik modunun üçü birden.
- ⚠ `FileDecoration.badge` karakter sınırı `.d.ts`'te **yazmıyor** (tip
  sınırsız `string`, doküman "çok kısa bir dize"/"bir harf" diyor). Gerçek
  Extension Host'ta `"85"` denenecek; kırpılırsa tek karakterlik duruma (`●`)
  düşülür, yüzde tooltip'te kalır.

**Ayarlar:** `coverdict.gutter.*` bloğu tamamen gider, yerine:
- `coverdict.show.explorerBadges` (bool, `true`)
- `coverdict.show.lineGutter` (bool, `true`)
- `coverdict.badgeMetric` (`jacoco-line|strict-line|sonar-compatible`,
  varsayılan `sonar-compatible` — kullanıcı Sonar farkını görmek istiyor;
  tooltip yine üçünü de gösterir)

**Toggle:** `coverdict.toggleCoverage` artık **ikisini birden** açıp kapatıyor.
Kapatma gerçekten çalışır çünkü `setDecorations(type, [])` ve
`onDidChangeFileDecorations` ikisi de belgelenmiş, garantili yollar.

**Aynı fazda düzeltilecek küçük hatalar** (yukarıdaki D tablosu 1-5):
iptalin `exitCode: null` ile hata sayılmaması · `resetController` sızıntısının
ortadan kalkması (controller zaten siliniyor) · `handle.result` etrafına
try/catch · `getConfiguration('coverdict', folder)` scope'lu okuma · durum
çubuğunun gerçek duruma göre yazması.

**Bitti sayılır:** her iki ayar tek tek kapatılıp açıldığında ilgili yüzey
gerçekten kayboluyor/geliyor; toggle ikisini birden etkiliyor; analizi iptal
etmek hata mesajı üretmiyor.

---

## Faz 10 — Aktivasyon ve promptsuz koşu

- **`"activationEvents": ["onStartupFinished"]`.** Ayrıca
  `restoreLastCoverage`'ın yarış durumu giderilir: `activate()` bir
  `Promise` döndürür ya da komutlar "restore tamamlandı" sinyalini bekler.
- **`restoreLastCoverage` doğru klasörü doğrular.** Bugün `storageUri`
  yoksa `globalStorageUri`'ye düşüyor — o **tüm workspace'ler arasında
  paylaşımlı**, yani bir projenin kapsaması başka bir projenin dosyalarına
  boyanabilir. Kaydedilen verdict'in hangi klasöre ait olduğu
  `workspaceState`'e yazılır ve geri yüklerken karşılaştırılır.
- **Prompt yerine ayarlar:**
  - `coverdict.reportPath` (varsayılan `target/site/jacoco/jacoco.xml`)
  - `coverdict.perTestClasspathPath` (varsayılan `target/coverdict-classpath.txt`)
  - `coverdict.mutationClasspathPath` (varsayılan `target/coverdict-classpath.txt`)
  - `coverdict.diffMode` (`no-vcs|uncommitted|base`, varsayılan `uncommitted`)
  - `coverdict.baseRef` (string, `diffMode: base` içindir)
  Prompt **yalnızca** ayarın gösterdiği dosya yoksa çıkar ve "ayarı düzelt"
  düğmesi sunar. Bu, `base` modunu ilk kez erişilebilir yapar (hata D-9).
- **`output.show(true)` kaldırılır** — her koşuda panel odağını çalıyor.
- **Tüm ayar açıklamaları yeniden yazılır:** her biri "ne işe yarar + somut
  örnek + kapatırsan ne olur" formatında, düz Türkçe.
- **`coverdict-playground` (ayrı repo, ayrı commit):** `run.ps1` çıktıyı
  `target/coverdict-classpath.txt`'e yazsın, `mutation-classpath.txt` satırı
  `.gitignore`'dan düşsün, README güncellensin.

**Bitti sayılır:** temiz bir pencere açılışında hiçbir komut çalıştırmadan son
taramanın rozetleri ve gutter'ı geliyor; `coverdict.analyze` hiç soru sormadan
koşuyor.

---

## Faz 11 — Kenar çubuğu paneli + Problems entegrasyonu

### 11a. Problems paneli — `src/ui/diagnostics.ts`
`languages.createDiagnosticCollection('coverdict')`. Her `findings[]` girdisi
bir `Diagnostic`:
- `range` ← `startLine`/`endLine`
- `severity` ← verdict'in `severity` alanı (`WARNING`→`Warning`,
  `INFO`→`Information`). **Not:** stdout'ta gördüğün `HIGH`/`INCONCLUSIVE`
  `severity` değil `confidence`; ikisi ayrı alan.
- `code` ← `{ value: rule, target: Uri }`, hedef coverdict reposundaki
  `docs/rules/<RULE>.md` → Problems panelinde kural adı tıklanabilir link olur
  (`index.d.ts:7127-7142`)
- `source` ← `'coverdict'`, `message` ← `message` + `suggestedAction`

Altı kuralın hepsi haritalanır: `NO_RECOGNIZED_ORACLE`, `TAUTOLOGICAL_ORACLE`,
`CATCH_ORACLE_WITHOUT_FAIL`, `NULL_CHECK_ONLY`, `PSEUDO_TESTED_METHOD`,
`SUBSUMED_TEST`. Her taramada `set(...)`, tarama yoksa `clear()`.

### 11b. Activity Bar konteyneri + üç TreeView
`contributes.viewsContainers.activitybar` + `contributes.views` (bugün
**hiçbiri yok** — `contributes` sadece `configuration` + `commands` içeriyor).

| View | İçerik | Tıklanınca |
|---|---|---|
| **Çalıştır** | Aktif diff modu · rapor yolu · classpath yolu · "Analiz Et" · "Analiz Et (test bazlı)" · "Mutasyon" · en altta **çalıştırılacak gerçek komut satırı** (Plan.md F8: "sihir olmaktan çıksın") | komutu çalıştırır / ayarı açar |
| **Kapsama** | `Genel` → 3 metrik · `Yeni kod` → 3 metrik veya `unavailable_no_vcs` açıklaması · `Kapsanmayan yeni satırlar` → dosya → aralık | dosyayı o satırda açar |
| **Test Kalitesi** | Kurala göre gruplanmış bulgular, her grupta sayı, her yaprakta `confidence` rozeti | test dosyasını o satırda açar |

- Yapraklarda `command: 'vscode.open'` + `TreeItem.resourceUri`
  (`index.d.ts:12344-12350`'nin kendi tavsiyesi). Renk yalnızca
  `ThemeIcon`+`ThemeColor` ile mümkün (`TreeItem.color` yok).
- `view/title` araç çubuğu: yeniden tara · aç/kapat · ayarlar.
- `contributes.viewsWelcome` ile boş durum: "Başlamak için Analiz Et".
- **Uyarılar artık görünür** (hata D-7): `warnings[]` içindeki
  `PER_TEST_NO_CHANGED_TARGETS`, `MODULE_WITHOUT_REPORT`,
  `CHANGED_LINES_ABSENT_FROM_REPORT` vb. ilgili view'da açık bir satır olur.
  Hard rule 3a: "veri yok" ile "sorun yok" asla aynı görünmez.

### 11c. "Satır → Testler" panelinin düzeltilmesi
Kök neden: `runAnalyzePerTest` diff modunu `{kind:'uncommitted'}` olarak
**sabitliyor** (`commands.ts:134`); hiçbir değişiklik yoksa L2 hiçbir sınıfı
hedeflemiyor.
- Diff modu `coverdict.diffMode` ayarından gelsin (Faz 10).
- `PER_TEST_NO_CHANGED_TARGETS` varken panel yeni bir `noChangedTargets`
  durumu göstersin ve **ne yapılacağını** yazsın: "Bu sınıfta değişiklik yok.
  `coverdict.diffMode`'u `base` yapıp `coverdict.baseRef`'e bir commit/branch
  verin, ya da dosyada değişiklik yapıp tekrar çalıştırın."
- `lineIndex.ts:21`'deki `ambient`/`entries` karışması ayrıştırılır (hata D-6):
  `<clinit>` kaynaklı kanıt panelde ayrı ve etiketli gösterilir.

**Bitti sayılır:** playground'da tek bir komut paleti kullanmadan, sadece
kenar çubuğundan tarama başlatılabiliyor; 7 bulgu hem Problems panelinde hem
Test Kalitesi ağacında görünüyor ve tıklanınca doğru dosya/satır açılıyor.

---

## Faz 12 — Mutasyon (F5 + F6)

CLI tarafı hazır (D-71).
- `--mutation-report` + `--mutation-classpath`; tek sınıf için
  `--mutation-target <id>=<FQCN>` (editör bağlam menüsü).
- **İlerleme akışı zaten mevcut ama kullanılmıyor:** CLI her ilerleme satırını
  `stderr`'e `coverdict: ` önekiyle anında flush ederek yazıyor
  (`AnalyzeCommand.java:740-759`), 30 sn'de bir heartbeat
  (`MutationRunner.java:220`). `runner.ts`'in `onStderrLine` kancası hazır ama
  bugün sadece Output'a ham geçiyor ve `withProgress`'in `_progress`'i
  atılıyor (`commands.ts:205`). Yeni `src/cli/progressParser.ts` (adı
  `runner.ts:9`'da zaten vaat edilmiş, dosya yok) bu satırları olaya çevirir.
- Kaldı/öldü/**belirsiz** üç kova; 9 PIT statüsünün hepsi haritalanır
  (`NON_VIABLE`, `MEMORY_ERROR`, `NOT_STARTED`, `STARTED`, `RUN_ERROR`,
  `NO_COVERAGE` → belirsiz; asla "öldü"/"kaldı" sayılmaz).
- Süre gerçekçi: tek sınıf saniyeler, büyük modül 70-90 dakika
  (`ROADMAP.md:551-563`). Asla otomatik tetiklenmez; iptal JVM'i gerçekten
  öldürmeli (`runner.ts:63` bugün çıplak `SIGTERM`, ağaç öldürme yok —
  Windows'ta yalnızca doğrudan `java` sürecini bitirir).

---

## Değişecek dosyalar

**`coverdict-vscode`:**
- Sil: `src/ui/coverageProvider.ts`, `src/test/integration/coverageApi.test.ts`
- Yeniden adlandır + sadeleştir: `src/ui/decorationFallback.ts` → `src/ui/gutterRenderer.ts`
- Yeni: `src/ui/explorerBadges.ts`, `src/ui/diagnostics.ts`,
  `src/ui/treeViews/` (üç provider), `src/model/metrics.ts`,
  `src/cli/progressParser.ts`
- Ağır düzenleme: `src/ui/commands.ts` · `src/extension.ts` ·
  `package.json` (`contributes` baştan yazılır: `configuration`, `commands`,
  `menus`, `views`, `viewsContainers`, `viewsWelcome`, `colors`) ·
  `src/verdict/types.ts` + `parse.ts` (`newCode`, `changedFiles`, `findings`,
  `mutation` blokları modellenir — bugün eksik veya doğrulanmıyor) ·
  `src/verdict/coverageMapping.ts` · `src/model/lineIndex.ts` ·
  `.vscode-test.mjs` (workspace klasörü açılmalı) · `README.md` (bayat:
  hâlâ "Faz 4 iskelet, görünür hiçbir şey yapmıyor" diyor)

**`coverdict-playground` (ayrı commit):** `run.ps1`, `.gitignore`, `README.md`

**`coverdict` (ayrı commit, sadece doküman):** `docs/ROADMAP.md` Faz 9-12 durumu

---

## Doğrulama

Her faz sonunda sırayla:

1. `npm run check-types && npm run lint` — temiz.
2. `npm run test:unit`. Yeni testler: `metrics.ts` klasör rollup'ı ·
   `progressParser` (gerçek stderr satırları **ve iki chunk'a bölünmüş bir
   satır** — `spawn` satır hizalı chunk garanti etmez) · `diagnostics`
   eşlemesi (altı kuralın hepsi) · `explorerBadges` indeksi · `parse.ts`'in
   `newCode`/`findings` doğrulaması.
3. `npm run test:integration` — **`.vscode-test.mjs`'e workspace klasörü
   eklendikten sonra** ilk kez gerçek komut yolları test edilebilir olacak
   (bugün klasör açılmadığı için her komut `commands.ts:163`'te çıkıyor).
   En az bir test ayarı `getConfiguration().update(...)` ile değiştirip
   sonucu doğrulamalı — bugün **hiçbir test hiçbir ayara dokunmuyor**, bu
   yüzden mevcut hata fark edilmedi.
4. **Gerçek CLI koşusu** (mock değil), playground'a karşı:
   ```bash
   java -jar C:/Users/Mert/Desktop/coverdict/coverdict-cli/target/coverdict.jar analyze --repo C:/Users/Mert/Desktop/coverdict-playground --uncommitted --report target/site/jacoco/jacoco.xml --file-coverage --out /tmp/v.json
   ```
   Çıktıdaki yüzdeler eklentinin gösterdikleriyle **birebir** aynı olmalı.
5. **Elle Extension Host doğrulaması** (yalnızca kullanıcı yapabilir):
   her ayarın tek tek açılıp kapatılması · toggle'ın iki yüzeyi birden
   etkilemesi · pencere yeniden yüklendiğinde kapsamanın komutsuz gelmesi ·
   Problems panelinde 7 bulgunun görünmesi · ağaçta tıklayınca doğru satırın
   açılması · **rozet karakter sınırı** · analizi iptal edince hata çıkmaması.
6. SonarQube taraması (`localhost:9001`, proje `coverdict-vscode`) — her
   özellik commit'inden sonra sıfır yeni bulgu.

Her faz kendi küçük commit'ini alır (AGENTS.md çalışma anlaşması). **Push
yapılmaz** — kullanıcı kendisi pushlar.

---

## Açık riskler

1. **`FileDecoration.badge` karakter sınırı belgelenmemiş.** 2 karakter render
   olmazsa yüzde rozetten tooltip'e taşınır. Faz 9'un ilk elle testinde ölçülür.
2. **Native Test Coverage görünümü kaybediliyor.** VS Code'un yerleşik "Test
   Coverage" yan panelini artık beslemiyoruz. Karşılığında aç/kapat gerçekten
   çalışıyor ve eski fork'larda da aynı davranıyor — kullanıcının şikayeti tam
   olarak buydu, takas bilinçli.
3. **"Yeni ve kapsanmış" satırlar boyanamaz** — JSON sadece kapsanmayan yeni
   aralıkları veriyor. Panelde açıkça yazılır, uydurulmaz.
4. **Cursor/Windsurf'ün gerçek VS Code sürümü hâlâ ölçülmedi.** Faz 9 bunu
   daha az önemli hale getiriyor: `FileDecorationProvider` +
   `TextEditorDecorationType` çok daha eski sürümlerde de çalışır.
5. **Bayatlık tespiti hâlâ yok.** Tarama sonrası dosya düzenlenirse gutter
   eski satır numaralarını boyamaya devam ediyor ve bunu belli etmiyor —
   Plan.md Bölüm 5'in `onDidSaveTextDocument` tabanlı çözümü hiç yazılmadı.
   Bu plana dahil değil, sonraki tur.
