import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { bindModules, describeModuleForPom, describeModuleForReport, describeSiblingProjects, discoverModuleRootsFromPoms, discoverModuleRootsFromSettingsGradle, isProjectRoot, moduleForPath, parseSettingsGradleProjectPaths, toRepoRelativePosix } from '../../../cli/reportDiscovery';

test('a report at the workspace root needs no module binding', () => {
	const module = describeModuleForReport('target/site/jacoco/jacoco.xml');
	assert.equal(module.id, 'root');
	assert.equal(module.root, '.');
	assert.equal(module.reportPath, 'target/site/jacoco/jacoco.xml');
});

test('a report under a Maven module subdirectory is bound to that module root', () => {
	const module = describeModuleForReport('gson/target/site/jacoco/jacoco.xml');
	assert.equal(module.id, 'root');
	assert.equal(module.root, 'gson');
	assert.equal(module.reportPath, 'gson/target/site/jacoco/jacoco.xml');
});

test('nested module paths keep every segment in the root', () => {
	const module = describeModuleForReport('modules/service-a/target/site/jacoco/jacoco.xml');
	assert.equal(module.root, 'modules/service-a');
});

test('a report at an unfamiliar layout falls back to the repo root rather than guessing', () => {
	const module = describeModuleForReport('some/other/coverage/jacoco.xml');
	assert.equal(module.root, '.');
	assert.equal(module.reportPath, 'some/other/coverage/jacoco.xml');
});

/** Faz "Gradle support" G1: Gradle's own jacocoTestReport task default (XML must be turned on by hand - see docs/CLI-REFERENCE.md/the doctor hint), plain Java module shape only. */
test('a Gradle jacocoTestReport at the workspace root needs no module binding', () => {
	const module = describeModuleForReport('build/reports/jacoco/test/jacocoTestReport.xml');
	assert.equal(module.id, 'root');
	assert.equal(module.root, '.');
	assert.equal(module.reportPath, 'build/reports/jacoco/test/jacocoTestReport.xml');
});

test('a Gradle jacocoTestReport under a subproject directory is bound to that subproject root', () => {
	const module = describeModuleForReport('core/build/reports/jacoco/test/jacocoTestReport.xml');
	assert.equal(module.root, 'core');
	assert.equal(module.reportPath, 'core/build/reports/jacoco/test/jacocoTestReport.xml');
});

test('nested Gradle subproject paths keep every segment in the root', () => {
	const module = describeModuleForReport('modules/service-a/build/reports/jacoco/test/jacocoTestReport.xml');
	assert.equal(module.root, 'modules/service-a');
});

test('a Maven report and a Gradle report never collide on the same repo root binding', () => {
	const maven = describeModuleForReport('gson/target/site/jacoco/jacoco.xml');
	const gradle = describeModuleForReport('gson/build/reports/jacoco/test/jacocoTestReport.xml');
	assert.equal(maven.root, 'gson');
	assert.equal(gradle.root, 'gson');
});

test('toRepoRelativePosix strips the repo root and normalizes backslashes', () => {
	const rel = toRepoRelativePosix('C:\\repo\\gson\\target\\site\\jacoco\\jacoco.xml', 'C:\\repo');
	assert.equal(rel, 'gson/target/site/jacoco/jacoco.xml');
});

test('toRepoRelativePosix on an already-relative-looking mismatch returns the normalized input unchanged', () => {
	const rel = toRepoRelativePosix('/elsewhere/jacoco.xml', 'C:\\repo');
	assert.equal(rel, '/elsewhere/jacoco.xml');
});

test('isProjectRoot is true when a pom.xml marker is present (gson-shaped: one real multi-module project)', () => {
	assert.equal(isProjectRoot(['pom.xml']), true);
});

test('isProjectRoot is true for any recognized Gradle marker too', () => {
	assert.equal(isProjectRoot(['settings.gradle.kts']), true);
});

test('isProjectRoot is false with no markers at all (coverdict-corpus-shaped: a folder of unrelated repos)', () => {
	assert.equal(isProjectRoot([]), false);
});

test('describeSiblingProjects names every candidate and tells the user to open one directly, never picks for them', () => {
	const message = describeSiblingProjects(['assertj', 'dropwizard', 'gson', 'junit-framework']);
	assert.ok(message.includes('assertj, dropwizard, gson, junit-framework'));
	assert.ok(message.includes('4'));
	assert.ok(!message.toLowerCase().includes('otomatik')); // never phrased as if one was auto-chosen
});

