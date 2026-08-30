# coverdict-vscode — devir belgesi ve ileri plan

**Son güncelleme:** 2026-08-31, Faz 32 (§7.10): "Raporu Dışa Aktar" (HTML) -
CLI'a üçüncü bir okuyucu (`HtmlRenderer`, offline tek dosya, açık/koyu tema,
katlanabilir+filtrelenebilir bölümler) ve ikinci bir komut (`render-html`,
sadece render eder, yeniden analiz yapmaz) eklendi; VS Code'un export
komutu artık hiç yeniden taramıyor, `verdict-current.json` +
`pertest-current.json`/`mutation-current.json`'ı birleştirip doğrudan
render ediyor - gerçek kullanıcı testi ilk sürümün boş bir yeniden-taramayla
kenar çubuğundaki gerçek veriyi sessizce eziyor olduğunu ortaya çıkardı
(D-73/D-74'ün bir kez düzelttiği hatanın aynısı). Ayrıntı: `coverdict`
reposunun `docs/DECISIONS.md`'sinde D-75..D-79.

---

**Önceki güncelleme:** 2026-08-29, Faz 30 (§7.9): gson'a karşı yapılan ikinci
tur gerçek dogfood'un çıkardığı dört sorunun (ön koşullar sessiz, rapor
yoksa öneri yok, kolay tekrar-koş yok, çok-modülde tek bir "listeden seç"e
zorlanma) hepsi tek bir bütçede çözüldü: her modül tek koşuda birden bağlanır
(`showQuickPick` tamamen kalktı), classpath eksikse `doctor --fix`
çağrılır, JaCoCo raporu yoksa Maven **görünür bir VS Code Task** olarak
kendisi çalıştırılabilir (argLine tuzağı önceden tespit edilir), Maven
gerçekten başarısız olunca CLI'ın kendi stderr'i yorumlanıp Türkçe, eyleme
dönüştürülebilir bir sebep gösterilir (D-67'nin kardeş-modül tuzağı için
`mvn install -DskipTests` düğmesi dahil), ve çok-modüllü bir mutasyon/derin
tarama koşusunda ilerleme çubuğu artık modül geçişlerinde donmuyor. 5 commit,
212 unit + 57 integration, SonarQube kalite kapısı OK. Önceki: 2026-08-29,
Faz 29 (§7.8, iki geçiş): gson dogfood'unun ortaya çıkardığı çok-modül
workspace-kökü boşluğu düzeltildi, sonra kullanıcının aynı gün verdiği
gerçek geri bildirimle (ekran görüntüsüyle) ikinci kez düzeltildi - ilk
versiyon ilgisiz repoları (`coverdict-corpus`) tek bir çok-modüllü projeyle
(`gson`) ayırt etmiyordu, ikisini de aynı düz "hangi jacoco.xml" listesine
koyuyordu.

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

