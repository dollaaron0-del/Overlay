# Overlay

Selbst gehostetes Web-Dashboard für den eigenen Homeserver: verwaltet Web-Apps
(Start/Stop/Restart/Logs über PM2) und bettet die echte Claude Code CLI direkt
im Browser ein (statt eines rohen SSH-Terminals), als installierbare PWA fürs
iPad.

## Struktur

- `server/` — Node.js/TypeScript-Backend (Express, WebSocket, PM2- und
  node-pty-Integration)
- `web/` — React-PWA-Frontend (Vite)
- `shared/` — gemeinsame WebSocket-Message-Typen
- `docs/DEPLOYMENT.md` — Einrichtung auf dem echten Homeserver (Tailscale,
  PM2, HTTPS)
- `docs/SECURITY.md` — Bedrohungsmodell

## Lokale Entwicklung

```
npm install
cp .env.example .env
# .env ausfüllen: APPS_ROOT, SESSION_SECRET, ADMIN_USERNAME
npm run set-password -w server -- <passwort>
# ADMIN_PASSWORD_HASH aus der Ausgabe in .env eintragen
npm run dev
```

Frontend läuft dann auf `http://localhost:5173` (proxied API/WS zum Backend
auf Port 4317).

**Hinweis:** In einer Sandbox/lokalen Entwicklungsumgebung ohne echten
`claude`-Login kann `CLAUDE_COMMAND` in `.env` testweise auf `bash` gesetzt
werden, um die Terminal-Pipeline zu prüfen. Für den echten Einsatz auf dem
Homeserver bleibt es beim Standardwert `claude`.

Siehe `docs/DEPLOYMENT.md` für die Einrichtung auf dem echten Server.
