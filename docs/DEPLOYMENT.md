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

## 6. Manuelle Verifikation nach dem Deployment

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
