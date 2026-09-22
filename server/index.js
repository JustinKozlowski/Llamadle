const express = require('express');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const COUNT_TOKENS_MODEL = process.env.LLAMADLE_MODEL || 'claude-haiku-4-5';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// gemini-2.5-flash-lite (the original choice — cheapest tier at the time) returns a 404 for
// new API keys ("no longer available to new users"); Google's own error names this as the
// replacement.
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5';
// Which provider /guess's judge+opponent+scoring calls use — 'gemini' (default) or
// 'anthropic'. Lets you flip providers (e.g. when one is having capacity issues, or to A/B
// quality/cost) without a code change.
const LLM_PROVIDER = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
const SESSION_SECRET = process.env.SESSION_SECRET;

// The main cost-abuse defense for /guess — kept tight (rather than the token-spend cap
// considered and dropped in favor of this) since it directly bounds worst-case cost per
// identity per day regardless of how chatty any individual guess is.
const MAX_GUESSES_PER_DAY = 12;

const POOLS = {
  easy: require('./phrases/easy.json'),
  medium: require('./phrases/medium.json'),
  hard: require('./phrases/hard.json'),
};

// Endless mode's own pool — disjoint from POOLS above, so unlimited replay never previews or
// spoils a phrase that might come up as a future daily puzzle.
const ENDLESS_POOLS = {
  easy: require('./phrases/endless/easy.json'),
  medium: require('./phrases/endless/medium.json'),
  hard: require('./phrases/endless/hard.json'),
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSinceEpoch(date) {
  return Math.floor(date.getTime() / MS_PER_DAY);
}

// Shared by /daily and /game below. (No longer called by any Claude Code skill — the `daily`
// skill just opens the browser now, and `endless` has its own separate /endless pool — this
// stays as the public daily-puzzle endpoint the deployed frontend's /game route also uses.)
function getDailyPuzzle(difficulty) {
  const pool = POOLS[difficulty];
  if (!pool) return null;
  const puzzleNumber = daysSinceEpoch(new Date());
  const entry = pool[puzzleNumber % pool.length];
  return { puzzleNumber, phrase: entry.phrase, bannedWords: entry.bannedWords };
}

const SHARE_BAR_SEGMENTS = 5;
const SHARE_BAR_TOKENS_PER_SEGMENT = 10; // how "chatty" a guess has to be to fill one more block

// One row per guess: 💬 + a bar sized to that guess's own token count. Llamadle's actual
// scoring metric is token efficiency, not letter-matching, so the bar shows that instead of a
// Wordle-style correctness grid — 🏆 marks the winning guess. No reply text/content shown, so
// this never spoils the phrase or reveals anything about the other guesses.
function shareGrid(transcript, won) {
  const rows = [];
  for (let i = 0; i < transcript.length; i += 2) {
    const filled = Math.min(
      SHARE_BAR_SEGMENTS,
      Math.max(1, Math.ceil((transcript[i].tokens || 0) / SHARE_BAR_TOKENS_PER_SEGMENT))
    );
    const bar = '🟦'.repeat(filled) + '⬜'.repeat(SHARE_BAR_SEGMENTS - filled);
    const isLastPair = i + 2 >= transcript.length;
    // Trophy replaces the leading emoji rather than appending after the bar, so every row
    // stays the same width instead of the winning row running long.
    rows.push(`${isLastPair && won ? '🏆' : '💬'} ${bar}`);
  }
  return rows.join('\n');
}

function shareText({ puzzleNumber, difficulty, won, guessCount, tokenTotal, transcript }) {
  const headline = won
    ? `🦙 Solved in ${guessCount} guesses, ${tokenTotal} tokens`
    : `🏳️ Gave up after ${guessCount} guesses, ${tokenTotal} tokens`;
  const grid = transcript && transcript.length ? `\n\n${shareGrid(transcript, won)}` : '';
  return `Llamadle #${puzzleNumber} — ${difficulty}\n${headline}${grid}`;
}

// ---- session-scoped game state ----
// In-memory only — resets on server restart. Accepted gap: no server-tracked spend ceiling
// either, per the low-credit API key being the deliberate backstop instead.
//
// sessionId -> { [difficulty]: { puzzleNumber, phrase, bannedWords, guessCount, tokenTotal,
//                                 transcript, won, lastCompletedPuzzleNumber } }
const sessions = new Map();

function getSessionGames(sessionId) {
  let games = sessions.get(sessionId);
  if (!games) {
    games = {};
    sessions.set(sessionId, games);
  }
  return games;
}

function lockGame(game, won) {
  game.won = won;
  game.lastCompletedPuzzleNumber = game.puzzleNumber;
}

// ---- LLM providers (judge + opponent + guess scoring) ----
//
// Both callGemini/callAnthropic return the same normalized {text, usage} shape, and
// countGeminiTokens/countAnthropicTokens both return a plain token count — /guess (below)
// only ever calls the provider-agnostic callLLM/countGuessTokens dispatchers, so the actual
// wire-format differences between providers (role naming, auth, structured-output nesting,
// response envelope) stay isolated in this section.

const OPPONENT_SYSTEM_PROMPT = 'Respond in 1 sentence';

// Originally verbatim from the client-side prompt (src/components/HelloWorld.vue's
// isInputHacky) before judge/opponent moved server-side — now extended to also catch emoji
// standing in for a banned word (e.g. 🍕 for "pizza").
const JUDGE_SYSTEM_PROMPT =
  "We are playing charades so we can't say certain words. \n" +
  'We are allowed to describe words and use synonyms though. \n' +
  'Is the given phrase attemping to spell the banned words? \n' +
  'Do not allow leet speek of the banned words. \n' +
  'Do not allow mispelling of the banned words. \n' +
  'Do not use emojis of banned words. \n' +
  'Return individual mispelled words if there is a concatenation of the banned words.\n';

// No `additionalProperties` here — Gemini's schema dialect rejects it outright ("Unknown name
// \"additionalProperties\"... Cannot find field", a 400, confirmed by actually reading the
// error body, not just the status code). Anthropic requires it instead; callAnthropic adds it
// on top only for that provider's request, rather than it living on the shared schema object.
const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    mispelledOrEmojiWordsThatAreInBannedWordsList: { type: 'array', items: { type: 'string' } },
    reason: { type: 'string' },
  },
  required: ['mispelledOrEmojiWordsThatAreInBannedWordsList', 'reason'],
};

