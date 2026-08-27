/**
 * Best-effort FQCN for a Java source file: the file's own `package`
 * declaration plus its base name (the standard one-public-top-level-class-
 * per-file convention `perTest`'s `className` values already assume on the
 * production side). Pure - no `vscode`. Deliberately narrow: a file with
 * more than one top-level class, or a nonstandard filename/class-name
 * mismatch, is not detected here - F3 degrades to "class not found in
 * perTest evidence" for those rather than guessing which class it meant
 * (hard rule 3a).
 */
const PACKAGE_DECLARATION = /^\s*package\s+([\w.]+)\s*;/m;

export function detectClassName(sourceText: string, fileBaseNameWithoutExtension: string): string {
	const match = PACKAGE_DECLARATION.exec(sourceText);
	return match ? `${match[1]}.${fileBaseNameWithoutExtension}` : fileBaseNameWithoutExtension;
}
