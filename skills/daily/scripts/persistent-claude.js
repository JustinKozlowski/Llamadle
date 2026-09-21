// A long-running `claude --print --input-format stream-json --output-format stream-json`
// process, kept alive across turns instead of spawning a fresh `claude` CLI process per call.
//
// Why: each `claude` CLI invocation pays several hundred ms to several seconds of process
// startup overhead (auth/keychain checks, plugin sync, etc. — see `claude --bare`'s
// description) on top of the actual API call. Measured in this environment: ~2.5s overhead
// on a cold process, ~0-10ms on turn 2+ of a process kept alive. Judge and opponent calls
// happen multiple times per game, so this overhead was being paid on every single guess.
//
// Note this hidden CLI overhead is unrelated to a separate, unavoidable one: every call
// through this account's `claude` CLI also carries this org's admin-managed policy
// instructions regardless of --system-prompt/--safe-mode (confirmed via `claude --help`:
// "Admin-managed (policy) settings still apply"). That's present identically whether the
// process is persistent or one-shot, so switching to a persistent process doesn't change it
// either way — it's just a fixed, cached-after-first-hit cost of using this CLI at all.
//
// The CLI also forces extended thinking on regardless of flags — there's no --no-thinking or
// --max-thinking-tokens flag. MAX_THINKING_TOKENS=0 (an env var, undocumented in `claude
// --help`) forces it off: confirmed via `usage.output_tokens_details.thinking_tokens` dropping
// to 0 on both judge and opponent prompts, with no change to judge correctness on an
// adversarial (leetspeak) guess, and duration_ms dropping accordingly.
const { spawn } = require('child_process');

const MODEL = 'claude-haiku-4-5';

function createPersistentClaude({ systemPrompt, jsonSchema, label, model = MODEL }) {
  const tag = label ? `[persistent:${label}]` : '[persistent]';
  const args = [
    '--safe-mode',
    '--print',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--tools', '',
    '--model', model,
    '--no-session-persistence',
    '--system-prompt', systemPrompt,
  ];
  if (jsonSchema) args.push('--json-schema', JSON.stringify(jsonSchema));

  console.log(`${tag} spawning: claude ${args.join(' ')}`);
  const proc = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, MAX_THINKING_TOKENS: '0' },
  });

  const queue = []; // FIFO of {resolve, reject, startedAt} — one entry per in-flight turn
  let stdoutBuf = '';
  let stderrBuf = '';
  let dead = false;
  let deadError = null;

  proc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line.trim()) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue; // not a result line (e.g. a system/init event) — ignore
      }
      if (obj.type !== 'result') continue;

      const pending = queue.shift();
      if (!pending) continue;
      const wallMs = Date.now() - pending.startedAt;

      if (obj.is_error) {
        console.log(`${tag} turn error after ${wallMs}ms: ${JSON.stringify(obj).slice(0, 300)}`);
        pending.reject(new Error(`claude CLI reported an error: ${JSON.stringify(obj).slice(0, 500)}`));
        continue;
      }

      console.log(
        `${tag} turn done: wall=${wallMs}ms cli_duration_ms=${obj.duration_ms} cost=$${obj.total_cost_usd}`
      );
      pending.resolve({
        text: typeof obj.result === 'string' ? obj.result : null,
        structured: obj.structured_output ?? null,
        usage: obj.usage ?? null,
        costUsd: obj.total_cost_usd ?? null,
        durationMs: obj.duration_ms ?? null,
        wallMs,
      });
    }
  });

  proc.stderr.on('data', (d) => {
    stderrBuf += d.toString();
  });

  proc.on('exit', (code) => {
    dead = true;
    deadError = new Error(`claude CLI process exited (code ${code}): ${stderrBuf.slice(-500)}`);
    console.log(`${tag} exited (code ${code})${stderrBuf ? `: ${stderrBuf.slice(-300)}` : ''}`);
    while (queue.length) queue.shift().reject(deadError);
  });

  function send(text) {
    if (dead) return Promise.reject(deadError || new Error(`${tag} process is dead`));
    return new Promise((resolve, reject) => {
      queue.push({ resolve, reject, startedAt: Date.now() });
      proc.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
    });
  }

  function kill() {
    if (dead) return;
    try { proc.stdin.end(); } catch {}
    try { proc.kill(); } catch {}
  }

  return {
    send,
    kill,
    get isDead() { return dead; },
  };
}

module.exports = { createPersistentClaude, MODEL };
