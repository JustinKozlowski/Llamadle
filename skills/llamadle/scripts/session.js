#!/usr/bin/env node
// Debug helpers only. The active game's control flow (starting it, the guess loop, judge
// retry, win handling) is owned entirely by engine.js — this script just lets you peek at or
// discard the session file by hand.
const lib = require('./lib');

const [, , cmd] = process.argv;

function out(obj) {
  console.log(JSON.stringify(obj));
}

switch (cmd) {
  case 'status': {
    const session = lib.readSession();
    out(session ? { active: true, ...session } : { active: false });
    break;
  }
  case 'end':
    lib.clearSession();
    out({ ended: true });
    break;
  default:
    out({ error: `unknown command "${cmd}" (only "status" and "end" are supported)` });
    process.exit(1);
}
