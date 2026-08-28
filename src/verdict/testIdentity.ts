/**
 * Ported from coverdict-cli's `TestIdentity.java` (D-49): a raw test id
 * string from `perTest.entries[].lines[].tests[]` can be a JUnit5
 * `UniqueId` (`[engine:...]/[class:X]/[method:Y()]` for a plain test, or
 * `[class:X]/[test-template:Y(args)]/[test-template-invocation:#N]` for one
 * invocation of a `@ParameterizedTest`/`@RepeatedTest`) or coverdict's own
 * `Class#method(...)` shape, depending on the target's test engine - the
 * real format was never confirmed against every live PIT shape, so an
 * unrecognized id is displayed verbatim (`display`) rather than guessed at
 * (hard rule 3a), same "callers skip enrichment rather than guess" contract
 * as the Java original.
 *
 * Faz 14c: the original regex only recognized `[method:...]`, so every
 * `@ParameterizedTest` invocation (real, common shape - see
 * coverdict-playground's `CalculatorParameterizedTest`) fell through to the
 * `#`-splitting fallback below, which found the `#1` inside
 * `[test-template-invocation:#1]` and mis-parsed the entire UniqueId as one
 * giant "class name". `simpleClassName` is added so callers (the line->tests
 * panel) can show a short, readable name and keep the full FQCN only as a
 * tooltip/title.
 */

export interface ParsedTestIdentity {
	className: string | null;
	methodName: string | null;
	/** Last segment of `className` (`Outer$Inner` kept as-is - nesting is not this module's concern). Same value as `className` when it has no package. */
	simpleClassName: string | null;
	/** Set only for a `@ParameterizedTest`/`@RepeatedTest` invocation (`[test-template-invocation:#N]`). */
	invocation: string | null;
	/** Always set: the best available human-readable form - `Class#method()` (optionally ` #N` for one invocation) when parsed, the raw id otherwise. */
	display: string;
}

const JUNIT5_CLASS = /\[class:([^\]]+)]/;
const JUNIT5_METHOD = /\[method:([^\](]+)/;
const JUNIT5_TEST_TEMPLATE = /\[test-template:([^\](]+)/;
const JUNIT5_INVOCATION = /\[test-template-invocation:#(\d+)]/;

export function parseTestIdentity(rawTestId: string): ParsedTestIdentity {
	const classMatch = JUNIT5_CLASS.exec(rawTestId);
	if (classMatch) {
		const parsed = parseJUnit5(rawTestId, classMatch[1]);
		if (parsed) {
			return parsed;
		}
	}

	const hash = rawTestId.indexOf('#');
	if (hash > 0 && hash < rawTestId.length - 1) {
		const className = rawTestId.slice(0, hash);
		const rest = rawTestId.slice(hash + 1);
		const paren = rest.indexOf('(');
		const methodName = paren >= 0 ? rest.slice(0, paren) : rest;
		if (methodName.length > 0) {
			return { className, methodName, simpleClassName: simpleName(className), invocation: null, display: `${simpleName(className)}#${methodName}()` };
		}
	}

	return { className: null, methodName: null, simpleClassName: null, invocation: null, display: rawTestId };
}

/** `[class:X]` was found; still may be neither `[method:]` nor `[test-template:]` (e.g. a container-level UniqueId) - `null` falls through to the raw-id fallback above rather than guessing. */
function parseJUnit5(rawTestId: string, className: string): ParsedTestIdentity | null {
	const methodMatch = JUNIT5_METHOD.exec(rawTestId);
	if (methodMatch) {
		const methodName = methodMatch[1];
		return { className, methodName, simpleClassName: simpleName(className), invocation: null, display: `${simpleName(className)}#${methodName}()` };
	}

	const templateMatch = JUNIT5_TEST_TEMPLATE.exec(rawTestId);
	if (templateMatch) {
		const methodName = templateMatch[1];
		const invocationMatch = JUNIT5_INVOCATION.exec(rawTestId);
		const invocation = invocationMatch ? invocationMatch[1] : null;
		const suffix = invocation ? ` #${invocation}` : '';
		return { className, methodName, simpleClassName: simpleName(className), invocation, display: `${simpleName(className)}#${methodName}()${suffix}` };
	}

	return null;
}

function simpleName(fqcn: string): string {
	const dot = fqcn.lastIndexOf('.');
	return dot < 0 ? fqcn : fqcn.slice(dot + 1);
}
