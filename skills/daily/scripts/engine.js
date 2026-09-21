#!/usr/bin/env node
// The Llamadle game engine. This is the ONE place that owns control flow: command routing,
// the guess loop, judge-retry logic, win/give-up handling, and every reply's exact text.
// SKILL.md is just glue on top of this — it never re-implements any of this logic in prose.
//
// Usage:
//   node engine.js message  <<'EOF' ... EOF   (stdin: the player's raw message text)
//   node engine.js resume   <<'EOF' ... EOF   (stdin: raw output from the action just done)
//
// Every invocation prints exactly one JSON object on stdout:
//   {"action": "reply", "text": "..."}
//     — done for this turn. Show `text` to the player verbatim (already fully formatted).
//   {"action": "call_agent", "subagentType": "...", "prompt": "..."}
//     — call the Agent tool with that subagent_type and prompt, verbatim, then pipe its raw
//       output into `node engine.js resume`.
//   {"action": "invoke_skill", "skill": "...", "args": "..."}
//     — call the Skill tool with that skill and args, then pipe its raw result into
//       `node engine.js resume`.
const lib = require('./lib');

const [, , cmd] = process.argv;

function out(obj) {
  console.log(JSON.stringify(obj));
}

function reply(text) {
  out({ action: 'reply', text });
}

function callAgent(subagentType, prompt) {
  out({ action: 'call_agent', subagentType, prompt });
}

function invokeSkill(skill, args) {
  out({ action: 'invoke_skill', skill, args });
}

function transcriptLines(session) {
  return session.transcript.map((t) => `${t.role === 'guess' ? 'Them' : 'You'}: ${t.text}`);
}

function judgePrompt(session, guessText) {
  return `Banned words: ${session.bannedWords.join(', ')}\nGuess: ${guessText}`;
}

function isGiveUp(text) {
  const t = text.trim().toLowerCase();
  return t.includes('give up') || t === 'quit' || t === 'i quit';
}

// ---- one-shot commands (no session, no Agent call) ----

async function doPlay() {
  const state = lib.readState();
  const daily = await lib.fetchDaily(state.difficulty);
  if (daily.error) {
    reply(`I can't reach the puzzle server right now (${daily.error}). Try again shortly.`);
    return;
  }

  const existing = lib.readSession();
  if (existing && existing.puzzleNumber === daily.puzzleNumber && existing.difficulty === state.difficulty) {
    reply(`You already have a game in progress (guess ${existing.guessCount + 1} coming up) — go ahead and send your next message to the opponent.`);
    return;
  }

  if (lib.alreadyCompleted(state, state.difficulty, daily.puzzleNumber)) {
    const result = lib.findResult(state, state.difficulty, daily.puzzleNumber);
    reply(
      result.found
        ? `You've already finished today's ${state.difficulty} puzzle.\n\n${lib.shareText(result)}`
        : `You've already finished today's ${state.difficulty} puzzle.`
    );
    return;
  }

  // Any leftover session here is stale (a different day/difficulty) — overwritten below.
  const session = {
    difficulty: state.difficulty,
    puzzleNumber: daily.puzzleNumber,
    phrase: daily.phrase,
    bannedWords: daily.bannedWords,
    guessCount: 0,
    tokenTotal: 0,
    transcript: [],
    phase: 'awaiting_guess',
    pending: null,
  };
  lib.writeSession(session);

  reply(
    `🦙 Llamadle #${daily.puzzleNumber} — ${state.difficulty}\n` +
      `Get the AI to say: "${daily.phrase}"\n` +
      `Banned words (don't use these yourself): ${daily.bannedWords.join(', ')}\n\n` +
      `Send your first message to the opponent whenever you're ready. ("give up" ends the attempt.)`
  );
}

