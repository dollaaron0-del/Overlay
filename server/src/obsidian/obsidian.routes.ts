import { Router } from "express";
import { getProject, resolveProjectDir } from "../projects/projects.registry.js";
import { listNotes, getNote } from "./vault-index.js";

export const obsidianRouter = Router();

obsidianRouter.get("/:id/obsidian/notes", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const notes = await listNotes(resolveProjectDir(project));
  res.json(notes);
});

obsidianRouter.get("/:id/obsidian/note", async (req, res) => {
  const project = await getProject(req.params.id);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const notePath = typeof req.query.path === "string" ? req.query.path : "";
  if (!notePath) {
    res.status(400).json({ error: "missing_path" });
    return;
  }
  const note = await getNote(resolveProjectDir(project), notePath);
  if (!note) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(note);
});
