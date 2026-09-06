# proof-vscode — handoff and forward plan

**Last updated:** 2026-09-06 — renamed from `coverdict-vscode` to
`proof-vscode` (matching the CLI repo's own `coverdict` → `proof-java`
rename), extension branding (`displayName`/`publisher`) made language-
neutral ahead of a possible future `proof-python`/`proof-js` CLI, and this
document itself was pruned and translated to English: the phase-by-phase
debugging narratives that used to live in §7/§8 and in `docs/NOTES.md` are
now in [`docs/archive/PLAN-HISTORY.md`](archive/PLAN-HISTORY.md) and
[`docs/archive/NOTES-HISTORY.md`](archive/NOTES-HISTORY.md) — read them for
the *why* behind a decision; this file states what's true *now* and what's
still open.

**Previous milestone:** 2026-08-31, Phase 32 (§7.10 in the archive):
"Export Report" (HTML) — a third CLI reader (`HtmlRenderer`, offline,
single-file, light/dark, collapsible/filterable sections) and a second
command (`render-html`, renders only, never re-analyzes); VS Code's export
command no longer re-scans at all, it merges `verdict-current.json` with
`pertest-current.json`/`mutation-current.json` and renders directly — a real
user test had found the first version's empty re-scan silently overwriting
real sidebar data. Detail: `proof-java`'s own `docs/DECISIONS.md`, D-75..D-79.

---

## 0. What this file is, and what to read first

This file is written so that someone who has never seen this project
(human or AI) can read it **alone** and start working. It explains what was
built, why, which rules are never broken, and what's next.

**Reading order:** this file → (for the architecture rules in their
original detail) `README.md` → (if you want to know *why* a past decision
was made a certain way) `docs/archive/PLAN-HISTORY.md` and
`docs/archive/NOTES-HISTORY.md`. Both archive files are chronological
records of closed work — **this file wins on any conflict.**

