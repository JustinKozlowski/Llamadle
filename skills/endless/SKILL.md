---
name: endless
description: Play Llamadle Endless — unlimited replay of a Wordle-style word-guessing game where you try to get an AI opponent to say a secret phrase without using any banned words, in as few tokens as possible. Uses your own Claude usage (via the local claude CLI), not the shared daily puzzle. Use this whenever the user runs /llamadle:endless or asks to play unlimited/practice Llamadle.
---

# Llamadle — Endless

Unlimited replay against a phrase pool that's separate from the shared daily puzzle
(`/llamadle:daily`) — no once-per-day gating, and it costs your own Claude usage instead of the
site's shared, rate-limited key.

**The game runs entirely in a local browser tab, backed by a self-contained local server** — not
in this chat. Judge/scoring/opponent/win-detection/state are all handled by
`scripts/bridge-server.js` itself (via fast headless `claude --safe-mode` calls, not the `Agent`
tool — see that file's comments for why). Your only job on `/llamadle:endless` is to make sure
that server is running and open the browser to it.

Path note: every path below is relative to this skill's own directory (the one this SKILL.md
lives in), not wherever Bash's current working directory happens to be — resolve it against
this skill's base directory as reported at invocation time.

## What to do

1. Check whether the bridge server is already running:
   ```
   test -f ~/.claude/llamadle/bridge.pid && kill -0 "$(cat ~/.claude/llamadle/bridge.pid)" 2>/dev/null && echo RUNNING || echo NOT_RUNNING
   ```
   (Not `cat pid | xargs kill -0` — `xargs` exits 0 on empty input even when there's no pid
   file, which reports RUNNING incorrectly. Verified during testing.)
2. If `NOT_RUNNING`, start it as a detached background process (don't use a foreground/blocking
   Bash call — it needs to keep running after this turn ends):
   ```
   nohup node "<skill dir>/scripts/bridge-server.js" > ~/.claude/llamadle/bridge.log 2>&1 &
   ```
   Give it a second to bind its port, then confirm it's up:
   ```
   sleep 1 && curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/state
   ```
   (Expect `200`. If it fails, read `~/.claude/llamadle/bridge.log` for the error and report it
   to the player rather than retrying in a loop.)
3. Open the browser: `open http://localhost:4173` (macOS `open`, matching this environment).
4. Tell the player the game is open in their browser now, and that this chat isn't part of
   play — everything happens in that tab. The page's own "New Phrase" button gets a fresh
   random phrase after each round; no need to re-invoke this skill to keep playing.

There is no turn-by-turn protocol here: no `Agent` tool calls, no message/resume loop. Once the
server is confirmed running and the browser is open, this skill's job for that invocation is
done.

## Other useful facts (for your own troubleshooting, not part of normal play)

- Difficulty preference lives in `~/.claude/llamadle/state.json` — same file and shape the
  server itself owns; don't hand-edit it while the server is running. Endless mode has no
  streak/history/completion tracking (unlimited replay has no daily gating to track).
- `~/.claude/llamadle/bridge.log` has the server's stdout/stderr if something goes wrong.
- If the player asks to stop the server: `kill $(cat ~/.claude/llamadle/bridge.pid)` and remove
  `~/.claude/llamadle/bridge.pid`.
