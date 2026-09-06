# Historical log: closed work items and phase narratives

> English condensation of `PLAN.md`'s former §7 (closed items) and §8
> (mutation UI phase). Kept for context on *why* things are built the way
> they are; the current architecture and open items live in
> [`../PLAN.md`](../PLAN.md). All `D-xx` references are decision numbers in
> the `proof-java` repo's `docs/DECISIONS.md`.

---

## Restore-after-reload didn't refresh Line → Tests / Mutation (closed, Phase 24)

Found by the user (2026-08-28): after running Deep Scan and Mutation Testing
and confirming real results on screen, reloading the Extension Development
Host window brought Coverage and Test Quality back correctly, but Line →
Tests and Mutation stayed empty — as if never run. The data was on disk
(`verdict-current.json`); it just wasn't reaching the screen.

**Root cause**, confirmed by reading `extension.ts`'s `restoreLastCoverage()`:
`setPerTestState`/`setMutationState` are plain variable assignments — they
fire no `EventEmitter`. A `TreeView` only repaints when its provider's own
`refresh()` (which fires `onDidChangeTreeData`) is called. On restore,
`publishAnalysis(...)` calls the Coverage/Quality views' `refresh()` calls
internally, but *before* `setPerTestState`/`setMutationState` run — so those
two views' refresh always fired against stale data, and nothing ever called
`refresh()` again afterward. Live runs happened to work because
`runAnalyzePerTest`/`runMutation` call their own `refresh()` right after
setting state — only the restore-on-reload path was missing it.

**Fix:** two added `refresh()` calls, one after `setPerTestState`, one after
`setMutationState`. To make this testable, `restoreLastCoverage`'s body was
extracted into an exported `restoreLastCoverageFrom(storageDir,
workspaceRoot, sinks)` (the integration test host has no real
`context.storageUri`, so the wrapper stayed thin around `vscode`-specific
lookups). New test: `extension.restoreLastCoverage.test.ts`, spying on both
views' `refresh()` — confirmed red before the fix, green after.

---

## Test file showed the wrong direction in Line → Tests (closed, Phase 21)

*(Referenced elsewhere as "Phase 16 item 1", open for three phases before
this fix — see `archive/NOTES-HISTORY.md`.)*

**Root cause, confirmed with real data:** PIT's L2 collector writes a test
class's own lines into `perTest.entries` as if some test "covers" them —
so `testsForClass(<TestClass>)` returned `'found'`, and both
`lineTestsView.computeView()` and `hoverProvider` locked onto the
"try production first" branch.

**Fix, two parts:**
1. Direction is now chosen by path: `model/pathIndex.ts`'s
   `classifySourcePath(path, modules)` reads the CLI's own
   `inputs.modules[].testRoots`/`sourceRoots`. No declaration → `'unknown'`,
   no direction is guessed.
2. The reverse index now filters out test classes: `testsToLines(...)` takes
   an optional production-class filter built from `fileCoverage.files[]`
   (the authoritative list of production files for that run). No
   `fileCoverage` → no filter (missing information is never used to exclude
   something, only to *not* filter).

Side fix: the hardcoded `['src/main/java']` was replaced with the real
`sourceRoots` (`productionSourceRoots(modules)`), so multi-module and
non-standard layouts work too.

---

## Sonar quality gate failing on `new_coverage` (closed, Phase 27)

A structural gap, not a new bug: UI code (`src/ui/**`) had never been
measured for coverage at all. Two options existed; the user chose the
"real fix" (instrument the real Extension Host) and it was tried first.

**Tried: instrumenting the Extension Host.** `@vscode/test-cli`'s own
`coverage` config was added to `.vscode-test.mjs` (c8-based,
`npm run test:integration:coverage`), and `@vscode/test-cli`/
`@vscode/test-electron` were upgraded (0.0.10→0.0.15, 2.4.1→3.1.0 — no test
regressions). In practice: `NODE_V8_COVERAGE` produced zero coverage data
from the Extension Host process on this machine (Windows) in both tool
versions — "Unknown% (0/0)". Confirmed with the user (2026-08-28) this looks
like a genuine Electron/environment constraint, not a config mistake. The
config was left in place (harmless without the `--coverage` flag; a
starting point to retry on a different environment, e.g. Linux CI).

