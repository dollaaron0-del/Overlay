# Overlay

Selbst gehostetes Web-Dashboard für den eigenen Homeserver, mit einer
iOS-artigen Oberfläche: ein Homescreen mit Widgets (Server-Ressourcen,
Sicherheits-Status, Backups, Ollama) und App-Kacheln für jedes Projekt sowie
für Sicherheit/Aktivität/Einstellungen — dazu eine Spotlight-Suche, ein
Benachrichtigungs-Center, Hell/Dunkel-Theme und eine anpassbare
Icon-Anordnung (Kacheln per Drag & Drop verschieben oder ausblenden). Jedes
Projekt lässt sich starten/stoppen/neu starten/deployen und verwaltet
(Start/Stop/Restart/Logs über PM2), bettet die echte Claude Code CLI direkt
im Browser ein (statt eines rohen SSH-Terminals), als installierbare PWA fürs
iPad — und überwacht den Server selbst mit einem nächtlichen Security-Scan
(ClamAV, rkhunter, chkrootkit, Lynis, AIDE, Trivy, npm audit, verfügbare
apt-Updates, offene Ports), optional ergänzt um eine rein beratende
LLM-Triage über ein lokal laufendes Ollama-Modell, sichtbar in der
"Sicherheit"-App. Nächtliche Backups (restic), Ressourcen-Monitoring und ein
Aktivitätsprotokoll runden den Serverbetrieb ab. Optional lässt sich
zusätzlich echtes 2FA (Authelia + Caddy) vorschalten.

Länger laufende Aktionen zeigen ihren tatsächlichen Fortschritt statt nur
"Lädt…": Backups einen echten Prozent-Balken (live aus restics eigenen
Status-Zeilen), der Security-Scan "Schritt X von Y: <Tool>", und ein Deploy
sein Live-Output plus Timer statt nur des Endergebnisses.

Für unterwegs (z.B. vom iPhone) gibt es eine eigene "Schnellnotiz"-App:
Text, Link und/oder Foto in Sekunden erfassen, landet als Eintrag in der
`inbox.md` eines frei wählbaren Projekts (z.B. dem eigenen Second Brain) —
das Ziel-Projekt ist serverseitig gespeichert, gilt also geräteübergreifend.

Für Ideen, die tatsächlich Rückmeldung brauchen, gibt es zusätzlich die
"Ideen"-App: eine Idee eintippen, ein Projekt auswählen, und die echte
Claude Code CLI (derselbe Login wie im Terminal) liest sich lesend in das
gewählte Projekt ein und schätzt ein, ob und wie sich die Idee umsetzen
ließe — inklusive Rückfragen. Ist man sich einig, fasst "Als Plan
speichern" das *gesamte* Gespräch (nicht nur die letzte Antwort) zu einem
strukturierten, umsetzungsfertigen Plan zusammen und legt ihn als Datei im
Projekt (`plans/`) ab. Die KI kann dabei nichts am Projekt verändern, nur
lesen. Jedes Projekt hat dafür im Dashboard einen eigenen "Pläne"-Tab
(neben Terminal/Logs/Dateien), der alle so gespeicherten Pläne auflistet —
später am eigentlichen Rechner reicht dann "setz das aus plans/... um".

Optional lässt sich davor ein zweistufiger, lokaler Ollama-Vorfilter
schalten (z.B. ein schwächeres Modell im RAM und ein stärkeres auf der
GPU): jede Nachricht geht zuerst dorthin, und nur wenn das jeweilige
Modell selbst entscheidet, dass die Anfrage echten Code-Zugriff braucht,
eskaliert es zur echten Claude-CLI. So kostet reines Ideen-Feedback keinen
Claude-Aufruf, nur tatsächliches Programmieren tut das. Welche Stufe
geantwortet hat, wird direkt an jeder Nachricht angezeigt — eine
"KI-Kaskade"-Übersicht in der Ideen-App zeigt außerdem alle drei Stufen in
ihrer Reihenfolge samt Zuständigkeit und Live-Status (konfiguriert,
erreichbar, Modell installiert).

## Struktur

- `server/` — Node.js/TypeScript-Backend (Express, WebSocket, PM2-,
  node-pty- und Security-Scan-Integration)
- `web/` — React-PWA-Frontend (Vite)
- `shared/` — gemeinsame Typen (WebSocket-Nachrichten, Security-Scan-Reports)
- `deploy/systemd/` — systemd-Units für den nächtlichen Security-Scan
- `deploy/authelia/`, `deploy/caddy/` — optionale 2FA-Vorbau-Konfiguration
- `docs/DEPLOYMENT.md` — Einrichtung auf dem echten Homeserver (Tailscale,
  PM2, HTTPS, Security-Scan-Timer, optionales 2FA)
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
