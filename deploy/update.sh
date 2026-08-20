#!/usr/bin/env bash
# Läuft als root über overlay-update.service — ausgelöst entweder vom "Jetzt
# aktualisieren"-Knopf im Kontrollzentrum oder automatisch von
# overlay-check-update.timer, via einer eng gefassten sudoers-Regel (siehe
# docs/DEPLOYMENT.md Abschnitt 15). Holt AUSSCHLIESSLICH den Branch, den
# dieser Checkout bereits als Upstream trackt ("@{u}") — kein hartkodierter
# Branch-Name, damit das Skript auch nach einem Branch-Wechsel oder auf einem
# anderen Server ohne Anpassung funktioniert. --ff-only stellt sicher, dass
# niemals ein Merge-Commit entsteht oder lokale Änderungen stillschweigend
# überschrieben werden — bei Konflikt bricht das Skript sichtbar ab, statt
# den Checkout in einen unklaren Zustand zu bringen.
set -euo pipefail
cd /opt/overlay

echo "==> 1/7 Hole geprüften Branch (nur was bereits per PR reviewt+gemerged wurde)"
git fetch origin
git merge --ff-only "@{u}"

echo "==> 2/7 Installiere Abhängigkeiten (falls der Branch package-lock.json geändert hat)"
npm ci

echo "==> 3/7 Baue neu"
npm run build -w shared
npm run build -w server
npm run build -w web

echo "==> 4/7 Starte Overlay neu"
runuser -u overlay -- pm2 restart overlay

echo "==> 5/7 Stelle sicher, dass der Emmy-Scheduler-Timer installiert ist"
# docs/DEPLOYMENT.md Abschnitt 16.2 beschrieb das bisher als manuellen
# Einmal-Schritt nach dem Feature-Merge — der auf diesem Server nie
# nachgeholt wurde, wodurch wiederkehrende Emmy-Checks nie automatisch
# liefen (der Tick braucht den Timer, der ihn per HTTP auslöst; ohne ihn
# wird die Fälligkeits-Prüfung schlicht nie ausgeführt). Die Templates in
# deploy/systemd/ passen unverändert auf diesen Server (WorkingDirectory,
# User/Group, EnvironmentFile sind bereits auf /opt/overlay bzw. den
# overlay-Nutzer gesetzt), daher hier automatisch nachziehen. Nur bei
# fehlender Datei kopieren, damit spätere manuelle Anpassungen an der Unit
# nicht bei jedem Update überschrieben werden.
if [ ! -f /etc/systemd/system/overlay-emmy-scheduler.timer ]; then
  cp deploy/systemd/overlay-emmy-scheduler.service /etc/systemd/system/
  cp deploy/systemd/overlay-emmy-scheduler.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now overlay-emmy-scheduler.timer
  echo "    Installiert und aktiviert (Takt: alle 15 Minuten)."
fi
if ! grep -q '^AUTOMATION_TOKEN=.\+' /opt/overlay/.env 2>/dev/null; then
  echo "    WARNUNG: AUTOMATION_TOKEN ist in .env nicht gesetzt — der Emmy-Scheduler-Tick schlägt dadurch weiterhin mit 404 fehl (siehe docs/DEPLOYMENT.md Abschnitt 14.2)."
fi

echo "==> 6/7 Stelle sicher, dass der Auto-Update-Check-Timer installiert ist"
# Gleiches Muster wie bei Schritt 5/7 oben (Emmy-Scheduler): ohne diesen
# Timer lief bislang gar kein automatischer Update-Check, nur der manuelle
# "Jetzt aktualisieren"-Knopf — das genau war die Lücke, die auf diesem
# Server nie nachgeholt wurde (siehe docs/DEPLOYMENT.md Abschnitt 15.3).
# Nur bei fehlender Datei installieren, damit spätere manuelle Anpassungen
# an der Unit nicht bei jedem Update überschrieben werden.
if [ ! -f /etc/systemd/system/overlay-check-update.timer ]; then
  cp deploy/systemd/overlay-check-update.service /etc/systemd/system/
  cp deploy/systemd/overlay-check-update.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable --now overlay-check-update.timer
  echo "    Installiert und aktiviert (Takt: alle 10 Minuten)."
fi

echo "==> 7/7 Erzwinge erneute 2FA (Authelia-Sitzungen zurücksetzen)"
# Ein automatisches Update bringt neuen Code auf den Server — das ist ein
# sicherheitsrelevantes Ereignis, das nicht durch eine noch Wochen gültige
# Session (siehe extend-authelia-session.sh: expiration=1M) unbemerkt
# durchrutschen soll. systemctl restart hält Login/Passwort/TOTP-Gerät
# unangetastet (anders als reset-authelia.sh), invalidiert aber alle aktiven
# Sitzungen, sofern Authelia mit dem Default-Session-Provider (in-memory)
# läuft statt einem persistenten Backend wie Redis.
systemctl restart authelia

echo "==> Fertig."
