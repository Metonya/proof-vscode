# coverdict-vscode

VS Code / Cursor / Windsurf extension for [coverdict](https://github.com/) - runs the coverdict CLI and renders its JSON verdict: inline coverage gutter, "which tests cover this line", and mutation findings.

Not published anywhere. Private dogfood only for now - the formal v1 schema
freeze (coverdict's Plan.md Faz 3) is deliberately skipped until there is a
real reason to distribute this.

## Status

Faz 4 (skeleton) of `coverdict/Plan.md`'s M6: the extension activates and
does nothing visible yet. See that plan for the full feature list and phase
order.

## Layout

```
src/
  extension.ts   activate/deactivate + registration only, no logic
  cli/           jar location, argv building, spawn/cancel, stderr progress parsing
  verdict/       verdict JSON types + parsing, test-identity, metrics (never throws)
  model/         single-source-of-truth store, path/line indexing, freshness, diff, cache
  ui/            gutter, hover, panel, tree view, status bar, commands
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
npm test           # compiles tests, runs the integration suite in a real Extension Host
npm run test:unit  # once verdict/model/ have real logic - plain node:test, no VS Code needed
```
