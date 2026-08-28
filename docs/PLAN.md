# coverdict-vscode — devir belgesi ve ileri plan

**Son güncelleme:** 2026-08-28, Faz 24 sonrası (pencere yenileme
düzeltmesi, örtük constructor etiketi, Test Kalitesi ↔ Mutasyon köprüsü,
L0/L3 çelişki köprüsü ve NO_COVERAGE açıklaması dahil - §7.6'nın tüm
maddeleri kapandı).

---

## 0. Bu dosya nedir, önce ne oku

Bu dosya, projeyi hiç bilmeyen birinin (insan ya da AI) **tek başına**
okuyup çalışmaya başlayabilmesi için yazıldı. Ne yapıldığını, neden öyle
yapıldığını, hangi kuralların asla çiğnenmediğini ve sırada ne olduğunu
anlatır.

**Okuma sırası:** bu dosya → (mimari kuralların özgün hâli için)
`README.md` → (bir kararın *nasıl* alındığını merak edersen)
`docs/NOTES.md`. `NOTES.md` kronolojik bir kayıttır: Faz 12'den Faz 20'ye
kadar her elle test oturumunun bulgularını sırasıyla içerir, ama içindeki
maddelerin çoğu sonradan kapandı. **Çelişki olursa bu dosya geçerlidir.**

**Çalışma kuralları (kullanıcının kendi koyduğu):**
- Küçük ve sık commit et. Devir noktası sohbet değil **repo**dur — bir
  sonraki oturum sohbeti görmeyecek, sadece bu dosyaları görecek.
- **Asla `git push` yapma.** Kullanıcı kendisi pushlar.
- Her anlamlı değişiklikten sonra: testler + Sonar taraması (§9).
- Veri uydurma. Bkz. hard rule 3a (§3).

---

## 1. Üç repo

| Yol | Ne | Neden var |
|---|---|---|
| `C:\Users\Mert\Desktop\coverdict` | Java CLI (Maven, JDK 17). Derlenmiş jar: `coverdict-cli/target/coverdict.jar` | Tek gerçek karar mercii. Tüm sayılar, tüm bulgular buradan çıkar. |
| `C:\Users\Mert\Desktop\coverdict-vscode` | **Bu repo.** VS Code eklentisi (TypeScript) | CLI'ın JSON çıktısını editörde çizer. Kendi başına hiçbir şey hesaplamaz. |
| `C:\Users\Mert\Desktop\coverdict-playground` | Küçük Java Maven projesi: 3 production + 10 test sınıfı | Gerçek veri kaynağı. Her test dosyası kasten bir rule senaryosudur. |

### coverdict nedir (bir paragrafta)

Java test paketleri için yerel, deterministik bir **"karar katmanı"**.
Kendi motoru yoktur; JaCoCo XML raporunu, git diff'ini ve PIT mutasyon
koşusunu okuyup bunları eyleme dönüştürülebilir bulgulara çevirir. Sloganı:
*"coverage %80 diyor; coverdict bu kanıtın ne kadar güvene layık olduğunu
söyler."* Üç soruya cevap verir: hangi değişen satırlar test edilmemiş,
hangi testlerde tanınabilir bir oracle (assertion) yok, hangi testler
birbirinin kopyası. LLM yok, çıktı byte düzeyinde deterministik.

Kanıt katmanları: **L0** test kaynağının JavaParser ile statik oracle
analizi (hep açık) · **L1** JaCoCo + git diff (hep açık) · **L2** PIT ile
test-başına satır kapsaması (`--per-test-report`) · **L3** PIT ile mutasyon
(`--mutation-report`).

### playground senaryoları

Üretim: `Calculator.java` (dallanmalı fixture: `add`, `divide` sıfıra
bölünce fırlatır, `describe`, `square`, ayrıca commit'lenmemiş `negate`),
`Notifier.java` (tek metotlu arayüz, yalnızca mock'lanmak için var),
`NotifyingCalculator.java`.

Testler — her biri bir beklenen sonucu temsil eder:

| Dosya | Beklenen |
|---|---|
| `CalculatorGoodTest` | bulgu yok (doğru negatif) |
| `CalculatorNoOracleTest` | `NO_RECOGNIZED_ORACLE` (HIGH) + `PSEUDO_TESTED_METHOD` |
| `CalculatorPseudoTestedTest` | `NO_RECOGNIZED_ORACLE` + `PSEUDO_TESTED_METHOD` (`square`) |
| `CalculatorTautologicalOracleTest` | 2 × `TAUTOLOGICAL_ORACLE` |
| `CalculatorCatchWithoutFailTest` | `CATCH_ORACLE_WITHOUT_FAIL` |
| `CalculatorNullCheckOnlyTest` | `NULL_CHECK_ONLY` |
| `CalculatorSubsumedTest` | `SUBSUMED_TEST` |
| `CalculatorUnresolvedOracleTest` | `NO_RECOGNIZED_ORACLE` ama INCONCLUSIVE (AssertJ çözülemiyor) |
| `CalculatorParameterizedTest` | bulgu yok (`@ParameterizedTest` yanlış pozitif vermemeli) |
| `NotifyingCalculatorMockitoTest` | bulgu yok (Mockito `verify` geçerli oracle) |

---

## 2. CLI sözleşmesi (eklentinin bilmesi gereken kadarı)

Ayrıntı için `coverdict` reposunun `docs/CLI-REFERENCE.md`,
`docs/DECISIONS.md` (D-01…D-71) ve `schema/coverdict-verdict.schema.json`
dosyalarına bak. Buradaki her şey gerçek kaynaktan doğrulandı.

### Komutlar

`coverdict analyze` ve `coverdict doctor`. Eklenti yalnızca `analyze`
kullanır.

### Diff modları — tam olarak biri zorunlu

| Flag | Anlamı |
|---|---|
| `--no-vcs` | Sadece overall coverage. `newCode` → `{"status":"unavailable_no_vcs"}`, `changedFiles` boş. |
| `--uncommitted` | `HEAD` → working tree (staged + unstaged). |
| `--base <ref>` | `merge-base(ref, HEAD)` → working tree. |

Biri verilmezse ya da birden fazlası verilirse → **exit 2**.

### Eklentinin kullandığı flag'ler

`--repo <dir>` · `--report <path>` (tek modülde çıplak yol; modül id'si
`root` olur) · `--out <file>` · `--coverage-exclusions <glob,glob>` ·
`--file-coverage` (→ `fileCoverage` bloğu) · `--per-test-report` (L2) ·
`--per-test-classpath root=<file>` · `--per-test-target root=<FQCN>`.

### Henüz kullanılmayan flag'ler (Faz 20 bunları kullanacak)

`--mutation-report` · `--mutation-classpath <id>=<file>` ·
`--mutation-target <id>=<FQCN>` · `--mutation-timeout <saniye>`
(varsayılan 300) · `--diagnostics-dir <dir>`.

**Önemli:** `--per-test-report` ve `--mutation-report` normalde bir diff
modu ister; ama `--per-test-target` / `--mutation-target` verilirse bu
kısıt kalkar ve `--no-vcs` altında bile çalışırlar (D-71). Target'lar
"ya hep ya hiç"tir: bir tane verirsen diff'ten türeyen tüm hedefler
yok sayılır.

### JSON çıktısı

Her zaman var: `schemaVersion`, `tool`, `analysis`, `inputs`, `coverage`,
`changedFiles`, `findings`, `warnings`.
Yalnızca ilgili flag ile: `fileCoverage`, `perTest`, `mutation`.
**Blok yoksa anahtar hiç yazılmaz — `null` yazılmaz.**

```
analysis     { status: "complete"|"incomplete", exitCode: 0|3, incompleteReasons: reason[] }
inputs       { diffMode, findingsScope, resolved{head,base,mergeBase,dirty}, modules[] }
coverage     { overall: metricSet, newCode: metricSet | {status: "unavailable_*"} }
changedFiles [{ path, module?, classification, newLines?, coveredNewLines?, uncoveredNewRanges? }]
findings     [{ rule, severity, confidence, module, path, startLine, endLine,
                message, suggestedAction, fingerprint, testMethod?, productionMethod?,
                relatedTestMethod?, relatedPath? }]
warnings     [{ code, message, path?, module?, count? }]
fileCoverage { files: [{ module, path, metrics: metricSet, lines: [[line,mi,ci,mb,cb]] }], excluded: [] }
perTest      { engine:"pitest", engineVersion, modules:[{ id, entries[], ambient[] }] }
mutation     { engine:"pitest", engineVersion, modules:[{ id, methods[] }] }
```

`metric` = `{ numeratorName, numerator, denominatorName, denominator, percent }`.
`denominator === 0` ise `percent` **null**'dur — "coverage yok" ile
"coverage %0" farklı şeylerdir.

`metricSet` her zaman üç modu birden taşır:

| Mod | Nasıl hesaplanır | Karakteri |
|---|---|---|
| `jacoco-line` | Satırdaki **herhangi bir** instruction çalıştıysa covered | En cömert; ham JaCoCo satır coverage'ı |
| `strict-line` | Satırdaki **her** instruction çalışmalı | En katı; genelde en düşük |
| `sonar-compatible` | JaCoCo satır coverage'ı **+ branch coverage** | SonarQube arayüzüyle ±0.1 içinde eşleşir |

Bu yüzden aynı dosya için üç farklı sayı görürsün; hangisinin rozeti ve
gutter'ı sürdüğü `coverdict.badgeMetric` ayarıyla seçilir (varsayılan
`sonar-compatible`). **Bu kullanıcının en sık sorduğu şeydir:** Sonar'da
%81.5 görüp `Calculator.java` yanında 76 görmek çelişki değil — biri
repo geneli, öteki tek dosya.

`fileCoverage.lines` 5'li tuple: `[satır, missedInstructions,
coveredInstructions, missedBranches, coveredBranches]` — JaCoCo'nun kendi
alan sırası.

`perTest.ambient` `<clinit>` (static initializer) kapsamasını tutar ve
**hiçbir teste atfedilemez** (D-50); `entries` ile karıştırılmamalıdır.

**Kolay gözden kaçan, pahalıya patlayan gerçek:** `perTest.entries` yalnızca
production sınıflarını içermez — **test sınıfları da oradadır**, kendi
satırlarını kendi test metotlarıyla "kapsıyor" olarak. Gerçek bir koşuda
doğrulandı (tek bir `--per-test-target root=...Calculator` için 10 test
sınıfının onu da listelendi). Yani "bu sınıfın `entries`'te kaydı var mı"
sorusu **bir dosyanın test mi production mı olduğunu söylemez**; o soru
yalnızca `inputs.modules[].testRoots`/`sourceRoots` ile cevaplanır. Bu
ayrımı kaçırmak Faz 16-20 arasında açık kalan gerçek bir hataya yol açtı
(§7.1).

### Rule id'leri (6 tane)

| Rule | Severity | Anlamı |
|---|---|---|
| `NO_RECOGNIZED_ORACLE` | WARNING | Testte tanınabilir hiçbir assertion/verification yok |
| `TAUTOLOGICAL_ORACLE` | WARNING | Assertion'ın sonucu test edilen koda bağlı olamaz (`assertEquals(4, 2*2)`) |
| `CATCH_ORACLE_WITHOUT_FAIL` | WARNING | Exception fırlarsa tüm oracle'lar atlanır ve test yine geçer |
| `NULL_CHECK_ONLY` | INFO | Her oracle sadece null olmadığına bakıyor, içeriğe değil |
| `PSEUDO_TESTED_METHOD` | WARNING | Metot covered ama üretilen tüm mutantlar hayatta kaldı — kimse ne yaptığını gözlemlemiyor (L3) |
| `SUBSUMED_TEST` | INFO | Bir testin kill-set'i başka bir testinkinin gerçek alt kümesi (L3/L4) |

Confidence: `HIGH` · `MEDIUM` · `INCONCLUSIVE` (`LOW` rezerve, kullanılmıyor).
**Hiçbir rule, hiçbir confidence'ta "bu testi sil" demez.**

Rule metinleri CLI'ın `docs/rules/<RULE>.md` dosyalarından gelir; eklentinin
Türkçe kısaltılmış hâli `src/model/ruleCatalog.ts`'tedir — **uydurulmadı,
oradan özetlendi.**

### Uyarı kodları

~30 tane var; eklentinin pratikte gördüğü ve açıkladığı ~10 tanesi
`src/model/warningCatalog.ts`'te başlık + "ne demek" + "ne yapmalı"
şeklinde duruyor. Tanımadığı kodu **ham** gösterir (hard rule 3a).
En sık karşılaşılanlar:

- `CHANGED_LINES_ABSENT_FROM_REPORT` — değişen satırların JaCoCo raporunda
  karşılığı yok. **İki farklı sebebi olabilir ve coverdict ikisini
  ayırt edemez:** (a) satırlar zaten çalıştırılabilir değil (süslü parantez,
  metot imzası, import), (b) rapor diff'ten eski — yani `mvn test` sonrası
  kodu değiştirdin. Yapılacak: testleri tekrar koşup raporu tazele; uyarı
  devam ediyorsa sebep (a)'dır.
- `PER_TEST_CLASSPATH_MISSING` — L2 hedefleri var ama modüle bağlı bir
  classpath listesi yok. Faz 19'dan beri eklenti bu dosyayı kendi üretiyor.
- `MODULE_WITHOUT_REPORT` — modül tanımlı ama `--report` bağlanmamış.
- `REPORT_MISSING_CHANGED_FILE`, `CHANGED_FILES_EXCLUDED`,
  `UNTRACKED_JAVA_FILE`, `MUTATION_TARGET_UNRESOLVED`, `SUPPRESSED_FINDINGS`.

### Exit kodları

| Kod | Anlam |
|---|---|
| 0 | Tamamlandı (bulgu olsa da olmasa da) |
| 2 | Geçersiz girdi/çağrı — **JSON yazılmaz** |
| 3 | Kanıt eksik/belirsiz — yapılandırılmış "incomplete" JSON **yazılır** |
| 4 | İç hata |
| 1 | Kasten boş; ileride bulgu tabanlı kalite kapısına ayrıldı |

### `mutation` bloğu (Faz 20 için)

```json
"mutation": { "engine": "pitest", "engineVersion": "1.15.8",
  "modules": [{ "id": "root", "methods": [{
    "className": "dev.coverdict.playground.Calculator",
    "methodName": "square", "methodDescription": "(I)I",
    "firstLine": 36, "lastLine": 38,
    "mutants": [{ "mutator": "TRUE_RETURNS", "line": 37,
                  "status": "SURVIVED", "killingTests": [] }] }] }] }
