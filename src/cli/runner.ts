import { spawn } from 'child_process';

/**
 * Spawns `java -jar <jarPath> <args>`, no `vscode` import (child_process is
 * enough) - the command handler in ui/commands.ts owns the `vscode`-facing
 * parts (progress UI, cancellation token wiring). stdout/stderr are line-
 * buffered separately: stdout carries the CLI's own text report, stderr
 * carries transient progress (D-64's contract on the CLI side) - see
 * progressParser.ts for turning a stderr line into a structured event.
 */

export interface RunOptions {
	javaExecutable: string;
	jarPath: string;
	args: string[];
	cwd?: string;
	onStdoutLine?: (line: string) => void;
	onStderrLine?: (line: string) => void;
}

export interface RunResult {
	exitCode: number | null;
	signal: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
}

export interface RunHandle {
	result: Promise<RunResult>;
	cancel: () => void;
}

export function run(options: RunOptions): RunHandle {
	const child = spawn(options.javaExecutable, ['-jar', options.jarPath, ...options.args], {
		cwd: options.cwd,
	});

	let stdoutAll = '';
	let stderrAll = '';
	const stdoutBuffer = lineBuffer((line) => {
		stdoutAll += line + '\n';
		options.onStdoutLine?.(line);
	});
	const stderrBuffer = lineBuffer((line) => {
		stderrAll += line + '\n';
		options.onStderrLine?.(line);
	});

	child.stdout.on('data', (chunk: Buffer) => stdoutBuffer.push(chunk.toString('utf8')));
	child.stderr.on('data', (chunk: Buffer) => stderrBuffer.push(chunk.toString('utf8')));

	const result = new Promise<RunResult>((resolve, reject) => {
		child.on('error', reject);
		child.on('close', (code, signal) => {
			stdoutBuffer.flush();
			stderrBuffer.flush();
			resolve({ exitCode: code, signal, stdout: stdoutAll, stderr: stderrAll });
		});
	});

	return {
		result,
		cancel: () => child.kill(),
	};
}

/** Buffers partial chunks until a full line is available - spawn gives no guarantee a chunk boundary lands on a newline. */
function lineBuffer(onLine: (line: string) => void) {
	let buffer = '';
	return {
		push(chunk: string) {
			buffer += chunk;
			let newlineIndex: number;
			while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
				onLine(buffer.slice(0, newlineIndex).replace(/\r$/, ''));
				buffer = buffer.slice(newlineIndex + 1);
			}
		},
		flush() {
			if (buffer.length > 0) {
				onLine(buffer.replace(/\r$/, ''));
				buffer = '';
			}
		},
	};
}
