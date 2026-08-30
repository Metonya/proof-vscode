import { spawn } from 'node:child_process';
import { join } from 'node:path';

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
	/**
	 * `undefined` runs `javaExecutable` with `args` directly, no `-jar`
	 * wrapper - lets this same runner invoke a non-jar executable (e.g.
	 * Maven) when a caller needs to, not only `coverdict.jar`.
	 */
	jarPath?: string;
	args: string[];
	cwd?: string;
	/**
	 * Windows `.cmd`/`.bat` launchers (`mvn.cmd`) cannot be spawned
	 * directly since Node's CVE-2024-27980 fix - only set this for a
	 * command whose arguments are entirely constructed by us, never for
	 * anything carrying user text.
	 */
	shell?: boolean;
	/** Defaults to `process.env` (the extension host's own environment) when omitted. */
	env?: NodeJS.ProcessEnv;
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
	const argv = options.jarPath === undefined ? options.args : ['-jar', options.jarPath, ...options.args];
	const child = spawn(options.javaExecutable, argv, {
		cwd: options.cwd,
		env: options.env ?? process.env,
		shell: options.shell ?? false,
		// POSIX'te kendi süreç grubunu kurar, böylece iptal PIT'in çocuk
		// JVM'lerini de kapsar (bkz. killTree). Windows'ta anlamsız ve
		// `shell: true` ile birlikte konsol penceresi açtırabildiği için
		// verilmiyor - orada `taskkill /T` işi görüyor.
		detached: process.platform !== 'win32',
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
		cancel: () => killTree(child.pid),
	};
}

/**
 * Faz 20: `child.kill()` (çıplak SIGTERM) yetmiyor. PIT kendi çocuk
 * JVM'lerini ("minion") doğuruyor; yalnızca ana süreci öldürmek onları
 * arkada bırakır - Windows'ta bunlar dakikalarca CPU yakmaya devam eder
 * ve bir sonraki koşu classpath'i kilitli bulur. Saatler sürebilen bir
 * mutasyon koşusunda iptalin gerçekten iptal etmesi şart.
 *
 * Windows'ta süreç grubu kavramı yok, o yüzden `taskkill /T` (ağaç) ile
 * öldürülüyor. POSIX'te `spawn` `detached: true` ile kendi süreç grubunu
 * kurar ve negatif pid tüm gruba sinyal gönderir.
 *
 * Öldürme başarısızlığı yutuluyor: süreç zaten bitmiş olabilir (yarış),
 * ve iptal yolunda hata fırlatmak kullanıcıya gösterilecek bir şey
 * değildir - koşunun kendi `close` olayı sonucu zaten bildirecek.
 */
function killTree(pid: number | undefined): void {
	if (pid === undefined) {
		return;
	}
	if (process.platform === 'win32') {
		// `taskkill` PATH'ten çözülmüyor: PATH'e yazma hakkı olan biri araya
		// kendi `taskkill.exe`'sini koyabilirdi (Sonar S4036). Mutlak yol
		// `%SystemRoot%` üzerinden kuruluyor, değişken yoksa Windows'un
		// kendi varsayılanı kullanılıyor. Argümanların tamamı bizim
		// ürettiğimiz sabitler + sayısal pid.
		const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || String.raw`C:\Windows`;
		const taskkill = join(systemRoot, 'System32', 'taskkill.exe');
		try {
			spawn(taskkill, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => { /* zaten bitmiş */ });
		} catch { /* zaten bitmiş */ }
		return;
	}
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		try {
			process.kill(pid, 'SIGTERM');
		} catch { /* zaten bitmiş */ }
	}
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
