#!/usr/bin/env bash
# Stellt die Rechtetrennung her, die SECURITY.md und DEPLOYMENT.md (Abschnitt
# 15) bereits voraussetzen, die bisher aber nirgends tatsächlich hergestellt
# wurde: der Code gehört root und ist für den Dienst-User nur lesbar, nur die
# Laufzeitdaten unter data/ gehören ihm selbst.
#
# Warum das nötig ist: ohne diesen Schritt gehört der komplette Checkout dem
# unprivilegierten Dienst-User (so war es auf diesem Server tatsächlich, inkl.
# .git und .env). Damit ist das PR-Review vor dem Ausrollen bloß eine
# Konvention — wer als dieser User Code ausführt, kann server/dist direkt
# überschreiben und das Gate komplett umgehen. update.sh läuft als root über
# overlay-update.service und darf weiterhin schreiben; genau diese Asymmetrie
# ist der Zweck.
#
# Repariert außerdem Alt-Modi unter data/: session.ts legt sessions.json
# bewusst mit 0600 an ("live credentials" — zusammen mit SESSION_SECRET lässt
# sich daraus ein gültiges Cookie bauen), aber ein Modus gilt nur beim
# *Erstellen*. Vor dieser Regel entstandene Dateien standen hier auf 0777 und
# waren damit für jeden lokalen Account lesbar.
#
# Aufruf als root:
#   deploy/harden-permissions.sh [--dry-run] [ziel-verzeichnis]
#
# Ohne Argument härtet es den Checkout, in dem das Skript selbst liegt.
# NICHT auf einem Entwicklungs-Klon ausführen — danach kann der Dienst-User
# dort weder committen noch bauen. Idempotent, wiederholtes Ausführen ist
# unschädlich.
set -euo pipefail

SERVICE_USER="${OVERLAY_USER:-overlay}"
DRY_RUN=0
TARGET=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '2,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*)
      echo "Unbekannte Option: $arg" >&2
      exit 2
      ;;
    *) TARGET="$arg" ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  TARGET="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

if [[ $EUID -ne 0 ]]; then
  echo "Muss als root laufen (chown auf root ist sonst nicht möglich)." >&2
  exit 1
fi
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  echo "Dienst-User '$SERVICE_USER' existiert nicht (via OVERLAY_USER überschreibbar)." >&2
  exit 1
fi
if [[ ! -f "$TARGET/package.json" ]]; then
  echo "'$TARGET' sieht nicht nach einem Overlay-Checkout aus (keine package.json)." >&2
  exit 1
fi

SERVICE_GROUP="$(id -gn "$SERVICE_USER")"

echo "Ziel        : $TARGET"
echo "Dienst-User : $SERVICE_USER:$SERVICE_GROUP"
[[ $DRY_RUN -eq 1 ]] && echo "Modus       : DRY-RUN, es wird nichts verändert"
echo

run() {
  echo "     $*"
  # Bewusst als if statt "[[ ... ]] && cmd": bei der &&-Variante würde ein
  # abschließendes "return 0" einen fehlgeschlagenen chown/chmod verschlucken
  # und set -e liefe daran vorbei.
  if [[ $DRY_RUN -eq 0 ]]; then
    "$@"
  fi
}

echo "==> 1/4 Code root-eigen machen, Dienst-User nur lesend"
# Relative Modi statt fester Zahlen: sonst verlieren die Binaries unter
# node_modules/.bin ihr Execute-Bit und der Build bricht ab.
run chown -R "root:$SERVICE_GROUP" "$TARGET"
run chmod -R g-w,o-rwx "$TARGET"

echo "==> 2/4 .env lesbar halten"
# Sonderfall: .env steht üblicherweise auf 0600. Nach dem chown oben gehörte
# sie root und wäre für den Dienst-User nicht mehr lesbar — der Server käme
# beim Start nicht mehr an seine Konfiguration. 0640 mit Gruppe = Dienst-User
# gibt Lesezugriff zurück, ohne Schreibrecht zu erlauben.
if [[ -f "$TARGET/.env" ]]; then
  run chmod 640 "$TARGET/.env"
else
  echo "     (keine .env vorhanden, übersprungen)"
fi

echo "==> 3/4 Laufzeitdaten dem Dienst-User zurückgeben"
# data/ ist das einzige Verzeichnis, in das der laufende Prozess schreibt
# (sessions.json, projects.json, Chats, Anhänge, Scan-/Backup-Berichte).
# go-rwx statt nur g-w: hier liegen Sitzungs-Credentials, andere lokale
# Accounts haben darin generell nichts zu suchen.
run mkdir -p "$TARGET/data"
run chown -R "$SERVICE_USER:$SERVICE_GROUP" "$TARGET/data"
# Verzeichnisse und Dateien getrennt und mit festen Modi: ein "chmod -R
# u+rwX" würde bei genau den kaputten 0777-Dateien, um die es hier geht, das
# Execute-Bit erhalten (X wirkt, wenn irgendwer schon x hat) und sie als 0700
# statt 0600 zurücklassen — ausführbare JSON-Dateien.
run find "$TARGET/data" -type d -exec chmod 700 {} +
run find "$TARGET/data" -type f -exec chmod 600 {} +

echo "==> 4/4 Prüfen"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "     übersprungen (dry-run)"
  exit 0
fi

FAILED=0
check() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "     OK    $desc"
  else
    echo "     FEHLT $desc"
    FAILED=1
  fi
}
check_not() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "     FEHLT $desc"
    FAILED=1
  else
    echo "     OK    $desc"
  fi
}

check_not "Code ist für $SERVICE_USER nicht mehr beschreibbar" \
  runuser -u "$SERVICE_USER" -- test -w "$TARGET"
check_not ".git ist für $SERVICE_USER nicht mehr beschreibbar" \
  runuser -u "$SERVICE_USER" -- test -w "$TARGET/.git"
check "data/ ist für $SERVICE_USER schreibbar" \
  runuser -u "$SERVICE_USER" -- test -w "$TARGET/data"
if [[ -f "$TARGET/.env" ]]; then
  check ".env ist für $SERVICE_USER lesbar" \
    runuser -u "$SERVICE_USER" -- test -r "$TARGET/.env"
fi
if [[ -d "$TARGET/server/dist" ]]; then
  check "server/dist ist für $SERVICE_USER lesbar" \
    runuser -u "$SERVICE_USER" -- test -r "$TARGET/server/dist"
else
  echo "     (server/dist fehlt — noch nicht gebaut, übersprungen)"
fi

# Reste, die das Skript bewusst NICHT selbst anfasst: .env-Sicherungskopien
# enthalten alte Secrets, deren Löschung eine bewusste Entscheidung sein soll.
shopt -s nullglob
BAKS=("$TARGET"/.env.bak-*)
shopt -u nullglob
if [[ ${#BAKS[@]} -gt 0 ]]; then
  echo
  echo "     Hinweis: ${#BAKS[@]} .env-Sicherungskopie(n) gefunden. Sie enthalten"
  echo "     alte Secrets und gehören jetzt root (0600). Nach Prüfung löschen:"
  for f in "${BAKS[@]}"; do echo "       rm $f"; done
fi

echo
if [[ $FAILED -eq 0 ]]; then
  echo "==> Fertig. Danach einmal 'pm2 restart overlay'."
else
  echo "==> FEHLER: mindestens eine Prüfung fehlgeschlagen, bitte oben ansehen." >&2
  exit 1
fi
