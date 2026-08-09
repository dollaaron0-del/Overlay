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

### 4.1 Eine Code-Änderung an Overlay ausrollen

Overlay verwaltet sich nicht selbst: der "🚀 Deploy"-Button gilt nur für die
*verwalteten* Projekte, nicht für Overlay. Eine Änderung geht diesen Weg:

1. Commit landet per Push auf einem `overlay-agent/<name>`-Branch (Agenten
   pushen nie auf main, siehe AGENTS.md) — damit liegt sie erst auf GitHub,
   **nicht** auf dem Server.
2. Auf dem Server einspielen und bauen:
   ```
   cd /opt/overlay
   git pull                  # bzw. git merge origin/overlay-agent/<name>
   npm install               # nur nötig, wenn sich Dependencies geändert haben
   npm run build             # baut shared -> server -> web
   pm2 restart overlay
   ```
3. Im Browser einmal neu laden.

**Was wann nötig ist:** Das Frontend wird von `express.static` direkt von der
Platte ausgeliefert (`web/dist/`), also reicht bei reinen Frontend-Änderungen
`npm run build -w web` — ohne PM2-Neustart. Nur Änderungen am Server-Code
brauchen zwingend `pm2 restart overlay`, weil der laufende Prozess sonst
weiter den alten `server/dist/` im Speicher hat.

**Zum Neuladen im Browser:** Overlay ist eine PWA mit Service Worker, der
Navigationen aus seinem eigenen Cache beantwortet. Ein neuer Worker wird
dadurch erst bemerkt, während die alte Seite schon angezeigt wird — früher
zeigte deshalb erst der *zweite* Reload die neue Version, was aussah, als
würde "Aktualisieren" nichts tun. `web/src/pwa/sw-update.ts` lädt die Seite
jetzt automatisch einmal nach, sobald der neue Worker übernimmt, und fragt
zusätzlich regelmäßig nach Updates — ein Reload genügt, offene Tabs ziehen
auch von selbst nach.

## 5. Projekte registrieren

Jede verwaltete Web-App muss als direktes Unterverzeichnis von `APPS_ROOT`
liegen. Registrierung über die "Hinzufügen"-Kachel auf dem Homescreen des
Dashboards (Verzeichnis auswählen, Projekt-ID/PM2-Name/Start-Befehl
eintragen), oder per API:
```
curl -b cookie.txt -X POST https://<tailscale-host>/api/projects \
  -H "Content-Type: application/json" \
  -d '{"id":"my-app","dirName":"my-app","pm2Name":"my-app","startScript":"npm start"}'
```

**Optionales `deployScript`:** Zusätzlich zum Start-Befehl kann ein
Deploy-Befehl hinterlegt werden (z.B. `git pull && npm install && npm run
build`), der über den "🚀 Deploy"-Button auf der Projekt-Karte ausgeführt
wird — läuft als Shell-Befehl im Projektverzeichnis, danach automatisch ein
PM2-Restart, damit der neue Build sofort aktiv wird. Ohne gesetztes
`deployScript` erscheint kein Deploy-Button. Bewusst **kein** automatischer
Trigger (z.B. per Webhook) — der Button verlangt einen expliziten Klick im
Dashboard, jede Ausführung landet im "Aktivität"-Tab.

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