```

`status` PIT'in kendi `DetectionStatus` enum'u, **9 değer**: `KILLED`,
`SURVIVED`, `TIMED_OUT`, `NON_VIABLE`, `MEMORY_ERROR`, `NOT_STARTED`,
`STARTED`, `RUN_ERROR`, `NO_COVERAGE`. Kovalara eşlemesi §8.3'te.

**Gerçek çıktıdan iki uyarı** (2026-08-28, şemanın golden örneğinden
farklı — belgeden değil koşudan öğrenildi):
- `mutator` **tam sınıf adıdır**
  (`org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator`),
  golden örnekteki kısa `TRUE_RETURNS` biçimi değil.
- `methods[]` **test sınıflarını da içerir** — PIT onları da mutasyona
  sokuyor. `perTest.entries`'teki aynı tuzak; süzgeç yine
  `fileCoverage.files[]`.

PIT jar'ın **içine gömülüdür** — hedef repoya PIT plugin'i kurulmaz.
Mutatörler yalnızca `RETURNS` ve `VOID_METHOD_CALLS`, tek thread
(determinizm, D-52), `fullMutationMatrix` açık (her mutantı öldüren
**tüm** testler kaydedilir).

### İlerleme akışı (Faz 20'nin yüzde göstergesi buradan gelecek)

CLI her ilerleme satırını **stderr**'e, `coverdict: ` önekiyle, anında
flush ederek basar (stdout metin raporu taşır ve JSON byte-deterministik
kalmalı, D-64). Heartbeat **30 saniye**. Gerçek satır biçimleri:

```
coverdict: mutation: module 'root' - 3 target class(es), budget 300s
coverdict: mutation: module 'root' - 2/3 class(es), 6m12s elapsed
coverdict: mutation: module 'root' - done, 5 method(s) with mutants
coverdict: mutation: module 'root' - FAILED, budget of 300s exhausted after 2/3 class(es) completed
coverdict: per-test: module 'root' - 4 target class(es)
coverdict: per-test: module 'root' - collecting coverage, 48s elapsed
```

Teşhis notu (D-64): bir modül bütçesinin çoğunu `0/219`'da geçiriyorsa
mutasyon aşamasına **hiç girmemiş** demektir — "yavaş mutasyon"dan
tamamen farklı bir sorundur.

---

## 3. Eklenti mimarisi

### Değişmez kurallar — önce bunlar

1. **`verdict/` ve `model/` asla `import 'vscode'` yapmaz.** Bu sayede düz
   `node --test` ile, VS Code indirmeden test edilirler. `vscode` gereken
   iş kardeş bir dosyaya taşınır. Yerleşik desen:
   `cli/classpathParser.ts` (saf) ↔ `cli/classpathBuilder.ts` (vscode'lu);
   `cli/argsBuilder.ts` (saf) ↔ `cli/runner.ts`.
2. **Eklenti JaCoCo XML parse etmez, git çalıştırmaz, dosya yüzdesi
   hesaplamaz.** Her sayı CLI'ın JSON'undan gelir (D-70). Tek istisna:
   klasör rozetlerinin rollup'ı (`model/metrics.ts`) — çünkü CLI klasör
   seviyesi yayınlamaz.
3. **hard rule 3a — bu projenin en önemli kuralı.** Veri yokluğu asla
   "sorun yok" ya da "sorun var" ile aynı görünemez; her zaman kendi ayrı
   durumu olur. Tahmin yok, uydurma yok, boşluk doldurma yok.
   Örnekler: `Notifier.java` saf bir arayüz olduğu için 0 çalıştırılabilir
   satırı var → rozet **almaz** (%100 diye gösterilmez) · coverage dışı
   bırakılmış dosya gri `–` rozeti alır (verisizden ayrılır) · tanınmayan
   uyarı kodu ham gösterilir · belirsiz mutant statüsü killed/survived'a
   katlanmaz.
4. **Terminoloji:** `coverage`, `covered`, `uncovered` teknik terimlerdir,
   arayüzde **İngilizce kalır** ("kapsama"/"kapsanmayan" diye çevrilmez).
   Bu kullanıcının açık ve kalıcı talimatıdır.

### Veri akışı

```
komut (ui/commands.ts)
  → cli/jarLocator.ts      jar nerede
  → cli/argsBuilder.ts     argv (saf)
  → cli/runner.ts          spawn java -jar, stdout/stderr satır satır
  → verdict/parse.ts       asla throw etmez, sonuç nesnesi döner
  → model/store.ts         tek doğruluk kaynağı
  → 5 yüzey: gutter · Explorer rozeti · durum çubuğu · Problems paneli · 4 TreeView
