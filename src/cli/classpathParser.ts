import * as path from 'node:path';

/**
 * Faz 19: `mvn -q dependency:build-classpath` classpath'i tek satırda,
 * platformun kendi ayırıcısıyla basar - ama `-q` altında bile uyarı ve
 * indirme satırları araya girebiliyor. Ayırıcıyı içeren en uzun aday satır
 * seçilir; hiçbir aday yoksa boş dizi döner ve çağıran ham çıktıyı loglayıp
 * durur - yarım bir liste yazmaktansa hiç yazmamak yeğdir (hard rule 3a).
 *
 * Saf - `vscode` import etmez (`cli/argsBuilder.ts` ile aynı sözleşme), bu
 * yüzden düz `node --test` ile test edilebilir; `vscode`'a ihtiyaç duyan
 * spawn/yazma tarafı `cli/classpathBuilder.ts`'te.
 */
export function parseClasspathOutput(stdout: string): string[] {
	const candidate = stdout
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('[') && !line.startsWith('Downloading') && !line.startsWith('Progress'))
		.sort((a, b) => b.length - a.length)[0];
	if (!candidate) {
		return [];
	}
	return candidate.split(path.delimiter).map((e) => e.trim()).filter(Boolean);
}
