# Bedrohungsmodell

## Kontext

Overlay läuft auf einem Homeserver in einem WLAN, das mit anderen Wohnungen
geteilt wird — das lokale Netzwerk gilt daher **nicht** als vertrauenswürdig.
Gleichzeitig soll das Dashboard auch von unterwegs erreichbar sein.

## Zwei Schutzschichten

1. **Netzwerk-Layer (primär): Tailscale.** Der Server bindet ausschließlich an
   die Tailscale-Interface-Adresse (`BIND_ADDRESS`), nie an `0.0.0.0` oder die
   LAN-Adresse. Nur Geräte im eigenen Tailnet (iPad + Homeserver) können das
   Dashboard überhaupt erreichen — weder Mitbewohner im selben WLAN noch das
   öffentliche Internet. `tailscale funnel` wird bewusst nicht verwendet, da
   das den Server öffentlich exponieren würde.
2. **App-Layer (sekundär): Login.** Ein einzelner Benutzer
   (Benutzername/bcrypt-Passwort-Hash aus `.env`), signierter httpOnly-
   Session-Cookie. Dient als zweite Verteidigungslinie, falls die
   Netzwerkschicht versagt (z.B. Fehlkonfiguration), nicht als alleiniger
   Schutz.

Beide Schichten sind bewusst redundant: Tailscale schützt vor Netzwerk-
Exposure, der App-Login vor unbefugtem Zugriff durch andere Tailnet-Mitglieder
oder falls der Bind-Adresse-Schutz versehentlich umgangen wird.

## Angriffsflächen im Detail

- **Path Traversal (Dateien/Terminal-Arbeitsverzeichnis):** Jeder
  Projektpfad wird serverseitig aus `APPS_ROOT + dirName` zusammengesetzt
  (`projects/projects.registry.ts`), nie aus einem client-gelieferten
  Absolutpfad. Die Datei-API validiert zusätzlich in
  `files/safe-path.ts`, dass ein aufgelöster Pfad (inkl. Symlink-Auflösung)
  innerhalb des Projekt-Roots bleibt.
- **Session-Fixation/-Diebstahl:** Session-Cookie ist `httpOnly` (kein
  JS-Zugriff), `SameSite=Lax`, und (produktiv) `Secure`. Session-IDs sind
  kryptographisch zufällig (32 Byte) und zusätzlich HMAC-signiert.
- **Brute-Force auf Login:** Einfaches In-Memory-Backoff pro IP mit
  exponentiell wachsender Sperrzeit.
- **Command Injection über PM2/pty:** `startScript` wird nur beim
  Registrieren eines Projekts akzeptiert (Admin-Aktion, kein öffentlicher
  Endpunkt), nicht bei jedem Start neu vom Client geliefert. Der pty-Prozess
  (`claude`/`CLAUDE_COMMAND`) wird ohne von außen kontrollierbare Argumente
  gestartet.
- **Kein Schreibzugriff über die Datei-API:** Die Files-API ist in v1
  bewusst nur lesend — Bearbeitung von Code passiert ausschließlich über die
  Claude-Code-CLI-Session selbst, nicht über einen zusätzlichen Web-Editor.
- **Cross-Site-Angriffe auf eingeloggte Sessions:** `SameSite=Lax` verhindert
  bereits, dass der Session-Cookie bei plumpen Cross-Site-POSTs (klassisches
  CSRF) oder bei einem WebSocket-Verbindungsaufbau von einer fremden Seite aus
  mitgeschickt wird. Zusätzlich prüft der WebSocket-Upgrade-Handler
  (`ws/origin-check.ts`) explizit den `Origin`-Header gegen den tatsächlichen
  Host — eine zweite, unabhängige Sperre für den Fall, dass sich
  Cookie-Verhalten in einem Browser mal anders verhält als erwartet.
- **Security-Header:** `helmet` setzt eine strikte Content-Security-Policy
  (`default-src 'self'`, kein Inline-JavaScript erlaubt), `X-Frame-Options:
  DENY` (Overlay lässt sich nicht in ein `<iframe>` einbetten) und HSTS
  (wirkt erst, sobald über echtes HTTPS via `tailscale cert` ausgeliefert
  wird — über Klartext-HTTP ignorieren Browser den Header ohnehin).
- **Allgemeines Rate-Limiting:** Zusätzlich zum gezielten Login-Backoff
  begrenzt `express-rate-limit` alle `/api`-Routen pauschal (120
  Anfragen/Minute/IP) — eine großzügige, aber vorhandene Grenze gegen
  fehlerhafte Clients oder Wiederholungsschleifen.
- **`GET /api/health` ist absichtlich unauthentifiziert**, damit ein externer
  Uptime-Check ohne Login-Session funktioniert. Die Antwort ist bewusst auf
  `{"status":"ok","uptimeSeconds":...}` minimiert — keine Projekt-, Versions-
  oder Konfigurationsdetails, die für einen Angreifer nützlich wären.
- **Korruptionsschutz der Projekt-Registry:** `projects.json` wird per
  Write-then-Rename atomar geschrieben (kein halb geschriebenes File bei
  einem Absturz mitten im Schreibvorgang) und vor jedem Überschreiben nach
  `projects.json.bak` gesichert. Ist die Hauptdatei doch einmal korrupt,
  fällt der Server beim nächsten Start automatisch auf das Backup zurück,
  statt mit einer leeren/kaputten Registry weiterzulaufen.

## Bekannte Grenzen (v1)

- Ein Neustart des Overlay-Servers beendet alle laufenden `claude`-pty-
  Sessions und deren In-Memory-Scrollback. Das ist ein akzeptiertes Trade-off
  für v1, keine Sicherheitslücke.
- Es gibt genau einen Benutzer/ein Passwort — kein Mehrbenutzerkonzept, keine
  granularen Rollen. Für ein persönliches Homeserver-Dashboard angemessen.

## Dependency-Audit-Status

Alle Laufzeit-Abhängigkeiten (`npm audit --omit=dev`) sind aktuell frei von
bekannten Schwachstellen (`pm2` auf `7.x` und `bcrypt` auf `6.x` angehoben,
danach funktional erneut gegen Login/PM2-Start-Stop-Restart/Log-Streaming
getestet). Verbleibend sind ausschließlich Build-Zeit-Funde in
`vite-plugin-pwa`s Workbox-Toolchain (`workbox-build` → ein Rollup-Plugin-Fork
→ `ejs`/`jake`/`minimatch`/`brace-expansion`, DoS-Klasse) — dieser Pfad läuft
nur während `vite build`, landet nie im ausgelieferten Code, und ist auch in
der neuesten `vite-plugin-pwa`-Version noch nicht upstream gefixt. Ein
Major-Bump von `vite-plugin-pwa` (0.21 → 1.x) nur dafür wurde bewusst nicht
gemacht, um kein unnötiges Regressionsrisiko am PWA-Build einzugehen.