**Applied instead:** `sonar.coverage.exclusions=src/ui/**` — the honest
option: `src/ui/**` *is* tested, by 87 real Extension Host integration
tests, just not by anything Sonar's coverage metric can see. Quality gate
went to OK (`new_coverage` 88.4% against an 80% threshold at the time,
`new_violations` 0, `new_duplicated_lines_density` 0%,
`new_security_hotspots_reviewed` 100%).

*(This same environment limitation reappeared and was independently
re-confirmed during the 2026-09 rename work — see the main session summary;
still unresolved as of this writing.)*

---

## Mutation/per-test results vanished on the next scan (closed, Phase 25 and 28)

**Phase 25 (mutation side):** the user ran Mutation Testing, then a Deep
Scan, reloaded the window — the mutation result was gone. Root cause: the
only place mutation results lived was inside `verdict-current.json`, which
Deep Scan's own run then overwrote without a mutation block.

Fix: mutation results moved to their own file, `mutation-current.json`
(written only when `parsed.mutation` is actually present, so an empty/
budget-exhausted run doesn't clobber a good previous result), restored
independently of `verdict-current.json` by `extension.ts`'s
`restoreMutationSnapshot`. Since the CLI's own JSON carries no timestamp,
the extension now stamps its own `Date.now()` when writing the snapshot, so
"5 minutes ago" is accurate after a reload (previously it always said
"saved result — time unknown"). Schema validation
(`verdict/parse.ts`'s exported `isMutationBlock`) rejects malformed/partial
files silently rather than trusting or throwing on them (hard rule 3a).

**Phase 28 (the same bug's per-test twin):** caught by the user immediately
after, before Phase 25's commit was even pushed: Quick Scan → Deep Scan →
Mutation Testing in sequence, then a full window close/reopen — Line →
Tests was empty. Root cause: Mutation Testing's own run doesn't include
`--per-test-report`, so being the *last* run, it overwrote
`verdict-current.json` without a `perTest` block; Deep Scan's perTest data
had never been separately persisted.

Same fix pattern applied: perTest also gets its own file,
`pertest-current.json` (via a shared `writeJsonSnapshot` helper — Phase
25's `writeMutationSnapshot` was folded into it to avoid duplicating the
pattern). `restorePerTestSnapshot` runs independently and does not get
overwritten by a (possibly perTest-less) `verdict-current.json` block if
the snapshot restore already succeeded.

---

## Phase 22 manual-review findings (2026-08-28, from two screenshots)

The user compared two screenshots from a real Deep Scan + Mutation Testing
run number-by-number against the raw JSON (everything checked out) and
filed seven items. Three closed in this pass, four more closed later
(noted inline):

1. **Closed.** The inline diagnostic message was bilingual and got
   truncated — it concatenated a localized title, the CLI's raw English
   sentence, and the suggested action onto one line, overflowing in some VS
   Code forks. Now just `<title>: <method name>`; the tooltip already
   carries the full detail from the same catalog.
2. **Closed.** The mutation panel had no "what/when is this result" header.
   Now every run starts with a `header` node: `Target: Calculator · 5
   minutes ago`, or, for a result restored from disk with no known
   timestamp, an honest "saved result — time unknown" rather than a guessed
   duration (hard rule 3a).
3. **Closed.** Terminology consistency: `package.json`'s
   `proof.toggleCoverage` command title and view name had missed Phase 19's
   English-terminology pass; fixed to "Coverage" everywhere.
4. **Closed later (Phase 24).** `Line 4 · 14 tests` was noisy: a compiler-
   generated no-arg `<init>()` attributes its one instruction to the class
   declaration line, so all 14 object-constructing tests "cover" that line.
   Rather than hide it, `model/lineIndex.ts`'s `testsForClass` now returns
   the real method name per line (from `PerTestEntry.methodName`; ambiguous
   if more than one method claims a line, and then it's excluded rather than
   guessed), and consecutive-line grouping now also requires the same method
   — so `<init>` gets its own honestly-labeled group,
   `Line 4 · <init>()`, with a tooltip explaining why every constructing
   test appears there.
5. **Closed later (Phase 24).** Test Quality and Mutation showed the same
   evidence with no link between them. A two-way bridge was built: right-
   click a `PSEUDO_TESTED_METHOD` finding → "Show in Mutation Tree" selects
   that method there; right-click a survived-mutant method (only if a real
   matching finding exists) → "Show in Test Quality" goes back. The key is
   `Finding.productionMethod`'s real shape, confirmed against a live run:
   `"dev.proofjava.playground.Calculator#square(I)I"`
   (`FQCN#methodName(descriptor)returnType`), identical to
   `MutatedMethod.methodDescription`. New pure helpers in
   `model/mutationModel.ts`: `parseProductionMethod`/`productionMethodKey`/
   `findMutatedMethod`.
6. **Closed later (Phase 24).** A real contradiction stayed silent in the
   UI: `CalculatorUnresolvedOracleTest#addCheckedViaLocalSoftAssertions()`
   was `NO_RECOGNIZED_ORACLE` (INCONCLUSIVE — AssertJ soft-assertions can't
   be statically resolved) at L0, yet it genuinely appears in `add()`'s one
   mutant's `killingTests`. New pure `findKillContribution` in
   `model/mutationModel.ts` searches every mutant's `killingTests`
   (normalized via `parseTestIdentity`) for a given test id. Wherever a
   `prodTest` node is `'inconclusive'`, this now runs automatically; a match
   adds a tooltip note and a "Show in Mutation Tree" cross-link. No match →
   nothing is said (hard rule 3a: a "contradiction" claim only appears when
   actually proven).
7. **Closed later (Phase 24).** `negate()` showing a bare "no score" was
   too opaque. New pure `allMutantsNoCoverage` (an `every`, not `some` — a
   real mixed `NO_COVERAGE`+`SURVIVED` case exists and must not be
   over-claimed): when every mutant for a method is `NO_COVERAGE`, the score
   text now reads "no score — no test reaches this method" instead of a
   bare "no score".

---

## Mutation → Line-tests cross-link (closed, Phase 26)

User request: clicking a mutant already jumps to its production line
("Go to Line") — also let a right-click jump to "the test that failed to
catch this mutation".

**Real constraint, explained to and accepted by the user:** PIT publishes an
empty `killingTests` for a `SURVIVED` mutant — there's no such thing as
"the one test that failed". The only available evidence is `perTest` (if a
Deep Scan has been run): the tests that **cover** that line, all of which
by definition failed to kill the mutant since none did. Line → Tests already
shows exactly that (each covering test with its oracle quality), so the
chosen fix was to link there rather than duplicate it.

Implementation: a mutant node checks whether its line has a real `perTest`
record; if so, right-click → "Show in Line → Tests"
(`proof.mutationView.showInLineTests`) opens the production file at that
line and reveals it in the Line → Tests tree. No evidence → no context-menu
item at all (never show an empty bridge — hard rule 3a).

---

## gson dogfood: multi-module workspace root gap (closed, Phase 29/30)

The first real external-repo VS Code dogfood, against `google/gson`'s
multi-module checkout, surfaced a genuine architectural gap: the extension
had no support for multi-module or non-standard layouts. Opening VS Code at
the checkout root meant the real JaCoCo report lived in a submodule
(`gson/gson/target/site/jacoco/jacoco.xml`), while `--repo` always assumed
the workspace root itself was the module, with fixed
`src/main/java`/`src/test/java` roots.

**Fix (Phase 29):** `cli/reportDiscovery.ts` (pure) +
`ui/commands.ts`'s `resolveReportBinding()`. When the configured report path
doesn't exist at the workspace root, the extension now globs for
`**/target/site/jacoco/jacoco.xml`:
- **0 matches** → old behavior, same error.
- **1 match** → binds automatically, with a visible notification (never
  silent).
- **2+ matches** → never guessed at (hard rule 3a) — a `QuickPick` asks.

A same-day follow-up, from a user screenshot, caught the first version
asking the wrong question: pointing the extension at `coverdict-corpus`
(four **unrelated** independent checkouts side by side — no shared
pom/git) made it offer a flat pick-list mixing all four repos' reports —
"doesn't that seem absurd?", in the user's own words, and rightly so, since
there's no principled way to choose between unrelated repos.

**Fix:** `isProjectRoot()` (does the workspace root itself have a
`pom.xml`/`build.gradle[.kts]`/`settings.gradle[.kts]`?) and
`describeSiblingProjects()` were added. If the root is *not* a project
itself, the extension looks one level down, lists each independent project
it finds by name, and tells the user to open the right one as its own
workspace root — picking none of them. If the root *is* a project (like
gson), the old glob+QuickPick flow applies, now legitimately (every report
found really is part of the same project).

**Backlog item closed later (Phase 30):** binding every discovered module
in a single run instead of forcing a QuickPick choice between them — see
below.

**Still deferred, on purpose (not itself a bug):** consuming
`doctor --write-config`'s `proof.config.json` — the extension still repeats
its own discovery on every run instead of reading a saved config. Belongs to
a future session, tracked so it isn't relitigated.

---

## Phase 30: the extension resolves its own preflight requirements (closed)

A second round of gson dogfood surfaced four concrete UX requests, all
closed in one pass — driven by the user's own screenshot and quote:
*"if there can be multiple jacoco targets, instead of pulling from all of
them you're making me pick from a list — isn't that absurd?"* That sentence
set the whole direction: **no UI anywhere asks the user to choose between
real modules any more — everything found gets bound together.**

Five commits: model layer dropped the single `moduleId` state (L2/L3
evidence now merges across modules, FQCN collisions tracked as an
`ambiguous: ReadonlySet<string>` rather than last-write-wins);
`reportDiscovery.bindModules()` binds every discovered `jacoco.xml` by its
real id (the `QuickPick` was deleted); a hand-rolled classpath builder
(`cli/classpathBuilder.ts`/`classpathParser.ts`, which ran from the reactor
root and grabbed the longest matching line — fragile) was replaced with the
CLI's own `doctor --fix`; a new "Run Tests" flow
(`pomInspector.ts` + `mavenTestCommand.ts`, pure, plus a visible
`vscode.Task`) detects the `argLine`-surrogate trap *before* running rather
than after, and never edits the pom automatically; a new
`cli/mavenErrorInterpreter.ts` (pure) turns real Maven stderr into one of
three understood, actionable causes (unresolved reactor sibling / D-67, no
plugin prefix, enforcer JDK mismatch) — anything unrecognized returns
`undefined`, never invented; and a real regression (progress bar freezing on
module transitions in a multi-module run) was fixed by tracking progress
per module rather than globally.

New settings: `proof.testCommandPhase` (`test`|`verify`),
`proof.jacocoPluginVersion` (injected only if the pom declares no JaCoCo
plugin at all — the pom itself is never edited). New command:
`proof.runTests`.

Verified against the real gson checkout: `doctor --fix` produced correct
classpaths for all 6 modules (including the D-67 sibling-module trap, now
solved by a visible `mvn install -DskipTests` task). **One honestly
recorded, not-yet-fixed finding:** a real L3 mutation run against that
classpath failed with PIT's own "Cannot create Launcher without at least
one TestEngine" — a real gap in `doctor`'s own classpath generation
(missing the JUnit Platform engine jar), unrelated to this session's
changes and out of scope for this repo (belongs to `proof-java`'s backlog).

**Deliberately deferred (recorded here so it isn't re-litigated):**
consuming `proof.config.json`; the JUnit-engine classpath gap above (CLI
repo's job); adding `-am` to `MavenClient` (would be a fake fix — still
fails if the sibling module was never installed; the real fix is the
`mvn install -DskipTests` task already shipped); `doctor --json` (still
plain text, handled via exit code + regex interpretation); Gradle support
(not attempted, and the extension says so rather than half-working);
auto-fixing a pom's `argLine` (never — the modal always points to "Open
pom.xml"); module-scoped `-pl`/`-am` test runs (Run Tests still runs the
whole reactor — a speed optimization, not a correctness issue); per-module
grouping in the tree views (data merges; views stay flat — not requested).

---

## Phase 32: HTML export (closed)

Both CLI (`proof-java analyze --html-report <path>` /
`proof-java render-html`) and extension (`proof.exportReport`, an export
icon on the Run panel's title bar) sides. Full design record is
`proof-java`'s own `docs/DECISIONS.md` D-75 through D-79; only the
extension-relevant summary is here.

**CLI side (D-75/76/77/79):** a new `HtmlRenderer.java`, a third reader
alongside `VerdictJsonWriter`/`TextRenderer` — same `VerdictDocument`, no
schema change. Every section (coverage, changed files, findings, warnings,
per-test evidence, mutation, file coverage) is independently collapsible
and filterable, with a manual light/dark toggle and horizontally-scrolling
tables (never the whole page).

**Real architectural bug the first version shipped with, and the lesson
from it (D-78):** the first version always kicked off a fresh, diff-derived
`analyze` run on export. In practice this broke two things: (1) a fresh run
that found no changed classes returned empty, and that empty result
unconditionally overwrote the sidebar's real, current per-test/mutation
data — the exact silent-overwrite bug D-73/D-74 had already fixed once,
this time from the export command's own hand; (2) the user's actual
expectation was simply "export what's already on screen," not a new,
narrowly-scoped analysis. Fix: a second CLI command,
`proof-java render-html --in <verdict.json> --out <path>`, which never
re-analyzes, only renders (`VerdictJsonReader` was written for this). The
extension's export command no longer calls `analyze` at all — it merges
`verdict-current.json` with `pertest-current.json`/`mutation-current.json`
(if present) and hands them straight to `render-html`: zero re-scan cost,
zero risk to sidebar state.

**Deliberately not done:** merging the in-memory
`CoverageState`/`PerTestState`/`MutationState` for export instead of reading
from disk — neither carries a timestamp (the CLI's JSON stays
byte-deterministic on purpose), and `verdict-current.json` already has the
same data with a more reliable read path.

---

## Phase 20 — mutation testing UI, full implementation record (closed)

The user's original request, verbatim: *"I want quite a bit for mutation
testing: a percentage, real progress, a proper report."* Everything below
was implemented and verified against real playground data.

**Entry points.** Single class (the default, recommended path):
right-click in the editor → "Mutation Test This Class"
(`proof.mutationForFile`) → `--mutation-report
--mutation-target root=<FQCN>`. No diff required, works even under
`--no-vcs` (D-71). Measured on the playground: **5 seconds**. Module-wide:
"Mutation Testing" in the Run view, behind a modal confirmation that states
the time budget — never auto-triggered, since a large module can take
70–90 minutes per `ROADMAP.md`; disabled (with an explanation) under
`no-vcs`, which has no diff to derive targets from.

**Progress.** `cli/progressParser.ts` (pure): `parseProgressLine(line)` →
a `start`/`heartbeat`/`done`/`failed` event, or `undefined` for anything it
doesn't recognize — unrecognized lines are echoed to Output verbatim rather
than swallowed (hard rule 3a). Wired to the `withProgress` progress object
that had been accepted and discarded until this phase. `incrementFor`
reports *deltas* (VS Code wants increments, not absolute percentages) and
emits nothing if the total is unknown — a fabricated progress bar is worse
than none. Since the heartbeat is every 30 seconds, elapsed time is always
shown so the UI doesn't look frozen between updates (this improvement was
free for Deep Scan too).

**PIT's 9 statuses → 3 buckets:**

| Bucket | Statuses |
|---|---|
| killed | `KILLED`, `TIMED_OUT` |
| survived | `SURVIVED` |
| inconclusive | `NON_VIABLE`, `MEMORY_ERROR`, `NOT_STARTED`, `STARTED`, `RUN_ERROR`, `NO_COVERAGE`, and any status not recognized |

Inconclusive never folds into the other two buckets and is never hidden.
Score is `killed / (killed + survived)`; with zero decided mutants, the
score is `null` ("no score", not "0%"). `TIMED_OUT` counts as killed, per
PIT's own convention (confirmed with the user). The mapping lives in one
constant list in `model/mutationModel.ts`.

**Cancellation.** `runner.ts`'s `cancel` became `killTree`: `taskkill /PID
<pid> /T /F` on Windows, `spawn(..., { detached: true })` +
`process.kill(-pid)` on POSIX — a bare `SIGTERM` was leaving PIT's minion
JVMs running in the background.

**Report surface.** `proof.mutationView`: class → method → mutant → killing
tests. Method/class nodes show score; a method with any survivor gets a
warning icon. Clicking a mutant jumps to its line. Killing tests are shown
via `verdict/testIdentity.ts`'s readable names. A "survivors only" filter
sits in the title bar. No evidence at all → the view names which
`MUTATION_*` warning caused that and what to do about it.

**Two surprises only a real run revealed:**
1. `mutator` is a fully qualified class name
   (`org.pitest.mutationtest.engine.gregor.mutators.returns.PrimitiveReturnsMutator`),
   not the schema's golden-example short form (`TRUE_RETURNS`). The tree
   label keeps the last segment (minus the `Mutator` suffix); the tooltip
   keeps the full name.
2. PIT mutates test classes too — a single `--mutation-target
   root=...Calculator` run produced 16 methods, 8 of them from test
   classes. Filtered the same way as the `perTest.entries` case (§7.1
   above): against `fileCoverage.files[]`.
