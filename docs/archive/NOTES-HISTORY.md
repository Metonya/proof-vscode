# Historical log: manual test sessions, Phase 12 → Phase 21

> **This file is a chronological record, not current fact.** It captures what
> manual test sessions found, in the order they were found. Most items below
> were closed long ago; the current open-work list lives in
> [`../PLAN.md`](../PLAN.md) §7, not here. Where the two disagree, `PLAN.md`
> wins.
>
> This is the English translation/condensation of the original
> `docs/NOTES.md` (2026-08-27 to 2026-08-28 sessions). Kept for the *why*
> behind decisions that are otherwise just facts in `PLAN.md`.

---

## Pre-Phase-12 (mutation) cleanup — Phase 13/14

Real usage issues from the 2026-08-27 (post Phase 11) test session, closed
before mutation testing (Phase 12) work began:

**Phase 13:** items 1–5, 9, 10 (below) implemented. Item 8 investigated and
confirmed **not a bug** (see its own entry).

**Phase 14** (follow-up manual test): three more issues found and fixed:
- The Line → Tests panel was unreadable (`@ParameterizedTest` ids were
  printed raw) — `verdict/testIdentity.ts` gained test-template support, and
  the (now-removed) `ui/panelView.ts` got a grouped/collapsible view.
- New CLI flag `--per-test-target` (mirrors `--mutation-target`) plus a new
  "Which test covers this line, for this class" command — L2 evidence can
  now be collected without touching code or creating a diff.
- "New Code: none" now explains why; `warnings[]` now surfaces in the
  Coverage tree's "Warnings" section.
- `lineIndex.ts`'s ambient/entries mixup was untangled (bug D-6).
- Staleness detection added: editing a file after a scan now marks its
  gutter/badge "stale" instead of silently showing old data.

**Phase 15** — panel bug + the actual core value of proof-java: while
testing Phase 14b's new Line → Tests panel, two things surfaced: (1) the
panel cleared itself the instant you clicked into it (clicking moved
`activeTextEditor`, which the panel treated as "no active editor" — a real
bug), and (2) investigating the second, weaker complaint ("this could be
better") uncovered something much bigger: `findings[].testMethod` and
`perTest`'s test ids match **exactly** (17 confirmed matches against real
data), but the extension never connected them —
`Calculator.java:37` was green in the gutter, yet the one test covering it
(`squareHasNoAssertion`) asserted nothing.
- The webview panel (`ui/panelView.ts`) was deleted outright — the
  self-clearing bug was inherent to that architecture. Replaced by
  `ui/hoverProvider.ts` (bidirectional hover) and
  `ui/treeViews/lineTestsView.ts` (a real `TreeView`, cursor-tracking, never
  self-clears).
- `model/testQuality.ts`: the `findings[]` ↔ `perTest` merge layer —
  classifies each test as ok/noOracle/weak/redundant/inconclusive, and
  computes whether a line is "falsely green" (covered but by tests with no
  real oracle).
- A 5th gutter state, "oracleless" (orange), toggleable via
  `proof.show.oraclelessLines`.
- The reverse direction: hovering a test method shows which production
  lines it exercises.

Remaining at the time: items 6/7 below (a manual step the user still had to
do in the playground).

---

## Phase 20 (as originally scoped) — mutation testing UI

> **Done as of 2026-08-28.** The text below is the original request and
> scoping, kept as a record — not a task list. The actual implementation,
> decisions taken, and two real surprises the first live run produced are in
> `PLAN.md` §8.
>
> One estimate below turned out wrong: a single-class run via
> `--mutation-target` was guessed at "a few seconds" — the real measurement
> was 5 seconds, close enough. What the plan did **not** anticipate: PIT also
> mutates test classes themselves, and the `mutator` field is a fully
> qualified class name, not the short name the schema's golden example
> showed. Both were only discovered by actually running it.

User's original request (2026-08-28, quoted): *"I clicked Deep Scan — should
I have understood that's not mutation testing? What does it actually do?
Also I want a real percentage/progress indicator for mutation testing, a
proper report, that kind of thing — think about that separately."*

**Status at the time:** no mutation UI existed at all. Pending since Phase
12. "Deep Scan" is **not** mutation — it collects L2 (which test covers
which line); Phase 19 had already added "NOT MUTATION TESTING" to the start
of its tooltip as a stopgap, but the real fix was to actually add mutation.

**CLI side already ready (D-71), no extension-side counterpart:**
- `--mutation-report` + `--mutation-classpath <id>=<file>`
- `--mutation-target <id>=<FQCN>` — single class, no diff required
- `--mutation-timeout <seconds>` (default 300)
- A progress stream **already existed but was unused**: the CLI flushes
  every progress line to `stderr` immediately, prefixed `proof-java: `
  (`AnalyzeCommand.buildDiagnostics`), heartbeat every 30s
  (`MutationRunner.java`). `cli/runner.ts`'s `onStderrLine` hook existed and
  simply passed lines to Output raw; `withProgress`'s `_progress` object was
  received and discarded (`ui/commands.ts`). `cli/progressParser.ts` had
  been promised in a comment since Phase 1 but never written.

