/**
 * Pure: recognizes a small, closed set of Maven failure shapes from raw
 * subprocess output and turns them into an honest, actionable Turkish
 * sentence - never a guess. An unrecognized failure returns `undefined`
 * and the caller falls back to "ayrıntı için Output → coverdict kanalına
 * bakın" with the raw text already logged - hard rule 3a: an unrecognized
 * cause is never invented.
 *
 * Every shape here was verified against a real failure this session
 * (`mavenErrorInterpreter.test.ts` fixtures are the literal captured text),
 * not written from documentation.
 */

export type MavenFailureKind = 'unresolvedReactorSibling' | 'noPluginPrefix' | 'enforcerJdk';

export interface MavenFailureInterpretation {
	kind: MavenFailureKind;
	/** Ready-to-show Turkish sentence explaining the cause. */
	detail: string;
}

const UNRESOLVED_ARTIFACT_PATTERN = /Could not find artifact ([\w.-]+:[\w.-]+:jar:[\w.-]+)/;
const NO_PLUGIN_PREFIX_PATTERN = /No plugin found for prefix '([^']+)'/;
const ENFORCER_JDK_PATTERN = /Detected JDK Version:.*is not in the allowed range[^\n]*/;

export function interpretMavenFailure(output: string): MavenFailureInterpretation | undefined {
	return interpretUnresolvedReactorSibling(output) ?? interpretNoPluginPrefix(output) ?? interpretEnforcerJdk(output);
}

/**
 * D-67's exact shape: `dependency:build-classpath` resolves a reactor
 * sibling module through its **installed** jar in `~/.m2`, never through
 * its freshly-built `target/classes` - a module that depends on a sibling
 * that has never been `mvn install`-ed fails with both of these lines
 * together (verified against this session's real gson `test-jpms` output,
 * before that install had happened):
 *
 *   Could not resolve dependencies for project com.google.code.gson:test-jpms:...
 *   Could not find artifact com.google.code.gson:gson:jar:2.14.1-SNAPSHOT
 */
function interpretUnresolvedReactorSibling(output: string): MavenFailureInterpretation | undefined {
	if (!output.includes('Could not resolve dependencies for project')) {
		return undefined;
	}
	const match = UNRESOLVED_ARTIFACT_PATTERN.exec(output);
	if (!match) {
		return undefined;
	}
	return {
		kind: 'unresolvedReactorSibling',
		detail: `Maven, aynı repo içindeki \`${match[1]}\` modülünü yerel depoda bulamadı - bu modül henüz kurulmamış. Kardeş modüllerin classpath'i, önce bir kez \`mvn install -DskipTests\` çalıştırılmadan üretilemez.`,
	};
}

/** A pom with no `jacoco-maven-plugin` declared cannot resolve the short `jacoco:report` goal form - coverdict always uses the full coordinate, so seeing this means something else on the machine (a script, a stale alias) tried the short form. */
function interpretNoPluginPrefix(output: string): MavenFailureInterpretation | undefined {
	const match = NO_PLUGIN_PREFIX_PATTERN.exec(output);
	if (!match) {
		return undefined;
	}
	return {
		kind: 'noPluginPrefix',
		detail: `Bu projenin pom'unda JaCoCo eklentisi tanımlı değil, kısa "${match[1]}:..." biçimi çalışmıyor. coverdict kendi komutlarında her zaman tam koordinatı (org.jacoco:jacoco-maven-plugin:<sürüm>:...) kullanır.`,
	};
}

/** Quotes Maven's own sentence verbatim rather than paraphrasing a version range coverdict does not know. */
function interpretEnforcerJdk(output: string): MavenFailureInterpretation | undefined {
	const match = ENFORCER_JDK_PATTERN.exec(output);
	if (!match) {
		return undefined;
	}
	return {
		kind: 'enforcerJdk',
		detail: `Maven'ın kendi mesajı: "${match[0].trim()}". coverdict.javaExecutable / JAVA_HOME'un işaret ettiği JDK'yı bu projenin beklediği aralığa göre ayarlayın.`,
	};
}