**Working rules (the user's own):**
- Commit small and often. The handoff point isn't the chat, it's the
  **repo** — the next session won't see this conversation, only these
  files.
- **Never `git push`.** The user pushes themselves.
- After every meaningful change: tests + a Sonar scan (§9).
- Never invent data. See hard rule 3a (§3).

---

## 1. Three repos

| Path | What | Why it exists |
|---|---|---|
| `C:\Users\Mert\Desktop\proof-java` | Java CLI (Maven, JDK 17). Built jar: `proof-java-cli/target/proof-java.jar` | The single source of truth. Every number and every finding comes from here. |
| `C:\Users\Mert\Desktop\proof-vscode` | **This repo.** VS Code extension (TypeScript) | Renders the CLI's JSON output in the editor. Computes nothing on its own. |
| `C:\Users\Mert\Desktop\coverdict-playground` | Small Java Maven project: 3 production + 10 test classes | The real data source. Every test file is a deliberate rule scenario. |

### What proof-java is (in one paragraph)

A local, deterministic **"verdict layer"** for Java test suites. It has no
engine of its own; it reads a JaCoCo XML report, a git diff, and (optionally)
a PIT mutation run, and turns them into actionable findings. Its pitch:
*"coverage says 80%; proof-java tells you how much that evidence is worth
trusting."* It answers three questions: which changed lines are untested,
which tests have no recognizable oracle (assertion), and which tests are
exact duplicates of another. No LLM involved — the output is
byte-deterministic.

Evidence layers: **L0** static oracle analysis of test source via
JavaParser (always on) · **L1** JaCoCo + git diff (always on) · **L2**
per-test line coverage via PIT (`--per-test-report`) · **L3** mutation
testing via PIT (`--mutation-report`).

### Playground scenarios

Production: `Calculator.java` (a branchy fixture: `add`, `divide` throws on
zero, `describe`, `square`, plus an uncommitted `negate`),
`Notifier.java` (a single-method interface, exists only to be mocked),
`NotifyingCalculator.java`.

Tests — each represents an expected outcome:

| File | Expected |
|---|---|
| `CalculatorGoodTest` | no findings (true negative) |
| `CalculatorNoOracleTest` | `NO_RECOGNIZED_ORACLE` (HIGH) + `PSEUDO_TESTED_METHOD` |
| `CalculatorPseudoTestedTest` | `NO_RECOGNIZED_ORACLE` + `PSEUDO_TESTED_METHOD` (`square`) |
| `CalculatorTautologicalOracleTest` | 2 × `TAUTOLOGICAL_ORACLE` |
| `CalculatorCatchWithoutFailTest` | `CATCH_ORACLE_WITHOUT_FAIL` |
| `CalculatorNullCheckOnlyTest` | `NULL_CHECK_ONLY` |
| `CalculatorSubsumedTest` | `SUBSUMED_TEST` |
| `CalculatorUnresolvedOracleTest` | `NO_RECOGNIZED_ORACLE` but INCONCLUSIVE (AssertJ can't be resolved) |
| `CalculatorParameterizedTest` | no findings (`@ParameterizedTest` must not false-positive) |
| `NotifyingCalculatorMockitoTest` | no findings (Mockito `verify` is a valid oracle) |

---

## 2. The CLI contract (as much as the extension needs to know)

For detail, see the `proof-java` repo's `docs/CLI-REFERENCE.md`,
`docs/DECISIONS.md` (D-01…D-79), and `schema/proof-verdict.schema.json`.
Everything here is verified against the real source.

### Commands

`proof-java analyze` and `proof-java doctor`. The extension only uses
`analyze` (and, for export, `render-html`).

### Diff modes — exactly one required

| Flag | Meaning |
|---|---|
| `--no-vcs` | Overall coverage only. `newCode` → `{"status":"unavailable_no_vcs"}`, `changedFiles` empty. |
| `--uncommitted` | `HEAD` → working tree (staged + unstaged). |
| `--base <ref>` | `merge-base(ref, HEAD)` → working tree. |

Zero or more than one given → **exit 2**.

### Flags the extension uses

`--repo <dir>` · `--report <path>` (bare path for a single module; its
module id becomes `root`) · `--out <file>` ·
`--coverage-exclusions <glob,glob>` · `--file-coverage` (→ `fileCoverage`
block) · `--per-test-report` (L2) · `--per-test-classpath root=<file>` ·
`--per-test-target root=<FQCN>` · `--mutation-report` ·
`--mutation-classpath <id>=<file>` · `--mutation-target <id>=<FQCN>` ·
`--mutation-timeout <seconds>` (default 300) · `--diagnostics-dir <dir>`.

**Important:** `--per-test-report` and `--mutation-report` normally require
a diff mode, but giving `--per-test-target`/`--mutation-target` lifts that
restriction and lets them run even under `--no-vcs` (D-71). Targets are
all-or-nothing: giving one discards every diff-derived target.

### JSON output

Always present: `schemaVersion`, `tool`, `analysis`, `inputs`, `coverage`,
`changedFiles`, `findings`, `warnings`. Present only with the matching
flag: `fileCoverage`, `perTest`, `mutation`. **A missing block means the
key is absent — never `null`.**

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
`denominator === 0` means `percent` is **null** — "no coverage data" and
"0% coverage" are different things.

`metricSet` always carries all three modes:

| Mode | How it's computed | Character |
|---|---|---|
| `jacoco-line` | Covered if **any** instruction on the line ran | Most generous; raw JaCoCo line coverage |
| `strict-line` | Covered only if **every** instruction on the line ran | Strictest; usually the lowest number |
| `sonar-compatible` | JaCoCo line coverage **plus branch coverage** | Matches SonarQube's own UI within ±0.1 |

This is why the same file shows three different numbers; which one drives
the badge and gutter is `proof.badgeMetric` (default `sonar-compatible`).
**The most common question this raises:** seeing 81.5% in Sonar and 76 next
to `Calculator.java` is not a contradiction — one is repo-wide, the other
is a single file.

`fileCoverage.lines` is a 5-tuple: `[line, missedInstructions,
coveredInstructions, missedBranches, coveredBranches]` — JaCoCo's own field
order.

`perTest.ambient` holds `<clinit>` (static initializer) coverage and
**cannot be attributed to any test** (D-50); don't confuse it with `entries`.

**Easy to miss, expensive when missed:** `perTest.entries` isn't only
production classes — **test classes are in there too**, "covering" their
own lines via their own test methods (confirmed on real data: a single
`--per-test-target root=...Calculator` run listed all 10 test classes as
well). So "does this class have an entry in `entries`" **does not tell you
whether a file is test or production** — only
`inputs.modules[].testRoots`/`sourceRoots` answers that. Missing this
distinction caused a real, multi-phase bug (see
`archive/PLAN-HISTORY.md`, "Test file showed the wrong direction").

### Rule ids (6)

| Rule | Severity | Meaning |
|---|---|---|
| `NO_RECOGNIZED_ORACLE` | WARNING | No recognizable assertion/verification in the test |
| `TAUTOLOGICAL_ORACLE` | WARNING | The assertion's result can't depend on the code under test (`assertEquals(4, 2*2)`) |
| `CATCH_ORACLE_WITHOUT_FAIL` | WARNING | If an exception is thrown, every oracle is skipped and the test still passes |
| `NULL_CHECK_ONLY` | INFO | Every oracle only checks non-null, never content |
| `PSEUDO_TESTED_METHOD` | WARNING | Method is covered but every generated mutant survived — nobody observes what it does (L3) |
| `SUBSUMED_TEST` | INFO | A test's kill-set is a strict subset of another's (L3/L4) |

Confidence: `HIGH` · `MEDIUM` · `INCONCLUSIVE` (`LOW` reserved, unused).
**No rule, at any confidence, ever says "delete this test."**

Rule text comes from the CLI's `docs/rules/<RULE>.md` files; the
extension's own condensed catalog is `src/model/ruleCatalog.ts` —
**summarized from there, never invented.**

### Warning codes

About 30 exist; the ~10 the extension actually surfaces and explains live
in `src/model/warningCatalog.ts` as title + "what it means" + "what to do".
An unrecognized code is shown **raw** (hard rule 3a). Most common:

- `CHANGED_LINES_ABSENT_FROM_REPORT` — changed lines have no counterpart in
  the JaCoCo report. **Two distinct causes the CLI can't tell apart:**
  (a) the lines aren't executable at all (braces, method signature,
  import), or (b) the report is older than the diff — you changed code
  after `mvn test` last ran. Rerun tests to refresh the report; if the
  warning persists, it's cause (a).
- `PER_TEST_CLASSPATH_MISSING` — L2 targets exist but the module has no
  bound classpath list. The extension generates this file itself.
- `MODULE_WITHOUT_REPORT` — a module is defined but has no `--report` bound.
- `REPORT_MISSING_CHANGED_FILE`, `CHANGED_FILES_EXCLUDED`,
  `UNTRACKED_JAVA_FILE`, `MUTATION_TARGET_UNRESOLVED`, `SUPPRESSED_FINDINGS`.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Completed (findings or not) |
| 2 | Invalid input/invocation — **no JSON written** |
| 3 | Evidence missing/inconclusive — a structured "incomplete" JSON **is** written |
| 4 | Internal error |
| 1 | Deliberately unused; reserved for a future findings-based quality gate |

### The `mutation` block

```json
"mutation": { "engine": "pitest", "engineVersion": "1.15.8",
  "modules": [{ "id": "root", "methods": [{
    "className": "dev.proofjava.playground.Calculator",
    "methodName": "square", "methodDescription": "(I)I",
    "firstLine": 36, "lastLine": 38,
    "mutants": [{ "mutator": "TRUE_RETURNS", "line": 37,
                  "status": "SURVIVED", "killingTests": [] }] }] }] }
```

`status` is PIT's own `DetectionStatus` enum, **9 values**: `KILLED`,
`SURVIVED`, `TIMED_OUT`, `NON_VIABLE`, `MEMORY_ERROR`, `NOT_STARTED`,
`STARTED`, `RUN_ERROR`, `NO_COVERAGE`. Bucket mapping in §3 (mutation
model).

**Two things only a real run revealed** (not documented anywhere):
`mutator` is the **fully qualified class name**
(`org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator`),
not the schema's short-form golden example (`TRUE_RETURNS`); and
`methods[]` **includes test classes** too — PIT mutates them as well. The
filter in both cases is `fileCoverage.files[]`, the authoritative production
list.

PIT is **embedded in the jar** — nothing is installed into the target repo.
Mutators are limited to `RETURNS` and `VOID_METHOD_CALLS`, single-threaded
(determinism, D-52), `fullMutationMatrix` on (every mutant records **all**
tests that killed it).

### Progress stream

The CLI writes every progress line to **stderr**, prefixed `proof-java: `,
flushed immediately (stdout carries the text report and must stay
byte-deterministic, D-64). Heartbeat every **30 seconds**. Real line shapes:

```
proof-java: mutation: module 'root' - 3 target class(es), budget 300s
proof-java: mutation: module 'root' - 2/3 class(es), 6m12s elapsed
proof-java: mutation: module 'root' - done, 5 method(s) with mutants
proof-java: mutation: module 'root' - FAILED, budget of 300s exhausted after 2/3 class(es) completed
proof-java: per-test: module 'root' - 4 target class(es)
proof-java: per-test: module 'root' - collecting coverage, 48s elapsed
```

Diagnostic note (D-64): if a module's budget is mostly spent stuck at
`0/219`, the mutation phase never actually started — a different problem
from "just slow".

---

## 3. Extension architecture

### Invariants — read these first

1. **`verdict/` and `model/` never `import 'vscode'`.** This lets them be
   tested with plain `node --test`, no VS Code download required. Anything
   needing `vscode` moves to a sibling file. Established pattern:
   `cli/classpathParser.ts` (pure) ↔ `cli/classpathBuilder.ts` (vscode);
   `cli/argsBuilder.ts` (pure) ↔ `cli/runner.ts`.
2. **The extension never parses JaCoCo XML, runs git, or computes a
   coverage percentage itself.** Every number comes from the CLI's JSON
   (D-70). One exception: folder-badge rollup (`model/metrics.ts`), because
   the CLI doesn't publish folder-level numbers.
3. **Hard rule 3a — the most important rule in this project.** Missing
   data must never look like "fine" or "a problem" — it always gets its own
   distinct state. No guessing, no inventing, no filling gaps. Examples:
   `Notifier.java` is a pure interface with 0 executable lines → it gets
   **no** badge (never shown as "100%") · an excluded file gets a grey `–`
   badge (distinct from "no data") · an unrecognized warning code is shown
   raw · an inconclusive mutant status never folds into killed/survived.
4. **Terminology:** `coverage`, `covered`, `uncovered` are technical terms
   and stay in English in the UI. This is an explicit, standing instruction
   from the user.

### Data flow

```
command (ui/commands.ts)
  → cli/jarLocator.ts      where is the jar
  → cli/argsBuilder.ts     argv (pure)
  → cli/runner.ts          spawn java -jar, line-buffered stdout/stderr
  → verdict/parse.ts       never throws, returns a result object
  → model/store.ts         single source of truth
  → 5 surfaces: gutter · Explorer badge · status bar · Problems panel · 4 TreeViews
```

### File map

| File | Role |
|---|---|
| `src/extension.ts` | `activate`/`deactivate` and registration only. No business logic. Restores the last scan from `context.storageUri`. |
| `cli/jarLocator.ts` | Search order: `proof.jarPath` → `<ws>/proof-java-cli/target/proof-java.jar` → `<ws>/.proof-java/proof-java.jar`. The jar is never bundled into the `.vsix`. |
| `cli/argsBuilder.ts` | Builds `analyze`'s argv (pure). `DiffMode` type lives here. |
| `cli/runner.ts` | Runs it via `spawn`, buffers stdout/stderr into separate lines, exposes an `onStderrLine` hook, provides `cancel`. |
| `cli/classpathParser.ts` | Extracts the classpath line from `mvn dependency:build-classpath` output (pure). |
| `cli/doctorRunner.ts` / `ui/preflight.ts` | Runs `doctor --fix`, discovers/binds modules, interprets Maven failures — see `archive/PLAN-HISTORY.md` (Phase 29/30) for how this replaced the old hand-rolled classpath builder. |
| `cli/progressParser.ts` | Turns the CLI's stderr progress lines into a structured event (pure). Never swallows what it doesn't recognize. |
| `cli/mavenErrorInterpreter.ts` | Turns real Maven stderr into one of a few understood, actionable causes (pure); unrecognized → `undefined`. |
| `cli/pomInspector.ts` / `cli/mavenTestCommand.ts` | Detects the `argLine` trap and builds the "Run Tests" argv (pure). |
| `verdict/types.ts` | TypeScript shape of the JSON schema. No `vscode` import. |
| `verdict/parse.ts` | `parseVerdict(raw)` — **never throws**, returns a result object; validates rule ids. |
| `verdict/testIdentity.ts` | Port of the CLI's `TestIdentity.java` (D-49): resolves JUnit5 UniqueIds and `Class#method()` shapes; shows anything unrecognized **verbatim**. |
| `verdict/coverageMapping.ts` | 5-tuple → `LineState` (covered/partial/uncovered). `mi>0 \|\| mb>0` means partial. |
| `model/store.ts` | Single source of truth for the last run: coverage state, per-test state, gutter visibility, staleness flags. |
| `model/lineIndex.ts` | "Which tests cover this line" plus the reverse index and consecutive-line grouping (`groupConsecutiveLines`). |
| `model/testQuality.ts` | **The project's single most valuable join:** matches `findings[].testMethod` against `perTest` test ids (17 exact matches confirmed on real data). This is how "green but no real oracle" lines are known. |
| `model/falseGreenIndex.ts` | Lines JaCoCo calls covered, where every covering test has an oracle finding → orange gutter. |
| `model/metrics.ts` | The one permitted arithmetic: folder rollup. |
| `model/pathIndex.ts` | Path math + `classifySourcePath` (test vs. production — decides Line → Tests' direction). proof-java paths are repo-relative and **forward-slashed** (D-22). |
| `model/classNameDetector.ts` | package + filename → FQCN. Never guesses in a multi-class file. |
| `model/productionClassIndex.ts` | `className → path` map built from `fileCoverage.files[]`; never searches the disk. |
| `model/mutationModel.ts` | 9 PIT statuses → 3 buckets, scoring, class grouping, mutator name shortening (pure). |
| `model/ruleCatalog.ts` | Human-readable title/summary/action for the 6 rules. |
| `model/warningCatalog.ts` | Human-readable explanation for warning codes; the raw message is preserved in the tooltip. |
| `ui/commands.ts` | The largest file. Commands, run orchestration, `paintCoverage`, classpath auto-generation. |
| `ui/gutterRenderer.ts` | The one gutter renderer. 6 states: covered · partial · uncovered · oracleless (orange) · excluded · stale. A 7th, mutation-specific state was **deliberately not added** — waiting for the tree UI to settle first. |
| `ui/explorerBadges.ts` | Explorer badges. File percentage from the CLI, folder rollup locally. |
| `ui/hoverProvider.ts` | Bidirectional hover: on a production line, "which tests + their quality"; on a test method, "which production lines". |
| `ui/diagnostics.ts` | Writes findings to the Problems panel; keeps `severity` and `confidence` distinct. |
| `ui/statusBar.ts` | Summary percentage; the **one** surface that reports `fileCoverage` being entirely absent. |
| `ui/testFileLocator.ts` | Locates a test file; **never guesses** if it can't find one — returns `undefined`. |
| `ui/treeViews/runView.ts` | Run view. |
| `ui/treeViews/coverageView.ts` | Overall / new code / uncovered new ranges / Warnings. |
| `ui/treeViews/qualityView.ts` | Findings; rule↔file grouping, free-text filter. Has a Mutation cross-link target (`findQualityBridgeTarget`). |
| `ui/treeViews/lineTestsView.ts` | Line → Tests; range grouping, a "problems only" filter. Line groups carry the real `methodName` (including the implicit-constructor label). |
| `ui/treeViews/mutationView.ts` | Mutation report; class → method → mutant → killing tests. Has a Test Quality cross-link target (`findMutationBridgeTarget`). |

**Deleted, don't rewrite:** `src/ui/panelView.ts` (a webview panel,
removed — it self-cleared on its own click; replaced by hover + TreeView).

---

## 4. Current state

The Activity Bar has a `proof-java` container with **5 views**:

1. **Run** — Quick Scan (coverage + oracle findings, seconds), Deep Scan
   (adds L2: which test covers which line, via PIT, slower), Mutation
   Testing (module-wide, behind a confirmation dialog), Coverage View
   toggle. **Deep Scan is not mutation testing** — its tooltip opens with
   exactly that sentence, because the user asked.
2. **Coverage** — overall (three metrics), new code, uncovered new lines
   (click to jump), Warnings (with plain-language explanations).
3. **Test Quality** — findings; two title-bar buttons: free-text filter and
   a rule↔file grouping toggle.
4. **Line → Tests** — for the active Java file; consecutive lines covered
   by the same tests merge into one node (`Line 9-11`); a "problems only"
   filter (off by default). Direction is chosen by the file's location (see
   §7.1 in the archive for how that used to go wrong).