Der "Verfügbare Updates"-Check (`apt-updates`) braucht keine zusätzliche
Installation — `apt` ist auf jedem Debian/Ubuntu-System bereits vorhanden. Er
liest den bereits vorhandenen Paketindex (`apt list --upgradable`, ohne
selbst ein `apt-get update` auszulösen — das erledigt auf Standard-Ubuntu
bereits `apt-daily.timer` einmal täglich im Hintergrund) und markiert
Updates aus einer `-security`-Paketquelle mit erhöhtem Schweregrad. Er
**installiert nichts automatisch** — ein Tap im Dashboard ist bewusst kein
sicherer Weg, ein echtes System-Update auszulösen. Für automatische
Sicherheitsupdates stattdessen den Standard-Mechanismus einrichten:
```
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

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
- [ ] Alle neun Tools zeigen `ok` oder `findings`, keines mehr `skipped`
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

### 7.5 Manueller Scan-Trigger ("Jetzt scannen") einrichten

Das Dashboard bietet einen "Jetzt scannen"-Knopf (Kontrollzentrum). Da der
Scan root-Rechte für vollen Dateisystemzugriff braucht und der
Overlay-Webserver bewusst *nicht* als root läuft (siehe Abschnitt 1), kann
dieser Knopf den Scan nicht einfach direkt ausführen — das würde entweder
scheitern oder, schlimmer, einen unvollständigen Scan ohne Rechte auf
geschützte Pfade liefern, ohne dass das im Dashboard sichtbar wäre. Stattdessen
bittet der Knopf **systemd**, den echten (root-privilegierten) Scan-Dienst zu
starten — über eine eng gefasste `sudoers`-Regel, die dem Overlay-Benutzer
*ausschließlich* diesen einen Befehl erlaubt, sonst nichts:

```
# /etc/sudoers.d/overlay-security-scan (mit `visudo -f` anlegen, nicht direkt editieren!)
overlay ALL=(root) NOPASSWD: /usr/bin/systemctl start overlay-security-scan.service
```

`overlay` durch den tatsächlichen Benutzernamen ersetzen, unter dem der
Overlay-Webserver läuft (siehe Abschnitt 1). Ohne diese Regel liefert der
"Jetzt scannen"-Knopf einen klaren Fehler im Dashboard (kein stiller
Fehlschlag) — der nächtliche automatische Scan über den Timer (Abschnitt 7.2)
funktioniert davon unabhängig auch ohne diese Regel weiter.

Der Backup-Trigger ("Jetzt sichern") braucht dagegen **keine** sudoers-Regel:
Backups laufen bereits als derselbe unprivilegierte Benutzer wie der
Webserver selbst (siehe Abschnitt 8), das Dashboard kann sie direkt
auslösen.

## 8. Nächtliche Backups (restic)

Läuft als eigener systemd-Timer, unabhängig vom Security-Scan (Abschnitt 7).
Sichert `APPS_ROOT` (alle verwalteten Projekte) sowie Overlays eigenes
`server/data/`-Verzeichnis (Projekt-Registry, Scan-Reports, Backup-Historie)
über [restic](https://restic.net/) in ein deduplizierendes, verschlüsseltes
Repository. Das ist der einzige der nächtlichen Mechanismen, der einen
**echten Datenverlust** (versehentliches Löschen, Festplattenausfall,
fehlgeschlagenes Update) tatsächlich rückgängig machen kann — die
Scan-Tools aus Abschnitt 7 erkennen nur Probleme, sichern aber nichts.

**Anders als der Security-Scan braucht dieser Job kein root:** er liest nur
Verzeichnisse, die dem Overlay-Benutzer ohnehin bereits gehören, und läuft
deshalb als **derselbe unprivilegierte Benutzer**, der auch den
Overlay-Webserver betreibt.

### 8.1 restic installieren (Debian/Ubuntu)

```
apt update
apt install -y restic
```

### 8.2 Repository und Passwort einrichten

Ein lokales Repository reicht als Ausgangspunkt (idealerweise auf einer
zweiten Festplatte im selben Rechner); restic unterstützt daneben auch
SFTP, S3, Backblaze B2 und weitere Backends — siehe
https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html.

In `.env`:
```
RESTIC_REPOSITORY=/pfad/zu/einer/zweiten/platte/restic-repo
RESTIC_PASSWORD=<langes-zufaelliges-passwort>
```
Passwort generieren: `node -e "console.log(require('crypto').randomBytes(24).toString('base64'))"`

**Das Passwort unbedingt zusätzlich an einem zweiten Ort aufbewahren** (z.B.
Passwort-Manager), getrennt vom Server selbst. Ohne dieses Passwort ist das
Repository nicht mehr entschlüsselbar, selbst wenn es körperlich noch
existiert — restic initialisiert das Repository beim allerersten Lauf
automatisch, ein manueller `restic init` ist nicht nötig.

Retention (wie viele Snapshots aufgehoben werden, Standardwerte meist
ausreichend):
```
BACKUP_KEEP_DAILY=7
BACKUP_KEEP_WEEKLY=4
BACKUP_KEEP_MONTHLY=6
```

### 8.3 systemd-Timer einrichten

```
cp deploy/systemd/overlay-backup.service /etc/systemd/system/
cp deploy/systemd/overlay-backup.timer /etc/systemd/system/
```

In `overlay-backup.service` anpassen:
- `WorkingDirectory` auf den echten Pfad zu `server/` setzen
- `EnvironmentFile` auf den Pfad zur echten `.env` setzen
- `User`/`Group` auf den Benutzer setzen, unter dem Overlay selbst läuft
  (siehe Abschnitt 1) — standardmäßig `overlay`

Dann aktivieren:
```
systemctl daemon-reload
systemctl enable --now overlay-backup.timer
```

Standard-Zeitpunkt ist 01:00 Uhr nachts — eine Stunde **vor** dem
Security-Scan (02:00), damit ein langer Scan-Lauf nie ein Backup verzögert
oder verdrängt.

Manuell testen, ohne auf 01:00 zu warten:
```
systemctl start overlay-backup.service
journalctl -u overlay-backup.service -f
```

Das Ergebnis (Erfolg/Fehler, Anzahl neuer/geänderter Dateien, hinzugefügte
Datenmenge) erscheint danach auch in der "Backups"-Karte auf dem
Übersichts-Bildschirm des Dashboards.

### 8.4 Manuelle Verifikation

`restic` wurde in der Entwicklungs-Sandbox tatsächlich installiert und die
gesamte Backup-Logik (Init, Backup, Forget/Prune, JSON-Parsing) gegen ein
echtes, wenn auch temporäres Repository getestet — hier gibt es also, anders
als bei Lynis/AIDE/Authelia, keine offenen Verifikationslücken im Code
selbst. Nach der Einrichtung auf dem echten Server dennoch prüfen:

- [ ] `systemctl start overlay-backup.service` läuft durch und die
      "Backups"-Karte im Dashboard zeigt einen erfolgreichen Lauf
- [ ] `restic snapshots --repo <RESTIC_REPOSITORY>` (Passwort wird
      interaktiv abgefragt) zeigt den neuen Snapshot
- [ ] Ein zweiter Lauf meldet die unveränderten Dateien als "unverändert",
      nicht als "neu" (Duplizierung würde auf ein Konfigurationsproblem mit
      dem Repository-Pfad hindeuten)
- [ ] Stichprobenartige Wiederherstellung einmal durchspielen:
      `restic restore latest --repo <RESTIC_REPOSITORY> --target /tmp/restore-test`
      und prüfen, ob die erwarteten Dateien vorhanden sind
- [ ] Das `RESTIC_PASSWORD` ist an einem zweiten Ort gesichert, getrennt vom
      Server

## 9. Optional (empfohlen): Echtes 2FA mit Authelia + Caddy

Fügt eine **dritte** Schutzschicht vor Overlay ein: einen Login mit
Zwei-Faktor-Authentifizierung (TOTP-App auf dem iPad), bevor überhaupt der
eigene Overlay-Login erscheint. Sinnvoll, seit sensible Daten (Second Brain
u.a.) gehostet werden — ein gestohlenes Overlay-Passwort allein reicht damit
nicht mehr.

**Netzwerkmodell-Änderung:** Bisher band Overlays Node-Prozess direkt an die
Tailscale-Adresse. Mit Authelia übernimmt stattdessen **Caddy** (Reverse
Proxy) die Tailscale-Adresse, prüft über Authelia die 2FA-Session und leitet
erst danach an Overlay weiter, das jetzt nur noch auf `127.0.0.1` lauscht.

### 9.1 Installation

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

### 9.2 Konfigurieren

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

### 9.3 Aktivieren

```
systemctl daemon-reload
systemctl enable --now authelia
systemctl enable --now caddy
systemctl restart overlay   # bzw. `pm2 restart overlay`, je nachdem wie Overlay selbst läuft
```

### 9.4 Manuelle Verifikation

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

## 10. Manuelle Verifikation nach dem Deployment

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

## 11. Troubleshooting: Overlay reagiert nicht

**Grundprinzip: Overlay ist die komfortable Oberfläche, nicht der einzige
Zugang zum Server.** Der SSH-Zugriff, der schon vor Overlay genutzt wurde
(SSH-App auf dem iPad, dasselbe Tailnet), muss unabhängig davon weiter
funktionieren — er läuft als eigener Dienst (`sshd`) auf einem anderen Port
und hängt an nichts, was Overlay betrifft. Fällt Overlay komplett aus
(Absturz, volle Festplatte, kaputtes Deployment), kommt man darüber trotzdem
auf den Server: einfach mit der SSH-App wie gewohnt verbinden, unabhängig
davon ob Node/PM2/Overlay laufen. Alternative dazu, ganz ohne separate
SSH-App/Schlüsselverwaltung: [Tailscale SSH](https://tailscale.com/kb/1193/tailscale-ssh)
aktivieren (`tailscale up --ssh` auf dem Server, passende ACL im
Tailscale-Adminportal) — dann reicht die Tailscale-App allein für den
Notfallzugriff.

**Wichtig:** Diese SSH-Erreichbarkeit einmal *bevor* man sich auf Overlay als
Hauptzugang verlässt, aktiv ausprobieren (nicht erst im Ernstfall zum ersten
Mal testen).

### 11.1 Erste Diagnose (per SSH)

1. **Läuft der Prozess überhaupt?**
   ```
   pm2 status
   pm2 logs overlay --lines 100
   ```
   Zeigt sofort, ob der Overlay-Prozess abgestürzt ist und warum (Stacktrace
   in den Logs).

2. **Neu starten:**
   ```
   pm2 restart overlay
   ```
   Löst die meisten transienten Probleme (z.B. nach einem OOM-Kill oder
   einem unbehandelten Fehler).

3. **Healthcheck isoliert prüfen** — funktioniert der Server technisch, auch
   wenn im Browser nichts lädt?
   ```
   curl http://127.0.0.1:4317/api/health
   ```
   Antwortet das mit `{"status":"ok",...}`, liegt das Problem eher im
   Frontend/Browser (z.B. ein hängender Service-Worker-Cache der PWA — dann
   hilft, die installierte App vom Home-Bildschirm zu entfernen und über
   Safari neu zu installieren).

4. **Festplatte voll?** Sicherheits-Scans, Backups und Logs wachsen mit der
   Zeit:
   ```
   df -h
   ```
   Ein volles Dateisystem ist eine der häufigsten Ursachen dafür, dass ein
   Server gar nicht mehr reagiert.

5. **Falls Authelia/Caddy als 2FA-Schicht läuft** (Abschnitt 9): zusätzlich
   prüfen, da Caddy in diesem Setup direkt an der Tailscale-Adresse hängt —
   stürzt Caddy ab, kommt man an Overlay gar nicht erst vorbei:
   ```
   systemctl status caddy authelia
   journalctl -u caddy -n 50
   ```

6. **Letzter Ausweg:** Die verwalteten Apps laufen unabhängig von Overlay
   unter PM2. Sie lassen sich jederzeit direkt per SSH verwalten
   (`pm2 start/stop/restart <name>`), auch wenn Overlay selbst kaputt ist —
   Overlay ist nur eine Oberfläche über PM2, nicht die einzige Quelle der
   Wahrheit über den Zustand der Apps.

### 11.2 Overlay danach reparieren

Sobald man per SSH auf dem Server ist, das eigentliche Problem beheben, z.B.:
```
cd /opt/overlay   # oder wo auch immer das Repo liegt
git pull
npm install
npm run build
pm2 restart overlay
```
Ein `.env`-Tippfehler oder eine ungültige Konfiguration lässt Overlay beim
Start sofort mit einer Fehlermeldung abbrechen (siehe `config.ts`) — die
steht dann in `pm2 logs overlay`.

## 12. Optional: Lokaler Ollama-Vorfilter für die "Ideen"-App (RAM + GPU)

Standardmäßig geht jede Nachricht in der "Ideen"-App direkt an die echte
`claude`-CLI. Wer zusätzlich zwei lokale Ollama-Instanzen betreiben möchte
(z.B. ein kleineres Modell rein auf CPU/RAM, ein größeres auf der GPU),
kann diese als kostenlose Vorstufe vorschalten: jede Nachricht geht zuerst
dorthin, und nur wenn das jeweilige Modell selbst entscheidet, dass die
Anfrage echten Code-Zugriff braucht (z.B. tatsächliches Programmieren),
eskaliert sie weiter — erst zur GPU-Stufe, dann zu Claude. Siehe
`docs/SECURITY.md` Abschnitt "Lokaler Ollama-Vorfilter" für das genaue
Sicherheitsmodell.

**Zwei Ollama-Instanzen auf unterschiedlichen Ports starten.** Ollama bindet
standardmäßig an Port 11434; für eine zweite Instanz `OLLAMA_HOST` auf
einen anderen Port setzen. Beispiel mit systemd-Overrides (oder einfach
zwei manuell gestartete `ollama serve`-Prozesse, falls kein systemd-Setup
gewünscht ist):

```
# Instanz 1 (RAM/CPU-only) — kein GPU-Zugriff
OLLAMA_HOST=127.0.0.1:11434 CUDA_VISIBLE_DEVICES="" ollama serve &

