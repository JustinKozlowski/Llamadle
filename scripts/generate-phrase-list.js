#!/usr/bin/env node
// Generates a large deduped pool of charades phrases (plain text, one per line) for a given
// difficulty tier, for human review before running generate-banned-words.js on it. Loops over
// a fixed set of topic categories and asks the `claude` CLI for a batch per category — spreading
// across categories keeps cross-call duplicates rare without needing to feed a growing exclusion
// list back into every prompt.
//
// Usage:
//   node scripts/generate-phrase-list.js --difficulty easy --count 1000 --out easy-phrases.txt
//
// --difficulty: easy|medium|hard
// --count: target unique phrase count (default 1000) — script keeps looping categories
//   (allowing repeats with different exclusion reminders) until it hits this count or gives up
//   after too many empty passes.
// --out: output text file (plain phrases, one per line)
// --exclude-from: extra JSON phrase files (server/phrases/*.json shape) or text files whose
//   phrases should never be regenerated (repeatable)

const fs = require('fs');
const { execFileSync } = require('child_process');

const MODEL = 'claude-haiku-4-5';
const PER_CALL = 40;

const CATEGORIES = [
  'animals', 'everyday household objects', 'foods and drinks', 'simple mimeable actions/verbs',
  'emotions and facial expressions', 'sports and games', 'occupations and jobs',
  'weather and nature', 'vehicles and transportation', 'body parts and actions',
  'school and classroom', 'music and instruments', 'colors and shapes',
  'holidays and celebrations', 'clothing and accessories', 'well-known movies',
  'well-known TV shows', 'fairy tales and nursery rhymes', 'cartoon and superhero characters',
  'famous landmarks and places', 'famous historical people and scientists', 'idioms and proverbs',
  'kitchen and cooking', 'outdoor activities and hobbies', 'technology and gadgets',
  'dance and movement', 'insects and bugs', 'ocean and sea life', 'space and astronomy',
  'board games and video games', 'musicians and athletes', 'birthday and party things',
  'farm life', 'jungle and zoo animals', 'winter activities', 'summer activities',
];

// Difficulty is about how WELL-KNOWN / mainstream the phrase is, not how long it is. Every
// tier must be a REAL, existing word/name/title/idiom that a person would actually recognize —
// never an invented descriptive combo (e.g. "Cyclops' Uncontrollable Optic Blast Beam" is not
// a real, sayable phrase; "Cyclops" or "Optic Blast" would be). Length is incidental.
const DIFFICULTY_GUIDANCE = {
  easy: 'Pick phrases that are UNIVERSALLY known — something almost anyone, including a child, would recognize instantly with zero context (e.g. "Cat", "Pizza", "Ice cream", "Rainbow"). Maximum mainstream fame, minimum obscurity.',
  medium: 'Pick phrases that are WELL KNOWN but require a little more specific knowledge than the easy tier — a genuinely famous idiom, a widely recognized named person/place/character, or a common phrase most adults would know, but not the single most obvious example of its category (e.g. "Out of left field", "Paris", "Practice makes perfect", "Wolverine").',
  hard: 'Pick phrases that are NICHE or more obscure but still 100% real and recognizable to people familiar with the topic — a real idiom/proverb that is less commonly used, a specific named person/place/title that is famous within a domain but not a household name, or a real specific detail of something famous (e.g. "Don\'t look a gift horse in the mouth", "Hypatia of Alexandria", "The Green Mile"). Every phrase must be something a real person would actually say or a real title/name that exists — never a made-up descriptive string stitching several nouns together.',
};

const SCHEMA = {
  type: 'object',
  properties: { phrases: { type: 'array', items: { type: 'string' } } },
  required: ['phrases'],
  additionalProperties: false,
};