5. **Mutation** — class → method → mutant → killing tests. Every level
   shows a `killed/(killed+survived)` score; inconclusive mutants are
   counted separately and never hidden. A "survivors only" filter.

### Commands (15)

`proof.analyze` (Quick Scan) · `proof.analyzePerTest` (Deep Scan) ·
`proof.mutationForModule` (module-wide mutation, confirmed) ·
`proof.mutationForFile` (editor right-click — **the recommended path** for
mutation) · `proof.toggleCoverage` · `proof.perTestForFile` (editor
right-click, Java) · `proof.copyItem` (tree right-click → Copy) ·
`proof.qualityView.filter` · `proof.qualityView.toggleGrouping` ·
`proof.lineTestsView.toggleProblemsOnly` ·
`proof.mutationView.toggleSurvivorsOnly` ·
`proof.qualityView.showInMutation` (right-click, only on a
`PSEUDO_TESTED_METHOD` finding) ·
`proof.mutationView.showInQuality` (right-click, only when a matching
finding exists) ·
`proof.lineTestsView.showInMutation` (right-click, only when a real L0/L3
contradiction exists) ·
`proof.mutationView.showInLineTests` (right-click, only when that line has
a real perTest record).

### Settings (13)

| Setting | Default |
|---|---|
| `proof.jarPath` | `""` (falls back to the search order) |
| `proof.javaExecutable` | `"java"` |
| `proof.mavenExecutable` | `""` → `mvn.cmd` on Windows, `mvn` elsewhere |
| `proof.reportPath` | `"target/site/jacoco/jacoco.xml"` |
| `proof.perTestClasspathPath` | `"target/proof-classpath.txt"` |
| `proof.mutationTimeout` | `300` (seconds, per-module budget) |
| `proof.coverageExclusions` | `[]` |
| `proof.diffMode` | `"uncommitted"` (`no-vcs` \| `uncommitted` \| `base`) |
| `proof.baseRef` | `""` |
| `proof.badgeMetric` | `"sonar-compatible"` |
| `proof.show.explorerBadges` | `true` |
| `proof.show.lineGutter` | `true` |
| `proof.show.oraclelessLines` | `true` |