```

### Dosya haritası

| Dosya | Görev |
|---|---|
| `src/extension.ts` | Sadece `activate`/`deactivate` ve kayıt. İş mantığı yok. Son taramayı `context.storageUri`'den geri yükler. |
| `cli/jarLocator.ts` | Jar arama sırası: `coverdict.jarPath` → `<ws>/coverdict-cli/target/coverdict.jar` → `<ws>/.coverdict/coverdict.jar`. Jar `.vsix`'e **gömülmez**. |
| `cli/argsBuilder.ts` | `analyze` argv'sini kurar (saf). `DiffMode` tipi burada. |
| `cli/runner.ts` | `spawn` ile çalıştırır, stdout/stderr'i ayrı satır tamponlar, `onStderrLine` kancası sunar, `cancel` verir. |
| `cli/classpathParser.ts` | `mvn dependency:build-classpath` çıktısından classpath satırını ayıklar (saf). |
| `cli/classpathBuilder.ts` | Maven'ı çalıştırıp `target/coverdict-classpath.txt`'i üretir (Faz 19). Mutasyon da aynı dosyayı kullanır. |
| `cli/progressParser.ts` | CLI'ın stderr ilerleme satırlarını yapılandırılmış olaya çevirir (saf). Tanımadığını yutmaz. |
| `verdict/types.ts` | JSON şemasının TypeScript karşılığı. `vscode` import etmez. |
| `verdict/parse.ts` | `parseVerdict(raw)` — **asla throw etmez**, sonuç nesnesi döner; rule id'lerini doğrular. |
| `verdict/testIdentity.ts` | CLI'ın `TestIdentity.java`'sının portu (D-49): JUnit5 UniqueId'leri ve `Class#method()` biçimini çözer; tanımadığını **aynen** gösterir. |
| `verdict/coverageMapping.ts` | 5'li tuple → `LineState` (covered/partial/uncovered). `mi>0 \|\| mb>0` ise partial. |
| `model/store.ts` | Son koşunun tek kaynağı; coverage state, per-test state, gutter görünürlüğü, bayatlık işaretleri. |
| `model/lineIndex.ts` | "Bu satırı hangi testler kapsıyor" + ters indeks + ardışık satır gruplama (`groupConsecutiveLines`). |
| `model/testQuality.ts` | **Projenin en değerli birleşimi:** `findings[].testMethod` ile `perTest` test id'lerini eşler (gerçek veride 17 tam eşleşme ile doğrulandı). "Yeşil ama oracle'sız" satırları buradan biliyoruz. |
| `model/falseGreenIndex.ts` | JaCoCo'ya göre covered ama kapsayan her testin oracle bulgusu olan satırlar → turuncu gutter. |
| `model/metrics.ts` | Tek izinli aritmetik: klasör rollup'ı. |
| `model/pathIndex.ts` | Yol matematiği + `classifySourcePath` (test mi production mı — "Satır → Testler"in yön kararı). coverdict yolları repo-göreli ve **ileri eğik çizgili**dir (D-22). |
| `model/classNameDetector.ts` | package + dosya adı → FQCN. Çok sınıflı dosyada tahmin yapmaz. |
| `model/productionClassIndex.ts` | `fileCoverage.files[]`'ten `className → yol` haritası; diskte arama yapmaz. |
| `model/mutationModel.ts` | 9 PIT statüsü → 3 kova, skor, sınıf gruplama, mutator adı kısaltma (saf). |
| `model/ruleCatalog.ts` | 6 rule için Türkçe başlık/özet/eylem. |
| `model/warningCatalog.ts` | Uyarı kodları için Türkçe açıklama; ham mesaj tooltip'te korunur. |
| `ui/commands.ts` | En büyük dosya. 8 komut, koşu orkestrasyonu, `paintCoverage`, classpath otomatik üretimi. |
| `ui/gutterRenderer.ts` | Tek gutter çizici. 6 durum: covered · partial · uncovered · oracleless (turuncu) · excluded · stale. Mutasyon için 7. durum **eklenmedi** (bilinçli). |
| `ui/explorerBadges.ts` | Explorer rozetleri. Dosya yüzdesi CLI'dan, klasör rollup'tan. |
| `ui/hoverProvider.ts` | Çift yönlü hover: production satırında "hangi testler + kaliteleri", test metodunda "hangi production satırları". |
| `ui/diagnostics.ts` | Bulguları Problems paneline yazar; `severity` ile `confidence`'ı ayrı tutar. |
| `ui/statusBar.ts` | Özet yüzde; `fileCoverage` bloğunun hiç olmadığını bildiren **tek** yüzey. |
| `ui/testFileLocator.ts` | Test dosyasını bulur; bulamazsa **tahmin etmez**, `undefined` döner. |
| `ui/treeViews/runView.ts` | Çalıştır görünümü. |
| `ui/treeViews/coverageView.ts` | Overall / new code / uncovered new ranges / Uyarılar. |
| `ui/treeViews/qualityView.ts` | Bulgular; rule↔dosya gruplama, serbest metin filtre. Faz 24: `getParent` + Mutasyon köprüsü hedefi (`findQualityBridgeTarget`). |
| `ui/treeViews/lineTestsView.ts` | Satır → Testler; aralık gruplama, "sadece sorunlu satırlar" filtresi. Faz 24: satır grupları gerçek `methodName` de taşır (örtük constructor etiketi). |
| `ui/treeViews/mutationView.ts` | Mutasyon raporu; sınıf → metot → mutant → öldüren testler. Faz 24: `getParent` + Test Kalitesi köprüsü hedefi (`findMutationBridgeTarget`). |

