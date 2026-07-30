import { Router } from "express";
import { z } from "zod";
import { getProject } from "../projects/projects.registry.js";
import {
  getQuickCaptureTarget,
  setQuickCaptureTarget,
  getQuickCaptureObsidianMode,
  setQuickCaptureObsidianMode,
} from "./quickcapture-store.js";
import { appendQuickCapture } from "./quickcapture.js";
import { appendAuditEntry } from "../audit/audit-log.js";

export const quickCaptureRouter = Router();

quickCaptureRouter.get("/target", async (_req, res) => {
  const targetProjectId = await getQuickCaptureTarget();
  res.json({ targetProjectId });
});

const setTargetSchema = z.object({ projectId: z.string().min(1) });

quickCaptureRouter.put("/target", async (req, res) => {
  const parsed = setTargetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const project = await getProject(parsed.data.projectId);
  if (!project) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  await setQuickCaptureTarget(parsed.data.projectId);
  res.json({ ok: true });
});

quickCaptureRouter.get("/obsidian-mode", async (_req, res) => {
  const obsidianMode = await getQuickCaptureObsidianMode();
  res.json({ obsidianMode });
});

const setObsidianModeSchema = z.object({ obsidianMode: z.boolean() });

quickCaptureRouter.put("/obsidian-mode", async (req, res) => {
  const parsed = setObsidianModeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  await setQuickCaptureObsidianMode(parsed.data.obsidianMode);
  res.json({ ok: true });
});

const captureSchema = z.object({
  text: z.string().max(20_000).optional(),
  link: z.string().max(2000).optional(),
  image: z
    .object({
      dataBase64: z.string(),
      mimeType: z.string(),
    })
    .optional(),
});

quickCaptureRouter.post("/", async (req, res) => {
  const parsed = captureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request", details: parsed.error.issues });
    return;
  }
  const { text, link, image } = parsed.data;
  if (!text && !link && !image) {
    res.status(400).json({ error: "empty_capture" });
    return;
  }

  const targetProjectId = await getQuickCaptureTarget();
  if (!targetProjectId) {
    res.status(400).json({ error: "no_target_configured" });
    return;
  }
  const project = await getProject(targetProjectId);
  if (!project) {
    res.status(400).json({ error: "target_project_missing" });
    return;
  }

  try {
    const obsidianMode = await getQuickCaptureObsidianMode();
    await appendQuickCapture(project, { text, link, image }, obsidianMode);
  } catch (err) {
    res.status(400).json({ error: "capture_failed", message: (err as Error).message });
    return;
  }

  await appendAuditEntry({ type: "quick_capture", detail: project.id });
  res.json({ ok: true });
});