function parseArgs(argv) {
  const args = { count: 1000, excludeFrom: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--difficulty') args.difficulty = argv[++i];
    else if (a === '--count') args.count = parseInt(argv[++i], 10);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--exclude-from') args.excludeFrom.push(argv[++i]);
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!args.difficulty || !DIFFICULTY_GUIDANCE[args.difficulty]) {
    throw new Error('--difficulty <easy|medium|hard> is required');
  }
  if (!args.out) throw new Error('--out <file> is required');
  return args;
}

function loadExclusions(files) {
  const set = new Set();
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    if (f.endsWith('.json')) {
      const arr = JSON.parse(text);
      for (const e of arr) set.add(e.phrase.toLowerCase());
    } else {
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (t) set.add(t.toLowerCase());
      }
    }
  }
  return set;
}

function callClaude(category, difficulty, exclude) {
  const systemPrompt = [
    `You generate charades game phrases for a "${difficulty}" difficulty tier.`,
    DIFFICULTY_GUIDANCE[difficulty],
    'Every phrase MUST be a real, existing word/name/title/idiom that someone would actually',
    'say or recognize as-is. Never invent a descriptive phrase by stitching nouns/adjectives',
    'together (e.g. "Cyclops\' Uncontrollable Optic Blast Beam" or "Robotics Automation',
    'Manufacturing Plant" are NOT valid — they are made up, not real phrases). If you would not',
    'find the exact phrase used verbatim in real speech, a dictionary, or a title, don\'t use it.',
    `Topic category for this batch: ${category}.`,
    `Generate ${PER_CALL} DISTINCT phrases in this category. No duplicates within your list.`,
    exclude.length
      ? `Do not repeat any of these already-used phrases: ${JSON.stringify(exclude.slice(0, 200))}`
      : '',
    'Return plain phrases only, no numbering, no explanations, proper title case.',
  ].filter(Boolean).join('\n');

  const args = [
    '--print', '--output-format', 'json', '--model', MODEL,
    '--system-prompt', systemPrompt,
    '--json-schema', JSON.stringify(SCHEMA),
    `Generate the ${PER_CALL} phrases now.`,
  ];
  const stdout = execFileSync('claude', args, {
    encoding: 'utf8', maxBuffer: 1024 * 1024 * 10,
    env: { ...process.env, MAX_THINKING_TOKENS: '0' },
  });
  const result = JSON.parse(stdout);
  if (result.is_error) throw new Error(`claude CLI error: ${JSON.stringify(result).slice(0, 500)}`);
  const structured = result.structured_output;
  if (!structured || !Array.isArray(structured.phrases)) {
    throw new Error(`Unexpected output shape: ${JSON.stringify(result).slice(0, 500)}`);
  }
  return structured.phrases;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const exclusionSet = loadExclusions(args.excludeFrom);
  const seen = new Set(exclusionSet);
  const collected = [];

  let pass = 0;
  let emptyPasses = 0;
  while (collected.length < args.count && emptyPasses < CATEGORIES.length) {
    const category = CATEGORIES[pass % CATEGORIES.length];
    pass++;
    console.log(
      `[${collected.length}/${args.count}] pass ${pass} — category "${category}"...`
    );
    // Remind the model of a sample of what's already used in THIS category's neighborhood
    // (last 40 accepted phrases) rather than the whole growing list, to keep prompts small.
    const recentSample = collected.slice(-40);
    let phrases;
    try {
      phrases = callClaude(category, args.difficulty, recentSample);
    } catch (err) {
      console.log(`  call failed, skipping: ${err.message.slice(0, 200)}`);
      emptyPasses++;
      continue;
    }
    let added = 0;
    for (const raw of phrases) {
      const p = raw.trim();
      if (!p) continue;
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(p);
      added++;
      if (collected.length >= args.count) break;
    }
    console.log(`  +${added} new (total ${collected.length})`);
    emptyPasses = added === 0 ? emptyPasses + 1 : 0;
  }

  fs.writeFileSync(args.out, collected.join('\n') + '\n');
  console.log(`Wrote ${collected.length} phrases to ${args.out}`);
}

main();
