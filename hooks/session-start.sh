#!/usr/bin/env bash
# SessionStart hook: reminds the user about today's Llamadle puzzle, once per day. Can only
# know "were you reminded today," not "did you finish" — completion state lives server-side,
# tied to a browser cookie, invisible to a local hook.
set -euo pipefail

STATE_DIR="$HOME/.claude/llamadle"
MARKER_FILE="$STATE_DIR/last-reminded"
TODAY="$(date +%Y-%m-%d)"

mkdir -p "$STATE_DIR"

if [ -f "$MARKER_FILE" ] && [ "$(cat "$MARKER_FILE")" = "$TODAY" ]; then
  exit 0
fi

echo "$TODAY" > "$MARKER_FILE"

cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Remind the user to check today's Llamadle puzzle: https://www.justinkozlowski.me/llamadle"
  }
}
EOF
