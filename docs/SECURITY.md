# Bedrohungsmodell

## Kontext

Overlay läuft auf einem Homeserver in einem WLAN, das mit anderen Wohnungen
geteilt wird — das lokale Netzwerk gilt daher **nicht** als vertrauenswürdig.
Gleichzeitig soll das Dashboard auch von unterwegs erreichbar sein.

## Schutzschichten

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
3. **2FA-Layer (optional, empfohlen): Authelia + Caddy.** Siehe
   `docs/DEPLOYMENT.md` Abschnitt 8. Schaltet einen TOTP-2FA-Login *vor*
   Overlays eigenem Login, über einen Caddy-Reverse-Proxy, der als einziger
   Dienst noch direkt an die Tailscale-Adresse bindet — Overlay selbst
   wandert dann auf `127.0.0.1`. Nicht standardmäßig eingerichtet (größerer
   Konfigurationsaufwand als die ersten beiden Schichten), aber die
   naheliegende nächste Härtungsstufe, seit sensible Daten gehostet werden:
   selbst ein geleaktes Overlay-Passwort reicht dann allein nicht mehr.

Alle Schichten sind bewusst redundant: Tailscale schützt vor Netzwerk-
Exposure, der App-Login vor unbefugtem Zugriff durch andere Tailnet-Mitglieder
oder falls der Bind-Adresse-Schutz versehentlich umgangen wird, Authelia
zusätzlich vor einem kompromittierten/erratenen Overlay-Passwort allein.

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

## Nächtlicher Security-Scan

Da der Homeserver dauerhaft läuft und Apps mit sensiblen Daten (z.B. ein
"Second Brain") hostet, reicht der oben beschriebene Netzwerk-/App-Schutz
allein nicht — er verhindert unbefugten *Zugriff auf Overlay selbst*, sagt
aber nichts darüber aus, ob eine der gehosteten Apps oder der Server
insgesamt bereits kompromittiert ist. Dafür gibt es einen separaten,
nächtlichen Scan (ClamAV, rkhunter, chkrootkit, Lynis, AIDE, Trivy, npm audit,
Listening-Ports-Check — siehe `docs/DEPLOYMENT.md` Abschnitt 7). AIDE und
Trivy schließen dabei zwei Lücken, die die ursprüngliche Tool-Auswahl noch
offen ließ: AIDE erkennt *jede* unautorisierte Dateiänderung (nicht nur
bekannte Rootkit-Signaturen wie rkhunter/chkrootkit), Trivy prüft
OS-Paket-CVEs (nicht nur Node-Abhängigkeiten wie npm audit).

**Bewusste Privilegientrennung:** Der Scan braucht root-Rechte für vollen
Lesezugriff aufs Dateisystem (Malware kann sich überall verstecken). Er läuft
deshalb **nicht** im Overlay-Webserver-Prozess, sondern als eigener,
root-privilegierter systemd-Oneshot-Dienst (`overlay-security-scan.service`).
Der Webserver selbst bleibt unprivilegiert und bekommt nie root — er liest
nur die fertigen JSON-Reports, die der Scan-Dienst nach dem Schreiben per
`chown` auf den unprivilegierten Overlay-Benutzer überträgt. Ein kompromittierter
Webserver-Prozess (z.B. über eine noch unbekannte Lücke in einer der
gehosteten Apps) hätte damit keinen direkten Root-Zugriff über den
Scan-Mechanismus.

**Warum "voller Scan" statt "nur App-Verzeichnisse":** Auf Wunsch des
Betreibers bewusst so gewählt — der Server ist ein umfunktionierter
Gaming-PC mit Leistungsreserven, nachts läuft sonst nichts Rechenintensives,
und die gehosteten Apps (Second Brain u.a.) verarbeiten sensible Daten und
haben Internetzugriff. Gründlichkeit hat hier explizit Vorrang vor Laufzeit.

**Fehlende Tools werden nicht stillschweigend übersprungen:** Jeder Tool-
Schritt hat einen expliziten `skipped`-Status mit Begründung (z.B. "nicht
installiert"), sichtbar im Dashboard — ein leerer/unauffälliger Report kann
so nicht mit "alles installiert und geprüft" verwechselt werden.

**Bekannte Unsicherheit:** Die Feldformate von Lynis' (`lynis-report.dat`)
und AIDEs maschinenlesbaren Ausgaben wurden mangels installierter
Tool-Instanzen in der Entwicklungssandbox nicht gegen echte Ausgabe
verifiziert (siehe Kommentare in `security/parsers/lynis.ts` und
`security/parsers/aide.ts` sowie Checkliste in `DEPLOYMENT.md` Abschnitt 7.3).

**Bewusst nicht hinzugefügt: Wazuh und CrowdSec.** Beide sind gute,
etablierte Open-Source-Tools, passen aber nicht gut zu diesem konkreten
Aufbau:
- **Wazuh** (volles SIEM/XDR mit Echtzeit-Monitoring statt nur nächtlichem
  Scan) würde einen Großteil dessen duplizieren, was der eigene
  Scan-Mechanismus plus Dashboard bereits leisten — nur als separater,
  deutlich schwergewichtigerer Dienst (eigener Manager, Indexer, eigenes
  Web-UI). Bleibt eine Option für später, falls Echtzeit- statt
  Nächtlich-Monitoring gewünscht ist.
- **CrowdSec** wehrt primär internetweite Scan-/Brute-Force-Angriffe ab, die
  hier durch das Tailscale-only-Netzwerkmodell bereits weitgehend ausgeschlossen
  sind (siehe oben) — der Grenznutzen ist in diesem speziellen Setup gering,
  verglichen mit einem klassischen öffentlich exponierten Server.

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
