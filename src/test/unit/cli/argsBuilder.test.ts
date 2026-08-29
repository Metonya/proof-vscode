import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAnalyzeArgs } from '../../../cli/argsBuilder';

test('no-vcs mode', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo',
		diffMode: { kind: 'no-vcs' },
		reportPath: 'jacoco.xml',
		outPath: '/tmp/out.json',
	});
	assert.deepEqual(args, ['analyze', '--repo', '/repo', '--no-vcs', '--report', 'jacoco.xml', '--out', '/tmp/out.json']);
});

test('uncommitted mode', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo',
		diffMode: { kind: 'uncommitted' },
		reportPath: 'jacoco.xml',
		outPath: '/tmp/out.json',
	});
	assert.ok(args.includes('--uncommitted'));
	assert.ok(!args.includes('--no-vcs'));
});

test('base-ref mode includes the ref right after --base', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo',
		diffMode: { kind: 'base', ref: 'main' },
		reportPath: 'jacoco.xml',
		outPath: '/tmp/out.json',
	});
	const baseIndex = args.indexOf('--base');
	assert.ok(baseIndex >= 0);
	assert.equal(args[baseIndex + 1], 'main');
});

test('fileCoverage flag is only appended when true', () => {
	const withFlag = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json', fileCoverage: true,
	});
	const withoutFlag = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json', fileCoverage: false,
	});
	assert.ok(withFlag.includes('--file-coverage'));
	assert.ok(!withoutFlag.includes('--file-coverage'));
});

test('coverageExclusions is joined with commas into one --coverage-exclusions value', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		coverageExclusions: ['**/generated/**', 'src/main/java/**/*Dto.java'],
	});
	const flagIndex = args.indexOf('--coverage-exclusions');
	assert.ok(flagIndex >= 0);
	assert.equal(args[flagIndex + 1], '**/generated/**,src/main/java/**/*Dto.java');
});

test('an empty or absent coverageExclusions never appends the flag', () => {
	const absent = buildAnalyzeArgs({ repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json' });
	const empty = buildAnalyzeArgs({ repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json', coverageExclusions: [] });
	assert.ok(!absent.includes('--coverage-exclusions'));
	assert.ok(!empty.includes('--coverage-exclusions'));
});

test('perTest appends --per-test-report and --per-test-classpath id=path together', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		perTest: { classpathModuleId: 'root', classpathPath: 'mutation-classpath.txt' },
	});
	assert.ok(args.includes('--per-test-report'));
	const flagIndex = args.indexOf('--per-test-classpath');
	assert.ok(flagIndex >= 0);
	assert.equal(args[flagIndex + 1], 'root=mutation-classpath.txt');
});

test('an absent perTest never appends either flag', () => {
	const args = buildAnalyzeArgs({ repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json' });
	assert.ok(!args.includes('--per-test-report'));
	assert.ok(!args.includes('--per-test-classpath'));
});

test('perTest.targets appends one --per-test-target per FQCN, even under no-vcs (Faz 14b)', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		perTest: { classpathModuleId: 'root', classpathPath: 'coverdict-classpath.txt', targets: ['dev.example.Calculator'] },
	});
	const flagIndex = args.indexOf('--per-test-target');
	assert.ok(flagIndex >= 0);
	assert.equal(args[flagIndex + 1], 'root=dev.example.Calculator');
	assert.ok(args.includes('--no-vcs'), 'the builder itself does not reject no-vcs + a target - the CLI decides that');
});

test('perTest without targets never appends --per-test-target', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		perTest: { classpathModuleId: 'root', classpathPath: 'coverdict-classpath.txt' },
	});
	assert.ok(!args.includes('--per-test-target'));
});

test('--out is always the last two args, so a caller can rely on args[args.length - 1]', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
	});
	assert.equal(args.at(-2), '--out');
	assert.equal(args.at(-1), '/tmp/out.json');
});

/**
 * Faz 20: mutasyon bayrakları. `--mutation-classpath` `--per-test-classpath`
 * ile aynı dosya biçimini kullanır ama CLI ikisini ayrı opt-in sayar, o
 * yüzden burada da birleştirilmiyor.
 */
test('mutation appends --mutation-report, its own classpath flag and the timeout', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		mutation: { classpathModuleId: 'root', classpathPath: 'target/coverdict-classpath.txt', timeoutSeconds: 300 },
	});
	assert.ok(args.includes('--mutation-report'));
	assert.equal(args[args.indexOf('--mutation-classpath') + 1], 'root=target/coverdict-classpath.txt');
	assert.equal(args[args.indexOf('--mutation-timeout') + 1], '300');
	assert.ok(!args.includes('--per-test-report'), 'mutation must not silently drag L2 along - separate opt-ins');
});

test('mutation targets are passed one --mutation-target per class (D-71, diff-free entry)', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		mutation: { classpathModuleId: 'root', classpathPath: 'cp.txt', targets: ['dev.example.Calculator', 'dev.example.Other'] },
	});
	const targets = args.map((a, i) => (a === '--mutation-target' ? args[i + 1] : undefined)).filter(Boolean);
	assert.deepEqual(targets, ['root=dev.example.Calculator', 'root=dev.example.Other']);
	assert.ok(args.includes('--no-vcs'), 'the builder does not enforce the diff rule - a target lifts it CLI-side');
});

test('mutation without a timeout omits the flag rather than inventing the default', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		mutation: { classpathModuleId: 'root', classpathPath: 'cp.txt' },
	});
	assert.ok(!args.includes('--mutation-timeout'));
});

test('no mutation input means no mutation flags at all', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
	});
	assert.ok(!args.some((a) => a.startsWith('--mutation')));
});

test('without a module, --report stays the bare single-module shorthand', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
	});
	assert.ok(args.includes('--report'));
	assert.equal(args[args.indexOf('--report') + 1], 'jacoco.xml');
	assert.ok(!args.includes('--module'));
});

test('a module binding adds --module and switches --report to the id=path form (Faz 29)', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'gson/target/site/jacoco/jacoco.xml', outPath: '/tmp/out.json',
		module: { id: 'root', root: 'gson' },
	});
	const moduleIndex = args.indexOf('--module');
	assert.ok(moduleIndex >= 0);
	assert.equal(args[moduleIndex + 1], 'root=gson');
	const reportIndex = args.indexOf('--report');
	assert.equal(args[reportIndex + 1], 'root=gson/target/site/jacoco/jacoco.xml');
});
