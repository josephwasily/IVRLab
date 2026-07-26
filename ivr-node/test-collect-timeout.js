/**
 * Regression tests for collectDigits timeout semantics.
 *
 * The digit timeout must not run while a collect prompt is still playing:
 * it arms when playback ends (or immediately when there is no prompt), and
 * every received digit re-arms it. A safety cap (COLLECT_PLAYBACK_SAFETY_MS,
 * default 60s) guards against a lost PlaybackFinished event.
 *
 * Run inside the ivr-node image (needs its node_modules):
 *   docker run --rm --entrypoint node -e COLLECT_PLAYBACK_SAFETY_MS=1500 \
 *     <ivr-node-image> /app/test-collect-timeout.js
 * (copy this file + dynamic-ivr.js into /app first, or use a bind/docker cp)
 */

import { EventEmitter } from 'events';

process.env.COLLECT_PLAYBACK_SAFETY_MS = process.env.COLLECT_PLAYBACK_SAFETY_MS || '1500';

const { DynamicFlowEngine } = await import('./dynamic-ivr.js');

function makeFakeChannel() {
  const ch = new EventEmitter();
  ch.id = 'test-channel';
  ch.caller = { number: '100' };
  ch.playbacks = [];
  ch.play = (opts, cb) => {
    const pb = new EventEmitter();
    pb.stopped = false;
    pb.stop = (done) => { pb.stopped = true; if (done) done(); };
    ch.playbacks.push(pb);
    setImmediate(() => cb(null, pb));
    return pb;
  };
  return ch;
}

function makeEngine(ch) {
  return new DynamicFlowEngine({}, ch, {
    id: 'test', name: 'test', extension: '9999',
    flow: { startNode: 'a', nodes: {} }, promptCache: {}
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;

async function runCase(name, { maxDigits = 1, timeout = 1, promptPath = null, script }, expect) {
  const ch = makeFakeChannel();
  const engine = makeEngine(ch);
  const t0 = Date.now();
  const promise = engine.collectDigits({ maxDigits, timeout, terminators: '#', bargeIn: true, promptPath });
  const scriptDone = script ? script(ch) : Promise.resolve();
  const digits = await promise;
  const elapsed = (Date.now() - t0) / 1000;
  await scriptDone.catch(() => {});

  const problems = [];
  if (digits !== expect.digits) problems.push(`digits "${digits}" (want "${expect.digits}")`);
  if (expect.minElapsed !== undefined && elapsed < expect.minElapsed) problems.push(`resolved at ${elapsed.toFixed(2)}s (want >= ${expect.minElapsed}s)`);
  if (expect.maxElapsed !== undefined && elapsed > expect.maxElapsed) problems.push(`resolved at ${elapsed.toFixed(2)}s (want <= ${expect.maxElapsed}s)`);
  if (expect.promptStopped !== undefined) {
    const stopped = ch.playbacks.length > 0 && ch.playbacks[0].stopped;
    if (stopped !== expect.promptStopped) problems.push(`promptStopped ${stopped} (want ${expect.promptStopped})`);
  }

  if (problems.length) { failures++; console.log(`FAIL ${name}: ${problems.join('; ')}`); }
  else console.log(`pass ${name} (${elapsed.toFixed(2)}s, "${digits}")`);
}

// Simulated playback ends at 1.2s — longer than the 1s timeout (the bug
// scenario) but shorter than the 1.5s test safety cap.

// T1 — THE BUG: digit pressed shortly after a prompt longer than the timeout.
// Timer must not fire mid-playback; the digit at 1.6s must be collected.
await runCase('digit after long prompt', {
  promptPath: 'custom/long',
  script: async (ch) => {
    await sleep(1200); ch.playbacks[0]?.emit('PlaybackFinished');
    await sleep(400); ch.emit('ChannelDtmfReceived', { digit: '3' });
  }
}, { digits: '3', minElapsed: 1.5, maxElapsed: 2.2 });

// T2 — silence after long prompt: timeout counts from playback end, not start.
await runCase('silence after long prompt', {
  promptPath: 'custom/long',
  script: async (ch) => { await sleep(1200); ch.playbacks[0]?.emit('PlaybackFinished'); }
}, { digits: '', minElapsed: 2.0, maxElapsed: 2.9 });

// T3 — barge-in during playback still resolves immediately and stops the prompt.
await runCase('barge-in during prompt', {
  promptPath: 'custom/long',
  script: async (ch) => { await sleep(300); ch.emit('ChannelDtmfReceived', { digit: '2' }); }
}, { digits: '2', maxElapsed: 0.8, promptStopped: true });

// T4 — no prompt: plain timeout unchanged.
await runCase('no prompt silence', {}, { digits: '', minElapsed: 0.8, maxElapsed: 1.5 });

// T5 — inter-digit timeout still resets per digit (no prompt).
await runCase('inter-digit reset', {
  maxDigits: 3,
  script: async (ch) => {
    await sleep(200); ch.emit('ChannelDtmfReceived', { digit: '1' });
    await sleep(300); ch.emit('ChannelDtmfReceived', { digit: '2' });
  }
}, { digits: '12', minElapsed: 1.3, maxElapsed: 1.9 });

// T6 — playback error: timer must still arm (no hang).
{
  const ch = makeFakeChannel();
  ch.play = (opts, cb) => { setImmediate(() => cb(new Error('boom'), null)); };
  const engine = makeEngine(ch);
  const t0 = Date.now();
  const digits = await engine.collectDigits({ maxDigits: 1, timeout: 1, terminators: '#', bargeIn: true, promptPath: 'custom/broken' });
  const elapsed = (Date.now() - t0) / 1000;
  if (digits === '' && elapsed >= 0.8 && elapsed <= 1.6) console.log(`pass play error arms timer (real) (${elapsed.toFixed(2)}s)`);
  else { failures++; console.log(`FAIL play error arms timer (real): "${digits}" at ${elapsed.toFixed(2)}s`); }
}

// T7 — lost PlaybackFinished: safety cap (1.5s in tests) ends the collect.
await runCase('lost PlaybackFinished safety cap', {
  promptPath: 'custom/lost',
  script: async () => {}
}, { digits: '', minElapsed: 1.2, maxElapsed: 2.3 });

// T8 — digit during playback with more digits allowed: timer re-arms per digit.
await runCase('digit during prompt then silence', {
  maxDigits: 3,
  promptPath: 'custom/long',
  script: async (ch) => { await sleep(400); ch.emit('ChannelDtmfReceived', { digit: '7' }); }
}, { digits: '7', minElapsed: 1.2, maxElapsed: 1.9, promptStopped: true });

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