/** Faz 30: bindModules is the multi-module counterpart of describeModuleForReport - real, distinct ids instead of a fixed 'root'. */
test('bindModules: gives each discovered report a real id derived from its module root', () => {
	const bound = bindModules([
		'gson/target/site/jacoco/jacoco.xml',
		'extras/target/site/jacoco/jacoco.xml',
		'test-jpms/target/site/jacoco/jacoco.xml',
	]);
	assert.deepEqual(bound.map((m) => m.id), ['gson', 'extras', 'test-jpms']);
	assert.deepEqual(bound.map((m) => m.root), ['gson', 'extras', 'test-jpms']);
});

test('bindModules: a report at the workspace root gets id "root"', () => {
	const bound = bindModules(['target/site/jacoco/jacoco.xml']);
	assert.deepEqual(bound, [{ id: 'root', root: '.', reportPath: 'target/site/jacoco/jacoco.xml' }]);
});

test('bindModules: a real id collision (two module roots ending in the same segment) gets a numeric suffix, never silently merges', () => {
	const bound = bindModules([
		'backend/util/target/site/jacoco/jacoco.xml',
		'frontend/util/target/site/jacoco/jacoco.xml',
	]);
	assert.deepEqual(bound.map((m) => m.id), ['util', 'util-2']);
	assert.equal(new Set(bound.map((m) => m.id)).size, 2);
});

test('bindModules: unsafe characters in a module root are sanitized to a valid CLI token', () => {
	const bound = bindModules(['my module!/target/site/jacoco/jacoco.xml']);
	assert.equal(bound[0].id, 'my-module-');
});

/** Faz 31: describeModuleForPom is bindModules's discovery input before any report exists - a pom.xml's own path names its module root directly. */
test('describeModuleForPom: a root pom.xml is module root "."', () => {
	assert.deepEqual(describeModuleForPom('pom.xml'), { root: '.' });
});

test('describeModuleForPom: a submodule pom.xml names its own directory as root', () => {
	assert.deepEqual(describeModuleForPom('test-jpms/pom.xml'), { root: 'test-jpms' });
	assert.deepEqual(describeModuleForPom('modules/service-a/pom.xml'), { root: 'modules/service-a' });
});

/** Faz 31: discoverModuleRootsFromPoms - real gson shape, module discovery that works before a single jacoco.xml exists anywhere. */
test('discoverModuleRootsFromPoms: gives each discovered pom a real id derived from its module root', () => {
	const modules = discoverModuleRootsFromPoms(['pom.xml', 'gson/pom.xml', 'test-jpms/pom.xml']);
	assert.deepEqual(modules, [{ id: 'root', root: '.' }, { id: 'gson', root: 'gson' }, { id: 'test-jpms', root: 'test-jpms' }]);
});

test('discoverModuleRootsFromPoms: a real id collision gets a numeric suffix, same rule as bindModules', () => {
	const modules = discoverModuleRootsFromPoms(['backend/util/pom.xml', 'frontend/util/pom.xml']);
	assert.deepEqual(modules.map((m) => m.id), ['util', 'util-2']);
});

/** Faz 30: which bound module a target file belongs to - longest-root-prefix wins, '.' is the lowest-priority fallback. */
test('moduleForPath: a file under a module root resolves to that module', () => {
	const modules = [{ id: 'gson', root: 'gson' }, { id: 'extras', root: 'extras' }];
	assert.equal(moduleForPath('gson/src/test/java/com/google/gson/GsonTest.java', modules), 'gson');
	assert.equal(moduleForPath('extras/src/test/java/com/google/gson/extras/ExtraTest.java', modules), 'extras');
});

test('moduleForPath: a nested module\'s own root outranks its parent\'s (longest prefix wins)', () => {
	const modules = [{ id: 'root', root: '.' }, { id: 'nested', root: 'gson/nested' }];
	assert.equal(moduleForPath('gson/nested/src/main/java/Foo.java', modules), 'nested');
	assert.equal(moduleForPath('gson/src/main/java/Bar.java', modules), 'root');
});

test('moduleForPath: a path under no bound module\'s root is undefined, not a guess', () => {
	const modules = [{ id: 'gson', root: 'gson' }];
	assert.equal(moduleForPath('extras/src/main/java/Foo.java', modules), undefined);
});

/**
 * Faz "Gradle support" G3: the settings.gradle(.kts) counterpart of
 * discoverModuleRootsFromPoms. Deliberately mirrors GradleProjectScanner.java
 * in the CLI - the two parse the same files and must agree about which
 * modules exist, so these cases match that scanner's own tests.
 */
