import type { RuleId } from '../verdict/types';

/**
 * Phase 18: the six rule codes, in plain language. Until now every surface
 * showed the raw enum (`CATCH_ORACLE_WITHOUT_FAIL`) with no explanation
 * anywhere - the user's own complaint at the time was that a bare enum
 * name means nothing on its own.
 *
 * Every `title`/`summary` here is a condensed translation of that rule's
 * own doc in the proof-java repo (`docs/rules/<RULE>.md`) - nothing is
 * invented. `code` stays visible next to the title everywhere, so the
 * enum remains greppable/searchable and the docs link still matches.
 * Pure - no `vscode` (PLAN.md §3's first invariant).
 */
export interface RuleInfo {
	/** The raw enum - kept visible so the user can still search/grep for it and match the docs URL. */
	code: RuleId;
	/** Short human-readable name, shown as the primary label. */
	title: string;
	/** One or two sentences: what fired and why it matters. Shown on hover. */
	summary: string;
	/** What the developer should actually do about it. */
	action: string;
}

const CATALOG: Record<RuleId, Omit<RuleInfo, 'code'>> = {
	NO_RECOGNIZED_ORACLE: {
		title: 'No assertion',
		summary: 'The test method has no recognized assertion: no assertion/verification call, and no expected exception either. The code runs, but nothing looks at the result - these lines look covered but aren\'t really tested.',
		action: 'Add at least one assertion that states what the test actually expects.',
	},
	TAUTOLOGICAL_ORACLE: {
		title: 'Always-true assertion',
		summary: 'The assertion\'s result doesn\'t depend on the code under test at all - it holds for any implementation (e.g. comparing two constants, a literal boolean).',
		action: 'Base the assertion on the real output of the code under test.',
	},
	CATCH_ORACLE_WITHOUT_FAIL: {
		title: 'Swallowed exception',
		summary: 'Inside a try/catch, if the code throws, every assertion is skipped and the test still passes. The test silently treats a failure case as a success.',
		action: 'Add a fail() in the catch block, or verify the expected exception with assertThrows.',
	},
	NULL_CHECK_ONLY: {
		title: 'Null check only',
		summary: 'Every assertion in the test only checks "not null"; the value\'s actual content is never examined. A weak test - not broken, but it can\'t catch a wrong result.',
		action: 'Also verify what the value should be, not just that it exists.',
	},
	PSEUDO_TESTED_METHOD: {
		title: 'Pseudo-tested method',
		summary: 'A production method is executed by a test, but every generated mutant survived - no test observes what the method actually does. Comes from mutation (L3) evidence.',
		action: 'Add a test that genuinely verifies the method\'s return value or side effect.',
	},
	SUBSUMED_TEST: {
		title: 'Redundant (subsumed) test',
		summary: 'This test\'s killed-mutant set is a strict subset of another test\'s - on its own it catches nothing new, for the mutators exercised in this run. Comes from mutation (L3) evidence.',
		action: 'Informational only: before removing it, confirm the broader test genuinely covers this scenario.',
	},
	// proof-python only (pythonrules.py) - no Java counterpart, D-99.
	UNCOLLECTED_TEST_CLASS: {
		title: 'Uncollected test class',
		summary: 'A Test* class defines __init__, so pytest refuses to collect it - every test method inside never runs, and the suite still passes.',
		action: 'Move the setup out of __init__ into a fixture or setup_method.',
	},
	EMPTY_PARAMETRIZE: {
		title: 'Empty parametrize',
		summary: 'The test is parametrized over an empty list, so pytest skips it entirely - it never runs, and the suite still passes.',
		action: 'Give the parametrize list at least one case, or remove the test.',
	},
	RETURN_IN_TEST: {
		title: 'Returns instead of asserting',
		summary: 'The test returns a value instead of asserting one. pytest warns but still passes the test, so whatever the value was is never checked.',
		action: 'Replace the return with an assert on the same expression.',
	},
	NON_STRICT_XFAIL: {
		title: 'Non-strict xfail',
		summary: 'Marked xfail without strict=True - if the test starts passing, the run stays green and nobody is told.',
		action: 'Add strict=True to the marker, or set xfail_strict in the pytest configuration.',
	},
	UNCALLED_ORACLE: {
		title: 'Uncalled assertion',
		summary: 'An assertion (a mock check, or self.assert*) is referenced but never actually called - the attribute is evaluated and discarded, so it checks nothing.',
		action: 'Call it: add the parentheses and its arguments.',
	},
	MOCK_ONLY_ORACLE: {
		title: 'Mock-only assertion',
		summary: 'Every check in the test is about how a mock was called; nothing verifies what the code under test itself returned or changed.',
		action: 'Add an assertion on the value or state the code under test produces.',
	},
	BROAD_RAISES_WITHOUT_MATCH: {
		title: 'Broad exception match',
		summary: 'pytest.raises(Exception) with no match= accepts any error at all, including one from a line the test never meant to reach.',
		action: 'Name the specific exception type, or add match= to pin the message.',
	},
};

export function ruleInfo(rule: RuleId): RuleInfo {
	return { code: rule, ...CATALOG[rule] };
}

const PYTHON_ONLY_RULES = new Set<RuleId>([
	'UNCOLLECTED_TEST_CLASS', 'EMPTY_PARAMETRIZE', 'RETURN_IN_TEST',
	'NON_STRICT_XFAIL', 'UNCALLED_ORACLE', 'MOCK_ONLY_ORACLE', 'BROAD_RAISES_WITHOUT_MATCH',
]);

/**
 * Same address as the Problems panel's `diagnostic.code.target` - single
 * source, they can't drift apart. proof-java has a `docs/rules/<RULE>.md`
 * per rule; proof-python has no such directory yet, so its seven own rules
 * link to the source that documents them instead of a 404.
 */
export function ruleDocsUrl(rule: RuleId): string {
	if (PYTHON_ONLY_RULES.has(rule)) {
		return `https://github.com/Metonya/proof-python/blob/main/src/proof_python/pythonrules.py`;
	}
	return `https://github.com/Metonya/proof-java/blob/main/docs/rules/${rule}.md`;
}
