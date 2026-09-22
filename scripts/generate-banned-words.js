#!/usr/bin/env node
// Batch-generates {phrase, bannedWords} entries (the schema used by server/phrases/*.json)
// from a plain list of phrases, via the `claude` CLI — same tool the server already shells
// out to for judge/opponent calls (see skills/endless/scripts/persistent-claude.js), so this
// needs no separate API key.
//
// Batched (not one-shot-per-phrase) because each `claude` CLI invocation pays several hundred
// ms to a few seconds of cold-start overhead; batching amortizes that across many phrases.
//
// Usage:
//   node scripts/generate-banned-words.js --input phrases.txt --out server/phrases/hard.json --difficulty hard
//   node scripts/generate-banned-words.js --input phrases.txt --out server/phrases/easy.json --difficulty easy --batch-size 20 --dry-run
//
// --input: a text file, one phrase per line (blank lines and lines starting with # are skipped)
// --out: target phrases JSON file (array of {phrase, bannedWords}) — merged in, not overwritten.
//   Existing entries are kept; a phrase already present (case-insensitive) is skipped, not
//   regenerated, so re-running is safe.
// --difficulty: easy|medium|hard — controls how many banned words are generated per entry
//   (easy ~= 1 word, medium ~= 2-4, hard ~= 4-8 plus associated terms for named entities),
//   matching the existing spread across server/phrases/{easy,medium,hard}.json.
// --batch-size: phrases per `claude` call (default 20)
// --dry-run: print generated entries instead of writing them to --out

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MODEL = 'claude-haiku-4-5';

// Difficulty controls how many banned words to generate per entry — more banned words makes
// a phrase harder to describe around. Ranges reflect the existing hand-authored data: easy.json
// entries ban ~1 word, hard.json entries ban ~3-4 (plus a couple of associated terms for named
// entities), medium sits between.
const DIFFICULTY_GUIDANCE = {
  easy: '- Easy phrases: ban ONLY the single most essential word (rarely two). Keep it minimal.',
  medium: '- Medium phrases: ban roughly 2-4 words: the core content words plus at most one synonym.',
  hard: '- Hard phrases: ban roughly 4-8 words: the core content words, 1-3 close synonyms, and, for named people/places/things, 1-2 well-known associated terms even if they don\'t appear in the phrase (e.g. "Albert Einstein" -> also ban "physicist", "relativity").',
};

function buildSystemPrompt(difficulty) {
  return [
    "You are authoring banned-word lists for a charades-style word-guessing game.",
    "For each phrase, list the words a describer must not say while describing it.",
    "",
    "Include:",
    "- every content word (noun, verb, adjective, adverb) that appears in the phrase itself,",
    "  in lowercase base/singular form (don't invent forms that aren't in the phrase)",
    "- if the phrase is a multi-word proper noun or compound, also ban its individual words",
    DIFFICULTY_GUIDANCE[difficulty],
    "",
    "Exclude:",
    "- articles, prepositions, pronouns, conjunctions, and forms of \"to be\" (a, the, of, is, are, ...)",
    "- duplicate words (dedupe within each entry)",
    "",
    "Keep every banned word lowercase, punctuation-free, and as a single word (no phrases).",
    "Return one entry per input phrase, preserving the original phrase text exactly.",
  ].join('\n');
}

const SCHEMA = {
  type: 'object',
  properties: {
    entries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          phrase: { type: 'string' },
          bannedWords: { type: 'array', items: { type: 'string' } },
        },
        required: ['phrase', 'bannedWords'],
        additionalProperties: false,
      },
    },
  },
  required: ['entries'],
  additionalProperties: false,
};

function parseArgs(argv) {
  const args = { batchSize: 20, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--batch-size') args.batchSize = parseInt(argv[++i], 10);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--difficulty') args.difficulty = argv[++i];
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!args.input) throw new Error('--input <file> is required');
  if (!args.out) throw new Error('--out <file> is required');
  if (!args.difficulty || !DIFFICULTY_GUIDANCE[args.difficulty]) {
    throw new Error('--difficulty <easy|medium|hard> is required');
  }
  return args;
}

function readPhrases(inputPath) {
  return fs
    .readFileSync(inputPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function callClaude(phrases, difficulty) {
  const prompt = `Phrases:\n${JSON.stringify(phrases, null, 2)}`;
  const args = [
    '--print',
    '--output-format', 'json',
    '--model', MODEL,
    '--system-prompt', buildSystemPrompt(difficulty),
    '--json-schema', JSON.stringify(SCHEMA),
    prompt,
  ];
  const stdout = execFileSync('claude', args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
    env: { ...process.env, MAX_THINKING_TOKENS: '0' },
  });
  const result = JSON.parse(stdout);
  if (result.is_error) {
    throw new Error(`claude CLI reported an error: ${JSON.stringify(result).slice(0, 500)}`);
  }
  const structured = result.structured_output;
  if (!structured || !Array.isArray(structured.entries)) {
    throw new Error(`Unexpected claude CLI output shape: ${JSON.stringify(result).slice(0, 500)}`);
  }
  return structured.entries;
}

function loadExisting(outPath) {
  if (!fs.existsSync(outPath)) return [];
  return JSON.parse(fs.readFileSync(outPath, 'utf8'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const phrases = readPhrases(args.input);
  if (phrases.length === 0) {
    console.log('No phrases found in input file.');
    return;
  }

  const existing = loadExisting(args.out);
  const existingPhrasesLower = new Set(existing.map((e) => e.phrase.toLowerCase()));
  const toGenerate = phrases.filter((p) => !existingPhrasesLower.has(p.toLowerCase()));
  const skipped = phrases.length - toGenerate.length;
  if (skipped > 0) console.log(`Skipping ${skipped} phrase(s) already present in ${args.out}`);
  if (toGenerate.length === 0) {
    console.log('Nothing new to generate.');
    return;
  }

  const batches = chunk(toGenerate, args.batchSize);
  const newEntries = [];
  batches.forEach((batch, i) => {
    console.log(`Batch ${i + 1}/${batches.length} (${batch.length} phrases)...`);
    const entries = callClaude(batch, args.difficulty);
    newEntries.push(...entries);
  });

  if (args.dryRun) {
    console.log(JSON.stringify(newEntries, null, 2));
    return;
  }

  const merged = [...existing, ...newEntries];
  fs.writeFileSync(args.out, JSON.stringify(merged, null, 2) + '\n');
  console.log(`Wrote ${newEntries.length} new entries to ${args.out} (${merged.length} total).`);
}

main();
