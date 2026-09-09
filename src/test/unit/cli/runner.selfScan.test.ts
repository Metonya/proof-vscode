import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { buildAnalyzeArgs } from '../../../cli/argsBuilder';
import { run } from '../../../cli/runner';
import { parseVerdict } from '../../../verdict/parse';

/**
 * Plan.md Faz 5's own completion criterion: "proof-java'in kendisini tara;
 * başlık metrikleri CLI stdout'uyla birebir" - runs a real `java -jar
 * proof-java.jar analyze` against the sibling `proof-java` repo's own
 * proof-java-cli module (its own self-scan target) and asserts the
 * jacoco-line percent parsed from the JSON matches the percent the CLI's
 * own text report printed to stdout, parsed from the same real run - not
 * two independent computations, real end-to-end parity.
 *
 * Skips gracefully (not a failure) when the sibling repo/jar is not present
 * - this is a real, private dev-machine layout assumption (Desktop/proof-java
 * next to Desktop/proof-vscode), not something every clone will have.
 */
const CLI_REPO_ROOT = path.resolve(__dirname, '../../../../../proof-java/proof-java-cli');
const JAR_PATH = path.join(CLI_REPO_ROOT, 'target', 'proof-java.jar');
const REPORT_PATH = path.join(CLI_REPO_ROOT, 'target', 'site', 'jacoco', 'jacoco.xml');
const FIXTURES_PRESENT = fs.existsSync(JAR_PATH) && fs.existsSync(REPORT_PATH);

test('a real self-scan: JSON jacoco-line percent matches the CLI text report percent', { skip: !FIXTURES_PRESENT }, async () => {
	const outPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'proof-vscode-test-')), 'verdict.json');
	const args = buildAnalyzeArgs({
		repo: CLI_REPO_ROOT,
		diffMode: { kind: 'no-vcs' },
		reportPath: REPORT_PATH,
		outPath,
	});

	const handle = run({ javaExecutable: 'java', jarPath: JAR_PATH, args });
	const result = await handle.result;

	assert.ok(result.exitCode === 0 || result.exitCode === 3, `unexpected exit code ${result.exitCode}: ${result.stderr}`);

	const stdoutMatch = /jacoco-line\s+([\d.]+)%/.exec(result.stdout);
	assert.ok(stdoutMatch, `expected a "jacoco-line NN.N%" line in stdout, got:\n${result.stdout}`);
	const stdoutPercent = Number(stdoutMatch[1]);

	const raw = fs.readFileSync(outPath, 'utf8');
	const parsed = parseVerdict(raw);
	assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
	if (parsed.ok) {
		assert.equal(parsed.value.coverage.overall['jacoco-line']?.percent, stdoutPercent);
	}
});
