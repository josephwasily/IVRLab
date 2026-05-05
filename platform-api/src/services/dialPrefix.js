function resolveDialPrefix({ campaign, trunk } = {}) {
  // Campaign in scope: campaign value is authoritative (snapshot model).
  // NULL or empty on the campaign means "no prefix" — do NOT fall back to trunk.
  if (campaign) return campaign.dial_prefix || '';
  // No campaign (single-call API / webhook): use trunk default.
  if (trunk && trunk.dial_prefix) return trunk.dial_prefix;
  return '';
}

function applyDialPrefix(prefix, phoneNumber) {
  const num = String(phoneNumber || '').trim();
  if (!prefix) return num;
  return `${prefix}${num}`;
}

module.exports = { resolveDialPrefix, applyDialPrefix };