**Silinmiş, tekrar yazma:** `src/ui/panelView.ts` (webview paneli, Faz
15c'de kaldırıldı — kendi kendini boşaltıyordu; yerine hover + TreeView).

Faz 1'den beri koda yorum olarak söz verilip hiç yazılmamış olan
`src/cli/progressParser.ts` **Faz 20'de yazıldı** — artık uzun koşularda
gerçek yüzde ve geçen süre gösteriliyor.

---

## 4. Bugünkü durum (Faz 19)

Activity Bar'da `coverdict` konteyneri, içinde **5 görünüm**:

1. **Çalıştır** — "Hızlı Tarama" (coverage + oracle bulguları, saniyeler),
   "Derin Tarama" (üstüne L2: hangi test hangi satırı çalıştırıyor, PIT
   ile, daha uzun), "Mutasyon Testi" (modül geneli, onay diyaloğunun
   arkasında), "Coverage Görünümü" aç/kapat. **Derin Tarama mutasyon
   testi değildir** — tooltip'i bu cümleyle başlar, çünkü kullanıcı bunu
   sordu.
2. **Coverage** — overall (üç metrik), new code, uncovered yeni satırlar
   (tıklanınca gider), Uyarılar (Türkçe açıklamalı).
3. **Test Kalitesi** — bulgular; başlıkta iki düğme: serbest metin filtre
   ve rule↔dosya gruplama geçişi (tek düğme, tıkladıkça değişir).
4. **Satır → Testler** — aktif Java dosyası için; ardışık ve aynı testlerce
   kapsanan satırlar **tek düğümde** birleşir (`Satır 9-11`); başlıkta
   "sadece sorunlu satırlar" süzgeci (varsayılan kapalı). Yön dosyanın
   yerine göre seçilir (§7.1).
5. **Mutasyon** — sınıf → metot → mutant → öldüren testler. Her düzeyde
   skor `öldürülen/(öldürülen+hayatta kalan)`, belirsizler ayrıca sayılır
   ve asla gizlenmez. Başlıkta "sadece hayatta kalan mutantlar" süzgeci.

### Komutlar (15)

`coverdict.analyze` (Hızlı Tarama) · `coverdict.analyzePerTest` (Derin
Tarama) · `coverdict.mutationForModule` (modül geneli mutasyon, onaylı) ·
`coverdict.mutationForFile` (editör sağ tık — **mutasyon için önerilen
yol**) · `coverdict.toggleCoverage` · `coverdict.perTestForFile` (editör
sağ tık, Java) · `coverdict.copyItem` (ağaçlarda sağ tık → Kopyala) ·
`coverdict.qualityView.filter` · `coverdict.qualityView.toggleGrouping` ·
`coverdict.lineTestsView.toggleProblemsOnly` ·
`coverdict.mutationView.toggleSurvivorsOnly` ·
`coverdict.qualityView.showInMutation` (Faz 24, sağ tık, yalnızca
`PSEUDO_TESTED_METHOD` bulgusunda) ·
`coverdict.mutationView.showInQuality` (Faz 24, sağ tık, yalnızca
eşleşen bir bulgu varsa - §7.6 madde 5) ·
`coverdict.lineTestsView.showInMutation` (Faz 24, sağ tık, yalnızca L0/L3
çelişkisi gerçekten varsa - §7.6 madde 6) ·
`coverdict.mutationView.showInLineTests` (Faz 26, sağ tık, yalnızca
o satırın gerçek bir perTest kaydı varsa - §7.7).

### Ayarlar (13)

| Ayar | Varsayılan |
|---|---|
| `coverdict.jarPath` | `""` (arama sırası devreye girer) |
| `coverdict.javaExecutable` | `"java"` |
| `coverdict.mavenExecutable` | `""` → Windows'ta `mvn.cmd`, diğerinde `mvn` |
| `coverdict.reportPath` | `"target/site/jacoco/jacoco.xml"` |
| `coverdict.perTestClasspathPath` | `"target/coverdict-classpath.txt"` |
| `coverdict.mutationTimeout` | `300` (saniye, modül başına bütçe) |
| `coverdict.coverageExclusions` | `[]` |
| `coverdict.diffMode` | `"uncommitted"` (`no-vcs` \| `uncommitted` \| `base`) |
| `coverdict.baseRef` | `""` |
| `coverdict.badgeMetric` | `"sonar-compatible"` |
| `coverdict.show.explorerBadges` | `true` |
| `coverdict.show.lineGutter` | `true` |
| `coverdict.show.oraclelessLines` | `true` |

### Kullanıcının yerleşik kararları (değiştirme, önce sor)

- Tarama sonrası **açılır bildirim yok**. Yalnızca `analysis.status ===
  'incomplete'` olduğunda uyarı çıkar.
- Çalıştır görünümünde "Son tarama … bulgu" satırı **yok** (kaldırıldı).
- %100 coverage rozeti **`✓`**, tam sayı tooltip'te.
- Coverage dışı bırakılmış dosya gri **`–`** rozeti alır.
- Rule kodları ham enum olarak da görünür, ama başlık okunabilir Türkçedir.

### Sağlık

157 unit + 54 integration test geçiyor. SonarQube (`coverdict-vscode`,
`http://localhost:9001`) sıfır açık bulgu.

---

## 5. Geliştirme akışı

### Kurulum ve derleme

```bash
npm install
npm run watch          # esbuild + tsc, ikisi de watch modunda
```

`esbuild` `dist/extension.js`'i üretir (paketlenen budur); `tsc` sadece tip
kontrolü ve testleri `out/`'a derlemek için kullanılır.

### Çalıştırma / hata ayıklama

VS Code'da **F5** → "Run Extension" → Extension Development Host penceresi
açılır. Orada `coverdict-playground`'ı aç ve Activity Bar'daki coverdict
ikonuna tıkla.

### Test

```bash
npm run check-types && npm run lint
npm run pretest && npm run test:unit        # düz node:test, VS Code gerekmez
node esbuild.js && npm run test:integration # gerçek Extension Host
```

Temiz koşu (bir şey tuhaflaşırsa bunu kullan):

```bash
rm -rf out dist coverage && npm run pretest && npm run test:unit:coverage && node esbuild.js && npm run test:integration
```

### Jar'ı derlemek

`coverdict` reposunda:

```bash
mvn verify
```

→ `coverdict-cli/target/coverdict.jar`. Derlemek için JDK 17+ gerekir
(`maven.compiler.release=17`). Bu makinede PATH'teki `java` şu an
Temurin 25 — jar'ı çalıştırmak için sorun değil; `mvn verify` başarısız
olursa önce `java -version`'a bak.

### Playground'da kanıt üretmek

```bash
mvn -q clean test
```

→ JaCoCo raporunu tazeler: `target/site/jacoco/jacoco.xml`.

**Tuzak:** `mvn clean` `target/coverdict-classpath.txt`'i de siler. Faz
19'dan beri eklenti Derin Tarama'da dosyanın yokluğunu fark edip
"Maven ile şimdi üretilsin mi?" diye soruyor ve kendisi üretiyor —
elle üretmene gerek yok.

`run.ps1` playground'ın kendi kısayol scripti: `mvn clean test` + PIT
mutasyon koşusu + classpath dosyası yazımı + coverdict CLI'ı ilk commit'i
base alarak çağırma, hepsi tek komutta. **Kullanıcı bunu kendi akışında
kullanmıyor** — varlığını bil, çağırma.

### SonarQube

```bash
sonar-scanner -Dsonar.host.url=http://localhost:9001 -Dsonar.token=$SONAR_TOKEN -Dsonar.projectKey=coverdict-vscode -Dsonar.sources=src -Dsonar.exclusions=**/*.test.ts,out/**,dist/**,.vscode-test/** -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info
```

Sonuçlar SonarQube MCP araçlarıyla okunur
(`search_sonar_issues_in_projects`, `get_project_quality_gate_status`).
Yeni bulgu **sıfır** olmalı; bu repoda Sonar temizliği duran bir kısıttır.

**Kalite kapısı hakkında bilinmesi gereken:** `new_violations` ve
`new_security_hotspots_reviewed` geçiyor, ama kapının bütünü `new_coverage`
yüzünden ERROR veriyor (~%59, eşik %80). Sebep yapısal: `c8` yalnızca
`out/cli`, `out/model`, `out/verdict`'i ölçüyor; `src/ui/**` gerçek
Extension Host testleriyle test ediliyor ama o koşu enstrümante edilmiyor,
dolayısıyla Sonar tüm UI kodunu "kapsanmamış" görüyor. Yani bu ERROR
"UI test edilmemiş" demek **değil**. Karar bekliyor (§7.4).

---

## 6. Bilinen tuzaklar

- **`FileDecoration.badge` 2 code point'ten uzun olamaz.** Uzunsa VS Code
  extension host **throw eder ve o dosyanın dekorasyonunu tamamen
  düşürür** — yani `"100"` yazmak "rozet hiç yok" demektir. `@types/vscode`
  bunu yazmaz; gerçek 1.135.0 extension host bundle'ı okunarak bulundu.
  Bu yüzden %100 → `✓`. `explorerBadges.test.ts` içinde "üretilen hiçbir
  rozet 2 code point'i geçmez" invaryant testi var — **onu silme**, çünkü
  throw VS Code tarafında olduğu için normal bir eşitlik testi bu hatayı
  yakalayamaz (nitekim eski test `badge === '100'` diyip geçiyordu).
- **`mvn clean` classpath dosyasını siler** → Derin Tarama sessizce
  `PER_TEST_CLASSPATH_MISSING`'e düşer. (Faz 19'da otomatikleştirildi.)
- **Windows'ta `mvn.cmd` bir batch dosyasıdır**; Node'un CVE-2024-27980
  düzeltmesinden beri doğrudan `spawn` edilemez, `shell: true` gerekir.
  Bu yalnızca **tüm argümanlar kodun kendi ürettiği sabitler** olduğu için
  güvenli — kullanıcı metni asla oraya konmamalı.
- **`--no-vcs` altında per-test çalışmaz** — CLI tasarımı, değişmeyecek.
  L2 hedefleri değişen production sınıflarından türer.
- **`base` modunda `baseRef = HEAD`** boş diff verir. Hata değil:
  `merge-base(HEAD, HEAD) = HEAD`.
- **`perTest.entries` ve `mutation.methods` test sınıflarını da içerir.**
  İkisi de production listesiyle (`fileCoverage.files[]`) süzülmeli, yoksa
  arayüz testin kendi kodunu ölçüyormuş gibi görünür. Bu tuzak iki ayrı
  gerçek hataya yol açtı (§7.1, §8.6).
