import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { authRouter } from "./auth/auth.routes.js";
import { requireAuth } from "./auth/auth.middleware.js";
import { projectsRouter } from "./projects/projects.routes.js";
import { pm2Router } from "./pm2/pm2.routes.js";
import { filesRouter } from "./files/files.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json());

  app.use("/api", authRouter);

  const protectedApi = express.Router();
  protectedApi.use(requireAuth);
  protectedApi.use("/projects", projectsRouter);
  protectedApi.use("/projects", pm2Router);
  protectedApi.use("/projects", filesRouter);
  app.use("/api", protectedApi);

  if (config.isProduction) {
    const webDist = path.resolve(__dirname, "../../web/dist");
    app.use(express.static(webDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  return app;
}