169 unit + 57 integration test geçiyor (Faz 29, iki geçiş - önceki
157+57'ye `reportDiscovery`/`argsBuilder`'ın 12 yeni testi eklendi).
SonarQube (`coverdict-vscode`, `http://localhost:9001`) sıfır açık bulgu,
kalite kapısı **OK** (Faz 27,
§7.4).

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
sonar-scanner -Dsonar.host.url=http://localhost:9001 -Dsonar.token=$SONAR_TOKEN -Dsonar.projectKey=coverdict-vscode -Dsonar.sources=src -Dsonar.exclusions=**/*.test.ts,out/**,dist/**,.vscode-test/** -Dsonar.coverage.exclusions=src/ui/** -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info
```

Sonuçlar SonarQube MCP araçlarıyla okunur
(`search_sonar_issues_in_projects`, `get_project_quality_gate_status`).
Yeni bulgu **sıfır** olmalı; bu repoda Sonar temizliği duran bir kısıttır.

**Kalite kapısı hakkında bilinmesi gereken (§7.4, Faz 27 - denendi,
gerçek bir ortam kısıtına takıldı):** `new_violations` ve
`new_security_hotspots_reviewed` geçiyor; `new_coverage` için önce
Extension Host'u gerçekten enstrümante etmek denendi -
`.vscode-test.mjs`'e `@vscode/test-cli`'ın kendi `coverage` yapılandırması
eklendi (`npm run test:integration:coverage`, `vscode-test --coverage`),
`@vscode/test-cli`/`@vscode/test-electron` en son sürüme yükseltildi
(0.0.10→0.0.15, 2.4.1→3.1.0 - 157 unit + 54 integration test hâlâ
geçiyor, düzeltme koşullarını bozmadı). Ama gerçekte çalıştırınca:
`NODE_V8_COVERAGE`, Extension Host sürecinden bu ortamda (Windows) hiçbir
kapsama verisi üretmiyor - iki araç sürümünde de "Unknown% (0/0)". Bu bir
yapılandırma hatası değil, gerçek bir Electron/ortam kısıtı gibi duruyor
(kullanıcıyla doğrulandı, 2026-08-28). Altyapı **bırakıldı** (zararsız -
`--coverage` bayrağı verilmeden hiçbir şeyi etkilemiyor, Linux CI gibi
farklı bir ortamda tekrar denenebilir), ama kapıyı şimdilik açık tutmak
yerine `sonar.coverage.exclusions=src/ui/**` eklendi - dürüst seçenek
(kullanıcının 3 seçenekten seçtiği): `src/ui/**` gerçek Extension Host
testleriyle test ediliyor, "test edilmemiş" demek değil, sadece Sonar'ın
coverage hesabına giremiyor.

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

### 7.4 ~~Sonar kalite kapısı `new_coverage` yüzünden ERROR~~ — **KAPANDI (Faz 27)**

Yapısal bir hataydı, yeni bir hata değil: UI kodunun coverage'ı hiç
ölçülmüyordu. Kullanıcı 2. seçeneği (doğru çözüm) istedi, denendi -
**gerçek bir ortam kısıtına takıldı, sonra 1. seçeneğe düşüldü.**

**Denenen (2): Extension Host'u gerçekten enstrümante et.**
`@vscode/test-cli`'ın kendi `coverage` yapılandırması `.vscode-test.mjs`'e
eklendi (c8 tabanlı, `--coverage` bayrağıyla; `npm run
test:integration:coverage` script'i), `@vscode/test-cli`/`@vscode/
test-electron` en son sürüme yükseltildi (0.0.10→0.0.15, 2.4.1→3.1.0 -
157 unit + 54 integration test yükseltmeden sonra da geçti, regresyon
yok). Ama gerçekte çalıştırınca: `NODE_V8_COVERAGE`, Extension Host
sürecinden bu ortamda (Windows) hiçbir kapsama verisi üretmiyor - hem
eski hem yeni araç sürümünde "Unknown% (0/0)". Bu bir yapılandırma
hatası değil; muhtemelen Electron'un bu ortamdaki süreç/sandbox
davranışıyla ilgili gerçek bir kısıt (kullanıcıyla doğrulandı,
2026-08-28).

Altyapı **kaldırılmadı** - `--coverage` bayrağı verilmeden
`test:integration`'ı hiçbir şekilde etkilemiyor, zararsız; farklı bir
ortamda (ör. Linux CI) tekrar denenebilir bir başlangıç noktası olarak
duruyor.

**Uygulanan (1): `sonar.coverage.exclusions=src/ui/**`.** Dürüst
seçenek - `src/ui/**` gerçek Extension Host testleriyle test ediliyor,
bu "test edilmemiş" demek değil, sadece Sonar'ın coverage hesabına
giremiyor. Sonuç: kalite kapısı artık **OK**
(`new_coverage`: %88.4, eşik %80; `new_violations`: 0; `new_duplicated_
lines_density`: %0; `new_security_hotspots_reviewed`: %100).

Komut ve gerekçe §5'te (SonarQube bölümü) güncel.

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
- ~~**Aynı hatanın perTest ikizi.**~~ — **KAPANDI (Faz 28, §7.5b).**
  Faz 25'in commit'i pushlanmadan kullanıcı hemen ardından **aynı hatanın
  perTest yüzünü** canlı yakaladı (2026-08-28): Hızlı Tarama → Derin
  Tarama → Mutasyon Testi sırayla çalıştırıldı (üçü de gerçek veri
  üretti, ekranda doğrulandı), pencere **kapatılıp yeniden açıldı**
  (Reload Window değil, gerçek kapat/aç) - "Satır → Testler" boştu.
  Disk'teki gerçek `verdict-current.json` incelenerek kök nedeni
  doğrulandı: Mutasyon Testi `--per-test-report` içermiyor, son koşu
  olduğu için `verdict-current.json`'ı perTest'siz üzerine yazdı - Derin
  Tarama'nın topladığı perTest verisi hiçbir yerde disk'e kalıcı
  yazılmamıştı.

  Aynı reçete uygulandı: perTest de artık kendi dosyasında,
  `pertest-current.json` (`ui/commands.ts`'in ortak
  `writeJsonSnapshot`'ı - mutasyonla kod tekrarını önlemek için Faz 25'in
  `writeMutationSnapshot`'ı bu ortak fonksiyona indirgendi).
  `extension.ts`'in `restorePerTestSnapshot`'ı `verdict-current.json`'dan
  bağımsız, kendi erken `return`'lerinden etkilenmeyen bir adımda
  çalışıyor; başarıyla geri yüklerse `verdict-current.json`'ın
  (muhtemelen perTest'siz) kendi bloğu onu **ezmez** - hangisi varsa o
  kalır. `verdict/parse.ts`'in `isPerTestBlock`'u da `isMutationBlock`
  gibi dışa açılıp doğrulamada yeniden kullanıldı.

  Doğrulama: gerçek senaryoyu birebir kuran yeni entegrasyon testleri -
  `verdict-current.json`'da hiç `perTest` bloğu yokken (gerçek bir
  Mutasyon Testi çıktısının şekli) `pertest-current.json`'dan doğru geri
  yükleniyor; dosya yoksa/bozuksa eski davranışa (`verdict-current.json`'ın
  kendi bloğu) sessizce düşülüyor. Düzeltmeden önce testin **kırmızı**
  başladığı elle doğrulandı (geçici olarak `perTestRestored = false`
  yapılıp koşuldu). `npm run check-types && npm run lint`, temiz koşu
  (157 unit + 57 integration), SonarQube sıfır açık bulgu.
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

### 7.8 gson dogfood (2026-08-29) — çok-modül workspace kökü **düzeltildi**, iki UX sürtünmesi

`coverdict-corpus/gson`'da (google/gson'ın çok-modül checkout'u) ilk gerçek
dış-repo VS Code dogfood'u denendi. Kullanıcı `coverdict.jar` bulunamadı ve
JaCoCo raporu bulunamadı uyarılarıyla karşılaştı; ikinci uyarının kökü
araştırıldı ve **gerçek, mimari bir boşluk** bulundu, ilki iki UX isteğine
dönüştü.

**Bulunan gerçek boşluk — eklentinin çok-modül/standart-olmayan yerleşim
desteği yok.** Kullanıcı VS Code'u checkout'un **kökünde**
(`coverdict-corpus/gson`) açtı; gerçek JaCoCo raporu alt modülde
(`gson/gson/target/site/jacoco/jacoco.xml`), kök pom sadece agregatör.
`coverdict.reportPath`'i elle düzeltmek bile yetmezdi: `argsBuilder.ts`
kendi yorumunda zaten itiraf ediyor - *"Single-module shorthand only for
now [...] multi-module bindings [...] land with F8's config UI, when there
is a real multi-module case to build it against"* - yani `--module`/
`--source-roots`/`--test-roots` hiç yok, CLI'ın `M0-CLI-INPUT.md`'de
belgelenen çok-modül bağlamasının eklenti tarafı hiç inşa edilmemiş.
`--repo` her zaman workspace kökü, kaynak/test kökleri her zaman
`<repo>/src/main/java`/`src/test/java` varsayılıyor - `--repo` gerçek
modülün kendisi değilse bu sessizce yanlış.

**Bu oturumda uygulanan geçici çözüm (eklenti değişmedi):** VS Code'da
checkout kökü yerine **alt modülün kendisi** (`coverdict-corpus/gson/gson`)
ayrı bir klasör olarak açıldı - `coverdict.reportPath`'in varsayılanı
(`target/site/jacoco/jacoco.xml`) orada doğrudan doğru dosyaya denk geliyor,
kaynak/test kökü varsayımları da doğru. `gson/gson/.vscode/settings.json`
dış klasörün ayarlarının (jarPath, JDK 17 env) bir kopyası olarak eklendi.
Bu, "her repoda farklıysa sorun yaşarız" endişesinin ilk gerçek örneği -
gerçek çok-modül düzen için `doctor`'ın CLI tarafında zaten çözdüğü sorunun
aynısı eklenti tarafında hiç çözülmemiş.

**Düzeltildi, aynı oturumda (Faz 29).** Tam F8'i beklemeden, dar ve gerçek
bir fix: `cli/reportDiscovery.ts` (saf, `vscode` import etmiyor) +
`ui/commands.ts`'teki yeni `resolveReportBinding()`. `runAnalyzeCore`
(Hızlı/Derin/Mutasyon Testi'nin **hepsinin** paylaştığı tek çekirdek)
`coverdict.reportPath` workspace kökünde yoksa artık pes etmiyor:
`vscode.workspace.findFiles('**/target/site/jacoco/jacoco.xml', ...)` ile
arama yapıyor.