These are all Java/Maven-specific by nature (a jar run by a JVM, built by
Maven). If a `proof-python`/`proof-js` CLI ever needs this extension to
speak to it too, this setting surface — and the hardcoded `proof-java.jar`
default paths in `cli/jarLocator.ts` — will need a language-scoped rename
(e.g. `proof.java.jarPath`) at that point. Not done preemptively: there is
no second language today, and guessing its shape now would likely guess
wrong.

### User's standing decisions (don't change without asking)

- No popup notification after a scan. Only `analysis.status ===
  'incomplete'` produces a warning.
- No "last scan … findings" line in the Run view (removed).
- 100% coverage badge is **`✓`**; the exact number is in the tooltip.
- An excluded file gets a grey **`–`** badge.
- Rule codes are always shown as the raw enum too, alongside a readable
  title.

### Health

242 unit + 87 integration tests passing (2026-09-06, after adding
fixture-free `cli/runner.ts` tests — see the main rename session's summary).
SonarQube (`proof-vscode`, `http://localhost:9001`): 0 open issues, 0
unreviewed hotspots, quality gate **OK**.

---

## 5. Development workflow

### Setup and build

```bash
npm install
npm run watch          # esbuild + tsc, both in watch mode
```

`esbuild` produces `dist/extension.js` (what actually ships); `tsc` is only
for type-checking and compiling tests to `out/`.

### Run / debug

**F5** in VS Code → "Run Extension" → opens an Extension Development Host
window. Open `coverdict-playground` there and click the proof-java icon in
the Activity Bar.

### Test

```bash
npm run check-types && npm run lint
npm run pretest && npm run test:unit        # plain node:test, no VS Code needed
node esbuild.js && npm run test:integration # real Extension Host
```

Clean run (use this if something looks off):

```bash
rm -rf out dist coverage && npm run pretest && npm run test:unit:coverage && node esbuild.js && npm run test:integration
```

### Building the jar

In the `proof-java` repo:

```bash
mvn verify
```

→ `proof-java-cli/target/proof-java.jar`. Requires JDK 17+ to build
(`maven.compiler.release=17`).

### Producing evidence in the playground

```bash
mvn -q clean test
```

→ refreshes `target/site/jacoco/jacoco.xml`.

**Gotcha:** `mvn clean` also deletes `target/proof-classpath.txt`. The
extension notices the missing file during Deep Scan and offers to generate
it via a Maven task itself — no manual step needed.

`run.ps1` is the playground's own shortcut script (`mvn clean test` + a PIT
mutation run + writing the classpath file + calling the proof-java CLI with
the first commit as base, all in one command). **The user doesn't use this
in their own workflow** — know it exists, don't invoke it unprompted.

