#!/usr/bin/env bash
# Writes a sanitized model-routing snapshot for the Overlay sidebar "Modelle"
# widget to /opt/overlay/data/model-status.json.
#
# Runs as the `aaron` user from cron (it has an ACL read grant on
# /home/emmy/.openclaw; the Overlay server process, user `overlay`, does not).
# Reads `openclaw models status --json` for the Emmy gateway's own agent state
# and keeps only non-secret fields: provider profile *counts*, the resolved
# default model and its fallback chain. No API keys, tokens or OAuth material
# ever touch the output file. If the openclaw call fails the previous snapshot
# is left in place rather than clobbered.

OUT=/opt/overlay/data/model-status.json
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

export OPENCLAW_STATE_DIR=/home/emmy/.openclaw
export OPENCLAW_CONFIG_PATH=/home/emmy/.openclaw/openclaw.json
export HOME=/home/emmy

raw=""
for attempt in 1 2 3; do
  # A cold `openclaw` start (loading embedded plugin servers) can time out the
  # first time; a warm retry then succeeds.
  raw="$(timeout 120 openclaw models status --json 2>/dev/null)"
  case "$raw" in
    "{"*) break ;;
    *) raw=""; sleep 3 ;;
  esac
done

if [ -z "$raw" ]; then
  echo "model-status-snapshot: 'openclaw models status' produced no JSON after 3 tries" >&2
  exit 1
fi

RAWFILE="$(mktemp)"
trap 'rm -f "$TMP" "$RAWFILE"' EXIT
printf '%s' "$raw" > "$RAWFILE"

if ! python3 - "$RAWFILE" "$TMP" <<'PY'
import datetime, json, sys

with open(sys.argv[1]) as f:
    j = json.load(f)
auth = j.get("auth", {})

def profile_count(provider):
    for p in auth.get("providers", []):
        if p.get("provider") == provider:
            return int(p.get("profiles", {}).get("count", 0) or 0)
    return 0

out = {
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "instance": "emmy",
    "default": j.get("resolvedDefault") or j.get("defaultModel") or None,
    "fallbacks": [m for m in (j.get("fallbacks") or []) if isinstance(m, str)],
    "claudeAccounts": profile_count("anthropic"),
    "geminiKeys": profile_count("google"),
}
with open(sys.argv[2], "w") as f:
    json.dump(out, f, indent=2)
    f.write("\n")
PY
then
  echo "model-status-snapshot: failed to parse openclaw output" >&2
  exit 1
fi

chmod 644 "$TMP"
mv "$TMP" "$OUT"
trap - EXIT
