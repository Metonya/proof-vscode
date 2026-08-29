import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { inspectPom } from '../../../cli/pomInspector';

test('inspectPom: detects a declared jacoco-maven-plugin', () => {
	const pom = `<project><build><plugins><plugin><groupId>org.jacoco</groupId><artifactId>jacoco-maven-plugin</artifactId></plugin></plugins></build></project>`;
	assert.equal(inspectPom(pom).hasJacocoPlugin, true);
});

test('inspectPom: a pom with no jacoco plugin at all', () => {
	const pom = `<project><build><plugins><plugin><artifactId>maven-surefire-plugin</artifactId></plugin></plugins></build></project>`;
	assert.equal(inspectPom(pom).hasJacocoPlugin, false);
});

/** Real shape found in gson's own pom this session, before the user's hand-patch. */
test('inspectPom: a literal argLine (no @{argLine}) is reported with its line number', () => {
	const pom = [
		'<project>',
		'  <build>',
		'    <plugins>',
		'      <plugin>',
		'        <artifactId>maven-surefire-plugin</artifactId>',
		'        <configuration>',
		'          <argLine>--illegal-access=deny</argLine>',
		'        </configuration>',
		'      </plugin>',
		'    </plugins>',
		'  </build>',
		'</project>',
	].join('\n');
	const facts = inspectPom(pom);
	assert.ok(facts.literalArgLine);
	assert.equal(facts.literalArgLine?.line, 7);
	assert.ok(facts.literalArgLine?.text.includes('--illegal-access=deny'));
});

/** Real shape gson's pom has after the hand-patch this session (@{argLine} forwards the JaCoCo agent property). */
test('inspectPom: an argLine that already forwards @{argLine} is not reported as a problem', () => {
	const pom = '<project><argLine>@{argLine} --illegal-access=deny</argLine></project>';
	assert.equal(inspectPom(pom).literalArgLine, undefined);
});

test('inspectPom: an argLine using the ${argLine} form is also accepted', () => {
	const pom = '<project><argLine>${argLine} -Xmx512m</argLine></project>';
	assert.equal(inspectPom(pom).literalArgLine, undefined);
});

test('inspectPom: no argLine at all is not a problem', () => {
	const pom = '<project><build></build></project>';
	assert.equal(inspectPom(pom).literalArgLine, undefined);
});

test('inspectPom: the FIRST literal argLine found is reported, not the last', () => {
	const pom = [
		'<project>',
		'  <argLine>first --literal</argLine>',
		'  <argLine>@{argLine} second</argLine>',
		'</project>',
	].join('\n');
	const facts = inspectPom(pom);
	assert.equal(facts.literalArgLine?.line, 2);
});