function judgePrompt(bannedWords, guess) {
  return `Banned Words: ${JSON.stringify(bannedWords)}. Phrase: ${guess}`;
}

// Without an explicit timeout, a stalled connection (e.g. a network that silently drops
// packets instead of refusing the connection) hangs the whole request forever instead of
// erroring — this converts that into a clean, catchable failure.
const LLM_TIMEOUT_MS = 15000;

async function callGemini({ systemInstruction, contents, responseSchema, label }) {
  const tag = label ? `[gemini:${label}]` : '[gemini]';
  const body = { systemInstruction: { parts: [{ text: systemInstruction }] }, contents };
  if (responseSchema) {
    body.generationConfig = { responseMimeType: 'application/json', responseSchema };
  }
  const t0 = Date.now();
  console.log(`${tag} calling generateContent`);
  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      }
    );
  } catch (err) {
    console.log(`${tag} network error after ${Date.now() - t0}ms: ${err}`);
    throw new Error(`gemini network error: ${err}`);
  }
  if (!res.ok) {
    const detail = await res.text();
    console.log(`${tag} upstream error ${res.status} after ${Date.now() - t0}ms`);
    throw new Error(`gemini upstream error ${res.status}: ${detail}`);
  }
  const data = await res.json();
  console.log(`${tag} done in ${Date.now() - t0}ms`);
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text,
    usage: data.usageMetadata || {},
  };
}

// Scores a guess by its own token count, via Gemini's dedicated (free) countTokens endpoint,
// rather than inferring it from generateContent's growing-context usageMetadata — exact and
// context-independent, matching how the Claude Code skill's bridge-server.js scores guesses
// via Anthropic's own free count_tokens endpoint.
async function countGeminiTokens(text) {
  const tag = '[gemini:count-tokens]';
  const t0 = Date.now();
  console.log(`${tag} calling countTokens`);
  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:countTokens?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text }] }] }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      }
    );
  } catch (err) {
    console.log(`${tag} network error after ${Date.now() - t0}ms: ${err}`);
    throw new Error(`gemini network error: ${err}`);
  }
  if (!res.ok) {
    const detail = await res.text();
    console.log(`${tag} upstream error ${res.status} after ${Date.now() - t0}ms`);
    throw new Error(`gemini countTokens error ${res.status}: ${detail}`);
  }
  const data = await res.json();
  console.log(`${tag} done in ${Date.now() - t0}ms`);
  return data.totalTokens || 0;
}

