/**
 * Pure: builds the Maven argv for the "Testleri Çalıştır" task (Faz 30/31).
 * Default is still the whole reactor - no `-pl`/`-am`, matching what a user
 * would type by hand. `moduleRoots` (Faz 31) scopes it to just the module(s)
 * proof-java already knows it needs, once a scan has bound them: real gson
 * testing found a whole-reactor run pulling in sibling modules (native-image,
 * ProGuard-obfuscated test classes, JPMS) that proof-java never asked for and
 * has nothing to do with the module actually being analyzed - scoping avoids
 * their fragility entirely rather than trying to work around each one. The
 * very first run (no scan yet, no known modules) still has to be whole-reactor
 * - there is nothing to scope to yet, and guessing one would be a guess.
 */

export type MavenTestPhase = 'test' | 'verify';

export interface MavenTestCommandInput {
	phase: MavenTestPhase;
	/** Whether to inject `org.jacoco:jacoco-maven-plugin:<version>:prepare-agent`/`:report` around the phase - false when some pom in the reactor already configures the plugin itself (D-30's CLI-goal-binding approach, never a permanent pom edit). */
	injectJacocoGoals: boolean;
	jacocoPluginVersion: string;
	/** Faz 31: repo-relative module roots (e.g. `['gson', 'extras']`) to scope the build to via `-pl <roots> -am`. Omitted/empty means the whole reactor - the honest first-run default. */
	moduleRoots?: readonly string[];
}

export function buildMavenTestArgs(input: MavenTestCommandInput): string[] {
	const args: string[] = ['-B'];
	if (input.moduleRoots && input.moduleRoots.length > 0) {
		args.push('-pl', input.moduleRoots.join(','), '-am');
	}
	if (input.injectJacocoGoals) {
		args.push(`org.jacoco:jacoco-maven-plugin:${input.jacocoPluginVersion}:prepare-agent`);
	}
	args.push(input.phase);
	if (input.injectJacocoGoals) {
		args.push(`org.jacoco:jacoco-maven-plugin:${input.jacocoPluginVersion}:report`);
	}
	return args;
}