- **0 eşleşme** → eski davranış, aynı hata mesajı (`offerToOpenSetting`).
- **1 eşleşme** → otomatik bağlanır, ama **sessizce değil**: Output'a satır
  + bir bilgi bildirimi ("`'gson' modülüne otomatik bağlanıldı`").
- **2+ eşleşme** → asla tahmin etmez (hard rule 3a) - `showQuickPick` ile
  kullanıcıya sorar.

Modül kökü keşfedilen rapor yoluna göre çıkarılır
(`<kök>/target/site/jacoco/jacoco.xml` deseninden), ama **modül id'si her
zaman `'root'` kalır** - `MODULE_ID` sabiti L2/L3 classpath bağlama, tree-view
arama ve state anahtarları boyunca zaten sabit `'root'` varsayıyor; farklı
bir id analyze'i doğru modüle bağlarken per-test/mutation akışlarını
`--module` ile eşleşmeyen bir id'yle çağırıp CLI'da reddedilmeye yol açardı.
`argsBuilder.ts`'e eklenen opsiyonel `module: {id, root}` alanı verilince
`--report` çıplak biçimden `<id>=<path>`'e döner ve `--module <id>=<root>`
eklenir; verilmezse eski tek-modül davranışı **birebir korunur** (mevcut
tüm testler değişmeden geçti).

