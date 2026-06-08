function resolveDialPrefix({ campaign, trunk } = {}) {
  // Trunk is the source of truth (default "9" on new trunks). A campaign
  // may explicitly override the trunk's prefix by setting its own non-empty
  // dial_prefix; a NULL/empty campaign prefix means "inherit from trunk".
  if (campaign && campaign.dial_prefix) return campaign.dial_prefix;
  if (trunk && trunk.dial_prefix) return trunk.dial_prefix;
  return '';
}

function applyDialPrefix(prefix, phoneNumber) {
  const num = String(phoneNumber || '').trim();
  if (!prefix) return num;
  return `${prefix}${num}`;
}

module.exports = { resolveDialPrefix, applyDialPrefix };