async function callAnthropic({ systemInstruction, contents, responseSchema, label }) {
  const tag = label ? `[anthropic:${label}]` : '[anthropic]';
  // contents is in Gemini's shape ({role: 'user'|'model', parts: [{text}]}) since that's the
  // shape /guess builds once and passes to whichever provider callLLM dispatches to.
  const messages = contents.map((c) => ({
    role: c.role === 'model' ? 'assistant' : 'user',
    content: c.parts.map((p) => p.text).join(''),
  }));
  const body = { model: ANTHROPIC_MODEL, max_tokens: 1024, system: systemInstruction, messages };
  if (responseSchema) {
    // additionalProperties: false is required by Anthropic's structured outputs but rejected
    // by Gemini's — added here, on a copy, rather than on the shared JUDGE_SCHEMA object.
    body.output_config = { format: { type: 'json_schema', schema: { ...responseSchema, additionalProperties: false } } };
  }
  const t0 = Date.now();
  console.log(`${tag} calling messages`);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    console.log(`${tag} network error after ${Date.now() - t0}ms: ${err}`);
    throw new Error(`anthropic network error: ${err}`);
  }
  if (!res.ok) {
    const detail = await res.text();
    console.log(`${tag} upstream error ${res.status} after ${Date.now() - t0}ms`);
    throw new Error(`anthropic upstream error ${res.status}: ${detail}`);
  }
  const data = await res.json();
  console.log(`${tag} done in ${Date.now() - t0}ms`);
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  return { text: textBlock && textBlock.text, usage: data.usage || {} };
}

// Reuses the same free count_tokens endpoint /count-tokens below already calls for the skill.
async function countAnthropicTokens(text) {
  const tag = '[anthropic:count-tokens]';
  const t0 = Date.now();
  console.log(`${tag} calling count_tokens`);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, messages: [{ role: 'user', content: text }] }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
  } catch (err) {
    console.log(`${tag} network error after ${Date.now() - t0}ms: ${err}`);
    throw new Error(`anthropic network error: ${err}`);
  }
  if (!res.ok) {
    const detail = await res.text();
    console.log(`${tag} upstream error ${res.status} after ${Date.now() - t0}ms`);
    throw new Error(`anthropic count_tokens error ${res.status}: ${detail}`);
  }
  const data = await res.json();
  console.log(`${tag} done in ${Date.now() - t0}ms`);
  return data.input_tokens || 0;
}

function callLLM(args) {
  return LLM_PROVIDER === 'anthropic' ? callAnthropic(args) : callGemini(args);
}

function countGuessTokens(text) {
  return LLM_PROVIDER === 'anthropic' ? countAnthropicTokens(text) : countGeminiTokens(text);
}

function llmConfigured() {
  return LLM_PROVIDER === 'anthropic' ? Boolean(ANTHROPIC_API_KEY) : Boolean(GEMINI_API_KEY);
}

const app = express();
// Both nginx (production, see docker-compose.yml's network_mode: "service:llamadle") and the
// Vue dev-server proxy (local dev, vue.config.js) sit directly in front of this app over
// loopback and add X-Forwarded-For — trust exactly that one hop, not `true` (which would trust
// the header on a direct, unproxied connection too, letting anyone spoof their rate-limit key).
app.set('trust proxy', 'loopback');
app.use((req, res, next) => {
  console.log(`[req] ${req.method} ${req.originalUrl}`);
  next();
});
app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

// Identifies a player for daily-play gating and per-player limits — no login, just a random id
// in a signed, httpOnly cookie set on first visit.
app.use((req, res, next) => {
  let sid = req.signedCookies && req.signedCookies.sid;
  if (!sid) {
    sid = crypto.randomUUID();
    res.cookie('sid', sid, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 400 * MS_PER_DAY,
    });
  }
  req.sessionId = sid;
  next();
});

