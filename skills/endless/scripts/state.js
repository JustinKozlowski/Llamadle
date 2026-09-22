#!/usr/bin/env node
// Thin CLI over lib.js, for manual inspection/debugging only — bridge-server.js calls these
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

  default:
    fail(`unknown command "${cmd}"`);
}
