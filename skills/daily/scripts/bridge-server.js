#!/usr/bin/env node
// Self-contained local game server for Llamadle. Started by the skill (see SKILL.md), reused
// across invocations via the PID file. Owns the entire turn loop itself — judge, scoring,
// opponent, win detection, state persistence — using headless `claude` CLI calls (see
// persistent-claude.js) instead of the Agent tool. No Monitor, no relay through the running
// Claude Code session during gameplay.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const lib = require('./lib');
const { createPersistentClaude, MODEL } = require('./persistent-claude');

const STATE_DIR = path.join(os.homedir(), '.claude', 'llamadle');
const PID_FILE = path.join(STATE_DIR, 'bridge.pid');
const PORT_FILE = path.join(STATE_DIR, 'bridge.port');
const DEFAULT_PORT = 4173;
const PUBLIC_HTML = path.join(__dirname, 'public', 'index.html');

// The page pings /heartbeat every HEARTBEAT_INTERVAL_MS while open. If nothing has pinged in
// HEARTBEAT_TIMEOUT_MS, the server shuts itself down — correctly handles a closed tab, a
// crashed browser, and multiple tabs open at once (only dies once *nothing* is pinging),
// without the "reload kills it" problem a beforeunload/pagehide handler would have.
const HEARTBEAT_TIMEOUT_MS = 20000;
const HEARTBEAT_CHECK_INTERVAL_MS = 5000;
let lastHeartbeat = Date.now();

function cleanupFiles() {
  try { fs.unlinkSync(PID_FILE); } catch (e) {}
  try { fs.unlinkSync(PORT_FILE); } catch (e) {}
}

function shutdown(reason) {
  console.log(`llamadle bridge server shutting down (${reason})`);
  teardownSessionProcs();
  cleanupFiles();
  process.exit(0);
}

// Verbatim from the original site's system_instruction (src/components/HelloWorld.vue,
// askPrompt's payload) — not rewritten, on request.
const OPPONENT_SYSTEM_PROMPT = 'Respond in 1 sentence';

// Verbatim from the original site's isInputHacky payload, including its typos ("attemping",
// "mispelling") — not corrected, on request.
const JUDGE_SYSTEM_PROMPT =
  "We are playing charades so we can't say certain words. \n" +
  'We are allowed to describe words and use synonyms though. \n' +
  'Is the given phrase attemping to spell the banned words? \n' +
  'Do not allow leet speek of the banned words. \n' +
  'Do not allow mispelling of the banned words.\n' +
  'Return individual mispelled words if there is a concatenation of the banned words.\n';

// Matches the original site's response_schema exactly (isInputHacky in HelloWorld.vue) —
// there's no separate boolean; "flagged" is derived from the array being non-empty, same as
// the original's `mispelledWordsThatAreInBannedWordsList.length > 0` check.
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    mispelledWordsThatAreInBannedWordsList: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['mispelledWordsThatAreInBannedWordsList', 'reason'],
};

function judgePrompt(bannedWords, guess) {
  // Matches the original site's user-turn content exactly: `Banned Words: ${JSON.stringify(
  // this.bannedWords)}. Phrase: ${input}` (isInputHacky in HelloWorld.vue) — "Phrase" there
  // refers to the player's guess, not the puzzle's target phrase.
  return `Banned Words: ${JSON.stringify(bannedWords)}. Phrase: ${guess}`;
}

function isGiveUp(text) {
  const t = text.trim().toLowerCase();
  return t === 'give up' || t === 'i give up' || t === 'quit' || t === 'i quit';
}

// ---- persistent judge/opponent processes, scoped to the current game ----
//
// One judge process and one opponent process are kept alive for the life of a game (spawned
// lazily on its first guess, killed when the game ends or a new/different game starts). This
// amortizes `claude` CLI startup overhead across every guess in a game instead of paying it
// per guess — see persistent-claude.js for measurements and why the opponent's own past
// replies no longer need to be replayed back to it as text (it remembers them natively).
//
// If the server restarts mid-game (e.g. after a heartbeat timeout is narrowly avoided, or a
// crash), the new opponent process starts with no memory of that game's earlier turns — the
// session's `transcript` field still has them for display/history purposes, but they aren't
// replayed into the fresh process. Not handled: a mid-game server restart is rare (the
// heartbeat keeps the server alive for the duration of an open tab) and re-deriving that
// memory would mean re-running the opponent for every past turn.
let sessionProcs = null; // { key, judge, opponent }

