---
name: daily
description: Play Llamadle's daily puzzle, a Wordle-style word-guessing game — try to get an AI opponent to say today's secret phrase without using any banned words, in as few tokens as possible. Use this whenever the user runs /llamadle:daily or asks to play/check/share today's Llamadle puzzle.
---

# Llamadle — Daily

A daily, Wordle-style game where the player chats with an AI opponent, trying to get it to
naturally say today's secret phrase without their own guesses using any of that puzzle's
banned words.

**All game logic lives in `scripts/engine.js`** — command routing, the guess loop, judge-retry
handling, win/give-up handling, and every reply's exact text. This file is just the glue
between that engine and the two things only you (Claude) can do: call the `Agent` tool and
call the `Skill` tool. Never re-implement any game logic here in prose — if something needs to
change, change the engine, not this description.

Path note: `scripts/engine.js` is relative to this skill's own directory (the one this
SKILL.md lives in), not wherever Bash's current working directory happens to be — resolve it
against this skill's base directory as reported at invocation time.

## The loop

1. Run `node "<skill dir>/scripts/engine.js" message` with the player's raw message piped in
   via a quoted heredoc (never inline free text into a shell argument — a message containing
   `"`, `` ` ``, `$`, or `\` would get shell-interpreted otherwise):
   ```
   node "<skill dir>/scripts/engine.js" message <<'LLAMADLE_EOF'
   <the player's exact message>
   LLAMADLE_EOF
   ```
   For the bare `/llamadle:daily` invocation with no extra text, pipe in an empty string.
2. It prints exactly one JSON object. Act on its `action` field:
   - **`"reply"`** → show `text` to the player verbatim. Done for this turn — wait for their
     next message and go back to step 1.
   - **`"call_agent"`** → call the `Agent` tool with `subagent_type: <subagentType>` and
     `prompt: <prompt>`, exactly as given (don't add or remove anything). Take its raw output
     and go to step 3.
   - **`"invoke_skill"`** → call the `Skill` tool with `skill: <skill>` and `args: <args>`,
     exactly as given. Take its raw result and go to step 3.
3. Pipe whatever you got back in step 2 into resume, the same way:
   ```
   node "<skill dir>/scripts/engine.js" resume <<'LLAMADLE_EOF'
   <the subagent/skill's raw output, exactly as returned>
   LLAMADLE_EOF
   ```
   This prints another action object — go back to step 2 and keep looping until you get a
   `"reply"`.

That's the entire protocol. It's the same for every command (`play`, `stats`, `share`,
`notifications on|off`, `difficulty <easy|medium|hard>`, and ordinary guesses while a game is
active) — the engine decides what any given message means, not this file.
