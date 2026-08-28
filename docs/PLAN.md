# coverdict-vscode — devir belgesi ve ileri plan

**Son güncelleme:** 2026-08-28, Faz 21 sonrası.

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
`STARTED`, `RUN_ERROR`, `NO_COVERAGE`.

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
| `cli/classpathBuilder.ts` | Maven'ı çalıştırıp `target/coverdict-classpath.txt`'i üretir (Faz 19). |
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
| `model/ruleCatalog.ts` | 6 rule için Türkçe başlık/özet/eylem. |
| `model/warningCatalog.ts` | Uyarı kodları için Türkçe açıklama; ham mesaj tooltip'te korunur. |
| `ui/commands.ts` | En büyük dosya. 8 komut, koşu orkestrasyonu, `paintCoverage`, classpath otomatik üretimi. |
| `ui/gutterRenderer.ts` | Tek gutter çizici. 6 durum: covered · partial · uncovered · oracleless (turuncu) · excluded · stale. |
| `ui/explorerBadges.ts` | Explorer rozetleri. Dosya yüzdesi CLI'dan, klasör rollup'tan. |
| `ui/hoverProvider.ts` | Çift yönlü hover: production satırında "hangi testler + kaliteleri", test metodunda "hangi production satırları". |
| `ui/diagnostics.ts` | Bulguları Problems paneline yazar; `severity` ile `confidence`'ı ayrı tutar. |
| `ui/statusBar.ts` | Özet yüzde; `fileCoverage` bloğunun hiç olmadığını bildiren **tek** yüzey. |
| `ui/testFileLocator.ts` | Test dosyasını bulur; bulamazsa **tahmin etmez**, `undefined` döner. |
| `ui/treeViews/runView.ts` | Çalıştır görünümü. |
| `ui/treeViews/coverageView.ts` | Overall / new code / uncovered new ranges / Uyarılar. |
| `ui/treeViews/qualityView.ts` | Bulgular; rule↔dosya gruplama, serbest metin filtre. |
| `ui/treeViews/lineTestsView.ts` | Satır → Testler; aralık gruplama, "sadece sorunlu satırlar" filtresi. |

