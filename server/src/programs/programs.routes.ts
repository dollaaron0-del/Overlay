import { Router } from "express";
import { listProgramMeta } from "./programs.js";

export const programsRouter = Router();

// GET /api/programs — tile metadata (id, title, iframe path) for the sidebar.
programsRouter.get("/", (_req, res) => {
  res.json(listProgramMeta());
});