function sessionKey(session) {
  return `${session.difficulty}:${session.puzzleNumber}`;
}

function teardownSessionProcs() {
  if (!sessionProcs) return;
  sessionProcs.judge.kill();
  sessionProcs.opponent.kill();
  sessionProcs = null;
}

function ensureSessionProcs(session) {
  const key = sessionKey(session);
  if (sessionProcs && sessionProcs.key === key && !sessionProcs.judge.isDead && !sessionProcs.opponent.isDead) {
    return sessionProcs;
  }
  teardownSessionProcs();
  sessionProcs = {
    key,
    judge: createPersistentClaude({
      systemPrompt: JUDGE_SYSTEM_PROMPT,
      jsonSchema: JUDGE_SCHEMA,
      label: 'judge',
      model: MODEL,
    }),
    opponent: createPersistentClaude({
      systemPrompt: OPPONENT_SYSTEM_PROMPT,
      label: 'opponent',
      model: MODEL,
    }),
  };
  return sessionProcs;
}

// ---- HTTP plumbing ----

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---- route handlers ----

async function handleState(req, res) {
  sendJson(res, 200, lib.readState());
}

async function handleGame(req, res, query) {
  const state = lib.readState();
  const difficulty = query.get('difficulty') || state.difficulty;
  const daily = await lib.fetchDaily(difficulty);
  if (daily.error) return sendJson(res, 502, { error: daily.error });

  if (lib.alreadyCompleted(state, difficulty, daily.puzzleNumber)) {
    const result = lib.findResult(state, difficulty, daily.puzzleNumber);
    return sendJson(res, 200, {
      alreadyCompleted: true,
      puzzleNumber: daily.puzzleNumber,
      difficulty,
      share: result.found ? lib.shareText(result) : null,
    });
  }

  const existing = lib.readSession();
  let session;
  if (existing && existing.puzzleNumber === daily.puzzleNumber && existing.difficulty === difficulty) {
    session = existing;
  } else {
    session = {
      difficulty,
      puzzleNumber: daily.puzzleNumber,
      phrase: daily.phrase,
      bannedWords: daily.bannedWords,
      guessCount: 0,
      tokenTotal: 0,
      transcript: [],
    };
    lib.writeSession(session);
  }

  sendJson(res, 200, {
    alreadyCompleted: false,
    puzzleNumber: session.puzzleNumber,
    difficulty: session.difficulty,
    phrase: session.phrase,
    bannedWords: session.bannedWords,
    guessCount: session.guessCount,
    tokenTotal: session.tokenTotal,
    transcript: session.transcript,
  });
}

async function handleHeartbeat(req, res) {
  lastHeartbeat = Date.now();
  sendJson(res, 200, { ok: true });
}

async function handleDifficulty(req, res) {
  const body = await readBody(req);
  if (!['easy', 'medium', 'hard'].includes(body.difficulty)) {
    return sendJson(res, 400, { error: 'invalid difficulty' });
  }
  const state = lib.readState();
  state.difficulty = body.difficulty;
  lib.writeState(state);
  sendJson(res, 200, state);
}

