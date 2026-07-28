# Deployment auf dem Homeserver

Diese Anleitung geht davon aus, dass Overlay auf dem Homeserver läuft (nicht in
dieser Sandbox) und über Tailscale erreichbar gemacht wird.

## 1. Voraussetzungen auf dem Server

- Node.js 20+ und npm
- [PM2](https://pm2.keymetrics.io/) global installiert: `npm install -g pm2`
  (verwaltet sowohl die eigenen Web-Apps über die Overlay-API als auch,
  separat, den Overlay-Serverprozess selbst)
- Die echte [Claude Code CLI](https://docs.claude.com/claude-code) installiert
  und einmalig eingeloggt (`claude` im Terminal ausführen, Login-Flow
  abschließen) — Overlay spawnt diesen Befehl später einfach als Kindprozess
  und nutzt damit automatisch das bestehende Abo/den Login
- [Tailscale](https://tailscale.com/) installiert und dem eigenen Tailnet
  beigetreten (`tailscale up`)

**Wichtig zur Privilegientrennung:** Overlay selbst (der Webserver, PM2, die
`claude`-Sessions) läuft unter einem **normalen, unprivilegierten Benutzer**
(z.B. `overlay`), niemals als root. Nur der nächtliche Security-Scan
(Abschnitt 7) braucht root-Rechte für vollen Dateisystemzugriff — und läuft
deshalb als eigener, getrennter systemd-Dienst, nicht als Teil des
Webserver-Prozesses.

## 2. Tailscale-Zugriffsmodell

Das Grundprinzip: Overlay bindet **nur** an die Tailscale-Interface-Adresse,
nie an `0.0.0.0` oder die LAN-IP. Dadurch ist das Dashboard selbst dann nicht
erreichbar, wenn jemand im selben (geteilten) WLAN mitliest oder scannt.

1. IP des Tailscale-Interface ermitteln: `tailscale ip -4`
2. In `.env` setzen: `BIND_ADDRESS=<diese-tailscale-ip>`
3. Firewall (zusätzliche Absicherung, defense-in-depth): den konfigurierten
   `PORT` auf dem LAN-Interface explizit blockieren, z.B. mit `ufw`:
   ```
   ufw deny in on eth0 to any port 4317
   ```
4. Für echtes HTTPS (nötig für Service Worker + "Zum Home-Bildschirm
   hinzufügen" unter iOS) ein Tailscale-Zertifikat ausstellen:
   ```
   tailscale cert <dein-tailscale-hostname>.<dein-tailnet>.ts.net
   ```
   Die erzeugten Zertifikatsdateien vor einen Reverse-Proxy (z.B. Caddy oder
   nginx) schalten, der auf 443 lauscht und an den Overlay-Port
   weiterreicht — oder Node direkt mit `https.createServer` betreiben, falls
   kein Reverse-Proxy gewünscht ist.
5. **Niemals** `tailscale funnel` für dieses Dashboard aktivieren — das würde
   es öffentlich ins Internet exponieren und widerspricht dem gewählten
   Sicherheitsmodell.
6. Auf dem iPad: Tailscale-App installieren, im selben Tailnet anmelden. Der
   Homeserver ist dann sowohl im Heim-WLAN als auch unterwegs unter der
   gleichen Tailscale-Adresse erreichbar.

## 3. Konfiguration

```
cp .env.example .env
```

Dann in `.env`:
- `APPS_ROOT` auf das tatsächliche Verzeichnis setzen, unter dem die
  verwalteten Web-Apps liegen (z.B. `/home/<user>/apps`)
- `SESSION_SECRET` generieren: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- Admin-Passwort setzen: `npm run set-password -w server -- <dein-passwort>`
  und den ausgegebenen Hash als `ADMIN_PASSWORD_HASH` eintragen
- `COOKIE_SECURE=true`, sobald HTTPS via `tailscale cert` läuft
- `CLAUDE_COMMAND=claude` (Standard) — nur für lokale Tests ohne echten
  `claude`-Login auf z.B. `bash` ändern

## 4. Start

```
npm install
npm run build
NODE_ENV=production npm start
```

Für dauerhaften Betrieb den Overlay-Serverprozess selbst über PM2 verwalten
(getrennt von den Apps, die Overlay verwaltet):
```
pm2 start server/dist/index.js --name overlay
pm2 save
pm2 startup   # richtet Autostart beim Boot ein
```

## 5. Projekte registrieren

Jede verwaltete Web-App muss als direktes Unterverzeichnis von `APPS_ROOT`
liegen. Registrierung aktuell per API (UI-Formular ist ein mögliches
Folge-Feature):
```
curl -b cookie.txt -X POST https://<tailscale-host>/api/projects \
  -H "Content-Type: application/json" \
  -d '{"id":"my-app","dirName":"my-app","pm2Name":"my-app","startScript":"npm start"}'
```

## 6. Log-Rotation und Monitoring

PM2s eigene Logs (`~/.pm2/logs/`, sowohl für die verwalteten Web-Apps als auch
für den Overlay-Serverprozess selbst) wachsen sonst unbegrenzt. Einmalig
einrichten:
```
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
```

Für ein einfaches Uptime-Monitoring gibt es `GET /api/health` — bewusst ohne
Login (ein externer Pinger hat keine Session) und bewusst minimal (nur
`{"status":"ok","uptimeSeconds":...}`, keine Projekt- oder Versionsdetails).
Erreichbar ist er wie alles andere nur über Tailscale, ein externer Dienst
wie [healthchecks.io](https://healthchecks.io) kann also nicht direkt von
außen pingen — stattdessen entweder:
- einen Cron-Job auf einem anderen Tailnet-Gerät, der den Endpunkt pingt und
  bei Fehlschlag Alarm schlägt, oder
- [Uptime Kuma](https://github.com/louislam/uptime-kuma) selbst im Tailnet
  betreiben und von dort aus `https://<tailscale-host>/api/health` überwachen.

## 7. Nächtlicher Security-Scan

Läuft als eigener, root-privilegierter systemd-Timer (nicht als Teil des
Overlay-Webservers) und prüft einmal pro Nacht das ganze System auf Malware,
Rootkits, Fehlkonfigurationen und verwundbare App-Abhängigkeiten. Ergebnisse
erscheinen im "Sicherheit"-Tab des Dashboards.

### 7.1 Tools installieren (Debian/Ubuntu)

```
apt update
apt install -y clamav clamav-daemon rkhunter chkrootkit lynis aide iproute2
# Erste Signatur-Aktualisierung und rkhunter-Baseline:
freshclam
rkhunter --propupd
# AIDE-Baseline einmalig initialisieren (dauert je nach Festplattengröße):
aide --init
mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db
```

`iproute2` liefert `ss` (Listening-Ports-Check). Auf den meisten Debian/Ubuntu-
Systemen ist es bereits vorinstalliert.

**Wichtig zu AIDE:** Jede *beabsichtigte* Änderung am System (Paket-Updates,
neue Apps unter `APPS_ROOT`, manuelle Konfigänderungen) lässt AIDE ab dann
"Funde" melden, bis die Baseline neu initialisiert wird — das ist kein Fehler,
sondern der Zweck von AIDE. Nach bewussten größeren Änderungen die Baseline
auffrischen:
```
aide --init && mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db
```

Trivy ist nicht in den Standard-Debian/Ubuntu-Paketquellen enthalten,
Installation über das offizielle Repository:
```
curl -fsSL https://aquasecurity.github.io/trivy-repo/deb/public.key | gpg --dearmor -o /usr/share/keyrings/trivy.gpg
echo "deb [signed-by=/usr/share/keyrings/trivy.gpg] https://aquasecurity.github.io/trivy-repo/deb generic main" \
  | tee /etc/apt/sources.list.d/trivy.list
apt update
apt install -y trivy
```
Trivys eigene Vulnerability-Datenbank aktualisiert sich beim ersten Lauf
automatisch (braucht Internetzugang, wie `freshclam`).

**Optional: LLM-Triage über das vorhandene Ollama-Modell.** Da auf dem
Server ohnehin ein größeres Ollama-Modell für andere Zwecke läuft, kann der
Scan es nachts zusätzlich nutzen, um alle Funde der obigen Tools in
Klartext zusammenzufassen und zu priorisieren — rein beratend, siehe
`docs/SECURITY.md` Abschnitt "LLM-Triage" für das genaue Sicherheitsmodell
(insbesondere: das LLM ändert nie Schweregrade oder Zählungen, nur eine
zusätzliche Text-Einschätzung obendrauf). In `.env`:
```
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=<name des laufenden Modells, z.B. llama3.1>
```
Leer lassen (Standard), um diesen Schritt komplett zu überspringen. Läuft
nachts nach den anderen Scan-Schritten, keine Ressourcenkonkurrenz mit
Tagbetrieb.

### 7.2 systemd-Timer einrichten

Die Unit-Dateien liegen unter `deploy/systemd/` in diesem Repo:

```
cp deploy/systemd/overlay-security-scan.service /etc/systemd/system/
cp deploy/systemd/overlay-security-scan.timer /etc/systemd/system/
```

In `overlay-security-scan.service` anpassen:
- `WorkingDirectory` auf den echten Pfad zu `server/` setzen
- `EnvironmentFile` auf den Pfad zur echten `.env` setzen
- `SECURITY_SCAN_CHOWN_USER`/`SECURITY_SCAN_CHOWN_GROUP` auf den Benutzer
  setzen, unter dem Overlay selbst läuft (siehe Abschnitt 1) — der Scan läuft
  als root und schreibt die Reports zunächst als root, danach werden sie auf
  diesen Benutzer umgechownt, damit der unprivilegierte Overlay-Webserver sie
  lesen kann, ohne selbst Root-Rechte zu brauchen

Dann aktivieren:
```
systemctl daemon-reload
systemctl enable --now overlay-security-scan.timer
```

Standard-Zeitpunkt ist 02:00 Uhr nachts (mit bis zu 5 Minuten zufälliger
Verzögerung, falls andere nächtliche Jobs auch auf 02:00 gelegt sind). Da der
Server (ein umfunktionierter Gaming-PC) nachts sonst nichts zu tun hat und
Gründlichkeit hier bewusst wichtiger als Laufzeit ist, scannt der Job das
**gesamte Dateisystem** (`clamscan -r` über `/`, ausgenommen virtuelle
Verzeichnisse wie `/proc`) — das kann je nach Festplattengröße durchaus eine
bis mehrere Stunden dauern; der Timeout ist entsprechend großzügig (6h)
gesetzt.

Manuell testen, ohne auf 02:00 zu warten:
```
systemctl start overlay-security-scan.service
journalctl -u overlay-security-scan.service -f
```

Ein kritischer Fund lässt den systemd-Dienst als "failed" erscheinen
(`systemctl status`/`journalctl` zeigen das sofort an) — das ist absichtlich
der einfachste Alarm-Mechanismus ohne zusätzliche Benachrichtigungs-Kanäle.

### 7.3 Manuelle Verifikation

Auch hier gilt: in der Entwicklungs-Sandbox waren alle Scan-Tools nicht
installiert, daher lief nur die Parser-/Orchestrator-Logik (inkl. echtem
`npm audit`) gegen Fixtures bzw. eine echte Test-App. Nach der Einrichtung
auf dem echten Server einmal prüfen:

- [ ] `systemctl start overlay-security-scan.service` läuft durch und erzeugt
      einen neuen Report im "Sicherheit"-Tab
- [ ] Alle acht Tools zeigen `ok` oder `findings`, keines mehr `skipped`
      (sonst: Tool-Installation aus 7.1 prüfen)
- [ ] Die Lynis-Feldreihenfolge in `security/parsers/lynis.ts` gegen die
      echte `/var/log/lynis-report.dat` gegenprüfen (im Code als TODO
      markiert, da in der Sandbox nicht verifizierbar)
- [ ] Das AIDE-Ausgabeformat in `security/parsers/aide.ts` gegen einen
      echten `aide --check`-Lauf gegenprüfen (ebenfalls nicht in der Sandbox
      verifizierbar) — insbesondere nach einem frischen `aide --init` einmal
      absichtlich eine Datei unter `APPS_ROOT` ändern und prüfen, ob der Fund
      korrekt im Dashboard auftaucht
- [ ] Trivy zeigt nach der ersten DB-Aktualisierung plausible Funde (auf
      einem frisch installierten Debian/Ubuntu sind ein paar niedrige/mittlere
      Funde normal, nicht beunruhigend)
- [ ] Der "Offene Ports"-Check zeigt keine unerwarteten Listener außer
      Tailscale/localhost — falls doch, `SECURITY_SCAN_ALLOWED_HOSTS` in
      `.env` entsprechend ergänzen oder den gemeldeten Dienst untersuchen
- [ ] Falls `OLLAMA_MODEL` gesetzt ist: die automatische Einschätzung
      erscheint im Dashboard oberhalb der Tool-Karten, klar als KI-generiert
      gekennzeichnet — und die Schweregrad-Zusammenfassung ganz oben ändert
      sich dadurch **nicht** (sie darf ausschließlich aus den echten
      Tool-Funden stammen, nie aus dem LLM-Text)
- [ ] Die Report-Dateien unter `server/data/security-scans/` gehören nach
      dem Scan dem Overlay-Benutzer, nicht root (chown-Schritt greift)
- [ ] Falls `NTFY_URL` gesetzt ist: bei kritischen/hohen Funden kommt eine
      Push-Benachrichtigung an, bei einer sauberen Nacht (nur niedrig/mittel/
      keine Funde) bewusst keine — kein unnötiges Benachrichtigungs-Rauschen

### 7.4 Push-Benachrichtigungen (ntfy, optional)

Bei kritischen oder hohen Funden schickt der Scan eine Push-Benachrichtigung
über [ntfy](https://ntfy.sh) — auf's Handy/iPad installierbare App, kein
eigener Server nötig, aber auch selbst hostbar. Als Nachrichtentext wird die
LLM-Einschätzung verwendet, falls konfiguriert und verfügbar, sonst eine
reine Zahlen-Zusammenfassung.

**Wichtig zum Datenschutz:** `ntfy.sh` ist ein öffentlicher Dienst. Ein Topic
ist im Grunde nur ein geheimer Name in einer URL — jeder, der den Topic-Namen
kennt oder errät, kann mitlesen. Da die Benachrichtigung Fund-Details (z.B.
Dateipfade, Paketnamen) enthalten kann, entweder:
- einen langen, zufälligen Topic-Namen wählen (z.B.
  `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"`),
  oder
- ntfy [selbst hosten](https://docs.ntfy.sh/install/) im eigenen Tailnet.

Einrichtung:
1. [ntfy-App](https://ntfy.sh/#subscribe) auf dem iPad installieren, ein
   Topic abonnieren (langer zufälliger Name, siehe oben).
2. In `.env`:
   ```
   NTFY_URL=https://ntfy.sh/<dein-zufaelliges-topic>
   ```
   Bei selbst gehostetem ntfy entsprechend die eigene URL eintragen.
3. Leer lassen (Standard), um Push-Benachrichtigungen komplett zu
   deaktivieren — der Rest des Scans bleibt davon unberührt.

## 8. Optional (empfohlen): Echtes 2FA mit Authelia + Caddy

Fügt eine **dritte** Schutzschicht vor Overlay ein: einen Login mit
Zwei-Faktor-Authentifizierung (TOTP-App auf dem iPad), bevor überhaupt der
eigene Overlay-Login erscheint. Sinnvoll, seit sensible Daten (Second Brain
u.a.) gehostet werden — ein gestohlenes Overlay-Passwort allein reicht damit
nicht mehr.

**Netzwerkmodell-Änderung:** Bisher band Overlays Node-Prozess direkt an die
Tailscale-Adresse. Mit Authelia übernimmt stattdessen **Caddy** (Reverse
Proxy) die Tailscale-Adresse, prüft über Authelia die 2FA-Session und leitet
erst danach an Overlay weiter, das jetzt nur noch auf `127.0.0.1` lauscht.

### 8.1 Installation

```
apt install caddy
```
Für Authelia: offizielles APT-Repository gemäß
https://www.authelia.com/integration/deployment/bare-metal/ einrichten (die
genauen Repository-/Schlüssel-Befehle ändern sich gelegentlich, daher hier
bewusst nicht fest verdrahtet — auf der verlinkten Seite nachsehen) und dann
```
apt install authelia
```

### 8.2 Konfigurieren

Templates liegen unter `deploy/authelia/` und `deploy/caddy/` in diesem
Repo — **beide Dateien haben ausführliche Kommentare, unter anderem einen
Hinweis, dass das genaue Feldformat/der Endpunkt-Pfad nicht gegen die
aktuelle Authelia-Dokumentation verifiziert werden konnte** (kein Zugriff
auf die Live-Docs aus dieser Entwicklungssandbox) — vor dem produktiven
Einsatz einmal gegen https://www.authelia.com/configuration/ gegenprüfen.

```
mkdir -p /etc/authelia /var/lib/authelia
cp deploy/authelia/configuration.yml /etc/authelia/configuration.yml
cp deploy/authelia/users_database.yml.example /etc/authelia/users_database.yml
cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile
```

In allen drei Dateien `CHANGE-ME.tailnet-name.ts.net` durch den echten
Tailscale-MagicDNS-Hostnamen ersetzen (`tailscale status` zeigt ihn an).

In `/etc/authelia/configuration.yml`:
- `session.secret` und `storage.encryption_key` generieren:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

In `/etc/authelia/users_database.yml`:
- Passwort-Hash generieren: `authelia crypto hash generate argon2 --password '<dein-passwort>'`
  und in die Datei eintragen

Zertifikate für Caddy (gleiche Tailscale-Zertifikate wie in Abschnitt 2.4):
```
mkdir -p /etc/tailscale-certs
tailscale cert --cert-file /etc/tailscale-certs/CHANGE-ME.tailnet-name.ts.net.crt \
                --key-file  /etc/tailscale-certs/CHANGE-ME.tailnet-name.ts.net.key \
                CHANGE-ME.tailnet-name.ts.net
```

In Overlays `.env`:
```
BIND_ADDRESS=127.0.0.1
```
(Caddy übernimmt jetzt die Tailscale-Adresse, Overlay selbst muss nicht mehr
direkt darauf binden.)

### 8.3 Aktivieren

```
systemctl daemon-reload
systemctl enable --now authelia
systemctl enable --now caddy
systemctl restart overlay   # bzw. `pm2 restart overlay`, je nachdem wie Overlay selbst läuft
```

### 8.4 Manuelle Verifikation

- [ ] `https://<tailscale-host>` zeigt zuerst die Authelia-Login-Seite
      (Passwort + TOTP-Code), erst danach den Overlay-Login
- [ ] TOTP-Gerät (z.B. Authenticator-App auf dem iPad) beim ersten Login
      erfolgreich registriert
- [ ] `https://<tailscale-host>:9091` erreicht direkt das Authelia-Portal
- [ ] Overlay selbst ist **nicht** mehr direkt über die Tailscale-Adresse auf
      dem alten Port erreichbar, nur noch über Caddy — mit `curl` von einem
      anderen Tailnet-Gerät auf `127.0.0.1:<PORT>` sollte das lokal auf dem
      Server selbst funktionieren, von außen aber nicht
- [ ] Der Caddy-`forward_auth`-Endpunkt-Pfad (`/api/authz/forward-auth`)
      passt zur installierten Authelia-Version (siehe Hinweis in
      `deploy/caddy/Caddyfile`) — bei Fehlern in den Caddy-Logs
      (`journalctl -u caddy`) als Erstes hier nachsehen

## 9. Manuelle Verifikation nach dem Deployment

Diese Punkte lassen sich nicht in der Entwicklungs-Sandbox testen und sollten
nach dem echten Deployment einmal manuell geprüft werden:

- [ ] `claude` startet im Terminal-Tab interaktiv mit dem bestehenden Login
- [ ] Eine echte, über PM2 verwaltete App lässt sich starten/stoppen/neu
      starten und zeigt Live-Logs
- [ ] Von einem zweiten Gerät im selben WLAN ist der Port **nicht**
      erreichbar (`curl` sollte timeouten), nur über Tailscale
- [ ] `tailscale cert` liefert ein gültiges Zertifikat, HTTPS funktioniert
      Ende-zu-Ende
- [ ] Auf dem iPad: Safari → Teilen → "Zum Home-Bildschirm" installiert
      Overlay als Vollbild-App
- [ ] Terminal-Session übersteht das Backgrounden/Wiederöffnen der App auf
      dem iPad (Scrollback wird korrekt wiederhergestellt)
- [ ] Bekannte Grenze: Ein Neustart des Overlay-Servers beendet laufende
      `claude`-Sessions und deren In-Memory-Scrollback — das ist erwartetes
      v1-Verhalten
