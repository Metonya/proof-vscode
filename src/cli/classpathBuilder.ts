import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { parseClasspathOutput } from './classpathParser';
import { run } from './runner';

/**
 * Faz 19: derin tarama, testlerin tam çalışma zamanı classpath'ini satır
 * satır listeleyen bir dosyaya ihtiyaç duyar. Bugüne kadar bunu kullanıcı
 * elle üretmek zorundaydı (playground'daki `run.ps1`'in yaptığı iş) - ve
 * `mvn clean` her seferinde siliyordu, sonra derin tarama sessizce
 * `PER_TEST_CLASSPATH_MISSING` ile boş dönüyordu. Kullanıcının kendi sözü:
 * "kullanıcı bu dosyayı üretmeyecek dimi, onu bizim üretmemiz gerekmez mi".
 *
 * Artık eksikse eklenti kendisi üretiyor: `mvn -q dependency:build-classpath`
 * bağımlılık listesini stdout'a basar, sonuna derlenmiş çıktı dizinleri
 * eklenir. Maven yoksa ya da komut başarısız olursa sebep kullanıcıya
 * aynen gösterilir - sessizce yarım bir liste yazmaktansa hiç yazmamak
 * yeğdir (hard rule 3a).
 */
export interface ClasspathBuildResult {
	ok: boolean;
	/** Ne olduğunu kullanıcıya gösterecek tek satır - başarıda da başarısızlıkta da doludur. */
	message: string;
}

export async function buildPerTestClasspath(
	workspaceRoot: string,
	classpathPath: string,
	output: vscode.OutputChannel,
): Promise<ClasspathBuildResult> {
	const isWindows = process.platform === 'win32';
	const mavenExecutable = vscode.workspace
		.getConfiguration('coverdict', vscode.Uri.file(workspaceRoot))
		.get<string>('mavenExecutable') || (isWindows ? 'mvn.cmd' : 'mvn');

	output.appendLine(`coverdict: ${mavenExecutable} -q dependency:build-classpath (${workspaceRoot})`);

	let stdout: string;
	try {
		const handle = run({
			javaExecutable: mavenExecutable,
			args: ['-q', 'dependency:build-classpath'],
			cwd: workspaceRoot,
			// Windows'ta `mvn.cmd` bir toplu iş dosyası; Node'un
			// CVE-2024-27980 düzeltmesinden beri doğrudan spawn edilemiyor.
			// Argümanların tamamı burada sabit - kullanıcı metni taşımıyor.
			shell: isWindows,
			onStderrLine: (line) => output.appendLine(line),
		});
		const result = await handle.result;
		if (result.exitCode !== 0) {
			output.appendLine(result.stdout);
			return { ok: false, message: `Maven classpath komutu başarısız oldu (çıkış kodu ${result.exitCode}). Ayrıntı için Output → coverdict.` };
		}
		stdout = result.stdout;
	} catch (e) {
		return { ok: false, message: `"${mavenExecutable}" çalıştırılamadı: ${(e as Error).message}. coverdict.mavenExecutable ayarını kontrol edin.` };
	}

	const entries = parseClasspathOutput(stdout);
	if (entries.length === 0) {
		output.appendLine(stdout);
		return { ok: false, message: 'Maven boş bir classpath döndürdü - projede bağımlılık çözülemedi. Ayrıntı için Output → coverdict.' };
	}
	// PIT'in testleri bulabilmesi için derlenmiş çıktı dizinleri de gerekir;
	// `dependency:build-classpath` yalnızca bağımlılıkları listeler.
	entries.push('target/classes', 'target/test-classes');

	const absoluteTarget = path.join(workspaceRoot, ...classpathPath.split('/'));
	try {
		await fs.promises.mkdir(path.dirname(absoluteTarget), { recursive: true });
		await fs.promises.writeFile(absoluteTarget, entries.join('\n') + '\n', 'utf8');
	} catch (e) {
		return { ok: false, message: `Classpath dosyası yazılamadı (${classpathPath}): ${(e as Error).message}` };
	}
	return { ok: true, message: `${classpathPath} üretildi (${entries.length} girdi).` };
}

