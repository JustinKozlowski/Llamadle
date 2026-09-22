---
name: daily
description: Open today's Llamadle daily puzzle in the browser — a Wordle-style word-guessing game where you try to get an AI opponent to say the secret phrase without using any banned words, in as few tokens as possible. Use this whenever the user runs /llamadle:daily or asks to play/check/share today's Llamadle puzzle.
---

# Llamadle — Daily

The daily puzzle is a shared, one-attempt-per-day challenge, judged and scored entirely by the
deployed site (session cookies, daily gating, share text) — this skill's only job is to open it.

## What to do

Run:
```
open https://www.justinkozlowski.me/llamadle
```
(macOS `open`, matching this environment.) Then tell the player the game is open in their
browser now — this chat isn't part of play.

That's the entire skill. No local server, no `Agent` tool calls, nothing else to check.

For unlimited replay against your own Claude usage instead of the shared daily puzzle, see the
`/llamadle:endless` skill.
