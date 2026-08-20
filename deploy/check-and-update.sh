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

# update.sh's last step is `pm2 restart overlay`, which kills every open
# project terminal (pty child processes die with the server, see
# server/src/pty/pty.session.ts) including whatever `claude` process is
# running inside it. Deferring the restart while a session is live avoids
# that mid-work — but only up to MAX_DEFERS: this same restart is also what
# forces re-authentication (deploy/update.sh step 5/5, Authelia), so an
# open terminal must never be able to block a security-relevant update
# indefinitely. /run is tmpfs, so this counter is naturally reset on every
# reboot instead of needing its own cleanup.
DEFER_STATE_FILE="/run/overlay-update-defer-count"
MAX_DEFERS=6

PORT=$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
PORT=${PORT:-4317}

git fetch --quiet origin

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "@{u}")

if [ "$LOCAL" != "$REMOTE" ]; then
  DEFER_COUNT=$(cat "$DEFER_STATE_FILE" 2>/dev/null || echo 0)
  ACTIVE_SESSIONS=$(curl -fsS --max-time 3 "http://127.0.0.1:${PORT}/api/health/terminals" 2>/dev/null \
    | grep -o '"activeSessions":true' || true)

  if [ -n "$ACTIVE_SESSIONS" ] && [ "$DEFER_COUNT" -lt "$MAX_DEFERS" ]; then
    echo "Neue Commits gefunden ($LOCAL -> $REMOTE), aber aktive Terminal-Sessions erkannt — verschiebe Update (Versuch $((DEFER_COUNT + 1))/$MAX_DEFERS)."
    echo $((DEFER_COUNT + 1)) > "$DEFER_STATE_FILE"
    exit 0
  fi

  rm -f "$DEFER_STATE_FILE"
  echo "Neue Commits gefunden ($LOCAL -> $REMOTE), starte overlay-update.service."
  systemctl start --no-block overlay-update.service
else
  rm -f "$DEFER_STATE_FILE"
  echo "Kein Update nötig (bereits auf $LOCAL)."
fi
