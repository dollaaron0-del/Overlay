export interface Project {
  id: string;
  dirName: string;
  pm2Name: string;
  startScript: string;
  /** Optional shell command run by POST /:id/deploy, e.g. "git pull && npm install && npm run build". */
  deployScript?: string;
  /** Optional custom home-screen icon (a single emoji), set via PATCH /:id. Falls back to a generic folder icon. */
  icon?: string;
}
