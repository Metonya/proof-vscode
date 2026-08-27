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

test('--out is always the last two args, so a caller can rely on args[args.length - 1]', () => {
	const args = buildAnalyzeArgs({
		repo: '/repo', diffMode: { kind: 'no-vcs' }, reportPath: 'jacoco.xml', outPath: '/tmp/out.json',
	});
	assert.equal(args[args.length - 2], '--out');
	assert.equal(args[args.length - 1], '/tmp/out.json');
});
