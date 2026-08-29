/**
 * Pure: answers two yes/no questions about a pom.xml's raw text, needed
 * before the extension can offer to run tests on the user's behalf
 * (Faz 30, §7.8's "if there's no JaCoCo report, offer to run tests"
 * follow-up). Targeted regex/line scanning, not a real XML parser - three
 * narrow questions do not justify a new dependency, and a false negative
 * here only means an extra warning shown or an extra goal injected, never
 * a silent wrong answer (the caller never uses this to suppress a warning,
 * only to decide whether to add a goal or show one).
 */

export interface PomFacts {
	/** Does this pom declare `jacoco-maven-plugin` as a `<plugin>`? If so, its own build already knows how to produce a report - don't inject the CLI goals on top of it. */
	hasJacocoPlugin: boolean;
	/**
	 * A literal (non-`@{argLine}`/`${argLine}`) `<argLine>` value, if this
	 * pom has one - the exact shape that clobbers a command-line-injected
	 * JaCoCo agent property (gson's real pom, verified this session:
	 * `<argLine>--illegal-access=deny</argLine>` silently produced an empty
	 * `jacoco.exec`). `undefined` when no `<argLine>` exists, or the one
	 * that does already forwards the user property correctly.
	 */
	literalArgLine: { line: number; text: string } | undefined;
}

const JACOCO_PLUGIN_PATTERN = /<artifactId>\s*jacoco-maven-plugin\s*<\/artifactId>/;
const ARG_LINE_PATTERN = /<argLine>([^<]*)<\/argLine>/;

export function inspectPom(pomXml: string): PomFacts {
	return {
		hasJacocoPlugin: JACOCO_PLUGIN_PATTERN.test(pomXml),
		literalArgLine: findLiteralArgLine(pomXml),
	};
}

function findLiteralArgLine(pomXml: string): { line: number; text: string } | undefined {
	const lines = pomXml.split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const match = ARG_LINE_PATTERN.exec(lines[i]);
		if (!match) {
			continue;
		}
		const value = match[1];
		if (!value.includes('@{argLine}') && !value.includes('${argLine}')) {
			return { line: i + 1, text: lines[i].trim() };
		}
	}
	return undefined;
}
