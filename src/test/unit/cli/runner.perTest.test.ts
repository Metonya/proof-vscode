import * as assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

import { buildAnalyzeArgs } from '../../../cli/argsBuilder';
import { run } from '../../../cli/runner';
import { testsForClass } from '../../../model/lineIndex';
import { parseTestIdentity } from '../../../verdict/testIdentity';
import { parseVerdict } from '../../../verdict/parse';

/**
 * F3's own completion criterion (Plan.md Bölüm 7): "Gerçek --per-test-report
 * koşusu". Runs a real `java -jar coverdict.jar analyze --base <first
 * commit> --per-test-report` against coverdict-playground and proves the
 * whole F3 pipeline end to end: parseVerdict accepts the real perTest
 * block, testsForClass finds Calculator's real lines, and
 * parseTestIdentity handles the real (and unanticipated: class-name-
 * prefixed, not bare JUnit5 UniqueId) test-id shape PIT actually produced.
 *
 * Skips gracefully when the sibling repo/jar/classpath file are not
 * present - see runner.selfScan.test.ts for the same pattern and reasoning.
 */
const PLAYGROUND_ROOT = path.resolve(__dirname, '../../../../../coverdict-playground');
const JAR_PATH = path.resolve(__dirname, '../../../../../coverdict/coverdict-cli/target/coverdict.jar');
const REPORT_PATH = path.join(PLAYGROUND_ROOT, 'target', 'site', 'jacoco', 'jacoco.xml');
const CLASSPATH_PATH = path.join(PLAYGROUND_ROOT, 'mutation-classpath.txt');
const FIXTURES_PRESENT = fs.existsSync(JAR_PATH) && fs.existsSync(REPORT_PATH) && fs.existsSync(CLASSPATH_PATH) && fs.existsSync(PLAYGROUND_ROOT);

test('a real --per-test-report run: perTest parses, testsForClass finds real lines, testIdentity handles the real id shape', { skip: !FIXTURES_PRESENT }, async () => {
	const firstCommit = execSync('git rev-list --max-parents=0 HEAD', { cwd: PLAYGROUND_ROOT, encoding: 'utf8' }).trim();

	const outPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'coverdict-vscode-test-')), 'verdict.json');
	const args = buildAnalyzeArgs({
		repo: PLAYGROUND_ROOT,
		diffMode: { kind: 'base', ref: firstCommit },
		reportPath: REPORT_PATH,
		outPath,
		perTest: { classpathModuleId: 'root', classpathPath: CLASSPATH_PATH },
	});

	const result = await run({ javaExecutable: 'java', jarPath: JAR_PATH, args }).result;
	assert.ok(result.exitCode === 0 || result.exitCode === 3, `unexpected exit code ${result.exitCode}: ${result.stderr}`);

	const parsed = parseVerdict(fs.readFileSync(outPath, 'utf8'));
	assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
	if (!parsed.ok) {
		return;
	}
	assert.ok(parsed.value.perTest, 'expected a real perTest block');

	const lookup = testsForClass(parsed.value.perTest, 'root', 'dev.coverdict.playground.Calculator');
	assert.equal(lookup.kind, 'found');
	if (lookup.kind !== 'found') {
		return;
	}

	const line7Tests = lookup.linesToTests.get(7) ?? [];
	assert.ok(line7Tests.length > 0, 'expected at least one test covering Calculator.java line 7 (add)');

	const displayed = line7Tests.map((t) => parseTestIdentity(t).display);
	assert.ok(
		displayed.some((d) => d.includes('CalculatorGoodTest#addWorksCorrectly()')),
		`expected a resolved "...CalculatorGoodTest#addWorksCorrectly()" display, got: ${JSON.stringify(displayed)}`,
	);
});