**What the user asked for, in their own words ("quite a bit"):**
1. A percentage/progress indicator — classes/mutants done, estimated time.
   Data source: the stderr stream above; write `progressParser.ts` and wire
   it to `withProgress`'s `progress.report({ increment, message })`.
2. A "proper report" — which mutant, where, killed or survived.
3. Probably its own sidebar view (alongside the existing four).

**Design decisions not yet made at the time (deferred to the next
session):**
- Should mutation be a separate button (a third scan), or an option on Deep
  Scan? Duration varies wildly (seconds for one class, 70–90 minutes for a
  large module per `ROADMAP.md`) — it must **never** auto-trigger.
- Mapping PIT's 9 statuses into three buckets: `NON_VIABLE`, `MEMORY_ERROR`,
  `NOT_STARTED`, `STARTED`, `RUN_ERROR`, `NO_COVERAGE` → **inconclusive**;
  never counted as killed/survived (hard rule 3a).
- Cancellation: `runner.ts:cancel` at the time was a bare `SIGTERM`, no
  process-tree kill — on Windows it would only end the `java` process
  itself, leaving PIT's minion processes behind. A real problem for a
  long-running mutation job.
- Classpath: Phase 19 had added `cli/classpathBuilder.ts`; mutation could
  reuse the same list (`--mutation-classpath`) with no new code.

---

## Phase 18 status (2026-08-28) — most Phase 16/17 findings closed

