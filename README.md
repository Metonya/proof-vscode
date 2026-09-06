# Proof for VS Code

See which of your passing tests actually prove anything, inline as you
code.

Coverage tells you a line executed. It doesn't tell you that anything
checked what that line did. This extension runs [proof-java](https://github.com/Metonya/proof-java)
against your workspace and shows its verdict directly in the editor: which
lines are covered, which of the tests covering them have no real assertion,
and, when you ask for it, which mutations nothing catches.

Works in VS Code, Cursor, and Windsurf.

![Coverage gutter and Explorer badges](media/screenshots/hero-gutter.png)
<!-- Suggested shot: a Java file open with the coverage gutter visible
     (a mix of covered/uncovered/oracleless lines) and Explorer badges
     showing in the sidebar file tree. This is the first thing a visitor
     sees - the one screenshot that has to sell the idea on its own. -->

## Why

A green test suite and a high coverage percentage both quietly assume the
same thing: that the code checking your program actually works. It's
common for that assumption to be wrong: a test with no assertion, a test
that compares a constant to itself, a test whose only checks sit inside a
`try` block that swallows the exception. All three run green. All three
raise your coverage number. None of them would catch a real bug.

Proof reads the evidence your build already produces (a JaCoCo report, your
git diff, and optionally a PIT mutation run) and turns it into specific
findings, shown where you're already looking: the editor gutter, a hover,
the Problems panel.

## Features

- **Coverage gutter**: inline, colored by line. Covered, partially
  covered, uncovered, excluded, or *oracleless* (covered, but by tests with
  no real assertion), each with its own distinct color, because "covered"
  and "meaningfully tested" are not the same claim.
- **Explorer badges**: coverage percentage on every file and folder in
  the file tree, rolled up from the same data as the gutter.
- **Line → Tests**: for the file you have open, which tests cover a given
  line, and whether each one has a real oracle. In a test file, the same
  view runs in reverse, showing which production lines *this* test
  actually exercises.
- **Test Quality view**: every finding (no assertion, tautological
  assertion, swallowed exception, null-check-only, and more), filterable
  and groupable by rule or by file, with a plain-language explanation for
  each.
- **Mutation testing**: run PIT against a single class (usually a few
  seconds) or a whole module (minutes, behind a confirmation, since it can
  run long). Results: class → method → mutant → the tests that failed to
  kill it, with live progress.
- **Problems panel integration**: every finding also shows up as a
  standard VS Code diagnostic, so it participates in the usual
  navigation/quick-fix flow.
- **HTML export**: a single, offline HTML report of the current results,
  for sharing outside the editor.
- Every number comes from the CLI's own JSON. The extension never parses
  coverage XML, runs git, or computes a percentage itself.

## Screenshots

**Line → Tests**: which tests cover this line, and whether each one has a
real oracle (a test file open shows the reverse: which lines this test
actually exercises).

![Line → Tests view](media/screenshots/line-to-tests.png)

**Test Quality**: every finding, filterable and groupable by rule or file.

![Test Quality view](media/screenshots/test-quality.png)

**Mutation**: class → method → mutant → the tests that failed to kill it,
with live progress on a run.

![Mutation view](media/screenshots/mutation.png)

<!-- Drop the four PNGs above into media/screenshots/ with these exact
     filenames (hero-gutter, line-to-tests, test-quality, mutation) and
     they'll show up here and on the Marketplace listing automatically -
     no other change needed. A short GIF instead of a still for the hero
     shot (e.g. running Quick Scan and watching the gutter light up) tends
     to land better on a Marketplace page than a static image, if you want
     to go that far. -->

## Requirements

- A Maven or Gradle project with a JaCoCo report. Quick Scan finds either
  `target/site/jacoco/jacoco.xml` (Maven) or
  `build/reports/jacoco/test/jacocoTestReport.xml` (Gradle) automatically.
  Gradle support is coverage-only today: the **Run Tests** button, Deep
  Scan, and Mutation Testing still assume Maven. See
  [`proof-java`](https://github.com/Metonya/proof-java)'s own README for
  the full build-tool support matrix (including Android/Kotlin gaps).
- `proof-java.jar`: the CLI this extension runs. See
  [`proof-java`](https://github.com/Metonya/proof-java) for what it does
  and how it works. The extension can fetch the jar for you (see Usage
  below); you never need to clone or build that repository yourself just
  to use this extension.

## Installation

Not yet published to the VS Code Marketplace. For now, build it from
source. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Usage

1. Open your project in VS Code and open the **Proof** icon in the
   Activity Bar. If `proof-java.jar` isn't already on your machine, run
   **Proof: Download proof-java.jar** (Command Palette or the Run panel).
   It fetches the latest release from
   [`proof-java`](https://github.com/Metonya/proof-java), verifies it
   against the published checksum, and installs it somewhere the
   extension already knows to look (no setting to configure). Already
   have a jar elsewhere? Point `proof.jarPath` at it instead.
2. Run **Quick Scan** for coverage and oracle findings, **Deep Scan** to
   also collect per-test line evidence, or right-click a file and choose
   **Mutation Test This Class** for mutation results on just that class.
3. Click through the Coverage / Test Quality / Line → Tests / Mutation
   views, or just read the gutter and hover over a line.

## Configuration

The most commonly changed settings (search `proof.` in Settings for the
full list):

| Setting | Default | Purpose |
|---|---|---|
| `proof.jarPath` | *(auto-detected)* | Path to `proof-java.jar`, if it isn't in one of the default locations |
| `proof.diffMode` | `uncommitted` | What counts as "changed": `no-vcs`, `uncommitted`, or `base` |
| `proof.baseRef` | *(none)* | The ref to diff against when `diffMode` is `base` |
| `proof.badgeMetric` | `sonar-compatible` | Which of the three coverage modes drives the gutter/badges |
| `proof.show.oraclelessLines` | `true` | Highlight covered-but-unasserted lines separately |
| `proof.mutationTimeout` | `300` | Per-module time budget (seconds) for mutation testing |

## Documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md): building, running, and testing
  the extension itself.
- [proof-java](https://github.com/Metonya/proof-java): the CLI this extension runs, and
  what each finding actually means.
- [`skills/proof-java`](https://github.com/Metonya/proof-java/tree/main/skills/proof-java):
  if you use an AI coding agent to write or repair tests, this is a skill
  for it. It runs `proof-java`, reads the verdict JSON, and acts on the
  findings in a loop instead of guessing whether a test is good.

## License

Not yet decided for this repository.
