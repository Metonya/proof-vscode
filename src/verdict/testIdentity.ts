/**
 * Ported from coverdict-cli's `TestIdentity.java` (D-49): a raw test id
 * string from `perTest.entries[].lines[].tests[]` can be a JUnit5
 * `UniqueId` (`[engine:...]/[class:X]/[method:Y()]`) or coverdict's own
 * `Class#method(...)` shape, depending on the target's test engine - the
 * real format was never confirmed against every live PIT shape, so an
 * unrecognized id is displayed verbatim (`display`) rather than guessed at
 * (hard rule 3a), same "callers skip enrichment rather than guess" contract
 * as the Java original.
 */

export interface ParsedTestIdentity {
	className: string | null;
	methodName: string | null;
	/** Always set: the best available human-readable form - `Class#method()` when parsed, the raw id otherwise. */
	display: string;
}

const JUNIT5_UNIQUE_ID = /\[class:([^\]]+)].*\[method:([^\](]+)/;

export function parseTestIdentity(rawTestId: string): ParsedTestIdentity {
	const unique = JUNIT5_UNIQUE_ID.exec(rawTestId);
	if (unique) {
		const [, className, methodName] = unique;
		return { className, methodName, display: `${className}#${methodName}()` };
	}

	const hash = rawTestId.indexOf('#');
	if (hash > 0 && hash < rawTestId.length - 1) {
		const className = rawTestId.slice(0, hash);
		const rest = rawTestId.slice(hash + 1);
		const paren = rest.indexOf('(');
		const methodName = paren >= 0 ? rest.slice(0, paren) : rest;
		if (methodName.length > 0) {
			return { className, methodName, display: `${className}#${methodName}()` };
		}
	}

	return { className: null, methodName: null, display: rawTestId };
}
