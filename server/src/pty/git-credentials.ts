import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

/**
 * Lets a sandboxed project session `git push` on its own, without ever
 * putting a stored GitHub login inside the sandbox (see pty/sandbox.ts's
 * "hide /home wholesale" boundary, which this deliberately does not touch).
 *
 * Written to the project's own *local* git config, not the sandbox's $HOME:
 * that $HOME is a fresh empty tmpfs every session, so anything written there
 * would never be seen again, whereas the project directory is bound normally
 * and persists on real disk. The two config lines mirror what `gh auth
 * setup-git` itself writes — clear any existing helper chain for this host,
 * then point it at gh, which resolves the actual token from the GH_TOKEN
 * environment variable (see pty.manager.ts) without needing any `gh auth
 * login` state.
 */
export function ensureGitCredentialHelper(projectDir: string): void {
  if (!config.GIT_SANDBOX_PUSH_TOKEN) return;
  if (!fs.existsSync(path.join(projectDir, ".git"))) return;

  try {
    execFileSync("git", [
      "-C",
      projectDir,
      "config",
      "--local",
      "--replace-all",
      "credential.https://github.com.helper",
      "",
    ]);
    execFileSync("git", [
      "-C",
      projectDir,
      "config",
      "--local",
      "--add",
      "credential.https://github.com.helper",
      "!gh auth git-credential",
    ]);
  } catch (err) {
    // A project that isn't a normal git checkout, or a missing/broken `git`
    // binary, must not take the whole session down over a nice-to-have.
    console.error(`Could not set up git credential helper for ${projectDir}:`, err);
  }
}
