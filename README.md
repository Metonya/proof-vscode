# coverdict-vscode

VS Code / Cursor / Windsurf extension for [coverdict](https://github.com/) - runs the coverdict CLI and renders its JSON verdict: inline coverage gutter, "which tests cover this line", and mutation findings.

Not published anywhere. Private dogfood only for now - the formal v1 schema
freeze (coverdict's Plan.md Faz 3) is deliberately skipped until there is a
real reason to distribute this.

## Status

**Start here: [`docs/PLAN.md`](docs/PLAN.md)** - the single handoff document.
It covers what the CLI contract is, how this extension is built and tested,
which rules are never broken, what works today, and what is still open.
[`docs/NOTES.md`](docs/NOTES.md) is the chronological log behind those
decisions; `PLAN.md` wins where they disagree.

Faz 19 done (2026-08-28): the extension runs coverdict, renders Explorer
coverage badges and an editor gutter through its own decoration types
(the native VS Code Test Coverage API was dropped - it has no documented
way to clear or independently control its two rendering surfaces), shows
per-line test evidence and its oracle quality via hover and a tree,
lists every finding in the Problems panel, and has its own Activity Bar
container (Çalıştır / Coverage / Test Kalitesi / Satır → Testler) so no
step requires the Command Palette. Mutation testing has CLI support but
**no UI yet** - that is Faz 20, planned in `docs/PLAN.md` §8.

## Layout

```
src/
  extension.ts   activate/deactivate + registration only, no logic
  cli/           jar location, argv building, spawn/cancel, Maven classpath generation
  verdict/       verdict JSON types + parsing, test-identity, line mapping (never throws)
  model/         single-source-of-truth store, path/line indexing, staleness, test quality
  ui/            gutter, hover, tree views, explorer badges, status bar, diagnostics, commands
  test/
    unit/          plain node:test - no `vscode` import anywhere under here
    integration/   @vscode/test-cli, runs inside a real Extension Host
```

Two rules that hold for the whole project, not just this skeleton:

- `verdict/` and `model/` never `import 'vscode'` - they run under plain
  Node, are unit-tested with `node --test`, and are what a later AI-skill
  integration would reuse as-is.
- The extension never parses JaCoCo XML, runs git, or computes a coverage
  percentage itself - every number comes from the CLI's own JSON.

## Requires

A locally built `coverdict.jar` (`mvn -pl coverdict-cli package` in the
`coverdict` repo). The extension looks for it via `coverdict.jarPath`, then
`${workspaceFolder}/coverdict-cli/target/coverdict.jar`, then
`${workspaceFolder}/.coverdict/coverdict.jar`.

## Develop

```bash
npm install
npm run watch      # esbuild + tsc, both in watch mode
```

Press F5 (`Run Extension`) to launch a development Extension Host window.

## Test

```bash
npm test           # compiles tests, then unit + integration
npm run test:unit  # plain node:test, no VS Code needed
```