### SonarQube

```bash
sonar-scanner -Dsonar.host.url=http://localhost:9001 -Dsonar.token=$SONAR_TOKEN -Dsonar.projectKey=proof-vscode -Dsonar.sources=src -Dsonar.exclusions=**/*.test.ts,out/**,dist/**,.vscode-test/** -Dsonar.coverage.exclusions=src/ui/** -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info
```

New findings should always be **zero** — Sonar cleanliness is a standing
constraint in this repo.

**Known, still-live environment limitation (see
`archive/PLAN-HISTORY.md`, "Sonar quality gate failing on `new_coverage`"):**
`@vscode/test-cli`'s `--coverage` flag produces no coverage data at all from
the Extension Host on this machine ("Unknown% (0/0)", no output directory)
— confirmed again as recently as the 2026-09-06 rename session, independent
of any code change. `sonar.coverage.exclusions=src/ui/**` stays in place as
the honest workaround: that code is tested (87 real Extension Host
integration tests), just not measurable by Sonar's coverage metric here.

---

## 6. Known pitfalls

- **`FileDecoration.badge` can't be longer than 2 code points.** If it is,
  the extension host **throws and drops that file's decoration entirely**
  — writing `"100"` means "no badge at all". `@types/vscode` doesn't
  document this; found by reading the real 1.135.0 extension host bundle.
  Hence 100% → `✓`. `explorerBadges.test.ts` has an invariant test for
  "no badge this provider produces exceeds 2 code points" — **don't delete
  it**, since the throw happens on VS Code's side, so an ordinary equality
  test can't catch it (the old test literally checked `badge === '100'` and
  passed).