function doStats() {
  const state = lib.readState();
  if (state.history.length === 0) {
    reply(`No games played yet. Streak: 0. Current difficulty: ${state.difficulty}.`);
    return;
  }
  const lines = state.history
    .slice(-10)
    .reverse()
    .map((h) => `${h.date} — #${h.puzzleNumber} ${h.difficulty}: ${h.won ? 'won' : 'gave up'} in ${h.guesses} guesses, ${h.tokens} tokens`);
  reply(`Streak: ${state.streak}\nDifficulty: ${state.difficulty}\n\nRecent games:\n${lines.join('\n')}`);
}

async function doShare() {
  const state = lib.readState();
  const daily = await lib.fetchDaily(state.difficulty);
  if (daily.error) {
    reply(`I can't reach the puzzle server right now (${daily.error}).`);
    return;
  }
  const result = lib.findResult(state, state.difficulty, daily.puzzleNumber);
  if (!result.found) {
    reply(`You haven't finished today's ${state.difficulty} puzzle yet.`);
    return;
  }
  reply(lib.shareText(result));
}

function doSetDifficulty(message) {
  const match = message.trim().toLowerCase().match(/(easy|medium|hard)/);
  if (!match) {
    reply('Usage: difficulty easy|medium|hard');
    return;
  }
  const state = lib.readState();
  state.difficulty = match[1];
  lib.writeState(state);
  reply(`Difficulty set to ${match[1]}. This applies next time you start a puzzle (doesn't affect a game already in progress).`);
}

function doNotificationsOn() {
  const state = lib.readState();
  state._pendingNotify = 'on';
  lib.writeState(state);
  invokeSkill(
    'schedule',
    'Create a daily routine that checks https://www.justinkozlowski.me/llamadle/daily and sends a push notification like "New Llamadle puzzle is up!" once a day. Reply with the routine\'s id/name.'
  );
}

function doNotificationsOff() {
  const state = lib.readState();
  if (!state.notificationsEnabled || !state.notificationRoutineId) {
    reply('Notifications are already off.');
    return;
  }
  state._pendingNotify = 'off';
  lib.writeState(state);
  invokeSkill('schedule', `Delete/disable this routine: ${state.notificationRoutineId}`);
}

function resumeNotifyOn(rawResult) {
  const state = lib.readState();
  delete state._pendingNotify;
  state.notificationsEnabled = true;
  state.notificationRoutineId = rawResult.trim().slice(0, 500) || 'unknown-routine';
  lib.writeState(state);
  reply("Daily notifications are on — I'll let you know when a new puzzle is up.");
}

function resumeNotifyOff() {
  const state = lib.readState();
  delete state._pendingNotify;
  state.notificationsEnabled = false;
  state.notificationRoutineId = null;
  lib.writeState(state);
  reply('Daily notifications are off.');
}

// ---- the guess loop ----

async function doGiveUp(session) {
  const state = lib.readState();
  lib.recordResult(state, session.difficulty, session.puzzleNumber, false, session.guessCount, session.tokenTotal);
  lib.writeState(state);
  lib.clearSession();
  reply(
    `No worries — here's how that attempt went:\n\n` +
      lib.shareText({
        puzzleNumber: session.puzzleNumber,
        difficulty: session.difficulty,
        won: false,
        guesses: session.guessCount,
        tokens: session.tokenTotal,
        streak: state.streak,
      })
  );
}

async function doGuess(session, guessText) {
  if (isGiveUp(guessText)) {
    await doGiveUp(session);
    return;
  }

  session.phase = 'awaiting_judge';
  session.pending = { guessText, judgeRetryCount: 0 };
  lib.writeSession(session);
  callAgent('llamadle-judge', judgePrompt(session, guessText));
}

