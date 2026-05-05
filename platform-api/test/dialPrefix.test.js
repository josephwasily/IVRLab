const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDialPrefix, applyDialPrefix } = require('../src/services/dialPrefix');

test('applyDialPrefix returns trimmed number when prefix is empty', () => {
  assert.equal(applyDialPrefix('', '01234'), '01234');
  assert.equal(applyDialPrefix(null, '01234'), '01234');
  assert.equal(applyDialPrefix(undefined, '  01234  '), '01234');
});

test('applyDialPrefix prepends prefix to trimmed number', () => {
  assert.equal(applyDialPrefix('9', '01234'), '901234');
  assert.equal(applyDialPrefix('9', '  01234 '), '901234');
});

test('applyDialPrefix handles multi-char prefix and DTMF symbols', () => {
  assert.equal(applyDialPrefix('901', '5551234'), '9015551234');
  assert.equal(applyDialPrefix('*9', '01234'), '*901234');
});

test('applyDialPrefix returns empty string when phoneNumber is empty', () => {
  assert.equal(applyDialPrefix('9', ''), '9');
  assert.equal(applyDialPrefix('9', null), '9');
});

test('resolveDialPrefix uses campaign value as authority when campaign present', () => {
  // Snapshot model: when a campaign is in scope, its value wins — even if null/empty.
  assert.equal(
    resolveDialPrefix({ campaign: { dial_prefix: '8' }, trunk: { dial_prefix: '9' } }),
    '8'
  );
  assert.equal(
    resolveDialPrefix({ campaign: { dial_prefix: null }, trunk: { dial_prefix: '9' } }),
    ''
  );
  assert.equal(
    resolveDialPrefix({ campaign: { dial_prefix: '' }, trunk: { dial_prefix: '9' } }),
    ''
  );
});

test('resolveDialPrefix falls back to trunk when no campaign in scope', () => {
  assert.equal(
    resolveDialPrefix({ campaign: null, trunk: { dial_prefix: '9' } }),
    '9'
  );
  assert.equal(
    resolveDialPrefix({ campaign: undefined, trunk: { dial_prefix: '9' } }),
    '9'
  );
});

test('resolveDialPrefix returns empty when nothing is configured', () => {
  assert.equal(resolveDialPrefix({ campaign: null, trunk: null }), '');
  assert.equal(resolveDialPrefix({ campaign: null, trunk: { dial_prefix: null } }), '');
  assert.equal(resolveDialPrefix({}), '');
});
