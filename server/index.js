const express = require('express');
const { rateLimit } = require('express-rate-limit');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const COUNT_TOKENS_MODEL = process.env.LLAMADLE_MODEL || 'claude-haiku-4-5';

const POOLS = {
  easy: require('./phrases/easy.json'),
  medium: require('./phrases/medium.json'),
  hard: require('./phrases/hard.json'),
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSinceEpoch(date) {
  return Math.floor(date.getTime() / MS_PER_DAY);
}

const app = express();
app.use(express.json());

// Abuse protection only — neither route can generate a bill, so this exists purely to stop
// someone from hammering the shared Anthropic RPM quota or scraping /daily.
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
  const pool = POOLS[difficulty];
  if (!pool) {
    return res.status(400).json({ error: `unknown difficulty "${difficulty}"` });
  }

  const dayCount = daysSinceEpoch(new Date());
  const entry = pool[dayCount % pool.length];

  // puzzleNumber increases forever (like Wordle's puzzle #), independent of pool wraparound.
  res.json({
    puzzleNumber: dayCount,
    difficulty,
    phrase: entry.phrase,
    bannedWords: entry.bannedWords,
  });
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