# Instanz 2 (GPU)
OLLAMA_HOST=127.0.0.1:11435 ollama serve &
```

Modelle wie gewohnt pro Instanz laden (`OLLAMA_HOST=127.0.0.1:11434 ollama
pull <kleines-modell>`, entsprechend für Port 11435 mit einem stärkeren
Modell).

**In `.env`:**
```
IDEA_CHAT_OLLAMA_RAM_URL=http://127.0.0.1:11434
IDEA_CHAT_OLLAMA_RAM_MODEL=<name des kleinen Modells>
IDEA_CHAT_OLLAMA_GPU_URL=http://127.0.0.1:11435
IDEA_CHAT_OLLAMA_GPU_MODEL=<name des größeren Modells>
```
Eine der beiden `_MODEL`-Variablen leer lassen, um nur eine Stufe zu
nutzen; beide leer lassen (Standard), um komplett beim bisherigen
Claude-only-Verhalten zu bleiben.

**Verifikation:** in der "Ideen"-App eine Nachricht schicken und prüfen,
dass an der Antwort "🖥️ RAM-Ollama" statt "✨ Claude" steht — dann lief die
Anfrage tatsächlich über die lokale Instanz. Eine gezielt komplexe/coding-
lastige Anfrage sollte stattdessen zu "✨ Claude" eskalieren.

## 13. Obsidian-Second-Brain-Integration

Overlay liest/schreibt Notizen im normalen Obsidian-Dateiformat (YAML-
Frontmatter, `#tags`, `[[Wikilinks]]`) — dafür ist **keine zusätzliche
Software auf dem Server nötig**, kein Plugin, kein separater Prozess.
Overlay arbeitet direkt auf den `.md`-Dateien im Projektverzeichnis; ob
parallel dazu die echte Obsidian-App (Desktop/Mobile, per Syncthing/iCloud/
Obsidian Sync) auf denselben Dateien läuft, ist Overlay egal.