- **PIT çocuk JVM doğurur.** İptalde çıplak `SIGTERM` yetmez; `killTree`
  (Windows'ta `taskkill /T`) kullanılır — yoksa minion süreçler arkada
  kalır ve classpath'i kilitler.
- **Terminoloji:** `coverage`/`covered`/`uncovered` çevrilmez (§3, kural 4).

---

## 7. Açık işler (öncelik sırasıyla)

### 7.0 ~~pencere yenilenince "Satır → Testler" ve "Mutasyon" geri yüklenmiyor~~ — **KAPANDI (Faz 24)**

**Kullanıcının bulduğu, henüz dokunulmamış gerçek hata (2026-08-28).**
Repro: Derin Tarama ve Mutasyon Testi çalıştırılıp gerçek sonuçlar
ekranda görüldü (iki ekran görüntüsüyle doğrulandı); eklenti yeniden
derlenip Extension Development Host penceresi yenilendi (`Ctrl+R` /
"Developer: Reload Window"). Sonuç: **Coverage** ve **Test Kalitesi**
görünümleri son taramanın verisiyle doğru geri geldi, ama **Satır →
Testler** ve **Mutasyon** boş/ilk hâlinde kaldı — sanki hiç
çalıştırılmamışlar gibi. Diskteki `verdict-current.json` doğru veriyi
taşıyor; kayıp değil, sadece **ekrana yansımıyor**.

**Kök neden bulundu, kod okunarak doğrulandı — tahmin değil.**
`src/extension.ts`'in `restoreLastCoverage()` fonksiyonu (satır ~148-183):

```ts
publishAnalysis(sinks, folder.uri.fsPath, analysisResultFrom(parsed.value));
// perTest restores independently of fileCoverage - ...
setPerTestState({ moduleId: MODULE_ID, perTest: parsed.value.perTest, warnings: parsed.value.warnings });
// Faz 20: mutasyon da geri yüklenir - ...
if (parsed.value.mutation) {
	setMutationState({ moduleId: MODULE_ID, mutation: parsed.value.mutation, warnings: parsed.value.warnings, targets: [], ranAt: undefined });
}
```

`model/store.ts`'teki `setPerTestState`/`setMutationState` **düz değişken
atamasıdır** — hiçbir `EventEmitter` tetiklemez. Bir `TreeView`'ın
ekranı yenilemesi için tek sinyal, ilgili provider'ın kendi
`refresh()`'i (`onDidChangeTreeData` event'ini ateşler). Sırayı takip et:

1. `publishAnalysis(...)` çağrılır. Bu fonksiyonun **içinde**
   `sinks.lineTestsView.refresh()` (ve `runView`/`coverageView`/
   `qualityView`) çağrılıyor (`ui/commands.ts:189-192`) — **ama bu anda
   `perTestState` hâlâ eski/boş değerinde**, çünkü `setPerTestState`
   henüz çağrılmadı. Yani "Satır → Testler" boş veriyle bir kez
   yenileniyor.
2. `setPerTestState(...)` çağrılır — veri artık doğru, ama **bunun
   ardından hiçbir `refresh()` çağrılmıyor**. `LineTestsTreeProvider`'ın
   `onDidChangeTreeData` event'i bir daha ateşlenmiyor, VS Code
   `getChildren()`'ı tekrar sormuyor. Görünüm 1. adımdaki boş hâlde
   kilitli kalıyor.
3. `setMutationState(...)` çağrılır (mutasyon bloğu varsa) — **hiçbir
   yerde `sinks.mutationView.refresh()` çağrılmıyor**, ne önce ne sonra.
   `MutationTreeProvider` kayıt anındaki ilk render'ında ("Henüz
   mutasyon testi çalıştırılmadı") donuk kalıyor.

**Coverage ve Test Kalitesi neden etkilenmiyor:** onların verisi
(`fileCoverage`, `findings`) `setCoverageState(...)` ile
`publishAnalysis`'in **kendi içinde**, kendi `refresh()` çağrılarından
**önce** set ediliyor (`ui/commands.ts:176` → `setCoverageState`, sonra
`paintCoverage`/`showCoverageSummary`, sonra görünüm `refresh()`'leri) —
sıra orada doğru.

**Neden şimdiye kadar fark edilmedi:** aynı oturumda **canlı** bir
Derin Tarama/Mutasyon Testi çalıştırıldığında `ui/commands.ts`'teki
`runAnalyzePerTest`/`runPerTestForFile`/`runMutation` fonksiyonları
`setPerTestState`/`setMutationState`'i çağırdıktan **hemen sonra**
kendi `refresh()`'lerini çağırıyor (`revealLineTestsView(sinks)`,
`sinks.mutationView.refresh()`) — o yüzden canlı koşuda hep doğru
çalıştı. Hata yalnızca **pencere yenileme / eklenti yeniden başlatma**
yolunda, yani `extension.ts`'in kendi geri yükleme kodunda.

**Önerilen düzeltme (küçük, iki satır):**

```ts
setPerTestState({ moduleId: MODULE_ID, perTest: parsed.value.perTest, warnings: parsed.value.warnings });
sinks.lineTestsView.refresh();               // <-- eklenecek

if (parsed.value.mutation) {
	setMutationState({ moduleId: MODULE_ID, mutation: parsed.value.mutation, warnings: parsed.value.warnings, targets: [], ranAt: undefined });
	sinks.mutationView.refresh();             // <-- eklenecek
}
```

`refresh()` ucuz bir çağrı (yalnızca event ateşler), gereksiz yere
çağrılması zararsız — mutasyon bloğu yoksa zaten `if` bloğunun dışında
kaldığı için hiç çağrılmayacak, bu da doğru (görünüm zaten "henüz
çalıştırılmadı" ilk hâlinde, ki bu gerçek durum).

**Doğrulama (düzeltmeden önce tekrarlanabilir, düzeltmeden sonra
kaybolmalı):**
1. `coverdict-playground`'da Derin Tarama, sonra Mutasyon Testi (tek
   sınıf, `Calculator`) çalıştır — her iki panel de dolsun.
2. `npm run watch` açıkken bir kod değişikliği yap ya da doğrudan F5 ile
   yeniden başlat; Extension Development Host'ta "Developer: Reload
   Window" çalıştır.
3. **Düzeltmeden önce:** Coverage ve Test Kalitesi dolu gelir, Satır →
   Testler "Önce bir Java dosyası açın"/boş, Mutasyon "Henüz mutasyon
   testi çalıştırılmadı" der — disk verisi orada olmasına rağmen.
4. **Düzeltmeden sonra:** ikisi de son koşunun verisiyle dolu gelmeli.

**Test boşluğu — bunu da kapat.** `src/test/integration/extension.test.ts`
şu an yalnızca `activate()`'in patlamadığını doğruluyor;
`restoreLastCoverage`'ın per-test/mutation geri yüklemesini **hiçbir
test egzersiz etmiyor** (fonksiyon zaten export edilmiyor, private).
Düzeltmeyle birlikte bir entegrasyon testi eklenmeli: gerçek bir
`verdict-current.json` (per-test + mutation bloklu) `context.storageUri`
altına yazılıp `activate()` çağrılsın, sonra `lineTestsView`/
`mutationView`'ın **gerçekten** dolu döndüğü doğrulansın (bugünkü haliyle
bu test **kırmızı** başlar, düzeltmeden sonra yeşile döner — klasik
regresyon kilidi).