- **`mvn clean` deletes the classpath file** → Deep Scan silently falls
  into `PER_TEST_CLASSPATH_MISSING`. (Automated away since the "Run Tests"
  work — see `archive/PLAN-HISTORY.md`, Phase 30.)
- **`mvn.cmd` on Windows is a batch file**; since Node's CVE-2024-27980 fix
  it can't be `spawn`ed directly and needs `shell: true`. Safe only because
  **every argument is a constant the code itself produces** — user text
  must never end up there.
- **Per-test analysis doesn't run under `--no-vcs`** — a CLI design
  decision, won't change. L2 targets are derived from changed production
  classes.
- **`base` mode with `baseRef = HEAD`** yields an empty diff. Not a bug:
  `merge-base(HEAD, HEAD) = HEAD`.
- **`perTest.entries` and `mutation.methods` include test classes too.**
  Both must be filtered against the production list
  (`fileCoverage.files[]`), or the UI ends up measuring a test's own code.
  This exact gap caused two separate real bugs (see the archive).
- **PIT spawns child JVMs.** A bare `SIGTERM` on cancel isn't enough;
  `killTree` (`taskkill /T` on Windows) is used — otherwise minion
  processes survive and lock the classpath.
- **Terminology:** `coverage`/`covered`/`uncovered` are never translated
  (§3, rule 4).