**1. Schnellnotiz im Obsidian-Modus.** In der "Schnellnotiz"-App (Ziel-
Projekt-Auswahl, Zahnrad-Symbol) den Schalter "Obsidian-Modus" aktivieren.
Danach landet jede Notiz als eigene Datei unter `<projekt>/inbox/` (mit
YAML-Frontmatter `tags`, `created`, ggf. eingebettetem Bild via
`![[datei]]`) statt an eine gemeinsame `inbox.md` angehängt zu werden —
das idiomatische Obsidian/Second-Brain-Muster (ein verlinkbarer, taggbarer
Knoten pro Gedanke). Standardmäßig aus, um bestehendes Verhalten nicht zu
brechen.

**2. Mini-Vault-Browser.** Jedes Projekt hat im Dashboard einen "Obsidian"-
Tab: alle `.md`-Dateien des Projekts (rekursiv, `node_modules`/`.git`
ausgenommen) mit Tag-Filter, Frontmatter-Anzeige, gerendertem Inhalt
(Überschriften/Fett/Kursiv/Links/Wikilinks/Listen) und Backlinks ("wer
verlinkt hierher"). Rein lesend, kein Caching — bei typischer Second-
Brain-Größe (tausende, nicht Millionen Notizen) wird pro Anfrage frisch
gescannt. Ein "In Obsidian öffnen"-Link nutzt das `obsidian://open`-
Deeplink-Schema; das funktioniert nur, wenn der lokale Obsidian-Vault-Name
mit dem Overlay-Projektnamen übereinstimmt (Obsidian selbst wird dabei
nicht angesprochen, das ist reines URL-Scheme-Handling im Betriebssystem).

**3. Direkte Anbindung an ein laufendes Obsidian (optional, außerhalb
dieses Repos).** Wer zusätzlich das Obsidian-Plugin "Local REST API"
nutzt, kann von woanders (z.B. einem eigenen Skript oder OpenClaw, siehe
Abschnitt 14) direkt mit der laufenden Obsidian-Instanz sprechen — das ist
unabhängig von Overlay und braucht keine Konfiguration hier.

Keine der drei Optionen erfordert einen neuen Dienst oder Port auf dem
Server; alles läuft im bestehenden Overlay-Prozess mit.

## 14. OpenClaw-Integration (optional)

[OpenClaw](https://openclaw.ai/) ist ein separat zu betreibendes,
selbst gehostetes Gateway, das Messenger-Apps (Discord/Telegram/WhatsApp/
Slack/etc.) mit KI-Agenten verbindet. Overlay bindet es auf zwei
unabhängigen Wegen an; beide sind rein optional (leer = deaktiviert) und
beeinträchtigen nichts, wenn OpenClaw gar nicht läuft.

> **Hinweis zur Quellenlage:** OpenClaws primäre Dokumentation war beim
> Schreiben dieser Integration nicht per automatisiertem Abruf erreichbar
> (403). Die genauen Endpunkt-Pfade/Payload-Formate unten stammen aus
> Sekundärquellen und wurden nicht gegen die Primärdokumentation
> verifiziert — vor dem produktiven Einsatz gegen die eigene laufende
> OpenClaw-Instanz testen (siehe Verifikation unten) und bei Bedarf
> `server/src/openclaw/openclaw-webhook.ts` anpassen.

**14.1 Overlay → OpenClaw: Benachrichtigungen per Messenger.** Zusätzlich
zu ntfy (Abschnitt 7.4) sendet Overlay bei kritischen Scan-Funden,
fehlgeschlagenen Backups und gespeicherten Ideenplänen eine einfache
`{"text": "..."}`-Payload an einen konfigurierbaren Webhook — OpenClaw
leitet das dann an die angebundenen Messenger weiter.

In `.env`:
```
OPENCLAW_WEBHOOK_URL=http://127.0.0.1:18789/pfad/zu/deinem/webhook
OPENCLAW_WEBHOOK_SECRET=<falls deine OpenClaw-Instanz einen Bearer-Token erwartet>
```
Leere `OPENCLAW_WEBHOOK_URL` deaktiviert den Versand vollständig — ein
fehlgeschlagener Versand lässt den auslösenden Vorgang (Scan/Backup/
Plan-Speicherung) selbst nicht fehlschlagen, er wird nur ins Server-Log
geschrieben.

**14.2 OpenClaw → Overlay: Aktionen per Chat auslösen.** Eine token-
authentifizierte Automatisierungs-API unter `/api/automation/*` (separat
vom Session-Cookie-Login) erlaubt Start/Stop/Restart/Deploy pro Projekt
sowie das Auslösen von Backup und Security-Scan — genau die Aktionen, die
sonst über das Dashboard laufen, hier aber z.B. per Chat-Kommando aus
OpenClaw heraus. Jede Aktion landet mit `actor: "automation"` im
Aktivitätsprotokoll.

In `.env`:
```
AUTOMATION_TOKEN=<langer, zufälliger String>
```
Erzeugen z.B. mit `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
Leerer Wert lässt `/api/automation/*` durchgehend mit 404 antworten (der
Router existiert dann praktisch nicht, statt nur unauthentifiziert
abzulehnen). Mit gesetztem Token:

```
curl -H "Authorization: Bearer <AUTOMATION_TOKEN>" \
  https://<overlay-host>/api/automation/projects/<projekt-id>/status

curl -X POST -H "Authorization: Bearer <AUTOMATION_TOKEN>" \
  https://<overlay-host>/api/automation/projects/<projekt-id>/restart

curl -X POST -H "Authorization: Bearer <AUTOMATION_TOKEN>" \
  https://<overlay-host>/api/automation/backup

curl -X POST -H "Authorization: Bearer <AUTOMATION_TOKEN>" \
  https://<overlay-host>/api/automation/scan
```

Endpunkte: `GET/POST /api/automation/projects/:id/{status,start,stop,restart,deploy}`,
`POST /api/automation/backup`, `POST /api/automation/scan`.

**14.3 Emmy-Chat: zweiseitige Unterhaltung mit dem OpenClaw-Agenten.**
Das "Emmy"-App-Icon im Homescreen ist ein WhatsApp-artiges Chat-Fenster für
eine einzelne, durchgehende Unterhaltung mit dem OpenClaw-Hauptagenten
("Emmy"). Ausgehend (Overlay → Emmy) läuft das über denselben
`OPENCLAW_WEBHOOK_URL`/`OPENCLAW_WEBHOOK_SECRET` wie 14.1, nur mit einer
zusätzlichen `"thread": "emmy"`-Markierung im Payload, damit sich das vom
reinen Notification-Text unterscheiden lässt
(`server/src/openclaw/openclaw-webhook.ts`, `sendEmmyChatMessage`).

Eingehend (Emmy → Overlay) braucht es einen neuen, separaten
Token-authentifizierten Endpunkt — anders als 14.2 (das nur Aktionen
auslöst) transportiert dieser hier tatsächliche Chat-Inhalte:

```
EMMY_INBOUND_TOKEN=<langer, zufälliger String>
```

```
curl -X POST -H "Authorization: Bearer <EMMY_INBOUND_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"text": "Antwort von Emmy"}' \
  https://<overlay-host>/api/emmy/inbound
```

Leerer Wert lässt `/api/emmy/inbound` durchgehend mit 404 antworten, wie
`AUTOMATION_TOKEN` in 14.2. In OpenClaw muss eine Antwort des Emmy-Agenten
entsprechend an diesen Endpunkt weitergeleitet werden — der genaue
Konfigurationsweg dafür hängt von der eigenen OpenClaw-Instanz ab und war,
wie in der Quellenlage oben beschrieben, zum Schreibzeitpunkt nicht gegen
die Primärdokumentation verifizierbar.

**14.4 OpenClaw selbst als verwaltetes Projekt.** Läuft OpenClaw als
eigener Node-Prozess auf demselben Server, lässt es sich wie jedes andere
Projekt über "Hinzufügen" im Dashboard registrieren (PM2-Name, Start-
Skript, optionales Deploy-Skript) — dafür ist kein Overlay-Code nötig,
es ist einfach ein weiteres PM2-verwaltetes Projekt.

**Verifikation:** `OPENCLAW_WEBHOOK_URL` testweise auf einen simplen
lokalen Mock-Endpoint zeigen lassen (z.B. `nc -l 8080` oder ein
Ein-Zeiler-HTTP-Server) und einen Ideenplan speichern oder den
Backup-Trigger mit absichtlich falscher `RESTIC_REPOSITORY` laufen lassen
— der Mock-Endpoint sollte die `{"text": "..."}`-Payload empfangen. Für
die Automatisierungs-API: die vier `curl`-Aufrufe oben gegen ein
Testprojekt ausführen und im "Aktivität"-Tab prüfen, dass die Einträge mit
`actor: automation` erscheinen.

## 15. "Jetzt aktualisieren"-Knopf (Self-Update)

Das Kontrollzentrum hat einen "Jetzt aktualisieren"-Knopf, der Overlay auf
den aktuellen Stand des Branches bringt, den `/opt/overlay` bereits als
Upstream trackt: `git fetch` + `git merge --ff-only @{u}`, Neubau aller drei
Workspaces, dann `pm2 restart overlay`. Der Branch ist auf GitHub
geschützt (PR-Review Pflicht), es landet also nur bereits geprüfter Code.

Nach dem Auslösen zeigt der Knopf "Warte auf Neustart…" und pollt
`GET /api/health`, bis die `uptimeSeconds` des Servers zurückgesetzt sind
(= der Prozess wurde neu gestartet und bedient wieder Requests). Erst dann
meldet er "Alle Daten live — Overlay ist wieder online." Nach drei Minuten
ohne Rückkehr bittet er stattdessen, die Seite neu zu laden.

**Warum systemd + sudoers?** Dieselbe Rechtetrennung wie beim
Security-Scan-Trigger (Abschnitt 7.4): der unprivilegierte `overlay`-User
kann sich nicht selbst neu bauen (root-eigene Dateien, siehe `SECURITY.md`)
und seinen eigenen PM2-Prozess nicht neu starten. Der Web-Server bittet
daher systemd, die echte, root-privilegierte Unit über eine eng gefasste
sudoers-Regel zu starten, die **nichts** außer genau diesem einen Befehl
erlaubt.

**15.1 Update-Skript und Unit.** Beide liegen im Repo unter
`deploy/update.sh` und `deploy/systemd/overlay-update.service`. Die Unit
installieren und aktivieren (als root):

```
install -m 0644 /opt/overlay/deploy/systemd/overlay-update.service \
  /etc/systemd/system/overlay-update.service
systemctl daemon-reload
```

`overlay-update.service` ist `Type=oneshot`, läuft als `root` in
`/opt/overlay` und ruft `/bin/bash /opt/overlay/deploy/update.sh`
(`TimeoutStartSec=600`). Das Skript nutzt `set -euo pipefail` und
`git merge --ff-only`, bricht bei Konflikten also sichtbar ab, statt den
Checkout in einen unklaren Zustand zu bringen.

**15.2 sudoers-Regel.** Mit `visudo -f /etc/sudoers.d/overlay-update`
anlegen (nicht direkt editieren!):

```
# /etc/sudoers.d/overlay-update
overlay ALL=(root) NOPASSWD: /usr/bin/systemctl start --no-block overlay-update.service
```

Das `--no-block` ist hier — anders als beim Security-Scan-Trigger —
zwingend: der letzte Schritt der Unit startet **diesen Server selbst** neu.
Ohne `--no-block` würde `systemctl start` blockieren, bis die Unit fertig
ist — was aus Sicht dieses Requests nie passiert, weil der bearbeitende
Prozess vorher von seinem eigenen Neustart beendet wird. `--no-block`
kehrt zurück, sobald der Job eingereiht ist, sodass der Client ein sauberes
"ok" bekommt, bevor der Server für seinen eigenen Reload heruntergeht.

**Verifikation:** Im Kontrollzentrum "Jetzt aktualisieren" drücken —
der Knopf sollte auf "Warte auf Neustart…" wechseln und nach dem Rebuild
und PM2-Restart "Alle Daten live" melden. Alternativ direkt
`sudo systemctl start --no-block overlay-update.service` ausführen und
`journalctl -u overlay-update.service -f` mitlesen; der Lauf sollte die
drei Schritte (Fetch/Merge, Build, Restart) durchlaufen. Im "Aktivität"-Tab
erscheint ein `overlay_update_triggered`-Eintrag.