**Silinmiş, tekrar yazma:** `src/ui/panelView.ts` (webview paneli, Faz
15c'de kaldırıldı — kendi kendini boşaltıyordu; yerine hover + TreeView).

**Henüz yazılmamış ama koda yorum olarak söz verilmiş:**
`src/cli/progressParser.ts` — Faz 20'de yazılacak (§8.2).

---

## 4. Bugünkü durum (Faz 19)

Activity Bar'da `coverdict` konteyneri, içinde **4 görünüm**:

1. **Çalıştır** — "Hızlı Tarama" (coverage + oracle bulguları, saniyeler),
   "Derin Tarama" (üstüne L2: hangi test hangi satırı çalıştırıyor, PIT
   ile, daha uzun), "Coverage Görünümü" aç/kapat. **Derin Tarama mutasyon
   testi değildir** — tooltip'i bu cümleyle başlar, çünkü kullanıcı bunu
   sordu.
2. **Coverage** — overall (üç metrik), new code, uncovered yeni satırlar
   (tıklanınca gider), Uyarılar (Türkçe açıklamalı).
3. **Test Kalitesi** — bulgular; başlıkta iki düğme: serbest metin filtre
   ve rule↔dosya gruplama geçişi (tek düğme, tıkladıkça değişir).
4. **Satır → Testler** — aktif Java dosyası için; ardışık ve aynı testlerce
   kapsanan satırlar **tek düğümde** birleşir (`Satır 9-11`); başlıkta
   "sadece sorunlu satırlar" süzgeci (varsayılan kapalı).

### Komutlar (8)

`coverdict.analyze` (Hızlı Tarama) · `coverdict.analyzePerTest` (Derin
Tarama) · `coverdict.toggleCoverage` · `coverdict.perTestForFile` (editör
sağ tık, Java) · `coverdict.copyItem` (ağaçlarda sağ tık → Kopyala) ·
`coverdict.qualityView.filter` · `coverdict.qualityView.toggleGrouping` ·
`coverdict.lineTestsView.toggleProblemsOnly`.

### Ayarlar (12)

| Ayar | Varsayılan |
|---|---|
| `coverdict.jarPath` | `""` (arama sırası devreye girer) |
| `coverdict.javaExecutable` | `"java"` |
| `coverdict.mavenExecutable` | `""` → Windows'ta `mvn.cmd`, diğerinde `mvn` |
| `coverdict.reportPath` | `"target/site/jacoco/jacoco.xml"` |
| `coverdict.perTestClasspathPath` | `"target/coverdict-classpath.txt"` |
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

107 unit + 22 integration test geçiyor. SonarQube (`coverdict-vscode`,
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
- **Terminoloji:** `coverage`/`covered`/`uncovered` çevrilmez (§3, kural 4).

---

## 7. Açık işler (öncelik sırasıyla)

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

### 7.4 Faz 20 — mutasyon testi arayüzü

§8.

---

## 8. Faz 20 — mutasyon testi arayüzü (öneriler, onaya hazır)

Bugün arayüz **hiç yok**; Faz 12'den beri sırada. CLI tarafı D-71 ile
hazır. Kullanıcının isteği aynen: *"mutasyon testinde ne kadar ilerledi
yüzde vs kapsamlı rapor vs baya birşey istiyorum."*

Aşağıdaki maddeler **öneridir**; uygulamadan önce kullanıcı onayı alınır.

### 8.1 Nereden başlatılır — ayrı üçüncü buton + sınıf bazlı giriş

Çalıştır görünümüne üçüncü madde: **"Mutasyon Testi"**. **Asla otomatik
tetiklenmez** — tek sınıf saniyeler sürerken büyük bir modül `ROADMAP.md`'ye
göre 70–90 dakika sürebiliyor.

Varsayılan ve önerilen yol **tek sınıf**: editör sağ tık → "Bu Sınıf İçin
Mutasyon Testi" → `--mutation-report --mutation-target root=<FQCN>`.
Diff gerektirmez, `--no-vcs`'te bile çalışır.

Modül geneli koşu ayrı bir onay diyaloğunun arkasında dursun: *"Bu koşu
1 saati aşabilir. Devam?"*

### 8.2 İlerleme — `cli/progressParser.ts` nihayet yazılır

Saf modül (`vscode` import etmez), tek fonksiyon:

```ts
parseProgressLine(line: string):
  { kind: 'mutation' | 'perTest'; moduleId: string; done: number; total: number; elapsed: string } | undefined
```

§2'deki gerçek satır biçimlerini parse eder. **Tanımadığı satırı yutmaz** —
`undefined` döner ve çağıran onu Output'a aynen yazar (hard rule 3a).

`ui/commands.ts`'te bugün alınıp hiç kullanılmadan atılan `withProgress`
progress nesnesine bağlanır:

```ts
progress.report({ increment, message: `${done}/${total} sınıf · ${elapsed}` });
```

Heartbeat 30 saniye olduğu için yüzde dakikada en çok iki kez ilerler —
bu yüzden **geçen süre her zaman yazılır**, yoksa arayüz donmuş görünür.

### 8.3 9 PIT statüsü → 3 kova (hard rule 3a)

| Kova | Statüler |
|---|---|
| **öldürüldü** | `KILLED`, `TIMED_OUT` |
| **hayatta kaldı** | `SURVIVED` |
| **belirsiz** | `NON_VIABLE`, `MEMORY_ERROR`, `NOT_STARTED`, `STARTED`, `RUN_ERROR`, `NO_COVERAGE` |

Belirsiz olan **asla** ilk iki kovaya katlanmaz ve **asla** gizlenmez.
Skor `öldürülen / (öldürülen + hayatta kalan)` gösterilir, belirsiz sayısı
yanında ayrıca yazılır.

*Tek tartışmalı nokta:* `TIMED_OUT`'u öldürüldü saymak PIT'in kendi
geleneğidir (mutant kodu sonsuz döngüye soktu = tespit edildi). Kullanıcı
isterse belirsize alınır — kod bu eşlemeyi **tek bir sabit listeden**
okusun ki değiştirmek tek satır olsun.

### 8.4 İptal — `runner.ts:cancel` bugün çıplak `SIGTERM`, yetmez

PIT çocuk JVM'ler (minion) doğurur; Windows'ta yalnızca ana süreci
öldürmek onları arkada bırakır. Gereken:

- Windows: `taskkill /PID <pid> /T /F`
- POSIX: `spawn(..., { detached: true })` + `process.kill(-pid)`

`withProgress` `cancellable: true` olur ve `CancellationToken` buraya
bağlanır. Saatlerce sürebilen bir işlemde bu **şarttır**, sonraya
bırakılamaz.

### 8.5 Rapor yüzeyi — beşinci TreeView `coverdict.mutationView`

Hiyerarşi: **sınıf → metot → mutant**. Metot düğümünde `3/4` özeti (+
belirsiz sayısı ayrıca). Mutanta tıklayınca ilgili satıra gidilir.
`killingTests[]` `verdict/testIdentity.ts` üzerinden okunabilir hâle
getirilir — `model/testQuality.ts`'in `findings` ↔ `perTest` birleştirme
deseninin aynısı.

Classpath için Faz 19'un `cli/classpathBuilder.ts`'i **aynen** kullanılır
(`--mutation-classpath`), yeni kod gerekmez.

**Gutter'a 7. durum eklenmez** — önce ağaç çalışsın, gutter sonra
tartışılır.

### 8.6 Commit bölümlemesi

`progressParser` + birim testleri → süreç ağacı iptali → mutasyon ağacı →
elle doğrulama. Her biri kendi commit'i.

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