---

## 7. Open work (priority order)

### 7.1 "Covered new lines" isn't in the schema

The user wants to see which lines changed in the new-code section. Today
only a percentage and `uncoveredNewRanges` exist — a list of *covered* new
lines isn't in the CLI schema at all (D-70). This can't be solved on the
extension side: either the CLI gains a `coveredNewRanges` field, or the UI
explicitly states why it can't show this. The decision belongs to the CLI
repo.

### 7.2 A real "new code" scenario in the playground — a user-side step

Test code will **not** be committed into the playground (it would break the
scenario map). The real new-code flow will be tried on a separate branch
with a push, then `diffMode: base`, `baseRef: main`. Today there's an
uncommitted `Calculator.negate(int)` in the working tree that nothing calls
— a real uncovered-new-line candidate, visible in the report after
`mvn clean test`.

### 7.3 Rest of the mutation UI

The core UI landed with the Phase 20 work (see
`archive/PLAN-HISTORY.md`). Deliberately not done yet:
- **No mutation state in the gutter** (no 7th state). Waiting for the tree
  UI to see more real usage first.
- **`SUBSUMED_TEST` findings aren't cross-linked to the mutation tree** —
  the `PSEUDO_TESTED_METHOD` bridge exists; this one doesn't yet.

### 7.4 `proof.config.json` is still unread

