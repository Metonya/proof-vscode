import { httpsGetBuffer, httpsGetText } from './githubFetch';

/**
 * Faz 34 (user request): "Install Skill" needs the *current* skill content,
 * not whatever shipped with this extension build - a user fixing a
 * SKILL.md typo or adding a new rule in proof-java's own repo should not
 * require every VS Code user to update the extension too. Fetches the
 * whole `skills/proof-java/` tree from GitHub at install time; no local
 * copy is bundled or cached, by the user's own explicit choice.
 *
 * Pure - no `vscode` import (same convention as the rest of `cli/`), so it
 * can be unit-tested with a fake `fetchText`/`fetchBuffer` rather than a
 * real network call.
 */

const SKILL_REPO = 'Metonya/proof-java';
const SKILL_BRANCH = 'main';
const SKILL_ROOT = 'skills/proof-java';

export interface SkillFile {
	/** Relative to `skills/proof-java/` itself - e.g. `SKILL.md`, `reference/rules.md`. */
	relativePath: string;
	content: Buffer;
}

interface GitTreeEntry {
	path: string;
	type: string;
}

/**
 * The Git Trees API (one call, `recursive=1`) lists every path in the repo
 * at `SKILL_BRANCH` in one shot - cheaper and more robust to the skill's
 * own file layout changing than walking the Contents API directory by
 * directory, or hardcoding a file list here that could silently drift from
 * what proof-java actually ships.
 */
export async function fetchSkillFiles(fetchText = httpsGetText, fetchBuffer = httpsGetBuffer): Promise<readonly SkillFile[]> {
	const treeUrl = `https://api.github.com/repos/${SKILL_REPO}/git/trees/${SKILL_BRANCH}?recursive=1`;
	const raw = await fetchText(treeUrl);
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch (e) {
		throw new Error(`GitHub's tree response wasn't valid JSON: ${(e as Error).message}`);
	}
	if (!isRecord(json) || !Array.isArray(json.tree)) {
		throw new Error('unexpected response shape from the GitHub API (no "tree" array)');
	}

	const paths = json.tree
		.filter((entry): entry is GitTreeEntry => isRecord(entry) && typeof entry.path === 'string' && entry.type === 'blob' && entry.path.startsWith(`${SKILL_ROOT}/`))
		.map((entry) => entry.path);
	if (paths.length === 0) {
		throw new Error(`no files found under "${SKILL_ROOT}" in ${SKILL_REPO}@${SKILL_BRANCH} - the skill may have moved`);
	}

	return Promise.all(paths.map(async (fullPath): Promise<SkillFile> => ({
		relativePath: fullPath.slice(SKILL_ROOT.length + 1),
		content: await fetchBuffer(`https://raw.githubusercontent.com/${SKILL_REPO}/${SKILL_BRANCH}/${fullPath}`),
	})));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
