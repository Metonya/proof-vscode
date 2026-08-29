import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { interpretMavenFailure } from '../../../cli/mavenErrorInterpreter';

/**
 * The `unresolvedReactorSibling` fixture is the real output captured this
 * session running `doctor --fix` against gson's `test-jpms` module before
 * `gson` itself had ever been `mvn install`-ed (D-67) - not written from
 * documentation.
 */
const GSON_TEST_JPMS_FAILURE = `
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-dependency-plugin:3.6.1:build-classpath (default-cli) on project test-jpms: Could not resolve dependencies for project com.google.code.gson:test-jpms:jar:2.14.1-SNAPSHOT: The following artifacts could not be resolved: com.google.code.gson:gson:jar:2.14.1-SNAPSHOT (absent): Could not find artifact com.google.code.gson:gson:jar:2.14.1-SNAPSHOT
`;

test('interpretMavenFailure: unresolvedReactorSibling on gson\'s real test-jpms failure', () => {
	const result = interpretMavenFailure(GSON_TEST_JPMS_FAILURE);
	assert.equal(result?.kind, 'unresolvedReactorSibling');
	assert.match(result!.detail, /com\.google\.code\.gson:gson:jar:2\.14\.1-SNAPSHOT/);
	assert.match(result!.detail, /mvn install -DskipTests/);
});

test('interpretMavenFailure: "Could not resolve dependencies" alone (no artifact line) is not enough to diagnose', () => {
	const result = interpretMavenFailure('[ERROR] Could not resolve dependencies for project com.example:foo:jar:1.0');
	assert.equal(result, undefined);
});

test('interpretMavenFailure: noPluginPrefix', () => {
	const result = interpretMavenFailure(
		"[ERROR] No plugin found for prefix 'jacoco' in the current project and in the plugin groups [org.apache.maven.plugins, org.codehaus.mojo] available from the repositories",
	);
	assert.equal(result?.kind, 'noPluginPrefix');
	assert.match(result!.detail, /jacoco/);
});

test('interpretMavenFailure: enforcerJdk quotes Maven\'s own sentence verbatim', () => {
	const result = interpretMavenFailure(
		'[WARNING] Rule 0: org.apache.maven.enforcer.rules.version.RequireJavaVersion failed with message:\n'
			+ 'Detected JDK Version: 25.0.1 is not in the allowed range [17,22).',
	);
	assert.equal(result?.kind, 'enforcerJdk');
	assert.match(result!.detail, /Detected JDK Version: 25\.0\.1 is not in the allowed range \[17,22\)\./);
});

test('interpretMavenFailure: an unrecognized failure returns undefined, never a guess', () => {
	const result = interpretMavenFailure('[ERROR] Some completely different Maven failure nobody has seen before.');
	assert.equal(result, undefined);
});

test('interpretMavenFailure: empty output returns undefined', () => {
	assert.equal(interpretMavenFailure(''), undefined);
});
