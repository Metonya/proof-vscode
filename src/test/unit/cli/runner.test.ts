import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { run } from '../../../cli/runner';

/**
 * These exercise run()'s own spawn/line-buffering/exit-code/cancel logic in
 * isolation, using `node -e` as a stand-in process instead of the real
 * `proof-java.jar` - unlike runner.perTest.test.ts / runner.selfScan.test.ts
 * (which need the real jar and sibling repo and skip when those are
 * missing), these always run.
 */

test('jarPath present prepends -jar and jarPath ahead of args (node itself rejects the resulting -jar flag, proving the shape)', async () => {
	const lines: string[] = [];
	const handle = run({
		javaExecutable: process.execPath,
		jarPath: 'fake.jar',
		args: ['ignored'],
		onStderrLine: (line) => lines.push(line),
	});

	const result = await handle.result;

	assert.equal(result.exitCode, 9);
	assert.ok(lines.some((line) => line.includes('bad option: -jar')), `expected a "bad option: -jar" stderr line, got: ${JSON.stringify(lines)}`);
});

test('jarPath undefined runs javaExecutable with args directly (no -jar wrapper)', async () => {
	const handle = run({
		javaExecutable: process.execPath,
		args: ['-e', 'process.stdout.write("hello\\n"); process.exit(0);'],
	});

	const result = await handle.result;

	assert.equal(result.exitCode, 0);
	assert.equal(result.stdout, 'hello\n');
});

test('stdout is split into lines and each line reaches onStdoutLine', async () => {
	const lines: string[] = [];
	const handle = run({
		javaExecutable: process.execPath,
		args: ['-e', 'console.log("one"); console.log("two"); console.log("three");'],
		onStdoutLine: (line) => lines.push(line),
	});

	const result = await handle.result;

	assert.equal(result.exitCode, 0);
	assert.deepEqual(lines, ['one', 'two', 'three']);
	assert.equal(result.stdout, 'one\ntwo\nthree\n');
});

test('stderr is line-buffered separately from stdout', async () => {
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];
	const handle = run({
		javaExecutable: process.execPath,
		args: ['-e', 'console.log("out-line"); console.error("err-line");'],
		onStdoutLine: (line) => stdoutLines.push(line),
		onStderrLine: (line) => stderrLines.push(line),
	});

	const result = await handle.result;

	assert.deepEqual(stdoutLines, ['out-line']);
	assert.deepEqual(stderrLines, ['err-line']);
	assert.equal(result.stderr, 'err-line\n');
});

test('a final chunk with no trailing newline is still flushed as a line on close', async () => {
	const lines: string[] = [];
	const handle = run({
		javaExecutable: process.execPath,
		args: ['-e', 'process.stdout.write("no-newline-at-end")'],
		onStdoutLine: (line) => lines.push(line),
	});

	const result = await handle.result;

	assert.equal(result.exitCode, 0);
	assert.deepEqual(lines, ['no-newline-at-end']);
});

test('a non-zero exit code is reported in the resolved result', async () => {
	const handle = run({
		javaExecutable: process.execPath,
		args: ['-e', 'process.exit(7);'],
	});

	const result = await handle.result;

	assert.equal(result.exitCode, 7);
	assert.equal(result.signal, null);
});

test('cancel() terminates a still-running child before it exits on its own', async () => {
	const handle = run({
		javaExecutable: process.execPath,
		// Sleeps far longer than the test timeout would allow if cancel() did nothing.
		args: ['-e', 'setTimeout(() => process.exit(0), 30000);'],
	});

	handle.cancel();
	const result = await handle.result;

	assert.notEqual(result.exitCode, 0);
});

test('cancel() on an already-exited process is a no-op that does not throw', async () => {
	const handle = run({
		javaExecutable: process.execPath,
		args: ['-e', 'process.exit(0);'],
	});

	const result = await handle.result;
	assert.equal(result.exitCode, 0);

	assert.doesNotThrow(() => handle.cancel());
});

test('env defaults to process.env when omitted, and a custom env is honored', async () => {
	const lines: string[] = [];
	const handle = run({
		javaExecutable: process.execPath,
		args: ['-e', 'process.stdout.write(process.env.RUNNER_TEST_MARKER || "missing")'],
		env: { ...process.env, RUNNER_TEST_MARKER: 'present' },
		onStdoutLine: (line) => lines.push(line),
	});

	const result = await handle.result;

	assert.equal(result.exitCode, 0);
	assert.deepEqual(lines, ['present']);
});
