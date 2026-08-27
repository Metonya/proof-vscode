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

test('--out is always the last two args, so a caller can rely on args[args.length - 1]', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
	});
	assert.equal(args.at(-2), '--out');
	assert.equal(args.at(-1), '/tmp/out.json');
});
