/**
 * Pure: recognizes a small, closed set of Maven failure shapes from raw
 * subprocess output and turns them into an honest, actionable sentence -
 * never a guess. An unrecognized failure returns `undefined` and the
 * caller falls back to "see the Output → proof-java channel for detail"
 * with the raw text already logged - hard rule 3a: an unrecognized
 * cause is never invented.
 *
 * Every shape here was verified against a real failure this session
 * (`mavenErrorInterpreter.test.ts` fixtures are the literal captured text),
 * not written from documentation.
 */

export type MavenFailureKind = 'unresolvedReactorSibling' | 'noPluginPrefix' | 'enforcerJdk' | 'unresolvedJpmsModule';

export interface MavenFailureInterpretation {
	kind: MavenFailureKind;
	/** Ready-to-show sentence explaining the cause. */
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
		detail: `Maven couldn't find the \`${match[1]}\` module (from the same repo) in the local repository - that module hasn't been installed yet. A sibling module's classpath can't be generated without running \`mvn install -DskipTests\` once first.`,
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
		detail: `This project's pom doesn't declare the JaCoCo plugin, so the short "${match[1]}:..." form doesn't work. proof-java's own commands always use the full coordinate (org.jacoco:jacoco-maven-plugin:<version>:...).`,
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
		detail: `Maven's own message: "${match[0].trim()}". Point proof.javaExecutable / JAVA_HOME at a JDK within the range this project expects.`,
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
		detail: `A module's \`module-info.java\` can't find the \`${match[1]}\` module on the module path - module descriptors are usually only added to the JAR at the \`package\` phase, not yet present at \`test\`/\`verify\`. Either scope this module out (re-scan and select only the module you need), or run a full \`mvn install\`/\`package\`.`,
	};
}
