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

echo "==> 1/5 Hole geprüften Branch (nur was bereits per PR reviewt+gemerged wurde)"
git fetch origin
git merge --ff-only "@{u}"

echo "==> 2/5 Installiere Abhängigkeiten (falls der Branch package-lock.json geändert hat)"
npm ci

echo "==> 3/5 Baue neu"
npm run build -w shared
npm run build -w server
npm run build -w web

echo "==> 4/5 Starte Overlay neu"
runuser -u overlay -- pm2 restart overlay

echo "==> 5/5 Erzwinge erneute 2FA (Authelia-Sitzungen zurücksetzen)"
# Ein automatisches Update bringt neuen Code auf den Server — das ist ein
# sicherheitsrelevantes Ereignis, das nicht durch eine noch Wochen gültige
# Session (siehe extend-authelia-session.sh: expiration=1M) unbemerkt
# durchrutschen soll. systemctl restart hält Login/Passwort/TOTP-Gerät
# unangetastet (anders als reset-authelia.sh), invalidiert aber alle aktiven
# Sitzungen, sofern Authelia mit dem Default-Session-Provider (in-memory)
# läuft statt einem persistenten Backend wie Redis.
systemctl restart authelia

echo "==> Fertig."
