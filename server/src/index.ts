import http from "node:http";
import { config } from "./config.js";
import { createApp } from "./server.js";
import { attachWebSocketServer } from "./ws/ws.server.js";
import { loadSessions } from "./auth/session.js";

await loadSessions();

const app = createApp();
const server = http.createServer(app);
attachWebSocketServer(server);

server.listen(config.PORT, config.BIND_ADDRESS, () => {
  console.log(`Overlay server listening on http://${config.BIND_ADDRESS}:${config.PORT} (${config.NODE_ENV})`);
});

function shutdown(): void {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
