import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { test } from 'node:test';

import { parseClasspathOutput } from '../../../cli/classpathParser';

const SEP = path.delimiter;

/**
 * Faz 19: `mvn -q dependency:build-classpath` classpath'i tek satırda,
 * platformun kendi ayırıcısıyla basar - ama `-q` altında bile uyarı/indirme
 * satırları araya girebiliyor, o yüzden ayrıştırıcı en uzun aday satırı
 * seçiyor. Boş dönerse çağıran ham çıktıyı loglayıp durur, yarım liste
 * yazmaz (hard rule 3a).
 */
test('parses a single classpath line split by the platform separator', () => {
	const entries = parseClasspathOutput(`/a/one.jar${SEP}/a/two.jar${SEP}/a/three.jar\n`);
	assert.deepEqual(entries, ['/a/one.jar', '/a/two.jar', '/a/three.jar']);
});

test('ignores Maven log noise and picks the real classpath line', () => {
	const stdout = [
		'[INFO] Scanning for projects...',
		'Downloading from central: https://repo.maven.apache.org/x.jar',
		`/a/one.jar${SEP}/a/two.jar`,
		'[INFO] BUILD SUCCESS',
	].join('\n');
	assert.deepEqual(parseClasspathOutput(stdout), ['/a/one.jar', '/a/two.jar']);
});

test('empty or log-only output yields an empty list rather than a bogus entry', () => {
	assert.deepEqual(parseClasspathOutput(''), []);
	assert.deepEqual(parseClasspathOutput('[INFO] nothing here\n[INFO] still nothing\n'), []);
});

test('a single-entry classpath still parses', () => {
	assert.deepEqual(parseClasspathOutput('/only/one.jar\n'), ['/only/one.jar']);
});
