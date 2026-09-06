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
};

export function ruleInfo(rule: RuleId): RuleInfo {
	return { code: rule, ...CATALOG[rule] };
}

/** Same address as the Problems panel's `diagnostic.code.target` - single source, they can't drift apart. */
export function ruleDocsUrl(rule: RuleId): string {
	return `https://github.com/Metonya/proof-java/blob/main/docs/rules/${rule}.md`;
}
