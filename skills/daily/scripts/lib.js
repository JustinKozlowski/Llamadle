const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(os.homedir(), '.claude', 'llamadle');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const SESSION_FILE = path.join(STATE_DIR, 'session.json');

const DEFAULT_STATE = {
  notificationsEnabled: false,
  notificationRoutineId: null,
  difficulty: 'medium',
  streak: 0,
  lastCompletedPuzzleNumber: { easy: null, medium: null, hard: null },
  history: [],
};

function ensureDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

function readState() {
  ensureDir();
  if (!fs.existsSync(STATE_FILE)) return JSON.parse(JSON.stringify(DEFAULT_STATE));
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { ...JSON.parse(JSON.stringify(DEFAULT_STATE)), ...parsed };
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}

function writeState(state) {
  ensureDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function readSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeSession(session) {
  ensureDir();
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

function clearSession() {
  if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---- pure state-mutation helpers (operate on an already-loaded state object) ----

function alreadyCompleted(state, difficulty, puzzleNumber) {
  return state.lastCompletedPuzzleNumber[difficulty] === puzzleNumber;
}

function findResult(state, difficulty, puzzleNumber) {
  const entry = state.history.find(
    (h) => h.difficulty === difficulty && h.puzzleNumber === puzzleNumber
  );
  return entry ? { found: true, ...entry, streak: state.streak } : { found: false };
}

function recordResult(state, difficulty, puzzleNumber, won, guesses, tokens) {
  const prevCompleted = state.lastCompletedPuzzleNumber[difficulty];
  state.lastCompletedPuzzleNumber[difficulty] = puzzleNumber;
  state.streak = won ? (prevCompleted === puzzleNumber - 1 ? state.streak + 1 : 1) : 0;
  state.history.push({ date: todayISO(), puzzleNumber, difficulty, won, guesses, tokens });
  return state;
}

function shareText({ puzzleNumber, difficulty, won, guesses, tokens, streak }) {
  const headline = won
    ? `🦙 Solved in ${guesses} guesses, ${tokens} tokens`
    : `🏳️ Gave up after ${guesses} guesses, ${tokens} tokens`;
  return `Llamadle #${puzzleNumber} — ${difficulty}\n${headline}\nStreak: ${streak}`;
}

// ---- backend HTTP calls (the only network access in this plugin) ----

const BASE_URL = process.env.LLAMADLE_BASE_URL || 'https://www.justinkozlowski.me/llamadle';

async function fetchDaily(difficulty) {
  try {
    const res = await fetch(`${BASE_URL}/daily?difficulty=${encodeURIComponent(difficulty)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) return { error: `daily request failed (${res.status})`, detail: body };
    return body;
  } catch (err) {
    return { error: 'failed to reach puzzle server', detail: String(err) };
  }
}

async function fetchCountTokens(text) {
  try {
    const res = await fetch(`${BASE_URL}/count-tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      return { error: `count-tokens request failed (${res.status})`, detail: body };
    }
    return body;
  } catch (err) {
    return { error: 'failed to reach puzzle server', detail: String(err) };
  }
}

// ---- judge output parsing ----

function parseJudgeOutput(raw) {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      if (
        typeof parsed.flagged === 'boolean' &&
        Array.isArray(parsed.matchedWords) &&
        typeof parsed.reason === 'string'
      ) {
        return parsed;
      }
    } catch {
      // fall through
    }
  }
  return { parseError: true };
}

module.exports = {
  STATE_FILE,
  SESSION_FILE,
  BASE_URL,
  readState,
  writeState,
  readSession,
  writeSession,
  clearSession,
  readStdin,
  todayISO,
  alreadyCompleted,
  findResult,
  recordResult,
  shareText,
  fetchDaily,
  fetchCountTokens,
  parseJudgeOutput,
};