async function handleGuess(req, res) {
  const t0 = Date.now();
  const since = () => `${Date.now() - t0}ms`;

  const body = await readBody(req);
  const text = (body.text || '').trim();
  if (!text) return sendJson(res, 400, { error: 'text is required' });
  console.log(`[guess] +0ms received: "${text}"`);

  const session = lib.readSession();
  if (!session) return sendJson(res, 409, { error: 'no active session — call /game first' });

  if (isGiveUp(text)) {
    return finishGame(res, session, false);
  }

  // Start the judge and opponent calls at the same time rather than sequentially — the
  // opponent's reply doesn't actually depend on the judge's verdict, only on whether we end
  // up USING it. If the judge flags the guess, we skip straight to responding once it settles,
  // without waiting on the opponent call at all — a speculative call that's simply discarded,
  // not a wasted wait. The opponent is sent only the new guess text (not the full transcript)
  // since it's a persistent process that already remembers its own earlier replies natively.
  console.log(`[guess] +${since()} starting judge + opponent in parallel`);
  const procs = ensureSessionProcs(session);
  const judgePromise = procs.judge.send(judgePrompt(session.bannedWords, text));
  const opponentPromise = procs.opponent.send(text);
  opponentPromise.catch(() => {}); // avoid an unhandled rejection if we end up not needing it

  let judged;
  try {
    judged = await judgePromise;
  } catch (err) {
    console.log(`[guess] +${since()} judge call failed: ${err.message}`);
    return sendJson(res, 502, { error: `judge call failed: ${err.message}` });
  }
  console.log(`[guess] +${since()} judge settled`);

  const verdict = judged.structured;
  if (!verdict || !Array.isArray(verdict.mispelledWordsThatAreInBannedWordsList)) {
    return sendJson(res, 502, { error: 'judge did not return valid structured output' });
  }

  // Same rule as the original site: flagged whenever the array is non-empty, not a separate
  // boolean field.
  if (verdict.mispelledWordsThatAreInBannedWordsList.length > 0) {
    console.log(`[guess] +${since()} flagged — responding without waiting on opponent`);
    return sendJson(res, 200, {
      flagged: true,
      reason: verdict.reason,
      matchedWords: verdict.mispelledWordsThatAreInBannedWordsList,
    });
  }

  const scored = await lib.fetchCountTokens(text);
  console.log(`[guess] +${since()} count-tokens settled`);
  const tokens = typeof scored.input_tokens === 'number' ? scored.input_tokens : 0;
  const scoringNote = scored.error ? 'scoring temporarily unavailable for that guess' : null;

  session.transcript.push({ role: 'guess', text });
  session.tokenTotal += tokens;
  session.guessCount += 1;
  lib.writeSession(session);

  let replied;
  try {
    replied = await opponentPromise;
  } catch (err) {
    console.log(`[guess] +${since()} opponent call failed: ${err.message}`);
    return sendJson(res, 502, { error: `opponent call failed: ${err.message}` });
  }
  console.log(`[guess] +${since()} opponent settled`);

  const replyText = (replied.text || '').trim();
  session.transcript.push({ role: 'reply', text: replyText });
  lib.writeSession(session);

  const won = replyText.toLowerCase().includes(session.phrase.toLowerCase());
  console.log(`[guess] +${since()} responding (won=${won})`);

  if (won) {
    return finishGame(res, session, true, { flagged: false, replyText, scoringNote });
  }

  sendJson(res, 200, {
    flagged: false,
    replyText,
    won: false,
    guessCount: session.guessCount,
    tokenTotal: session.tokenTotal,
    scoringNote,
  });
}

function finishGame(res, session, won, extra) {
  teardownSessionProcs();
  const state = lib.readState();
  lib.recordResult(state, session.difficulty, session.puzzleNumber, won, session.guessCount, session.tokenTotal);
  lib.writeState(state);
  lib.clearSession();

  const shareEntry = {
    puzzleNumber: session.puzzleNumber,
    difficulty: session.difficulty,
    won,
    guesses: session.guessCount,
    tokens: session.tokenTotal,
    streak: state.streak,
  };

  sendJson(res, 200, {
    flagged: false,
    replyText: (extra && extra.replyText) || null,
    won,
    guessCount: session.guessCount,
    tokenTotal: session.tokenTotal,
    scoringNote: (extra && extra.scoringNote) || null,
    share: lib.shareText(shareEntry),
    streak: state.streak,
  });
}

// ---- server setup ----

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const query = url.searchParams;

  const route = `${req.method} ${url.pathname}`;
  const handlers = {
    'GET /': async () => {
      const html = fs.readFileSync(PUBLIC_HTML, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
    },
    'GET /state': () => handleState(req, res),
    'GET /game': () => handleGame(req, res, query),
    'POST /difficulty': () => handleDifficulty(req, res),
    'POST /guess': () => handleGuess(req, res),
    'POST /heartbeat': () => handleHeartbeat(req, res),
  };

  const handler = handlers[route];
  if (!handler) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  Promise.resolve(handler()).catch((err) => {
    sendJson(res, 500, { error: String(err) });
  });
});

fs.mkdirSync(STATE_DIR, { recursive: true });
server.listen(DEFAULT_PORT, () => {
  fs.writeFileSync(PID_FILE, String(process.pid));
  fs.writeFileSync(PORT_FILE, String(DEFAULT_PORT));
  console.log(`llamadle bridge server listening on :${DEFAULT_PORT} (pid ${process.pid})`);
});

setInterval(() => {
  if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT_MS) shutdown('no heartbeat');
}, HEARTBEAT_CHECK_INTERVAL_MS);

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
