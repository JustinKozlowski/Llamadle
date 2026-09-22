const fs = require('fs');
const os = require('os');
const path = require('path');

const STATE_DIR = path.join(os.homedir(), '.claude', 'llamadle');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const SESSION_FILE = path.join(STATE_DIR, 'session.json');

// Endless mode has no daily gating, streak, or history — every round is an independent,
// unlimited replay against a random phrase, so the only thing worth persisting across
// invocations is the difficulty preference.
const DEFAULT_STATE = {
  difficulty: 'medium',
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

function shareText({ won, guesses, tokens }) {
  const headline = won
    ? `🦙 Solved in ${guesses} guesses, ${tokens} tokens`
    : `🏳️ Gave up after ${guesses} guesses, ${tokens} tokens`;
  return `Llamadle Endless\n${headline}`;
}

// ---- backend HTTP calls (the only network access in this plugin) ----

const BASE_URL = process.env.LLAMADLE_BASE_URL || 'https://www.justinkozlowski.me/llamadle';

// Endless mode's own pool, disjoint from the daily puzzle's — never overlaps with or spoils a
// phrase that might come up as a future daily puzzle. No puzzleNumber: each call returns a
// random pick, not a day-keyed one.
async function fetchPuzzle(difficulty) {
  try {
    const res = await fetch(`${BASE_URL}/endless?difficulty=${encodeURIComponent(difficulty)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) return { error: `endless request failed (${res.status})`, detail: body };
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
  shareText,
  fetchPuzzle,
  fetchCountTokens,
};
