#!/usr/bin/env node
// Thin CLI over lib.js, for manual inspection/debugging only — engine.js calls
// lib.parseJudgeOutput directly and does not shell out to this script.
const lib = require('./lib');

console.log(JSON.stringify(lib.parseJudgeOutput(lib.readStdin())));
