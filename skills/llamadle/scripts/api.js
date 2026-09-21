#!/usr/bin/env node
// Thin CLI over lib.js, for manual inspection/debugging only — engine.js calls these
// functions directly and does not shell out to this script.
const lib = require('./lib');

const [, , cmd, ...args] = process.argv;

function out(obj) {
  console.log(JSON.stringify(obj));
}

async function main() {
  if (cmd === 'daily') {
    const [difficulty] = args;
    const result = await lib.fetchDaily(difficulty || '');
    out(result);
    if (result.error) process.exitCode = 1;
    return;
  }

  if (cmd === 'count-tokens') {
    const text = lib.readStdin();
    const result = await lib.fetchCountTokens(text);
    out(result);
    if (result.error) process.exitCode = 1;
    return;
  }

  out({ error: `unknown command "${cmd}"` });
  process.exitCode = 1;
}

main();
