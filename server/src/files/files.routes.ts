import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { getProject, resolveProjectDir } from "../projects/projects.registry.js";
import { resolveSafePath, UnsafePathError } from "./safe-path.js";

export const filesRouter = Router();

const DEFAULT_IGNORE = new Set(["node_modules", ".git"]);
const MAX_FILE_BYTES = 1024 * 1024; // 1MB

async function withProjectDir(
  req: import("express").Request,
  res: import("express").Response,
  handler: (projectDir: string) => Promise<void>,
): Promise<void> {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await handler(resolveProjectDir(project));
}

filesRouter.get("/:id/tree", async (req, res) => {
  await withProjectDir(req, res, async (projectDir) => {
    const relPath = typeof req.query.path === "string" ? req.query.path : "";
    try {
      const target = await resolveSafePath(projectDir, relPath);
      const entries = await fs.readdir(target, { withFileTypes: true });
      const items = entries
        .filter((entry) => !DEFAULT_IGNORE.has(entry.name))
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? ("dir" as const) : ("file" as const),
          path: path.posix.join(relPath, entry.name),
        }))
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
      res.json(items);
    } catch (err) {
      if (err instanceof UnsafePathError) {
        res.status(400).json({ error: "unsafe_path" });
        return;
      }
      res.status(404).json({ error: "not_found" });
    }
  });
});

filesRouter.get("/:id/file", async (req, res) => {
  await withProjectDir(req, res, async (projectDir) => {
    const relPath = typeof req.query.path === "string" ? req.query.path : "";
    if (!relPath) {
      res.status(400).json({ error: "missing_path" });
      return;
    }
    try {
      const target = await resolveSafePath(projectDir, relPath);
      const stat = await fs.stat(target);
      if (!stat.isFile()) {
        res.status(400).json({ error: "not_a_file" });
        return;
      }
      if (stat.size > MAX_FILE_BYTES) {
        res.status(413).json({ error: "file_too_large" });
        return;
      }
      const buffer = await fs.readFile(target);
      if (buffer.subarray(0, 8192).includes(0)) {
        res.status(415).json({ error: "binary_file" });
        return;
      }
      res.type("text/plain").send(buffer.toString("utf8"));
    } catch (err) {
      if (err instanceof UnsafePathError) {
        res.status(400).json({ error: "unsafe_path" });
        return;
      }
      res.status(404).json({ error: "not_found" });
    }
  });
});
