#!/usr/bin/env bash
# Läuft als root über overlay-update.service — ausgelöst vom "Jetzt
# aktualisieren"-Knopf im Kontrollzentrum, via einer eng gefassten
# sudoers-Regel (siehe docs/DEPLOYMENT.md Abschnitt 15). Holt AUSSCHLIESSLICH
# den Branch, den dieser Checkout bereits als Upstream trackt ("@{u}") — kein
# hartkodierter Branch-Name, damit das Skript auch nach einem Branch-Wechsel
# oder auf einem anderen Server ohne Anpassung funktioniert. --ff-only stellt
# sicher, dass niemals ein Merge-Commit entsteht oder lokale Änderungen
# stillschweigend überschrieben werden — bei Konflikt bricht das Skript
# sichtbar ab, statt den Checkout in einen unklaren Zustand zu bringen.
set -euo pipefail
cd /opt/overlay

echo "==> 1/3 Hole geprüften Branch (nur was bereits per PR reviewt+gemerged wurde)"
git fetch origin
git merge --ff-only "@{u}"

echo "==> 2/3 Baue neu"
npm run build -w shared
npm run build -w server
npm run build -w web

echo "==> 3/3 Starte Overlay neu"
runuser -u overlay -- pm2 restart overlay

echo "==> Fertig."
