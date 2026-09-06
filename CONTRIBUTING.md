# Contributing

This covers building, running, and testing the extension itself. For what
it does and how to use it, see [`README.md`](README.md).

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

A locally built `proof-java.jar` (`mvn -pl proof-java-cli package` in the
`proof-java` repo). The extension looks for it via `proof.jarPath`, then
`${workspaceFolder}/proof-java-cli/target/proof-java.jar`, then
`${workspaceFolder}/.proof-java/proof-java.jar`.

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

Clean run (use this if something looks off):

```bash
rm -rf out dist coverage && npm run pretest && npm run test:unit:coverage && node esbuild.js && npm run test:integration
```

## Packaging

```bash
npx @vscode/vsce package
```

Produces a `.vsix` you can install locally via "Extensions: Install from
VSIX..." in the Command Palette. Not published to the Marketplace yet.

## Sonar

```bash
sonar-scanner -Dsonar.host.url=http://localhost:9001 -Dsonar.token=$SONAR_TOKEN
```

(`sonar-project.properties` at the repo root has the rest of the config.)
New findings should always be zero.
