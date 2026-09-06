/**
 * Pure: recognizes a small, closed set of Maven failure shapes from raw
 * subprocess output and turns them into an honest, actionable Turkish
 * sentence - never a guess. An unrecognized failure returns `undefined`
 * and the caller falls back to "ayrıntı için Output → proof-java kanalına
 * bakın" with the raw text already logged - hard rule 3a: an unrecognized
 * cause is never invented.
 *
 * Every shape here was verified against a real failure this session
 * (`mavenErrorInterpreter.test.ts` fixtures are the literal captured text),
 * not written from documentation.
 */

export type MavenFailureKind = 'unresolvedReactorSibling' | 'noPluginPrefix' | 'enforcerJdk' | 'unresolvedJpmsModule';

export interface MavenFailureInterpretation {
	kind: MavenFailureKind;
	/** Ready-to-show Turkish sentence explaining the cause. */
	detail: string;
}

const UNRESOLVED_ARTIFACT_PATTERN = /Could not find artifact ([\w.-]+:[\w.-]+:jar:[\w.-]+)/;
const NO_PLUGIN_PREFIX_PATTERN = /No plugin found for prefix '([^']+)'/;
const ENFORCER_JDK_PATTERN = /Detected JDK Version:.*is not in the allowed range[^\n]*/;
const JPMS_MODULE_NOT_FOUND_PATTERN = /module-info\.java:\[\d+,\d+]\s*module not found:\s*([\w.]+)/;

export function interpretMavenFailure(output: string): MavenFailureInterpretation | undefined {
	return interpretUnresolvedReactorSibling(output)
		?? interpretNoPluginPrefix(output)
		?? interpretEnforcerJdk(output)
		?? interpretUnresolvedJpmsModule(output);
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

/** A pom with no `jacoco-maven-plugin` declared cannot resolve the short `jacoco:report` goal form - proof-java always uses the full coordinate, so seeing this means something else on the machine (a script, a stale alias) tried the short form. */
function interpretNoPluginPrefix(output: string): MavenFailureInterpretation | undefined {
	const match = NO_PLUGIN_PREFIX_PATTERN.exec(output);
	if (!match) {
		return undefined;
	}
	return {
		kind: 'noPluginPrefix',
		detail: `Bu projenin pom'unda JaCoCo eklentisi tanımlı değil, kısa "${match[1]}:..." biçimi çalışmıyor. proof-java kendi komutlarında her zaman tam koordinatı (org.jacoco:jacoco-maven-plugin:<sürüm>:...) kullanır.`,
	};
}

/** Quotes Maven's own sentence verbatim rather than paraphrasing a version range proof-java does not know. */
function interpretEnforcerJdk(output: string): MavenFailureInterpretation | undefined {
	const match = ENFORCER_JDK_PATTERN.exec(output);
	if (!match) {
		return undefined;
	}
	return {
		kind: 'enforcerJdk',
		detail: `Maven'ın kendi mesajı: "${match[0].trim()}". proof.javaExecutable / JAVA_HOME'un işaret ettiği JDK'yı bu projenin beklediği aralığa göre ayarlayın.`,
	};
}

/**
 * Real gson shape (`test-jpms/src/test/java/module-info.java:[19,22] module
 * not found: com.google.gson`, verified this session): a sibling module's
 * own JPMS `module-info.java` requires a reactor module proof-java never
 * asked for and has nothing to do with the module actually being analyzed.
 * The dependency module descriptor is typically only added to the JAR at
 * the `package` phase (e.g. via ModiTect) - a plain `test`/`verify` build
 * never produces one, so this fails deterministically regardless of
 * install/build order. Scoping the run away from the JPMS module (Çalıştır
 * görünümünde tekrar tarayıp yalnızca ihtiyaç duyulan modülü seçmek)
 * sidesteps it entirely; a full `mvn install`/`package` is the only way to
 * make the JPMS module itself buildable.
 */
function interpretUnresolvedJpmsModule(output: string): MavenFailureInterpretation | undefined {
	const match = JPMS_MODULE_NOT_FOUND_PATTERN.exec(output);
	if (!match) {
		return undefined;
	}
	return {
		kind: 'unresolvedJpmsModule',
		detail: `Bir modülün \`module-info.java\`'sı \`${match[1]}\` modülünü modül yolunda bulamıyor - modül tanımlayıcıları genellikle yalnızca \`package\` aşamasında JAR'a eklenir, \`test\`/\`verify\` fazında henüz yok. Bu modülü kapsam dışı bırakmak (tekrar tarayıp yalnızca ihtiyacınız olan modülü seçin) ya da tam \`mvn install\`/\`package\` çalıştırmak gerekir.`,
	};
}
