#!/usr/bin/env bash
# Läuft periodisch (via overlay-check-update.timer) als root in /opt/overlay.
# Prüft nur, ob es neue Commits auf dem getrackten, PR-geschützten Branch
# gibt ("@{u}") — löst nichts aus, wenn nichts neu ist. Baut selbst NICHT
# neu; das übernimmt weiterhin ausschließlich overlay-update.service
# (deploy/update.sh), exakt derselbe Pfad wie beim manuellen "Jetzt
# aktualisieren"-Knopf im Kontrollzentrum. Kein neuer offener Port, kein
# neues Secret — reine Erweiterung des bereits vorhandenen Mechanismus
# um einen automatischen statt manuellen Trigger.
set -euo pipefail
cd /opt/overlay

git fetch --quiet origin

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "@{u}")

if [ "$LOCAL" != "$REMOTE" ]; then
  echo "Neue Commits gefunden ($LOCAL -> $REMOTE), starte overlay-update.service."
  systemctl start --no-block overlay-update.service
else
  echo "Kein Update nötig (bereits auf $LOCAL)."
fi