test('discoverModuleRootsFromSettingsGradle: kts include() calls become module roots', () => {
	const modules = discoverModuleRootsFromSettingsGradle('rootProject.name = "demo"\ninclude(":core", ":extras")\n');
	assert.deepEqual(modules, [{ id: 'core', root: 'core' }, { id: 'extras', root: 'extras' }]);
});

test('discoverModuleRootsFromSettingsGradle: Groovy include without parentheses parses the same way', () => {
	const modules = discoverModuleRootsFromSettingsGradle("include ':gson', ':gson:extras'\n");
	assert.deepEqual(modules, [{ id: 'gson', root: 'gson' }, { id: 'extras', root: 'gson/extras' }]);
});

/** junit-framework's real shape: every module is declared through the build's own includeProject(...) helper, never a bare include(...). */
test('discoverModuleRootsFromSettingsGradle: an include-prefixed wrapper function is matched too', () => {
	const modules = discoverModuleRootsFromSettingsGradle([
		'fun includeProject(name: String, mavenized: Boolean = false) {',
		'\tinclude(name)',
		'}',
		'includeProject("junit-jupiter", mavenized = true)',
		'includeProject("junit-platform-commons")',
	].join('\n'));

	assert.deepEqual(modules.map((m) => m.root), ['junit-jupiter', 'junit-platform-commons']);
});

/** A composite build is a separate Gradle root with its own lifecycle, not a subproject of this one. */
test('discoverModuleRootsFromSettingsGradle: includeBuild is never a subproject', () => {
	assert.deepEqual(discoverModuleRootsFromSettingsGradle('includeBuild("gradle/plugins")\n'), []);
});

/** includeFlat("sib") means ../sib - a sibling of the repo root, which a repo-relative path cannot express at all. */
test('discoverModuleRootsFromSettingsGradle: includeFlat is skipped rather than reported at a wrong root', () => {
	assert.deepEqual(discoverModuleRootsFromSettingsGradle('includeFlat("sibling")\n'), []);
});

test('discoverModuleRootsFromSettingsGradle: a wrapper that merely starts with an excluded word is still matched', () => {
	assert.deepEqual(discoverModuleRootsFromSettingsGradle('includeFlattenedModules(":core")\n').map((m) => m.root), ['core']);
});

test('discoverModuleRootsFromSettingsGradle: the same project declared twice is one module', () => {
	assert.deepEqual(discoverModuleRootsFromSettingsGradle('include(":core")\ninclude(":core")\n').map((m) => m.root), ['core']);
});

test('discoverModuleRootsFromSettingsGradle: a path escaping the repo root is not followed', () => {
	assert.deepEqual(discoverModuleRootsFromSettingsGradle('include(":..:outside")\n'), []);
});

test('discoverModuleRootsFromSettingsGradle: CRLF line endings parse identically', () => {
	assert.deepEqual(discoverModuleRootsFromSettingsGradle('include(":core")\r\ninclude(":extras")\r\n').map((m) => m.root), ['core', 'extras']);
});

test('discoverModuleRootsFromSettingsGradle: a settings file declaring nothing yields no modules', () => {
	assert.deepEqual(discoverModuleRootsFromSettingsGradle('rootProject.name = "demo"\n'), []);
});

/** The root project is never `include(...)`d; whether it is a real module is a filesystem fact the caller decides. */
test('discoverModuleRootsFromSettingsGradle: the root project is added only when the caller says so', () => {
	assert.deepEqual(discoverModuleRootsFromSettingsGradle('include(":core")\n', true), [
		{ id: 'root', root: '.' },
		{ id: 'core', root: 'core' },
	]);
});

test('discoverModuleRootsFromSettingsGradle: a subproject literally named root collides safely instead of shadowing the root project', () => {
	const modules = discoverModuleRootsFromSettingsGradle('include(":root")\n', true);
	assert.deepEqual(modules, [{ id: 'root', root: '.' }, { id: 'root-2', root: 'root' }]);
});

/** The raw-path layer, matching the CLI scanner one-to-one: a wrapper's own definition line has no quoted argument and contributes nothing. */
test('parseSettingsGradleProjectPaths: only real call sites with literal strings contribute', () => {
	const paths = parseSettingsGradleProjectPaths([
		'fun includeProject(name: String) { include(name) }',
		'include(":a", ":b:c")',
	].join('\n'));

	assert.deepEqual(paths, [':a', ':b:c']);
});
