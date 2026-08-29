/**
 * Pure: builds the Maven argv for the "Testleri Çalıştır" task (Faz 30).
 * Always the whole reactor - no `-pl`/`-am` module scoping in this first
 * pass, matching what a user would type by hand (the gson dogfood's own
 * manual workaround was a bare `mvn clean test` / `mvn verify` from the
 * repo root). Scoping to just the bound module(s) for speed is a real,
 * deferred optimization, not a correctness requirement.
 */

export type MavenTestPhase = 'test' | 'verify';

export interface MavenTestCommandInput {
	phase: MavenTestPhase;
	/** Whether to inject `org.jacoco:jacoco-maven-plugin:<version>:prepare-agent`/`:report` around the phase - false when some pom in the reactor already configures the plugin itself (D-30's CLI-goal-binding approach, never a permanent pom edit). */
	injectJacocoGoals: boolean;
	jacocoPluginVersion: string;
}

export function buildMavenTestArgs(input: MavenTestCommandInput): string[] {
	const args: string[] = ['-B'];
	if (input.injectJacocoGoals) {
		args.push(`org.jacoco:jacoco-maven-plugin:${input.jacocoPluginVersion}:prepare-agent`);
	}
	args.push(input.phase);
	if (input.injectJacocoGoals) {
		args.push(`org.jacoco:jacoco-maven-plugin:${input.jacocoPluginVersion}:report`);
	}
	return args;
}
