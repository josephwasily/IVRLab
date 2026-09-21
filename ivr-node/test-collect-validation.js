/**
 * Regression tests for collect input validation and digit-count-aware timeouts.
 *
 *  - validDigits: keys the question does not accept must never be stored as
 *    an answer; the caller is re-asked, capped so a stuck key cannot loop.
 *  - timeouts: the first digit gets the full reaction window, later digits a
 *    shorter inter-digit wait, so the budget scales with how much is entered.
 *
 * Run inside the ivr-node image (needs its node_modules):
 *   docker run --rm --entrypoint node \
 *     -v $PWD/ivr-node/dynamic-ivr.js:/app/dynamic-ivr.js:ro \
 *     -v $PWD/ivr-node/test-collect-validation.js:/app/test-collect-validation.js:ro \
 *     ivr-lab-ivr-node /app/test-collect-validation.js
 */

import { EventEmitter } from 'events';

const { DynamicFlowEngine } = await import('./dynamic-ivr.js');

function makeChannel() {
  const ch = new EventEmitter();
  ch.id = 'test-channel';
  ch.caller = { number: '100' };
  ch.playbacks = [];
  ch.play = (opts, cb) => {
    const pb = new EventEmitter();
    pb.stop = (done) => { if (done) done(); };
    ch.playbacks.push(pb);
    setImmediate(() => { cb(null, pb); setImmediate(() => pb.emit('PlaybackFinished')); });
    return pb;
  };
  return ch;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`pass ${name} -> ${JSON.stringify(actual)}`);
  else { failures++; console.log(`FAIL ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`); }
}

// ---- validDigits -------------------------------------------------------
// A yes/no question that advances to `done` when input is unusable.
const flow = {
  startNode: 'q',
  nodes: {
    q: { id: 'q', type: 'collect', variable: 'ans', validDigits: '12', maxDigits: 1,
         timeout: 1, next: 'done', onEmpty: 'done' },
    done: { id: 'done', type: 'hangup' }
  }
};

async function runCollect(digitsToPress) {
  const ch = makeChannel();
  const engine = new DynamicFlowEngine({}, ch, {
    id: 't', name: 'test', extension: '9999', flow, promptCache: {}
  });
  engine.hangup = async () => {};
  const pressed = [...digitsToPress];
  const feed = async () => {
    while (pressed.length) {
      await sleep(120);
      ch.emit('ChannelDtmfReceived', { digit: pressed.shift() });
    }
  };
  const run = engine.executeNode('q');
  await Promise.all([run, feed()]);
  return engine;
}

// T1 — an accepted key is stored.
{
  const e = await runCollect(['2']);
  check('valid digit stored', e.variables.ans, '2');
}

// T2 — THE BUG: a key outside validDigits must not become the answer.
{
  const e = await runCollect(['7', '7']);
  check('out-of-range digit not stored', e.variables.ans, undefined);
  check('  -> no dtmf recorded as an answer', e.dtmfInputs.length, 0);
}

// T3 — a mis-press followed by a good key still records the good key.
{
  const e = await runCollect(['9', '1']);
  check('retry after mis-press', e.variables.ans, '1');
}

// T4 — a caller leaning on a wrong key must not loop forever.
{
  const e = await runCollect(['8', '8', '8', '8', '8']);
  check('stuck wrong key terminates', e.variables.ans, undefined);
  const visits = e.nodeHistory.filter(n => n === 'q').length;
  if (visits <= 3) console.log(`pass retry cap honoured (${visits} visits)`);
  else { failures++; console.log(`FAIL retry cap: ${visits} visits to q`); }
}

// T5 — no validDigits declared: any digit is accepted, as before.
{
  const open = JSON.parse(JSON.stringify(flow));
  delete open.nodes.q.validDigits;
  const ch = makeChannel();
  const engine = new DynamicFlowEngine({}, ch, {
    id: 't', name: 'test', extension: '9999', flow: open, promptCache: {}
  });
  engine.hangup = async () => {};
  const run = engine.executeNode('q');
  await sleep(120); ch.emit('ChannelDtmfReceived', { digit: '7' });
  await run;
  check('no validDigits = unrestricted', engine.variables.ans, '7');
}

// ---- digit-count-aware timeouts ---------------------------------------
function bareEngine() {
  const ch = makeChannel();
  return [ch, new DynamicFlowEngine({}, ch, {
    id: 't', name: 'test', extension: '9999', flow: { startNode: 'a', nodes: {} }, promptCache: {}
  })];
}

// T6 — first digit gets the long window; nothing pressed means the long wait.
{
  const [, engine] = bareEngine();
  const t0 = Date.now();
  await engine.collectDigits({ maxDigits: 4, timeout: 1, interDigitTimeout: 0.3, terminators: '#', bargeIn: true });
  const el = (Date.now() - t0) / 1000;
  if (el >= 0.9 && el <= 1.4) console.log(`pass first-digit window used (${el.toFixed(2)}s)`);
  else { failures++; console.log(`FAIL first-digit window: ${el.toFixed(2)}s (want ~1s)`); }
}

// T7 — after the first digit the shorter inter-digit wait applies.
{
  const [ch, engine] = bareEngine();
  const t0 = Date.now();
  const p = engine.collectDigits({ maxDigits: 4, timeout: 1, interDigitTimeout: 0.3, terminators: '#', bargeIn: true });
  await sleep(150); ch.emit('ChannelDtmfReceived', { digit: '5' });
  const digits = await p;
  const el = (Date.now() - t0) / 1000;
  const ok = digits === '5' && el >= 0.35 && el <= 0.8;
  if (ok) console.log(`pass inter-digit window used (${el.toFixed(2)}s, "${digits}")`);
  else { failures++; console.log(`FAIL inter-digit window: ${el.toFixed(2)}s, "${digits}" (want ~0.45s)`); }
}

// T8 — a long entry stays collectable: each digit re-arms the short wait.
{
  const [ch, engine] = bareEngine();
  const p = engine.collectDigits({ maxDigits: 5, timeout: 1, interDigitTimeout: 0.4, terminators: '#', bargeIn: true });
  for (const d of ['1','2','3','4']) { await sleep(200); ch.emit('ChannelDtmfReceived', { digit: d }); }
  check('long entry collected across pauses', await p, '1234');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
