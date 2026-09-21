#!/usr/bin/env node
// Thin CLI over lib.js, for manual inspection/debugging only — engine.js calls these
// functions directly and does not shell out to this script.
const lib = require('./lib');

const [, , cmd, ...args] = process.argv;

function out(obj) {
  console.log(JSON.stringify(obj));
}

function fail(msg) {
  out({ error: msg });
  process.exit(1);
}

switch (cmd) {
  case 'get':
    out(lib.readState());
    break;

  case 'set-difficulty': {
    const [difficulty] = args;
    if (!['easy', 'medium', 'hard'].includes(difficulty)) fail(`invalid difficulty "${difficulty}"`);
    const state = lib.readState();
    state.difficulty = difficulty;
    lib.writeState(state);
    out(state);
    break;
  }

  case 'already-completed': {
    const [difficulty, puzzleNumberStr] = args;
    out({ alreadyCompleted: lib.alreadyCompleted(lib.readState(), difficulty, Number(puzzleNumberStr)) });
    break;
  }

  case 'find-result': {
    const [difficulty, puzzleNumberStr] = args;
    out(lib.findResult(lib.readState(), difficulty, Number(puzzleNumberStr)));
    break;
  }

  case 'record-result': {
    const [difficulty, puzzleNumberStr, wonStr, guessesStr, tokensStr] = args;
    const state = lib.readState();
    lib.recordResult(state, difficulty, Number(puzzleNumberStr), wonStr === 'true', Number(guessesStr), Number(tokensStr));
    lib.writeState(state);
    out(state);
    break;
  }

  case 'set-notifications': {
    const [onOff, routineId] = args;
    const state = lib.readState();
    state.notificationsEnabled = onOff === 'on';
    state.notificationRoutineId = onOff === 'on' ? routineId || null : null;
    lib.writeState(state);
    out(state);
    break;
  }

  default:
    fail(`unknown command "${cmd}"`);
}