async function resumeJudge(session, rawOutput) {
  let verdict = lib.parseJudgeOutput(rawOutput);

  if (verdict.parseError) {
    if (session.pending.judgeRetryCount < 1) {
      session.pending.judgeRetryCount += 1;
      lib.writeSession(session);
      callAgent(
        'llamadle-judge',
        judgePrompt(session, session.pending.guessText) +
          '\n\nRespond with ONLY the JSON object described in your instructions — no other text.'
      );
      return;
    }
    // Fail open after one retry — don't block the player over a formatting hiccup.
    verdict = { flagged: false, matchedWords: [], reason: '(judge response unparseable twice — allowed through)' };
  }

  const guessText = session.pending.guessText;

  if (verdict.flagged) {
    session.phase = 'awaiting_guess';
    session.pending = null;
    lib.writeSession(session);
    reply(
      `⚠️ That guess was flagged: ${verdict.reason}` +
        (verdict.matchedWords.length ? ` (matched: ${verdict.matchedWords.join(', ')})` : '') +
        `. It wasn't counted — try rephrasing.`
    );
    return;
  }

  const scored = await lib.fetchCountTokens(guessText);
  const tokens = typeof scored.input_tokens === 'number' ? scored.input_tokens : 0;
  const note = scored.error ? '(scoring temporarily unavailable for that guess)\n' : '';

  session.transcript.push({ role: 'guess', text: guessText });
  session.tokenTotal += tokens;
  session.guessCount += 1;
  session.phase = 'awaiting_opponent';
  session.pending = { note };
  lib.writeSession(session);

  callAgent('llamadle-opponent', transcriptLines(session).join('\n'));
}

async function resumeOpponent(session, rawReply) {
  const replyText = rawReply.trim();
  session.transcript.push({ role: 'reply', text: replyText });

  const won = replyText.toLowerCase().includes(session.phrase.toLowerCase());
  const note = (session.pending && session.pending.note) || '';

  if (!won) {
    session.phase = 'awaiting_guess';
    session.pending = null;
    lib.writeSession(session);
    reply(`${note}${replyText}`);
    return;
  }

  const state = lib.readState();
  lib.recordResult(state, session.difficulty, session.puzzleNumber, true, session.guessCount, session.tokenTotal);
  lib.writeState(state);
  lib.clearSession();

  reply(
    `${note}${replyText}\n\n🎉 It said the phrase — you win!\n\n` +
      lib.shareText({
        puzzleNumber: session.puzzleNumber,
        difficulty: session.difficulty,
        won: true,
        guesses: session.guessCount,
        tokens: session.tokenTotal,
        streak: state.streak,
      })
  );
}

// ---- top-level routing ----

async function handleMessage(raw) {
  const message = raw.trim();
  const lower = message.toLowerCase();

  if (lower === '' || lower === 'play') return doPlay();
  if (lower === 'stats') return doStats();
  if (lower === 'share') return doShare();
  if (lower === 'notifications on') return doNotificationsOn();
  if (lower === 'notifications off') return doNotificationsOff();
  if (lower.startsWith('difficulty')) return doSetDifficulty(message);

  const session = lib.readSession();
  if (session && session.phase === 'awaiting_guess') {
    return doGuess(session, message);
  }

  // No active game and no recognized command — default to starting a game.
  return doPlay();
}

async function handleResume(raw) {
  const session = lib.readSession();

  if (session) {
    if (session.phase === 'awaiting_judge') return resumeJudge(session, raw);
    if (session.phase === 'awaiting_opponent') return resumeOpponent(session, raw);
    reply('(internal) unexpected session phase — try `play` again.');
    return;
  }

  // No session: the only resumable flows without one are notifications.
  const state = lib.readState();
  if (state._pendingNotify === 'on') return resumeNotifyOn(raw);
  if (state._pendingNotify === 'off') return resumeNotifyOff();

  reply('(internal) nothing was pending to resume.');
}

async function main() {
  const raw = lib.readStdin();
  if (cmd === 'message') {
    await handleMessage(raw);
  } else if (cmd === 'resume') {
    await handleResume(raw);
  } else {
    out({ error: `unknown command "${cmd}" (use "message" or "resume")` });
    process.exitCode = 1;
  }
}

main();