// Abuse protection — was "neither route can generate a bill" when this was written; /guess
// below now can, so this is a genuine cost defense too, not just RPM/scraping protection.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.get('/daily', (req, res) => {
  const difficulty = (req.query.difficulty || 'medium').toString();
  const puzzle = getDailyPuzzle(difficulty);
  if (!puzzle) {
    return res.status(400).json({ error: `unknown difficulty "${difficulty}"` });
  }
  res.json({ puzzleNumber: puzzle.puzzleNumber, difficulty, phrase: puzzle.phrase, bannedWords: puzzle.bannedWords });
});

// Unlimited-replay mode: a random pick from a separate pool, no puzzleNumber/day-rotation and
// no session/cookie involvement — this endpoint only ever serves phrase content. The actual
// guess loop for endless mode runs entirely through the local `claude` CLI (the
// `skills/endless/` plugin skill), never through this server's /guess.
app.get('/endless', (req, res) => {
  const difficulty = (req.query.difficulty || 'medium').toString();
  const pool = ENDLESS_POOLS[difficulty];
  if (!pool) {
    return res.status(400).json({ error: `unknown difficulty "${difficulty}"` });
  }
  const entry = pool[Math.floor(Math.random() * pool.length)];
  res.json({ difficulty, phrase: entry.phrase, bannedWords: entry.bannedWords });
});

app.get('/game', (req, res) => {
  const difficulty = (req.query.difficulty || 'medium').toString();
  const puzzle = getDailyPuzzle(difficulty);
  if (!puzzle) {
    return res.status(400).json({ error: `unknown difficulty "${difficulty}"` });
  }

  const games = getSessionGames(req.sessionId);
  let game = games[difficulty];

  if (game && game.puzzleNumber === puzzle.puzzleNumber && game.lastCompletedPuzzleNumber === puzzle.puzzleNumber) {
    return res.json({
      alreadyCompleted: true,
      puzzleNumber: puzzle.puzzleNumber,
      difficulty,
      phrase: game.phrase,
      won: game.won,
      guessCount: game.guessCount,
      tokenTotal: game.tokenTotal,
      transcript: game.transcript,
      share: shareText({ puzzleNumber: puzzle.puzzleNumber, difficulty, won: game.won, guessCount: game.guessCount, tokenTotal: game.tokenTotal, transcript: game.transcript }),
    });
  }

  if (!game || game.puzzleNumber !== puzzle.puzzleNumber) {
    game = {
      puzzleNumber: puzzle.puzzleNumber,
      phrase: puzzle.phrase,
      bannedWords: puzzle.bannedWords,
      guessCount: 0,
      tokenTotal: 0,
      transcript: [],
      won: null,
      lastCompletedPuzzleNumber: null,
    };
    games[difficulty] = game;
  }

  res.json({
    alreadyCompleted: false,
    puzzleNumber: game.puzzleNumber,
    difficulty,
    phrase: game.phrase,
    bannedWords: game.bannedWords,
    guessCount: game.guessCount,
    tokenTotal: game.tokenTotal,
    transcript: game.transcript,
  });
});