`doctor --write-config` produces this file (D-40/D-66); nothing consumes
it. The extension still repeats its own module/report discovery on every
run. Deliberately deferred multiple times (see
`archive/PLAN-HISTORY.md`, Phase 29 and Phase 30) — still the real next
step whenever this is picked back up.

### 7.5 A real gap found during gson dogfood, not this repo's to fix

A real L3 mutation run against `doctor`'s generated classpath for a gson
module failed with PIT's own "Cannot create Launcher without at least one
TestEngine" — the JUnit Platform engine jar is missing from what `doctor`
generates. Confirmed unrelated to any extension-side change. Belongs on
`proof-java`'s own backlog, not tracked further here.

---

## 8. Verification checklist

After any change, in order:

1. `npm run check-types && npm run lint`
2. A clean run (§5) — unit and integration tests must **pass**; a lower
   test count than before means you accidentally deleted one.
3. A manual Extension Host check (F5) against real playground data.
   "Works" with synthetic data alone hasn't been good enough in this
   project — Phase 18's badge bug is exactly the kind of thing that gets
   missed that way.
4. A Sonar scan (§5) — **zero new findings**.
5. A small, descriptive commit. **No push.**
6. Report to the user: what changed, what was verified, what's still open.

---

## Appendix A: why the native VS Code Test Coverage API isn't used

Investigated and closed in Phase 20's precursor work; don't reopen without
new evidence. `@types/vscode` 1.134.0 was checked against the real VS Code
1.135.0 `vscode.d.ts` (byte-identical outside header comments):

- **Published coverage can't be cleared.** `TestRun`'s only coverage member
  is `addCoverage`; there's no `clearCoverage`/`removeCoverage`/
  `resetCoverage`.
- **Explorer badge and gutter can't be controlled independently.** None of
  the 62 lines mentioning `coverage` distinguish badge from gutter from
  decoration.
- No documented `testing.*` command id exists either.

So `show.explorerBadges` / `show.lineGutter` working independently is
**not possible** with the native API. This is why the extension uses its
own `TextEditorDecorationType`s and its own `FileDecorationProvider`. Side
benefit: the native API reported "100%" for a file like `Notifier.java`
with zero executable lines — a hard-rule-3a violation; the extension's own
renderer correctly leaves that file unbadged.

## Appendix B: historical record

[`docs/archive/PLAN-HISTORY.md`](archive/PLAN-HISTORY.md) holds the full,
closed-item narratives this file used to carry in §7/§8 (root causes,
options considered, verification steps) — read it if you want the reasoning
behind something stated here as settled fact.
[`docs/archive/NOTES-HISTORY.md`](archive/NOTES-HISTORY.md) is the older,
Phase 12–21 manual-test-session log (formerly `docs/NOTES.md`) — same idea,
earlier period.

`D-xx` markers throughout the code and these docs are decision numbers in
the `proof-java` repo's `docs/DECISIONS.md`.
