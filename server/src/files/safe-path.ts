import fs from "node:fs/promises";
import path from "node:path";

export class UnsafePathError extends Error {}

/**
 * Resolves a client-supplied relative path against a project root and guarantees
 * the result stays inside that root, including after symlink resolution.
 * Throws UnsafePathError if the path would escape the root.
 */
export async function resolveSafePath(projectRoot: string, relativePath: string): Promise<string> {
  const root = path.resolve(projectRoot);
  const requested = relativePath ? relativePath.replace(/^[/\\]+/, "") : "";
  const resolved = path.resolve(root, requested);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new UnsafePathError(`Path escapes project root: ${relativePath}`);
  }

  // Re-check after resolving symlinks, in case a symlink inside the project
  // points outside of it.
  let realResolved: string;
  try {
    realResolved = await fs.realpath(resolved);
  } catch {
    // Path doesn't exist yet (e.g. for a not-found check) — the lexical check above
    // is the best we can do; callers should handle ENOENT from subsequent fs calls.
    return resolved;
  }
  const realRoot = await fs.realpath(root);
  if (realResolved !== realRoot && !realResolved.startsWith(realRoot + path.sep)) {
    throw new UnsafePathError(`Path escapes project root via symlink: ${relativePath}`);
  }

  return resolved;
}
