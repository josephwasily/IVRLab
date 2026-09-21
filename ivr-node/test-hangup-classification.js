/**
 * Regression tests for mid-flow hangup classification.
 *
 * A survey caller who hangs up the instant they press the last digit — before
 * the thank-you prompt finishes — has answered everything, so the call is a
 * completed survey, not an abort. resolveHangupStatus decides that by walking
 * the flow forward from the node the caller died on and looking for collect
 * nodes that still have no value.
 *
 * Run inside the ivr-node image (needs its node_modules):
 *   docker run --rm --entrypoint node \
 *     -v $PWD/ivr-node/dynamic-ivr.js:/app/dynamic-ivr.js:ro \
 *     -v $PWD/ivr-node/test-hangup-classification.js:/app/test-hangup-classification.js:ro \
 *     ivr-lab-ivr-node /app/test-hangup-classification.js
 */

import { EventEmitter } from 'events';

const { DynamicFlowEngine } = await import('./dynamic-ivr.js');

// A linear survey: welcome -> q1 -> q2 -> thanks -> hangup.
const linearFlow = {
  startNode: 'welcome',
  nodes: {
    welcome: { id: 'welcome', type: 'play', prompt: 'w', next: 'q1' },
    q1: { id: 'q1', type: 'collect', variable: 'a1', prompt: 'p1', next: 'q2', onTimeout: 'q2', onEmpty: 'q2' },
    q2: { id: 'q2', type: 'collect', variable: 'a2', prompt: 'p2', next: 'thanks', onTimeout: 'thanks', onEmpty: 'thanks' },
    thanks: { id: 'thanks', type: 'play', prompt: 't', next: 'hangup' },
    hangup: { id: 'hangup', type: 'hangup' }
  }
};

// A branching flow: the untaken branch still holds an unanswered question.
const branchFlow = {
  startNode: 'q1',
  nodes: {
    q1: { id: 'q1', type: 'collect', variable: 'a1', next: 'split' },
    split: { id: 'split', type: 'branch', variable: 'a1', branches: { '1': 'thanks', '2': 'q2' }, default: 'q2' },
    q2: { id: 'q2', type: 'collect', variable: 'a2', next: 'thanks' },
    thanks: { id: 'thanks', type: 'play', prompt: 't', next: 'hangup' },
    hangup: { id: 'hangup', type: 'hangup' }
  }
};

// A collect that retries itself on empty input — the walk must not loop.
const retryFlow = {
  startNode: 'q1',
  nodes: {
    q1: { id: 'q1', type: 'collect', variable: 'a1', next: 'thanks', onEmpty: 'q1', onTimeout: 'q1' },
    thanks: { id: 'thanks', type: 'play', prompt: 't', next: 'hangup' },
    hangup: { id: 'hangup', type: 'hangup' }
  }
};

function makeEngine(flow) {
  const ch = new EventEmitter();
  ch.id = 'test-channel';
  ch.caller = { number: '100' };
  return new DynamicFlowEngine({}, ch, {
    id: 'test', name: 'test', extension: '9999', flow, promptCache: {}
  });
}

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) console.log(`pass ${name} -> ${actual}`);
  else { failures++; console.log(`FAIL ${name}: got "${actual}", want "${expected}"`); }
}

// T1 — THE BUG: every question answered, caller hangs up during the thank-you.
{
  const e = makeEngine(linearFlow);
  e.variables.a1 = '1'; e.variables.a2 = '2';
  e.dtmfInputs = [{ node: 'q1', digits: '1' }, { node: 'q2', digits: '2' }];
  check('all answered, hangup at thanks', e.resolveHangupStatus('thanks'), 'captured_then_hangup');
  check('  -> marks flow completed', e.completedFlow, true);
}

// T2 — genuine mid-survey drop-off: q2 never answered.
{
  const e = makeEngine(linearFlow);
  e.variables.a1 = '1';
  e.dtmfInputs = [{ node: 'q1', digits: '1' }];
  check('question still pending', e.resolveHangupStatus('q2'), 'caller_hangup_early');
}

// T3 — hung up during the welcome, nothing captured at all.
{
  const e = makeEngine(linearFlow);
  check('no digits captured', e.resolveHangupStatus('welcome'), 'caller_hangup_early');
}

// T4 — branch taken to thanks: the unanswered q2 sits on a path the caller
// can no longer reach, so it must not count against them.
{
  const e = makeEngine(branchFlow);
  e.variables.a1 = '1';
  e.dtmfInputs = [{ node: 'q1', digits: '1' }];
  check('unanswered question on untaken branch', e.resolveHangupStatus('thanks'), 'captured_then_hangup');
}

// T5 — same flow, but the caller is still upstream of the branch: q2 is
// reachable and unanswered.
{
  const e = makeEngine(branchFlow);
  e.variables.a1 = '2';
  e.dtmfInputs = [{ node: 'q1', digits: '2' }];
  check('unanswered question still reachable', e.resolveHangupStatus('split'), 'caller_hangup_early');
}

// T6 — self-referencing retry node must terminate and report pending.
{
  const e = makeEngine(retryFlow);
  e.dtmfInputs = [{ node: 'q1', digits: '9' }];
  check('retry loop terminates', e.resolveHangupStatus('q1'), 'caller_hangup_early');
}

// T7 — unknown node id: cannot prove completeness, stay conservative.
{
  const e = makeEngine(linearFlow);
  e.variables.a1 = '1'; e.variables.a2 = '2';
  e.dtmfInputs = [{ node: 'q1', digits: '1' }, { node: 'q2', digits: '2' }];
  check('unknown node id', e.resolveHangupStatus('nosuchnode'), 'caller_hangup_early');
  check('undefined node id', e.resolveHangupStatus(undefined), 'caller_hangup_early');
}

// T8 — pending list names the actual unanswered nodes.
{
  const e = makeEngine(linearFlow);
  const pending = e.getPendingCollectNodes('q1');
  check('pending list from q1', pending.join(','), 'q1,q2');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