**Closed:**
- Phase 16 item 2 (`NotifyingCalculator.java` green gutter, no Explorer
  badge) — **root cause found**: the extension host process throws if
  `FileDecoration.badge` is longer than 2 code points, and drops that file's
  decoration entirely. So `"100"` means "no badge at all". This was the
  materialized form of Phase 9's own "open risk 1". 100% is now `✓`, the
  exact number lives in the tooltip. The old test only checked
  `badge === '100'` and could never have caught this (the throw happens on
  VS Code's side); replaced with an invariant test asserting every badge the
  provider produces is ≤2 code points.
- Phase 16 item 3 (Test Quality) — rule names got human-readable titles
  (`model/ruleCatalog.ts`, sourced from proof-java's own
  `docs/rules/<RULE>.md` files), shown next to the raw enum, with a
  "what it means / what to do" hover. Free-text filtering and grouping by
  file were added. Right-click → Copy was added.
- Warnings now have plain-language text (`model/warningCatalog.ts`); the raw
  CLI message (which can carry real numbers that must not be invented) stays
  in the tooltip.
- "Run" went from five commands down to two scans (Quick / Deep), each
  stating what it does and roughly how long it takes.
- Excluded files became visible in the Explorer (grey `–`).

**Still open at the time:**
- **Phase 16 item 1** — opening a test file rendered the production
  direction in Line → Tests instead of the reverse. Root-cause hypothesis
  and verification steps recorded below, not yet fixed at this point.
- The user's "I also want to see which lines changed under New Code" ask
  was never scoped (today only a percentage and uncovered ranges exist; the
  list of *covered* new lines isn't in the schema at all — D-70).

**Gotcha:** running `mvn clean test` deletes
`target/proof-classpath.txt`, breaking Line → Tests
(`PER_TEST_CLASSPATH_MISSING`). Hit once this session. Regenerate the
classpath list after `clean` (`mvn dependency:build-classpath` plus adding
the `target/classes`/`target/test-classes` entries) — `run.ps1` already does
this.

---

## Phase 16 — post-Phase-15 manual findings (2026-08-28, with screenshots)

The user manually tested Phase 15 (hover + Line → Tests tree + oracleless
gutter) against the playground and left five screenshots plus written
notes. None of this was implemented yet at the time — findings only. Items
1 and 2 are real bugs; the rest are improvement requests.

### 1. REAL BUG: opening a test file shows "covers itself" instead of the reverse direction

> **Closed (Phase 21, 2026-08-28).** The hypothesis below was confirmed
> against a real `--per-test-target` run: PIT's L2 collector also writes
> test classes into `entries`. The fix ended up slightly bigger than
> expected — even after direction was chosen by path, the reverse index kept
> listing the test's own lines as "production lines"; a second filter was
> needed. Full detail in `PLAN.md` §7.1. The same bug existed in
> `hoverProvider.ts` too.

**Observation** (with `CalculatorNullCheckOnlyTest.java` open, Line → Tests
tree): root nodes read `Line 15`, `Line 17`, `Line 21`, `Line 22`, `Line 23`
— each with "1 test (1 oracleless/weak)" and an orange warning icon, each
with one child,
`CalculatorNullCheckOnlyTest#describeOnlyChecksNonNull() NULL_CHECK_ONLY`.
This is exactly `prodLineItem`/`prodTestItem`'s format
(`ui/treeViews/lineTestsView.ts:70-73`) — i.e. the test file is being
rendered in the **production** direction. Correct behavior: Line → Tests in
a test file should show the **reverse** direction — one `testMethod` node
(`describeOnlyChecksNonNull()`) with the production lines it exercises
underneath (`testLine` nodes, `Calculator.java : N`).

**Root-cause hypothesis (unverified at the time, first step to take):**
`computeView()` tries `testsForClass(perTestState.perTest, moduleId,
className)` first; if it returns `'found'`, the code assumes **production**
and stops there, never consulting the `testsToLines` reverse index. This
suggests proof-java-cli's PIT-based L2 collector writes the test class's own
lines into `entries` as a "test" that covers itself.

**Fix directions considered (undecided at the time):** decide test-vs-
production by path *first, independently* (via `inputs.modules[].testRoots`
or the file's `changedFiles[]` classification) rather than "try production,
fall back to test" — the fallback order itself was the wrong assumption.

### 2. LIKELY REAL BUG: `NotifyingCalculator.java` has a green gutter but no Explorer badge

**Observation:** real, non-zero coverage lines light up green in the gutter,
but no percentage badge shows in the Explorer for this file (or others in
the same screenshot).

**Note:** different from the Phase 13 item 8 case (`Notifier.java`, a pure
interface with zero executable lines, correctly unbadged) —
`NotifyingCalculator.java` has real gutter coverage, so that justification
doesn't apply here.

*(Resolved by Phase 13's own investigation below — see item 8's outcome:
this was not a regression.)*

### 3. Improvement: Test Quality view is weak

User's own words: filterable, searchable, groupable by file, better rule
display names, hover explanations. Broken into: free-text filter (missing
at the time), group-by-file toggle (missing), human-readable rule titles
(missing — raw enum shown), and tooltips on rule *group* nodes explaining
what the rule means (only individual finding leaves had tooltips).

*(All later closed — see `PLAN.md` §3/§4 for the current
`ruleCatalog.ts`/`qualityView.ts` shape.)*

### General note

Items 1 and 2 carried real suspicion of a bug and undercut Phase 15's claim
of having found "the actual value of proof-java" — the production/test
direction mix-up was especially serious since it was in the exact screen the
user had just praised.

---

## Miscellaneous findings (undated batch, later triaged into Phase 18+)

1. **No feedback on the coverage-view toggle.** Clicking "Toggle Coverage
   View" gave no visible confirmation.
2. **Status bar percentage ignored the selected `badgeMetric`.** It always
   read `jacoco-line` even when `proof.badgeMetric` was set to
   `sonar-compatible`, while Explorer badges/gutter already respected it.
3. **The difference between "Analyze" and "Analyze (per-test)" wasn't
   clear** — one just measures coverage, the other also collects L2
   (which test covers which line) evidence for Line → Tests.
4. **Why per-test analysis refuses to run under `--no-vcs` wasn't
   explained to the user** — a CLI design constraint (L2 targets only come
   from the diff), not a bug, but the error message didn't say *why*.
5. **Setting `baseRef` to the current commit still produced an empty
   diff** — expected (`merge-base(baseRef, HEAD) == HEAD` when baseRef is
   HEAD itself), but nothing told the user why.
6. **Don't commit test scenario changes into the playground** — its file
   layout is a deliberately fixed scenario map (see the README table); any
   real "new code" experiment needed a separate branch instead.
7. **Planned real "new code" scenario:** a feature branch pushed to the
   playground repo, then `diffMode: base` / `baseRef: main` against it —
   this was the plan to properly exercise the New Code / uncovered-new-
   ranges UI with genuine data (see `PLAN.md` §7.3).
8. **Explorer badges seemed to show on fewer files than before** —
   investigated and closed as **not a bug**: a real `--file-coverage` run
   confirmed `Notifier.java` has zero executable lines (a pure interface)
   and correctly gets no badge under any of the three metric modes,
   matching hard rule 3a (missing data must never look like "0%" or
   "100%"). The old native Test Coverage API's "100%" for that same file had
   been misleading, not more correct — dropping it in Phase 9 was the right
   call, not a regression. A regression test with this exact three-file
   fixture was added to `explorerBadges.test.ts`.
9. **The post-analysis notification message was ugly** — the
   "jacoco-line 94.4% · strict-line 83.3% · sonar-compatible 84.6%" summary
   needed a cleaner format (later revisited alongside the status bar).
10. **Nothing explained how the three metric modes are computed** — only
    the numbers were shown, not the formulas. (Now explained in `PLAN.md`
    §2, "three metric modes" table.)