**Gerçek gson checkout'una karşı uçtan uca doğrulandı** (checkout kökünde
6 alt modülün her birinde kendi `jacoco.xml`'i var - QuickPick senaryosunun
kendisi): eklentinin üreteceği birebir komut
(`--repo <kök> --no-vcs --module root=gson --report root=gson/target/site/jacoco/jacoco.xml`)
elle çalıştırıldı, exit 0, **33 bulgu** - `validation/runs/gson/`'daki D-31/
D-33 sonrası kalibrasyon sonucuyla birebir aynı sayı. 165 unit + 57
integration test (önceki 157 + 8, hepsi geçti) hiçbir regresyon göstermedi.

Artık gereksiz ama zararsız: `gson/gson/.vscode/settings.json` (bu
oturumun ilk, elle klasör-değiştirme geçici çözümü) - checkout'un kökünü
açmak artık QuickPick'ten "gson" seçmekle aynı sonucu veriyor, alt modülü
ayrıca açmaya gerek yok.

**Aynı gün, kullanıcı geri bildirimiyle ikinci bir düzeltme gerekti - ilk
versiyon yanlış soruyu soruyordu.** Kullanıcı gerçek ekran görüntüsüyle
gösterdi: `coverdict-corpus`'u (assertj/dropwizard/gson/junit-framework -
dört **birbirinden bağımsız** git checkout'u, ortak hiçbir pom/git'i yok)
açsaydı, ilk versiyon bu dört reponun **hepsindeki** `jacoco.xml`'leri tek
bir düz listede karışık gösterip "hangisini istersiniz" diye soracaktı -
kullanıcının kendi sözleriyle *"saçma değil mi?"* Haklı: ilgisiz repolar
arasında seçim yapmanın hiçbir ilkeli yolu yok, bunu bir seçenekmiş gibi
sunmak hard rule 3a'ya aykırı.

