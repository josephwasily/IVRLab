'use strict';

/**
 * Walk an IVR flow_data graph and return the captures eligible for the
 * single-digit survey report.
 *
 * Eligibility:
 *   - node.type === 'collect'
 *   - node.maxDigits === 1
 *   - At least one of node.reportLabelAr / node.reportLabelEn is non-empty.
 *
 * `flowData` is whatever was stored in `ivr_flows.flow_data`. It is normally
 * `{ nodes: { [id]: nodeObj } }` or `{ nodes: [ ... ] }`. Both shapes are
 * tolerated.
 *
 * Returns an array preserving discovery order:
 *   [{ nodeId, variable, labelAr, labelEn }, ...]
 */
function extractEligibleCaptures(flowData) {
  if (!flowData || typeof flowData !== 'object') return [];

  const rawNodes = flowData.nodes;
  let iterable;
  if (Array.isArray(rawNodes)) {
    iterable = rawNodes.filter((n) => n && n.id);
  } else if (rawNodes && typeof rawNodes === 'object') {
    iterable = Object.entries(rawNodes).map(([id, node]) => ({
      ...node,
      id
    }));
  } else {
    return [];
  }

  const eligible = [];
  for (const node of iterable) {
    if (!node || node.type !== 'collect') continue;
    if (Number(node.maxDigits) !== 1) continue;
    const labelAr = (node.reportLabelAr || '').trim();
    const labelEn = (node.reportLabelEn || '').trim();
    if (!labelAr && !labelEn) continue;

    eligible.push({
      nodeId: node.id,
      variable: node.variable || node.id,
      labelAr,
      labelEn
    });
  }
  return eligible;
}

module.exports = {
  extractEligibleCaptures
};
