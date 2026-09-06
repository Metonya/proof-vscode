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

test('perTest appends --per-test-report and one --per-test-classpath id=path per entry', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		perTest: { classpaths: [{ moduleId: 'root', path: 'mutation-classpath.txt' }] },
	});
	assert.ok(args.includes('--per-test-report'));
	const flagIndex = args.indexOf('--per-test-classpath');
	assert.ok(flagIndex >= 0);
	assert.equal(args[flagIndex + 1], 'root=mutation-classpath.txt');
});

/** Faz 30: a multi-module run needs one --per-test-classpath per module - the CLI validates each id independently, there is no repo-wide classpath. */
test('perTest with several classpaths emits one --per-test-classpath per module', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		perTest: { classpaths: [{ moduleId: 'gson', path: 'gson/cp.txt' }, { moduleId: 'extras', path: 'extras/cp.txt' }] },
	});
	const flags = args.map((a, i) => (a === '--per-test-classpath' ? args[i + 1] : undefined)).filter(Boolean);
	assert.deepEqual(flags, ['gson=gson/cp.txt', 'extras=extras/cp.txt']);
});

test('an absent perTest never appends either flag', () => {
	const args = buildAnalyzeArgs({ repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json' });
	assert.ok(!args.includes('--per-test-report'));
	assert.ok(!args.includes('--per-test-classpath'));
});

test('perTest.targets appends one --per-test-target per FQCN, using each target\'s own module id, even under no-vcs (Faz 14b)', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		perTest: { classpaths: [{ moduleId: 'root', path: 'proof-classpath.txt' }], targets: [{ moduleId: 'root', fqcn: 'dev.example.Calculator' }] },
	});
	const flagIndex = args.indexOf('--per-test-target');
	assert.ok(flagIndex >= 0);
	assert.equal(args[flagIndex + 1], 'root=dev.example.Calculator');
	assert.ok(args.includes('--no-vcs'), 'the builder itself does not reject no-vcs + a target - the CLI decides that');
});

test('perTest without targets never appends --per-test-target', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		perTest: { classpaths: [{ moduleId: 'root', path: 'proof-classpath.txt' }] },
	});
	assert.ok(!args.includes('--per-test-target'));
});

test('perTest.timeoutSeconds appends --per-test-timeout, mirroring mutation\'s own timeout flag (Faz 31)', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		perTest: { classpaths: [{ moduleId: 'root', path: 'proof-classpath.txt' }], timeoutSeconds: 180 },
	});
	assert.equal(args[args.indexOf('--per-test-timeout') + 1], '180');
});

test('perTest without an explicit timeoutSeconds never appends --per-test-timeout', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		perTest: { classpaths: [{ moduleId: 'root', path: 'proof-classpath.txt' }] },
	});
	assert.ok(!args.includes('--per-test-timeout'));
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
		mutation: { classpaths: [{ moduleId: 'root', path: 'target/proof-classpath.txt' }], timeoutSeconds: 300 },
	});
	assert.ok(args.includes('--mutation-report'));
	assert.equal(args[args.indexOf('--mutation-classpath') + 1], 'root=target/proof-classpath.txt');
	assert.equal(args[args.indexOf('--mutation-timeout') + 1], '300');
	assert.ok(!args.includes('--per-test-report'), 'mutation must not silently drag L2 along - separate opt-ins');
});

test('mutation with several classpaths emits one --mutation-classpath per module', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		mutation: { classpaths: [{ moduleId: 'gson', path: 'gson/cp.txt' }, { moduleId: 'extras', path: 'extras/cp.txt' }] },
	});
	const flags = args.map((a, i) => (a === '--mutation-classpath' ? args[i + 1] : undefined)).filter(Boolean);
	assert.deepEqual(flags, ['gson=gson/cp.txt', 'extras=extras/cp.txt']);
});

test('mutation targets are passed one --mutation-target per class, each with its own module id (D-71, diff-free entry)', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		mutation: {
			classpaths: [{ moduleId: 'root', path: 'cp.txt' }],
			targets: [{ moduleId: 'root', fqcn: 'dev.example.Calculator' }, { moduleId: 'root', fqcn: 'dev.example.Other' }],
		},
	});
	const targets = args.map((a, i) => (a === '--mutation-target' ? args[i + 1] : undefined)).filter(Boolean);
	assert.deepEqual(targets, ['root=dev.example.Calculator', 'root=dev.example.Other']);
	assert.ok(args.includes('--no-vcs'), 'the builder does not enforce the diff rule - a target lifts it CLI-side');
});

test('mutation without a timeout omits the flag rather than inventing the default', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'uncommitted' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
		mutation: { classpaths: [{ moduleId: 'root', path: 'cp.txt' }] },
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

/** Faz 30: `modules` is the real multi-module binding - repeats --module/--report once per entry, and takes priority over reportPath/module when both happen to be set. */
test('modules[] repeats --module and --report once per entry, all --module flags before any --report', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, outPath: '/tmp/out.json',
		modules: [
			{ id: 'gson', root: 'gson', reportPath: 'gson/target/site/jacoco/jacoco.xml' },
			{ id: 'extras', root: 'extras', reportPath: 'extras/target/site/jacoco/jacoco.xml' },
		],
	});
	assert.deepEqual(
		args.filter((a) => a.includes('=')),
		['gson=gson', 'extras=extras', 'gson=gson/target/site/jacoco/jacoco.xml', 'extras=extras/target/site/jacoco/jacoco.xml'],
	);
});

test('a single-entry modules[] is indistinguishable in shape from module+reportPath (same --module/--report pair)', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, outPath: '/tmp/out.json',
		modules: [{ id: 'root', root: 'gson', reportPath: 'gson/target/site/jacoco/jacoco.xml' }],
	});
	const moduleIndex = args.indexOf('--module');
	assert.equal(args[moduleIndex + 1], 'root=gson');
	const reportIndex = args.indexOf('--report');
	assert.equal(args[reportIndex + 1], 'root=gson/target/site/jacoco/jacoco.xml');
});

test('an empty modules[] falls back to reportPath/module rather than emitting nothing', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json', modules: [],
	});
	assert.equal(args[args.indexOf('--report') + 1], 'jacoco.xml');
	assert.ok(!args.includes('--module'));
});