app.post('/guess', async (req, res) => {
  const difficulty = ((req.body && req.body.difficulty) || '').toString();
  const text = ((req.body && req.body.text) || '').toString().trim();
  if (!POOLS[difficulty]) {
    return res.status(400).json({ error: `unknown difficulty "${difficulty}"` });
  }
  if (!text) {
    return res.status(400).json({ error: '"text" is required' });
  }
  if (!llmConfigured()) {
    return res.status(500).json({ error: `server is not configured with an API key for LLM_PROVIDER=${LLM_PROVIDER}` });
  }

  const games = getSessionGames(req.sessionId);
  const game = games[difficulty];
  if (!game) {
    return res.status(409).json({ error: 'no active game for this difficulty — call /game first' });
  }

  const puzzle = getDailyPuzzle(difficulty);
  if (game.puzzleNumber !== puzzle.puzzleNumber) {
    return res.status(409).json({ error: 'stale game — call /game again to pick up today’s puzzle' });
  }
  if (game.lastCompletedPuzzleNumber === puzzle.puzzleNumber) {
    return res.status(403).json({ error: 'already completed today’s puzzle for this difficulty' });
  }
  if (game.guessCount >= MAX_GUESSES_PER_DAY) {
    lockGame(game, false);
    return res.status(429).json({
      error: 'guess limit reached for today — try again tomorrow',
      share: shareText({ puzzleNumber: game.puzzleNumber, difficulty, won: false, guessCount: game.guessCount, tokenTotal: game.tokenTotal, transcript: game.transcript }),
    });
  }

  // Judge, opponent, and the guess's own token count are all started together — none of them
  // depend on each other, only on whether we end up using them. If the judge flags the guess,
  // we respond as soon as it settles without waiting on the other two, which are simply
  // discarded (speculative calls, not a wasted wait).
  const candidateContents = [
    ...game.transcript.map((t) => ({ role: t.role === 'guess' ? 'user' : 'model', parts: [{ text: t.text }] })),
    { role: 'user', parts: [{ text }] },
  ];

  const judgePromise = callLLM({
    systemInstruction: JUDGE_SYSTEM_PROMPT,
    contents: [{ role: 'user', parts: [{ text: judgePrompt(game.bannedWords, text) }] }],
    responseSchema: JUDGE_SCHEMA,
    label: 'judge',
  });
  const opponentPromise = callLLM({ systemInstruction: OPPONENT_SYSTEM_PROMPT, contents: candidateContents, label: 'opponent' });
  const tokenCountPromise = countGuessTokens(text);
  opponentPromise.catch(() => {}); // avoid an unhandled rejection if it turns out not to be needed
  tokenCountPromise.catch(() => {});

  let judged;
  try {
    judged = await judgePromise;
  } catch (err) {
    return res.status(502).json({ error: `judge call failed: ${String(err)}` });
  }

  let verdict;
  try {
    verdict = JSON.parse(judged.text);
  } catch {
    return res.status(502).json({ error: 'judge did not return valid JSON' });
  }
  if (!verdict || !Array.isArray(verdict.mispelledOrEmojiWordsThatAreInBannedWordsList)) {
    return res.status(502).json({ error: 'judge did not return valid structured output' });
  }

  // Same rule as the original client code: flagged whenever the array is non-empty.
  if (verdict.mispelledOrEmojiWordsThatAreInBannedWordsList.length > 0) {
    return res.json({
      flagged: true,
      reason: verdict.reason,
      matchedWords: verdict.mispelledOrEmojiWordsThatAreInBannedWordsList,
    });
  }

  let opponent;
  try {
    opponent = await opponentPromise;
  } catch (err) {
    return res.status(502).json({ error: `opponent call failed: ${String(err)}` });
  }

  const replyText = (opponent.text || '').trim();

  // Score the guess by its own exact token count (via the provider's countTokens/count_tokens)
  // rather than inferring it from the generation call's growing-context usage. Fails soft — a
  // transient counting error shouldn't block the actual game mechanic. Kept on the transcript
  // entry itself (not just summed into tokenTotal) so shareGrid can size each row's bar below.
  let guessTokens = 0;
  try {
    guessTokens = await tokenCountPromise;
  } catch (err) {
    console.error(`countGuessTokens failed, scoring this guess as 0 tokens: ${err}`);
  }
  game.transcript.push({ role: 'guess', text, tokens: guessTokens });
  game.transcript.push({ role: 'reply', text: replyText });
  game.guessCount += 1;
  game.tokenTotal += guessTokens;

  const won = replyText.toLowerCase().includes(game.phrase.toLowerCase());
  if (won) {
    lockGame(game, true);
    return res.json({
      flagged: false,
      replyText,
      won: true,
      guessCount: game.guessCount,
      tokenTotal: game.tokenTotal,
      share: shareText({ puzzleNumber: game.puzzleNumber, difficulty, won: true, guessCount: game.guessCount, tokenTotal: game.tokenTotal, transcript: game.transcript }),
    });
  }

  res.json({ flagged: false, replyText, won: false, guessCount: game.guessCount, tokenTotal: game.tokenTotal });
});

app.post('/count-tokens', async (req, res) => {
  const text = req.body && req.body.text;
  if (typeof text !== 'string' || text.length === 0) {
    return res.status(400).json({ error: '"text" (non-empty string) is required' });
  }
  if (!ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'server is not configured with ANTHROPIC_API_KEY' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: COUNT_TOKENS_MODEL,
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      return res.status(502).json({ error: 'count_tokens upstream error', detail });
    }

    const { input_tokens } = await response.json();
    res.json({ input_tokens });
  } catch (err) {
    res.status(502).json({ error: 'failed to reach Anthropic', detail: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`llamadle-api listening on :${PORT}`);
});
