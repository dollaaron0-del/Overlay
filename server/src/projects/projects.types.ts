export interface Project {
  id: string;
  dirName: string;
  pm2Name: string;
  startScript: string;
  /** Optional shell command run by POST /:id/deploy, e.g. "git pull && npm install && npm run build". */
  deployScript?: string;
}