**Kapatıldı (Faz 24).** Önerilen iki satır uygulandı — `extension.ts`'te
`restoreLastCoverage`'ın gövdesi `restoreLastCoverageFrom(storageDir,
workspaceRoot, sinks)` adında ayrı, `export`'lu bir fonksiyona taşındı
(yalnızca `vscode.workspace.workspaceFolders`/`context.storageUri`'ye
bağımlı kısım sarmalayıcıda kaldı) — entegrasyon test host'unda gerçek
bir workspace klasörü açık olmadığı için `context.storageUri` hep
`undefined` geliyor, dolayısıyla asıl mantığı test edebilmek için bu
ayrım gerekti.

Yeni test: `src/test/integration/extension.restoreLastCoverage.test.ts`.
Gerçek playground alan adlarıyla (`dev.coverdict.playground.Calculator`,
`square` metodu, gerçek PIT mutator sınıf adı) bir `verdict-current.json`
temp dizine yazılıyor, `lineTestsView`/`mutationView`'ın `refresh()`
metotları casus (spy) ile sarılıp her çağrıda `getChildren()`'ın o anki
görüntüsü kaydediliyor — gerçek `TreeView`'ın `onDidChangeTreeData`
event'ine tam olarak ne zaman ve hangi veriyle tepki vereceğinin birebir
modeli bu. Düzeltmeden önce testin **kırmızı** başladığı elle doğrulandı:
`sinks.mutationView.refresh()` hiç çağrılmadığı için `mutationSnapshots`
boş kalıyor. Düzeltmeyle **yeşile döndüğü** de doğrulandı: her iki
görünümün son yakaladığı görüntü artık geri yüklenen veriyi taşıyor
(`prodLine` / `header`), boş başlangıç durumunu değil.

Doğrulama: `npm run check-types && npm run lint`, temiz koşu (142 unit +
32 integration, hepsi geçti), SonarQube taraması sıfır açık bulgu.

---

### 7.1 ~~Test dosyasında yanlış yön çiziliyor~~ — **KAPANDI (Faz 21)**

*(NOTES.md'de "Faz 16 madde 1", üç faz boyunca açık kaldı)*

Sözleşme artık kodda yerine getiriliyor:

> **Production dosyası → ileri yön** (satır → onu kapsayan testler).
> **Test dosyası → ters yön** (test metodu → çalıştırdığı production satırları).

**Kök neden, gerçek veriyle doğrulandı (2026-08-28):** PIT tabanlı L2
toplayıcısı **test sınıflarını da `perTest.entries`'e yazıyor** — tek bir
`--per-test-target root=...Calculator` koşusunda 10 test sınıfının onu da,
kendi satırlarını kendi test metotlarıyla "kapsıyor" olarak listelendi.
Bu yüzden `testsForClass(<TestClass>)` `'found'` dönüyordu ve hem
`lineTestsView.computeView()` hem `hoverProvider` "önce production dene"
sırasında production dalına kilitleniyordu.

**Düzeltme iki parçalı:**
1. **Yön yol tabanlı seçiliyor** — `model/pathIndex.ts`'in yeni
   `classifySourcePath(path, modules)`'ı CLI'ın kendi
   `inputs.modules[].testRoots`/`sourceRoots` beyanına bakar. Beyan yoksa
   `'unknown'` döner ve yön tahmin edilmez: hangi yönde gerçek kanıt varsa
   o gösterilir. Bunun için `CoverageState`/`AnalysisResult` artık
   `inputs.modules[]`'ü de taşıyor.
2. **Ters indeks test sınıflarını eliyor** — `testsToLines(...)` isteğe
   bağlı bir production-sınıf süzgeci alıyor; süzgeç
   `fileCoverage.files[]`'ten kuruluyor (bu koşunun production dosyalarının
   yetkili listesi). `fileCoverage` yoksa süzgeç de yok: eksik bilgiyle
   elemektense elememek yeğdir.

Yan düzeltme: `['src/main/java']` sabiti yerine artık gerçek
`sourceRoots` kullanılıyor (`productionSourceRoots(modules)`), yani çoklu
modül ve alışılmadık dizin düzenleri de doğru çalışıyor.

**Regresyon testleri gerçek veriyle** (`lineTestsView.test.ts`,
`hoverProvider.test.ts`): fixture'lar artık test sınıflarının
self-covering entry'lerini içeriyor — üç faz boyunca hatayı gizleyen tam
olarak bu eksiklikti.

### 7.2 "Değişen satırların listesi" şemada yok

Kullanıcı yeni kod bölümünde hangi satırların değiştiğini görmek istiyor.
Bugün yalnızca yüzde + `uncoveredNewRanges` var; **covered** yeni satırların
listesi CLI şemasında hiç yok (D-70). Bu eklentide çözülemez: ya CLI'a
`coveredNewRanges` eklenir, ya da arayüz bunun neden gösterilemediğini
açıkça yazar. Karar kullanıcınındır.

### 7.3 Playground'da gerçek "yeni kod" senaryosu — kullanıcı tarafı adım

*(NOTES.md madde 6/7)*

Playground'a test kodu **commit'lenmeyecek** (senaryo haritasını bozar).
Gerçek yeni-kod akışı ayrı bir branch + push ile denenecek, sonra
`diffMode: base`, `baseRef: main`. Bugün working tree'de commit'lenmemiş
bir `Calculator.negate(int)` var ve hiçbir test onu çağırmıyor — gerçek bir
uncovered-yeni-satır adayı; `mvn clean test` sonrası raporda görünür.

### 7.4 Sonar kalite kapısı `new_coverage` yüzünden ERROR

Yapısal, yeni bir hata değil: UI kodunun coverage'ı hiç ölçülmüyor (§5).
Üç seçenek var, hiçbiri seçilmedi:
1. `src/ui/**`'ı `sonar.coverage.exclusions`'a ekle — dürüst ama gerçek
   boşlukları da gizler.
2. Integration testlerini enstrümante et (`c8` + Extension Host) — doğru
   çözüm, ama kurulumu zahmetli.
3. Eşiği düşür — en kolay, en az bilgilendirici.

`new_violations` sıfır olduğu sürece koşu "temiz" sayılıyor; kapının
kendisi bu maddeye kadar ERROR kalacak.

### 7.5 Mutasyon arayüzünün kalanı

Faz 20 ile temel arayüz geldi (§8). Bilerek yapılmayanlar:
- **Gutter'a mutasyon durumu eklenmedi** (7. durum yok). Önce ağacın
  gerçek kullanımda oturması bekleniyor.
- ~~**Mutasyon sonucu bir sonraki taramada kayboluyor.**~~ — **KAPANDI
  (Faz 25).** Kullanıcının canlı kullanımda bizzat yakaladığı gerçek
  hata (2026-08-28): mutasyon testi çalıştırıldı, sonra bir Derin Tarama
  yapıldı, pencere yenilenince mutasyon sonucu gitmişti - tam olarak
  burada tahmin edilen senaryo.

  Çözüm: mutasyon sonucu artık kendi dosyasında,
  `mutation-current.json` (`ui/commands.ts`'in `writeMutationSnapshot`'ı,
  yalnızca `parsed.mutation` gerçekten varsa yazıyor - bütçe aşımı gibi
  boş bir koşu eskiyi ezmiyor). `verdict-current.json`'dan tamamen
  bağımsız: `extension.ts`'in `restoreMutationSnapshot`'ı onu ayrı,
  erken `return`'lerden etkilenmeyen bir adımda okuyor. "Bu sonuç ne
  kadar eski" sorusu da bedavaya çözüldü - CLI'ın çıktısı zaman damgası
  taşımadığı için önceden bilinmiyordu, ama artık dosyayı biz yazdığımız
  için kendi gerçek `Date.now()`'ımızı ekliyoruz; pencere yenilemesi
  sonrası "5 dakika önce" gibi doğru bir süre gösteriliyor (önceden
  hep "kaydedilmiş sonuç - ne zaman çalıştığı bilinmiyor" diyordu).

  Şema kendi icadımız (CLI'ın değil), `verdict/parse.ts`'in
  `isMutationBlock`'u dışa açılıp doğrulamada yeniden kullanıldı; bozuk/
  eksik alanlı bir dosya sessizce yok sayılıyor (hard rule 3a) - ne
  atıyor ne yarım veriyle güveniyor.

  Doğrulama: gerçek senaryoyu birebir kuran entegrasyon testleri
  (`extension.restoreLastCoverage.test.ts`) - `verdict-current.json`'da
  hiç `mutation` bloğu yokken `mutation-current.json`'dan doğru geri
  yükleniyor, gerçek zaman damgası doğru "N dakika önce" üretiyor,
  eksik dosya/bozuk JSON/eksik alan üç ayrı durumda da sessizce yok
  sayılıyor. `npm run check-types && npm run lint`, temiz koşu (157 unit
  + 51 integration), SonarQube sıfır açık bulgu.
- **`SUBSUMED_TEST` bulgusu** Test Kalitesi görünümünde çıkıyor ama
  mutasyon ağacıyla çapraz bağlanmadı (`PSEUDO_TESTED_METHOD` için bu
  köprü Faz 24'te kuruldu, §7.6 madde 5).

### 7.6 Faz 22 — elle inceleme bulguları (2026-08-28, iki ekran görüntüsüyle)

Kullanıcı gerçek bir Derin Tarama + Mutasyon Testi koşusundan sonra iki
ekran görüntüsünü karşılaştırmalı inceledi. Sayılar doğrulandı (JSON'la
tek tek karşılaştırıldı, hepsi tutarlı). Yedi madde bulundu, **1-3
kapandı**, 4-7 açık — öncelik kullanıcının kendi sıralaması.

**Kapandı:**
1. **Editördeki satır içi mesaj iki dilli ve kesiliyordu.**
   `diagnostics.ts`'in `message`'ı Türkçe başlık + CLI'ın ham İngilizce
   cümlesi + `suggestedAction`'ı tek satırda birleştiriyordu; bazı VS
   Code çatallarında satır sonuna aynen basılan bu metin ekranın dışına
   taşıyordu. Artık yalnızca `<Türkçe başlık>: <metot adı>` (metot yoksa
   sadece başlık). Tam detay zaten Test Kalitesi ağacının tooltip'inde
   aynı katalogdan geliyordu — burada tekrarlamak sadece tutarsızlık
   riski ekliyordu.
2. **Mutasyon panelinde "bu sonuç neyin, ne zaman?" yoktu.** Dosyadan
   dosyaya geçince panel değişmiyordu. Artık kökler her zaman bir
   `header` düğümüyle başlıyor: `Hedef: Calculator · 5 dakika önce`.
   Diskten geri yüklenmiş bir sonuçta (`ranAt` bilinmiyor, CLI zaman
   damgası taşımaz) `"kaydedilmiş sonuç - ne zaman çalıştığı bilinmiyor"`
   yazıyor — tahmini bir süre göstermek gerçek süreden daha yanıltıcı
   olurdu (hard rule 3a). `model/mutationModel.ts`'e `targetSummary`/
   `formatRelativeTime` (saf, test edilebilir) eklendi.
3. **"Kapsama" terminoloji kuralını çiğniyordu.** `package.json`'daki
   `coverdict.toggleCoverage` komut başlığı ve `coverdict.coverageView`
   görünüm adı hâlâ Türkçe "Kapsama" diyordu; `statusBar.ts` zaten
   İngilizce "coverage" kullanıyordu (Faz 19'un terminoloji geçişi
   `package.json`'ı atlamış). İkisi de "Coverage" oldu.
   `coverdict.show.oraclelessLines`'ın açıklaması da eski komut adlarına
   ("Kapsama + Hangi Test...") atıfta bulunuyordu — Faz 18'den beri
   geçerli olan "Derin Tarama"/"Bu Sınıf İçin Hangi Test Hangi Satırı
   Kapsıyor" adlarına güncellendi.

**Açık — öncelik kullanıcının belirlediği sıra:**
4. ~~**`Satır 4 · 14 test` gürültü.**~~ — **KAPANDI (Faz 24).** Gerçek
   playground verisiyle doğrulandı (`--per-test-target
   root=dev.coverdict.playground.Calculator`, 2026-08-28):
   `Calculator.java`'da elle yazılmış bir constructor yok, derleyicinin
   ürettiği parametresiz `<init>()`in tek instruction'ı sınıf bildirim
   satırına (satır 4) yazılıyor, nesne oluşturan 14 testin hepsi orada
   "kapsıyor" görünüyor.

   Gizlemek yerine etiketlendi: `model/lineIndex.ts`'in
   `testsForClass`'ı artık `linesToMethod`/`ambientLinesToMethod`
   döndürüyor (`PerTestEntry.methodName`'den, uydurma yok - bir satırı
   birden fazla metot iddia ediyorsa belirsiz sayılıp haritaya hiç
   girmiyor). `groupConsecutiveLines` artık metot adını da birleştirme
   kriterine katıyor (iki farklı metodun ardışık satırları aynı test
   kümesine sahip olsa bile artık tek aralıkta birleşmiyor).
   `lineTestsView.ts`'te `prodLine` düğümleri gerçek metot adını
   taşıyor; etiket `Satır 4 · <init>()` oluyor, `<init>` tek satırlık bir
   grup olduğunda tooltip'e "nesne oluşturan her test bu satırı da
   kapsar" açıklaması ekleniyor - "örtük"/"auto-generated" gibi
   ispatlayamayacağımız bir iddia yok, yalnızca gerçek veri.

   Doğrulama: yeni birim testleri (`lineIndex.test.ts`: `linesToMethod`,
   metot-farklı ardışık satırların artık ayrılması) ve gerçek playground
   şekliyle bir entegrasyon testi (`lineTestsView.test.ts`: 14 testli
   `<init>` satırı → etiket + tooltip). `npm run check-types && npm run
   lint`, temiz koşu (145 unit + 33 integration), SonarQube sıfır açık
   bulgu.
5. ~~**Test Kalitesi ve Mutasyon aynı kanıtı bağlantısız söylüyor.**~~ —
   **KAPANDI (Faz 24).** İki yönlü, gerçek veriyle çalışan bir köprü
   kuruldu. Test Kalitesi'nde bir `PSEUDO_TESTED_METHOD` bulgusuna sağ tık
   → "Mutasyon Ağacında Göster" o metodu mutasyon ağacında açıp seçiyor;
   Mutasyon ağacında hayatta kalan mutantlı bir metoda (yalnızca gerçekten
   eşleşen bir bulgu varsa) sağ tık → "Test Kalitesi'nde Göster" tersini
   yapıyor. Anahtar `Finding.productionMethod`'ın gerçek biçimi - canlı bir
   `--mutation-report` koşusundan doğrulandı (2026-08-28, üç ayrı metotla:
   `subtract`, `isPositive`, `square`):
   `"dev.coverdict.playground.Calculator#square(I)I"`
   (`FQCN#methodName(descriptor)dönüşTipi`), `MutatedMethod.methodDescription`
   ile birebir aynı format.

   `model/mutationModel.ts`'e `parseProductionMethod`/`productionMethodKey`/
   `findMutatedMethod` eklendi (saf, tam test edildi). Köprü, kuralı
   yeniden türetmiyor - gerçek `findings[]`'te eşleşen bir
   `PSEUDO_TESTED_METHOD` var mı diye bakıyor (CLI zaten hesapladı).
   `QualityTreeProvider`/`MutationTreeProvider`'a `getParent` eklendi
   (`reveal()`'in gerektirdiği); ikisi de artık `createTreeView` ile
   kayıtlı (`extension.ts`), stabil `TreeItem.id` taşıyorlar. Eşleşme
   yoksa (mutasyon verisi hiç yok ya da güncel değil) sessizce başarısız
   olmak yerine sebebini söylüyor (hard rule 3a) -
   `coverdict.qualityView.showInMutation`/`coverdict.mutationView.
   showInQuality` komutları.

   Doğrulama: gerçek playground verisiyle (`square`'in tek survived
   mutantı + gerçek `productionMethod` string'i) yeni birim ve entegrasyon
   testleri (`mutationModel.test.ts`, `mutationView.test.ts`,
   `treeViews.test.ts`). `npm run check-types && npm run lint`, temiz koşu
   (151 unit + 42 integration), SonarQube sıfır açık bulgu.
6. ~~**Gerçek bir çelişki arayüzde sessiz kalıyor.**~~ — **KAPANDI
   (Faz 24).** Gerçek playground verisiyle birebir doğrulandı
   (2026-08-28, `--mutation-report root=...Calculator`):
   `CalculatorUnresolvedOracleTest#addCheckedViaLocalSoftAssertions()`
   L0'da `NO_RECOGNIZED_ORACLE` (INCONCLUSIVE, AssertJ soft-assertion
   statik çözülemedi) ama `add()`'in tek mutantının `killingTests`'inde
   gerçekten var.

   `model/mutationModel.ts`'e `findKillContribution` eklendi (saf, tam
   test edildi): bir test kimliği verildiğinde, mutasyon bloğundaki
   **her** mutantın `killingTests`'ini `parseTestIdentity` ile normalize
   edip arıyor - kural yeniden türetilmiyor, kuralı zaten CLI hesapladı.
   "Satır → Testler"de bir `prodTest` düğümünün `verdict === 'inconclusive'`
   olduğu her yerde bu arama otomatik çalışıyor; eşleşme varsa tooltip'e
   "Mutasyon kanıtı bunu çürütüyor: ... bir mutantını (satır N) öldürdü"
   notu ekleniyor, `contextValue` `coverdict.prodTest.contradiction`
   oluyor ve sağ tık → "Mutasyon Ağacında Göster"
   (`coverdict.lineTestsView.showInMutation`) o metodu mutasyon ağacında
   açıp seçiyor. Ters yönde (bilgilendirme amaçlı, ayrı komut gerekmedi):
   mutasyon ağacındaki bir `killingTest` yaprağının gerçekten eşleşen bir
   `INCONCLUSIVE` bulgusu varsa tooltip'i aynı çelişkiyi hatırlatıyor.

   Eşleşme yoksa (mutasyon verisi hiç yok, ya da bu test hiçbir şey
   öldürmedi) sessizce hiçbir şey söylenmiyor - "çelişki var" iddiası
   yalnızca gerçekten kanıtlanmışsa gösteriliyor (hard rule 3a).

   Doğrulama: gerçek `add()`/`CalculatorUnresolvedOracleTest` şekliyle
   yeni birim testleri (`mutationModel.test.ts`) ve iki yönü de kapsayan
   entegrasyon testleri (`lineTestsView.test.ts`, `mutationView.test.ts`).
7. ~~**`negate()` "skor yok" fazla kapalı.**~~ — **KAPANDI (Faz 24).**
   `model/mutationModel.ts`'e `allMutantsNoCoverage` eklendi (saf,
   `every` - `some` değil, çünkü gerçek `describe()` verisi
   `NO_COVERAGE`+`SURVIVED` karışımı üretti ve karışık durumda "hiçbir
   test uğramıyor" iddiası yanlış olurdu). Bir metodun üretilen **her**
   mutantı `NO_COVERAGE` ise (gerçek `negate()` şekli) skor metni artık
   "skor yok" yerine "skor yok - hiçbir test bu metoda uğramıyor" diyor,
   tooltip de aynı sebebi tam cümleyle açıklıyor.

   Doğrulama: gerçek `negate()`/`describe()` şekilleriyle yeni birim
   testleri ve mutasyon ağacının bu metni doğru bastığını doğrulayan bir
   entegrasyon testi (`mutationView.test.ts`).

   **Bu üç maddenin ortak doğrulaması:** `npm run check-types && npm run
   lint`, temiz koşu (157 unit + 47 integration), SonarQube sıfır açık
   bulgu.

### 7.7 Mutasyon → Satır → Testler köprüsü (Faz 26, kullanıcı isteği) — **yapıldı**

Kullanıcının isteği: mutasyon listesinde bir mutanta tıklamak zaten
production satırına gidiyor ("Satıra Git") - ayrıca sağ tıkla "o
mutasyonu yakalayamayan teste" de gidilsin.

**Gerçek kısıt, kullanıcıya açıklandı ve kabul edildi:** `SURVIVED` bir
mutantın `killingTests`'i PIT tarafından **boş** yayınlanır - "başarısız
olan tek bir test" diye bir kayıt yok. Tek kanıt kaynağı `perTest`
(Derin Tarama ile toplanmışsa): o satırı **kapsayan** testler, ki
hiçbiri mutantı öldürmediği için hepsi "yakalayamayan" testlerdir.
"Satır → Testler" zaten tam bunu - kapsayan her testi oracle
kalitesiyle birlikte - gösterdiği için tekerleği yeniden icat etmek
yerine oraya yönlendirmek seçildi (3 seçenekten kullanıcının seçtiği).

Uygulama: `ui/treeViews/mutationView.ts`'in `mutantItem`'ı artık
`getPerTestState()` + `model/lineIndex.ts`'in `testsForClass`'ıyla o
satırın gerçekten bir `perTest` kaydı olup olmadığını kontrol ediyor;
varsa `contextValue` `coverdict.mutant.hasLineEvidence` oluyor ve sağ
tık → "Satır → Testler'de Göster" (`coverdict.mutationView.
showInLineTests`) production dosyasını o satırda açıp `lineTestsView`'ın
aktif dosyasını değiştiriyor, ardından `reveal()` ile o satırın düğümünü
açıp seçiyor. Kanıt yoksa (mutasyon var ama Derin Tarama hiç
çalıştırılmamış) sağ tık seçeneği hiç çıkmıyor - "boş bir köprü"
göstermektense hiç göstermemek (hard rule 3a).

Bunun için `CoverageSinks`'e `lineTestsTreeView: vscode.TreeView<
LineTestsNode>` eklendi (`extension.ts`'te `lineTestsView` zaten
`createTreeView` ile kayıtlıydı - Faz 15c'den beri `reveal()` için,
şimdi köprü komutu da aynı handle'ı kullanıyor).

Doğrulama: gerçek `square()`/`divide()` şekilleriyle (`square`'in
SURVIVED mutantı + gerçek bir Derin Tarama'nın `square` per-test kaydı,
ikisi de aynı satır 37) yeni entegrasyon testleri
(`mutationView.test.ts`) - kanıt varken köprü affordance'ı çıkıyor,
yokken (ne `divide` için ne de perTest hiç toplanmamışken) çıkmıyor.
`npm run check-types && npm run lint`, temiz koşu (157 unit + 54
integration), SonarQube sıfır açık bulgu.

---

## 8. Faz 20 — mutasyon testi arayüzü (**yapıldı**)

Kullanıcının isteği aynen: *"mutasyon testinde ne kadar ilerledi yüzde vs
kapsamlı rapor vs baya birşey istiyorum."* Aşağıdakiler uygulandı ve
gerçek playground verisiyle doğrulandı.

### 8.1 Nereden başlatılır

**Tek sınıf — önerilen ve varsayılan yol:** editör sağ tık → "Bu Sınıf
İçin Mutasyon Testi" (`coverdict.mutationForFile`) →
`--mutation-report --mutation-target root=<FQCN>`. Diff gerektirmez,
`--no-vcs`'te bile çalışır (D-71). Playground'da gerçek ölçüm: **5 saniye**.

**Modül geneli:** Çalıştır görünümünde "Mutasyon Testi"
(`coverdict.mutationForModule`), **modal onay diyaloğunun arkasında** —
metin bütçeyi de söyler. Asla otomatik tetiklenmez: büyük bir modülde
`ROADMAP.md`'ye göre 70–90 dakika sürebiliyor. `no-vcs` modunda modül
geneli koşu devre dışı (hedef türetecek diff yok) ve bunu söylüyor.

### 8.2 İlerleme — `cli/progressParser.ts` yazıldı

Saf modül. `parseProgressLine(line)` → `ProgressEvent | undefined`
(`start` / `heartbeat` / `done` / `failed`). §2'deki gerçek satır
biçimlerini ayrıştırır; **tanımadığı satırı yutmaz**, `undefined` döner ve
`ui/commands.ts` onu Output'a aynen yazar (hard rule 3a).

`ui/commands.ts`'te bugüne kadar alınıp hiç kullanılmadan atılan
`withProgress` progress nesnesine bağlandı. `incrementFor` **fark** üretir
(VS Code mutlak yüzde değil artış ister) ve toplam bilinmiyorsa hiç artış
yayınlamaz — uydurma bir ilerleme çubuğu, olmamasından kötüdür.

Heartbeat 30 saniye olduğu için yüzde dakikada en çok iki kez ilerler; bu
yüzden **geçen süre her zaman yazılır**, yoksa arayüz donmuş görünür.
Bu iyileştirme derin taramaya da bedava geldi.

### 8.3 9 PIT statüsü → 3 kova

| Kova | Statüler |
|---|---|
| **öldürüldü** | `KILLED`, `TIMED_OUT` |
| **hayatta kaldı** | `SURVIVED` |
| **belirsiz** | `NON_VIABLE`, `MEMORY_ERROR`, `NOT_STARTED`, `STARTED`, `RUN_ERROR`, `NO_COVERAGE` + **tanımadığımız her statü** |

Belirsiz olan asla ilk iki kovaya katlanmaz ve asla gizlenmez. Skor
`öldürülen / (öldürülen + hayatta kalan)`; belirsiz sayısı yanında ayrıca
yazılır. Karara bağlanmış mutant yoksa yüzde `null` — "skor yok" gösterilir,
"%0" değil.

`TIMED_OUT` = öldürüldü, PIT'in kendi geleneği (kullanıcı onayladı).
Eşleme `model/mutationModel.ts`'te **tek bir sabit listede**: fikir
değişirse tek satır. Dokuz statünün hepsi tek tek test ediliyor.

### 8.4 İptal — süreç ağacı öldürülüyor

`runner.ts:cancel` artık `killTree`: Windows'ta `taskkill /PID <pid> /T /F`,
POSIX'te `spawn(..., { detached: true })` + `process.kill(-pid)`. Çıplak
`SIGTERM` PIT'in çocuk JVM'lerini ("minion") arkada bırakıyordu.
`withProgress` zaten `cancellable: true`.

### 8.5 Rapor yüzeyi — `coverdict.mutationView`

Sınıf → metot → mutant → **öldüren testler**. Metot ve sınıf düğümlerinde
skor; hayatta kalanı olan metot uyarı ikonu alır. Mutanta tıklamak satıra
gider. Öldüren testler `verdict/testIdentity.ts` üzerinden okunabilir
adlarıyla gösterilir. Başlıkta "sadece hayatta kalan mutantlar" süzgeci.
Kanıt yoksa **hangi** `MUTATION_*` uyarısının sebep olduğu ve çözümü
yazılır. Classpath için Faz 19'un `cli/classpathBuilder.ts`'i aynen
kullanılıyor.

### 8.6 Gerçek veri iki sürpriz çıkardı — ikisi de belgeden okunamazdı

1. **`mutator` tam sınıf adı.** Şemanın golden örneği kısa `TRUE_RETURNS`
   gösteriyor; gerçek çıktı
   `org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator`.
   Etikette son parça + `Mutator` soneki atılmış hâli, tooltip'te tam adı.
2. **PIT test sınıflarını da mutasyona sokuyor.** Tek bir
   `--mutation-target root=...Calculator` koşusunda üretilen 16 metodun
   8'i test sınıflarındandı. Süzülmeseydi ağaç `CalculatorSubsumedTest`'in
   kendi mutant skorunu gösterirdi. `perTest.entries`'teki aynı tuzağın
   (§7.1) mutasyon tarafındaki eşi — süzgeç yine `fileCoverage.files[]`.

---

## 9. Doğrulama listesi

Herhangi bir değişiklikten sonra, sırayla:

1. `npm run check-types && npm run lint`
2. Temiz koşu (§5) — unit ve integration testleri **geçmeli**; sayı
   düşmüşse bir testi kazara sildin demektir.
3. Gerçek playground verisiyle elle Extension Host kontrolü (F5). Sentetik
   veriyle "çalışıyor" demek bu projede yeterli sayılmadı — Faz 18'in
   rozet hatası tam olarak böyle gözden kaçmıştı.
4. SonarQube taraması (§5) — **yeni bulgu sıfır**.
5. Küçük, açıklayıcı bir commit. **Push yok.**
6. Kullanıcıya raporla: ne değişti, ne doğrulandı, ne hâlâ açık.

---

## Ek A: neden native VS Code Test Coverage API kullanılmıyor

Faz 9'da araştırıldı ve kapatıldı; tekrar açma. `@types/vscode` 1.134.0
ile gerçek VS Code 1.135.0 `vscode.d.ts` (başlık yorumu dışında bayt bayt
aynı) okundu:

- **Yayınlanmış coverage silinemiyor.** `TestRun`'ın tek coverage üyesi
  `addCoverage`; `clearCoverage`/`removeCoverage`/`resetCoverage` yok.
- **Explorer rozeti ile gutter ayrı kontrol edilemiyor.** `coverage` geçen
  62 satırın hiçbirinde badge/gutter/decoration ayrımı yok.
- Belgelenmiş bir `testing.*` komut id'si de yok.

Yani `show.explorerBadges` / `show.lineGutter` ayarlarının bağımsız
çalışması native API ile **mümkün değil**. Bu yüzden eklenti kendi
`TextEditorDecorationType`'larını ve kendi `FileDecorationProvider`'ını
kullanıyor. Yan fayda: native API `Notifier.java` gibi 0 çalıştırılabilir
satırlı bir dosyaya "%100" diyordu — hard rule 3a ihlali; kendi
çizicimizde bu dosya doğru şekilde rozetsiz kalıyor.

## Ek B: tarihsel kayıt

`docs/NOTES.md` Faz 12'den Faz 20'ye kadar her elle test oturumunun
bulgularını kronolojik tutar — bir kararın **neden** öyle alındığını merak
edersen oraya bak. İçindeki maddelerin çoğu kapandı; **açık olanların
güncel listesi §7'dedir**, NOTES.md'de değil.

Kod ve notlar boyunca geçen `D-xx` işaretleri `coverdict` reposunun
`docs/DECISIONS.md` dosyasındaki karar numaralarıdır (D-01…D-71).