Kök neden: kör `**/jacoco.xml` taraması iki tamamen farklı şekli
birbirine karıştırıyordu - "bu klasör tek bir çok-modüllü proje, hangi
modül?" (gson: kendi kök `pom.xml`'i gerçek `<modules>gson, test-jpms,
...</modules>` bildiriyor, her aday gerçekten aynı projeye ait) ile "bu
klasör sadece birkaç ilgisiz reponun yan yana durduğu bir dizin"
(`coverdict-corpus`: kendi pom.xml/build.gradle/git'i hiç yok).

**Düzeltme:** `reportDiscovery.ts`'e `isProjectRoot()` (workspace kökünde
`pom.xml`/`build.gradle[.kts]`/`settings.gradle[.kts]` var mı) ve
`describeSiblingProjects()` eklendi - ikisi de saf. `resolveReportBinding()`
artık önce bunu soruyor:
- **Kök kendi başına bir proje değilse** → glob'a hiç girmiyor, bir seviye
  altındaki klasörlere bakıyor (aynı işaretçiler + `.git`), bulduğu her
  bağımsız projeyi **isimle** listeleyip "hangisini analiz etmek
  istiyorsanız onu ayrı workspace kökü olarak açın" diyor - **hiçbirini
  seçmiyor**.
- **Kök kendi başına bir proje ise** (gson gibi) → eski glob+QuickPick akışı
  çalışır, artık meşru çünkü bulunan her rapor gerçekten aynı projenin
  parçası. QuickPick etiketi de iyileştirildi: ham dosya yolu yerine modül
  kök adı (`gson`, `extras`, ...) gösteriliyor, başlık "birden fazla JaCoCo
  raporu bulundu" yerine "bu proje çok modüllü - hangi modül taransın?"
  diyor - rastgele dosya keşfi değil, kasıtlı proje yapısı izlenimi veriyor.

Gerçek dosya sistemine karşı doğrulandı (derlenmiş `reportDiscovery.js`
doğrudan çalıştırılarak, `vscode` API'sini taklit eden küçük bir script'le):
`coverdict-corpus` kökünde açılınca artık **hiç seçim sunmuyor**, doğrudan
"bu klasör kendisi tek bir proje değil - içinde 4 farklı proje bulundu:
assertj, dropwizard, gson, junit-framework" diyor;
`coverdict-corpus/gson`'da ise (gerçek 7-modüllü reactor) eski, doğru
davranış aynen sürüyor. 169 unit + 57 integration (169 = önceki 165 + bu
ikinci düzeltmenin 4 yeni testi), SonarQube kalite kapısı OK.

**Hâlâ backlog, gerçek bir sonraki adım (F8'in asıl kapsamı):**
- ~~Birden fazla modülü **aynı koşuda** birlikte bağlamak~~ — **KAPANDI
  (Faz 30, §7.9):** `showQuickPick` tamamen kalktı, bulunan her modül tek
  koşuda birden bağlanıyor.
- `doctor`'ın ürettiği `coverdict.config.json`'u (D-40/D-66) okuyup
  kullanma - **Faz 30'da da yapılmadı, bilinçli olarak ertelendi** (§7.9,
  "ertelenenler"): eklenti hâlâ her koşuda kendi keşfini tekrarlıyor, dosya
  yalnızca `doctor --write-config` ile üretiliyor ve elle düzenlenebiliyor.

**UX isteği 1 (kullanıcı, 2026-08-29) — bu oturumda ayrıca düzeltildi.**
`coverdict.jar` bulunamadı hatası **zaten** `offerToOpenSetting` kullanıyordu
(rapor-bulunamadı hatasıyla aynı "Ayarı Aç" düğmesi) - meğer yalnızca jar
mesajı bunu kullanmıyormuş, düz `showErrorMessage` idi. Tek satırlık fark,
düzeltildi: `coverdict.jarPath` sorgusuyla ayarları açan bir düğme artık
o hata mesajında da var.

**UX isteği 2 (kullanıcı, 2026-08-29) — KAPANDI (Faz 30, §7.9).** JaCoCo
raporu bulunamadığında eklenti artık kendisi "testleri JaCoCo ile şimdi
çalıştıralım mı?" diye soruyor ve Maven'i **görünür bir VS Code Task**
olarak çalıştırıyor. O zamanki risk analizi ("hangi build komutu doğru,
repodan repoya değişir") doğru çıktı ama çözümü "genel-amaçlı bir tek-tık
komutu tahmin etmek" değil, **gson'ın dört sorununu tek tek gerçek koda
karşı teşhis etmek** oldu - ayrıntı §7.9'da.

**Fikir - insan-okur "test kanıtı" raporu (kullanıcı, 2026-08-29) — KAPANDI (Faz 32, §7.10).**
SonarQube/Cucumber tarzı, hangi testlerin çalıştığını ve sonuçlarını
gösteren dışa aktarılabilir bir rapor - hem CLI'dan (`coverdict analyze
--report-format html` gibi) hem VS Code'dan ("dışa aktar" komutu). D-15
zaten "Standalone HTML is deferred until dogfood proves a need" diyor -
bu ihtiyacın ilk somut talebi. **Tasarlanmadı, kapsamlandırılmadı** - ayrı
bir oturumda ele alınmalı: CLI'ın kendi JSON'u zaten tek kaynak (hard rule
7), bir HTML/rapor render'ı JSON'u tüketen yeni bir render katmanı olur,
schema değişikliği gerektirmez.

### 7.9 Faz 30 (2026-08-29) — ön koşulları eklenti kendisi hallediyor (**yapıldı**)

İkinci gson dogfood turunun (§7.8'in devamı) çıkardığı dört somut istek tek
bütçede çözüldü: ön koşullar açıkça söylenmiyor, rapor yoksa öneri yok,
kolay bir "tekrar koş" yok, ve en önemlisi - kullanıcının kendi ekran
görüntüsüyle gösterdiği gibi - *"birden fazla jacoco bulunan target olabilir
hepsinden içerik almak yerine gittin listeden seç diyorsun saçma değil
mi"*. Bu son cümle mimariyi baştan belirledi: **hiçbir yerde artık gerçek
modüller arasında seçim yaptırılmıyor**, hepsi birden bağlanıyor.

**5 commit, sırayla:**

| Commit | İçerik |
|---|---|
| `60b26bd` model | `moduleId` state'ten tamamen kalktı; L2/L3 kanıtı modüller arasında birleşiyor; FQCN çakışması `ambiguous: ReadonlySet<string>` ile düşürülüyor (son-yazan-kazanır değil). |
| `24b39d4` feat | `reportDiscovery.bindModules()` bulunan **her** jacoco.xml'i gerçek id'leriyle bağlıyor (`showQuickPick` silindi); `classpathBuilder.ts`/`classpathParser.ts` (en-uzun-satır hatası dahil) silindi, yerine `doctor --fix` - CLI'ın kendi `mvn -pl <modül> dependency:build-classpath`'i. |
| `5b38d1b` feat | "Testleri Çalıştır" - `pomInspector.ts` (saf, argLine/jacoco-plugin tespiti) + `mavenTestCommand.ts` (saf, argv üretimi) + `ui/mavenTestTask.ts` (görünür `vscode.Task`, gerçek terminal). argLine tuzağı koşudan **önce** modal ile tespit ediliyor - "bu komut satırından düzeltilemez" diyor, pom'u asla otomatik düzenlemiyor. |
| `4dbc25a` feat | `cli/mavenErrorInterpreter.ts` (saf) - `doctor --fix`'in stderr'inde gerçekten akan Maven hata metnini üç şekle ayırıyor (`unresolvedReactorSibling`/D-67, `noPluginPrefix`, `enforcerJdk`); tanımadığı her şey için `undefined` döner, asla uydurmaz. `unresolvedReactorSibling`'de `mvn install -DskipTests` görünür Task olarak önerilip `doctor --fix` bir kez tekrar deneniyor. |
| `7ccb65d` fix | Çok-modüllü bir koşuda ilerleme çubuğunun donmasına yol açan gerçek regresyon düzeltildi: `incrementFor` artık modül başına (`Map<moduleId, done>`) sayaç tutuyor ve `100/moduleCount` ile ölçekleniyor. `doctor --fix`'in kendi ilerlemesi de (`parseDoctorProgressLine`) iptal edilebilir bir bildirime bağlandı. |

**Yeni/silinen dosyalar:**
- Yeni (saf, `vscode` import etmiyor): `cli/pomInspector.ts`, `cli/mavenTestCommand.ts`, `cli/mavenErrorInterpreter.ts`.
- Yeni (impure): `cli/doctorRunner.ts`, `ui/preflight.ts` (eski `resolveReportBinding`/`ensurePerTestClasspath` mantığının hepsi buraya taşındı), `ui/mavenTestTask.ts`.
- Silindi: `cli/classpathBuilder.ts`, `cli/classpathParser.ts` (ve testleri) - `-pl`/`-am` olmadan reactor kökünden koşan, en uzun satırı alan kırık el yapımı mantık.

**Yeni ayarlar/komutlar:**
- `coverdict.testCommandPhase` (`test` | `verify`, varsayılan `test`) - "Testleri Çalıştır"ın hangi Maven aşamasını koşacağı.
- `coverdict.jacocoPluginVersion` (varsayılan `0.8.13`) - pom'da JaCoCo hiç tanımlı değilse enjekte edilen CLI-goal sürümü (D-30'un yaklaşımı, pom asla düzenlenmiyor).
- `coverdict.perTestClasspathPath`'in rolü değişti: artık "biz üretiyoruz"un yolu değil, tek-modüllü bir koşuda `doctor`'a bırakmak istemeyen kullanıcı için salt-okunur bir kaçış kapısı.
- Yeni komut `coverdict.runTests` - Çalıştır görünümünün ilk öğesi, raporun gerçek mtime'ını ("12 dakika önce") gösteren bir açıklamayla.

**Gerçek gson checkout'una karşı doğrulandı, kısmi:** `doctor --fix` gson'un
6 modülünün hepsi için doğru classpath listelerini üretti (daha önce elle
düzeltilen D-67 kardeş-modül tuzağı dahil - `mvn install -DskipTests`
Task'ı gerçekten çözüyor). **Dürüstçe kaydedilen, çözülmemiş bir bulgu:**
bu classpath'e karşı gerçek bir L3 mutasyon koşusu, doctor'ın ürettiği
listede JUnit Platform engine jar'ı eksik olduğu için PIT'in kendi
`"Cannot create Launcher without at least one TestEngine"` hatasıyla
düştü - `doctor`'ın classpath üretimindeki gerçek bir boşluk, bu partinin
hiçbir değişikliğiyle ilgisi yok. Bu oturumun kendi dersine göre (WTA
dogfood retrospektifi ve loop-run'dan) **kovalanmadı, sadece kaydedildi** -
`coverdict` reposunun kendi backlog'una taşınmalı.

169 → 212 unit test, 57 integration test (değişmedi), SonarQube kalite
kapısı OK (dokunulan her dosyada 0 açık bulgu - konteyner bu oturum
ortasında bir kez yeniden başlatıldığında leak-period taban çizgisi
sıfırlandığı için `sinceLeakPeriod=true` artık güvenilir değil, dosya
bazlı `statuses=OPEN,CONFIRMED,REOPENED` sorgusu kullanıldı).

**Bilinçli olarak ertelenenler (tekrar tartışılmasın diye buraya yazıldı):**
- **`coverdict.config.json` tüketimi.** `doctor --write-config`'in ürettiği
  dosya hâlâ hiç okunmuyor - classpath dosya yolları modül köküne göreli
  olduğu için (id'ye bağlı değil) bu partide gerekli değildi, ama gerçek
  bir sonraki adım hâlâ bu (eski §7.8 backlog'unun ikinci maddesiyle aynı).
- **`doctor`'ın classpath üretimindeki JUnit Platform engine boşluğu** -
  yukarıda kaydedildi, `coverdict` (CLI) reposunun işi.
- **`MavenClient`'a `-am` eklemek** - sahte çözüm olurdu (reactor'ü
  genişletir ama kardeş modül yine de kurulu değilse aynı hatayı verir);
  gerçek çözüm zaten `mvn install -DskipTests` Task'ı.
- **`doctor --json`** - `doctor`'ın çıktısı hâlâ yalnızca düz metin; exit
  kodu + dosya varlığı + regex tabanlı yorumlama (`mavenErrorInterpreter.ts`)
  ile idare edildi. Gerçek fayda var ama CLI reposunda ayrı bir
  DECISIONS-gerektiren değişiklik.
- **Gradle desteği** - `doctor` hâlâ yalnızca Maven; eklenti bunu açıkça
  söylüyor, yarım çalışmıyor.
- **Pom'un `argLine`'ını otomatik düzeltmek** - asla, modal her zaman
  "Pom'u Aç"a yönlendiriyor.
- **`-pl`/`-am` ile modül-kapsamlı test koşusu** - "Testleri Çalıştır" hâlâ
  tüm reactor'ü koşuyor; hız optimizasyonu, doğruluk sorunu değil.
- **Ağaç görünümlerinde modül bazlı gruplama** - veri birleşiyor (Faz 30
  commit 1), görünümler düz kalıyor; istenmedi.
- ~~**İnsan-okur export raporu**~~ - **KAPANDI (Faz 32, §7.10).**

### 7.10 Faz 32 (2026-08-31) — "Raporu Dışa Aktar" (HTML) (**yapıldı**)

§7.8'in "Fikir" paragrafının karşılığı: hem CLI'dan (`coverdict analyze
--html-report <path>`) hem VS Code'dan (Çalıştır panelinin başlığındaki
export ikonu, `coverdict.exportReport`) çalışan, tek dosyalık, offline
HTML rapor. Tasarım ve kararların tam kaydı `coverdict` reposunun kendi
`docs/DECISIONS.md`'sinde **D-75'ten D-79'a** - burada sadece özet ve bu
eklentiyi doğrudan ilgilendiren kısım var.

**CLI tarafı (D-75/D-76/D-77/D-79):** yeni `HtmlRenderer.java`,
`VerdictJsonWriter`/`TextRenderer`'ın yanına üçüncü bir okuyucu olarak -
aynı `VerdictDocument`, şema değişikliği yok. Kapsama, değişen dosyalar,
bulgular, uyarılar, test bazlı kanıt, mutasyon (sınıf başına katlanabilir,
filtrelenebilir mutant tablosu) ve dosya kapsama (Sonar tarzı klasör
ağacı) - her bölüm bağımsız katlanabilir ve filtrelenebilir, açık/koyu
tema manuel geçişli, tüm tablolar kendi kutusunda yatay kayıyor (sayfa
değil). Başlık artık ham git-identity dökümü değil, ne/ne zaman/hangi
ayarlarla özeti.

**Gerçek kullanıcı testinin bulduğu mimari hata (D-78) - önemli ders:**
İlk sürüm export'ta her zaman taze, diff-türetilmiş bir `analyze` koşusu
başlatıyordu. Gerçek kullanımda bu iki şeyi kırdı: (1) taze koşu diff'te
değişen sınıf bulamayınca boş dönüyordu ve bu boş sonuç kenar
çubuğundaki **gerçek, taze görünen** per-test/mutasyon verisinin üzerine
koşulsuz yazılıyordu - tam D-73/D-74'ün bir kez düzelttiği sessiz-üzerine-
yazma hatasının aynısı, bu kez export komutunun kendi elinden; (2)
kullanıcının kendi beklentisi zaten "en güncel taramayla gelmesi" idi,
yeni ve dar kapsamlı bir analiz değil. Düzeltme: CLI'a ikinci bir komut
eklendi (`coverdict render-html --in <verdict.json> --out <path>`, hiç
yeniden analiz yapmaz, sadece render eder - `VerdictJsonReader` bunun
için yazıldı). Eklenti artık export'ta `analyze`'ı hiç çağırmıyor;
`verdict-current.json`'ı `pertest-current.json`/`mutation-current.json`
varsa onlarla birleştirip doğrudan `render-html`'e veriyor - sıfır
yeniden-tarama maliyeti, kenar çubuğu state'ine hiç dokunmuyor.

**Yeni/değişen dosyalar:** `ui/commands.ts` (`registerExportReportCommand`,
`registerOpenSettingsCommand`, `runExportReport` - artık `runAnalyzeCore`
çağırmıyor), `extension.ts`, `package.json` (`coverdict.exportReport`
$(export) ve `coverdict.openSettings` $(gear) ikonları, `coverdict.runView`
başlık çubuğunda - listeye altıncı bir satır eklenmedi, Faz 18'in "az
buton" tercihiyle çelişmesin diye).

**Bilinçli olarak yapılmayan:** ekrandaki `CoverageState`/`PerTestState`/
`MutationState`'i in-memory birleştirip export etmek (composite) - ikisi
hiç zaman damgası taşımıyor (CLI'ın kendi JSON'u byte-deterministik kalmak
için taşımaz), disk'teki `verdict-current.json` zaten aynı veriyi taşıyor
ve doğrudan okumak daha güvenilir (bkz. D-78).

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
