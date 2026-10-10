// Resolves a campaign from the v2 lookup keys (api_campaign_type + region)
// instead of its id, so callers don't hard-code client-specific ids such as
// "assuit-complaint-resolution-campaign" in their URLs.

const db = require('../db');

// Spelling variants seen in ids and in partner requests → stored value.
const REGION_ALIASES = { assuit: 'assiut', asyut: 'assiut' };

function normalizeKey(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).trim().toLowerCase();
    return s || null;
}

function normalizeRegion(value) {
    const s = normalizeKey(value);
    return s ? (REGION_ALIASES[s] || s) : null;
}

// Returns { campaign } or { error, status, ...details }.
function resolveCampaign(tenantId, campaignType, region) {
    const type = normalizeKey(campaignType);
    const reg = normalizeRegion(region);

    const where = ['tenant_id = ?', 'api_campaign_type = ?'];
    const params = [tenantId, type];
    if (reg) {
        where.push('region = ?');
        params.push(reg);
    }
    const matches = db.prepare(`SELECT * FROM campaigns WHERE ${where.join(' AND ')}`).all(...params);

    if (matches.length === 1) return { campaign: matches[0] };

    if (matches.length === 0) {
        return {
            status: 404,
            error: reg
                ? `No campaign of type "${type}" for region "${reg}"`
                : `No campaign of type "${type}"`,
            available: listCampaignTypes(tenantId)
        };
    }

    return {
        status: reg ? 409 : 400,
        error: reg
            ? `More than one campaign of type "${type}" for region "${reg}"; fix the campaign configuration`
            : `Campaign type "${type}" exists in more than one region; pass "region"`,
        regions: [...new Set(matches.map(c => c.region).filter(Boolean))]
    };
}

function listCampaignTypes(tenantId) {
    return db.prepare(`
        SELECT api_campaign_type AS campaign_type, region
        FROM campaigns
        WHERE tenant_id = ? AND api_campaign_type IS NOT NULL
        ORDER BY api_campaign_type, region
    `).all(tenantId);
}

module.exports = { normalizeKey, normalizeRegion, resolveCampaign };
