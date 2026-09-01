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

# cron gives us a bare PATH without nvm; make sure the `openclaw` CLI (installed
# under the aaron user's nvm node) is reachable. Glob so a node version bump
# doesn't silently break the snapshot again.
for _nvmbin in /home/aaron/.nvm/versions/node/*/bin; do
  [ -x "$_nvmbin/openclaw" ] && PATH="$_nvmbin:$PATH" && break
done
export PATH

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

fallbacks = [m for m in (j.get("fallbacks") or []) if isinstance(m, str)]

claude_accounts = profile_count("anthropic")
gemini_keys = profile_count("google")

# `openclaw models status` only reports provider profile counts when the agent
# state DB is readable; from the aaron cron user it usually is not, so the auth
# block comes back empty. Fall back to the gateway config file (aaron has an ACL
# read grant on it) and count credential profiles directly.
if claude_accounts == 0 or gemini_keys == 0:
    try:
        with open("/home/emmy/.openclaw/openclaw.json") as f:
            cfg = json.load(f)
        profiles = (cfg.get("auth") or {}).get("profiles") or {}
        cfg_gemini = sum(1 for p in profiles.values() if p.get("provider") == "google")
        # claude-cli OAuth subscription profiles. The claude-cli2 second account
        # is added once, unconditionally, further down (it never appears here).
        cfg_claude = sum(
            1 for p in profiles.values()
            if p.get("provider") == "claude-cli" and p.get("mode") == "oauth"
        )
        claude_accounts = claude_accounts or cfg_claude
        gemini_keys = gemini_keys or cfg_gemini
    except Exception:
        pass

# The claude-cli2 second-account plugin backend keeps its OAuth outside the
# agent state DB, so `openclaw models status` never lists it as a profile —
# it only shows up as a referenced-but-"missing" provider. Whenever a
# claude-cli2/* model is in the fallback chain (or the provider is flagged
# in use), that's a real second Claude subscription the widget should count,
# on top of whatever the profile scan above found.
uses_cli2 = any(m.startswith("claude-cli2/") for m in fallbacks) or (
    "claude-cli2" in (auth.get("missingProvidersInUse") or [])
)
if uses_cli2:
    claude_accounts += 1

out = {
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "instance": "emmy",
    "default": j.get("resolvedDefault") or j.get("defaultModel") or None,
    "fallbacks": fallbacks,
    "claudeAccounts": claude_accounts,
    "geminiKeys": gemini_keys,
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
