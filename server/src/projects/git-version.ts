import fs from "node:fs/promises";
import path from "node:path";

export interface ProjectVersion {
  /** Short (7-char) commit hash of HEAD. */
  commit: string;
  /** Branch name, or null when HEAD is detached (checked out at a raw commit). */
  branch: string | null;
}

/**
 * Reads the current commit/branch straight from .git/HEAD and refs — no
 * `git` subprocess. This runs once per project on every status-poll tick
 * (every 3s, see ws/status.ws.ts), so avoiding a fork here matters; plain
 * file reads are cheap enough to do unconditionally.
 */
export async function getGitVersion(projectDir: string): Promise<ProjectVersion | null> {
  const gitDir = path.join(projectDir, ".git");
  const headContent = await fs.readFile(path.join(gitDir, "HEAD"), "utf8").then(
    (s) => s.trim(),
    () => null,
  );
  if (headContent === null) return null;

  const refMatch = /^ref:\s*(refs\/heads\/(.+))$/.exec(headContent);
  if (!refMatch) {
    // Detached HEAD: HEAD itself holds the raw hash.
    return /^[0-9a-f]{40}$/.test(headContent) ? { commit: headContent.slice(0, 7), branch: null } : null;
  }

  const [, refPath, branch] = refMatch;
  const direct = await fs.readFile(path.join(gitDir, refPath), "utf8").then(
    (s) => s.trim(),
    () => null,
  );
  if (direct) return { commit: direct.slice(0, 7), branch };

  // Branch has no loose ref file — look it up in packed-refs instead
  // (git packs refs after gc; a freshly fetched/pulled repo may rely on it).
  const packed = await fs.readFile(path.join(gitDir, "packed-refs"), "utf8").catch(() => null);
  if (!packed) return null;
  for (const line of packed.split("\n")) {
    if (line.endsWith(` ${refPath}`)) {
      const hash = line.split(" ")[0];
      if (hash) return { commit: hash.slice(0, 7), branch };
    }
  }
  return null;
}
