const db = require('../db');
const { v4: uuidv4 } = require('uuid');

// Get tenant ID
const tenant = db.prepare('SELECT id FROM tenants LIMIT 1').get();
if (!tenant) {
  console.error('No tenant found!');
  process.exit(1);
}
const tenantId = tenant.id;

// Create the satisfaction survey IVR
const ivrId = uuidv4();

const surveyFlow = {
  startNode: 'welcome',
  nodes: {
    welcome: {
      id: 'welcome',
      type: 'play',
      prompt: 'survey_welcome',
      next: 'ask_satisfaction'
    },
    ask_satisfaction: {
      id: 'ask_satisfaction',
      type: 'collect',
      prompt: 'survey_satisfaction_question',
      maxDigits: 1,
      timeout: 10,
      validDigits: '12345',
      next: 'store_satisfaction',
      onTimeout: 'ask_satisfaction_retry',
      onEmpty: 'ask_satisfaction_retry'
    },
    ask_satisfaction_retry: {
      id: 'ask_satisfaction_retry',
      type: 'play',
      prompt: 'survey_invalid_try_again',
      next: 'ask_satisfaction',
      maxRetries: 3,
      onMaxRetries: 'goodbye'
    },
    store_satisfaction: {
      id: 'store_satisfaction',
      type: 'set_variable',
      variable: 'satisfaction_rating',
      value: '{{dtmf_input}}',
      next: 'ask_resolved'
    },
    ask_resolved: {
      id: 'ask_resolved',
      type: 'collect',
      prompt: 'survey_resolved_question',
      maxDigits: 1,
      timeout: 10,
      validDigits: '12',
      next: 'store_resolved',
      onTimeout: 'ask_resolved_retry',
      onEmpty: 'ask_resolved_retry'
    },
    ask_resolved_retry: {
      id: 'ask_resolved_retry',
      type: 'play',
      prompt: 'survey_invalid_try_again',
      next: 'ask_resolved',
      maxRetries: 3,
      onMaxRetries: 'goodbye'
    },
    store_resolved: {
      id: 'store_resolved',
      type: 'set_variable',
      variable: 'issue_resolved',
      value: '{{dtmf_input}}',
      next: 'thank_you'
    },
    thank_you: {
      id: 'thank_you',
      type: 'play',
      prompt: 'survey_thank_you',
      next: 'hangup'
    },
    goodbye: {
      id: 'goodbye',
      type: 'play',
      prompt: 'goodbye',
      next: 'hangup'
    },
    hangup: {
      id: 'hangup',
      type: 'hangup'
    }
  }
};

db.prepare(`
  INSERT INTO ivr_flows (id, tenant_id, name, description, status, language, flow_data, created_at, updated_at)
  VALUES (?, ?, ?, ?, 'active', 'ar', ?, datetime('now'), datetime('now'))
`).run(
  ivrId,
  tenantId,
  'Customer Satisfaction Survey',
  'Post-call survey: 1-5 satisfaction rating + issue resolved yes/no',
  JSON.stringify(surveyFlow)
);

console.log('Created IVR:', ivrId);

// Create SIP trunk for local Asterisk
const trunkId = uuidv4();
db.prepare(`
  INSERT INTO sip_trunks (id, tenant_id, name, host, port, transport, username, password, caller_id, codecs, max_channels, status, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
`).run(
  trunkId,
  tenantId,
  'Local Asterisk',
  '192.168.64.1',
  5060,
  'udp',
  '',
  '',
  '1000',
  'ulaw,opus',
  10
);

console.log('Created Trunk:', trunkId);

// Create campaign with settings JSON
const campaignId = uuidv4();
const campaignSettings = {
  trunk_id: trunkId,
  caller_id: '1000',
  max_concurrent_calls: 1,
  retry_attempts: 3,
  retry_delay_minutes: 30,
  description: 'Survey customers about their support experience',
  campaign_type: 'survey'
};

db.prepare(`
  INSERT INTO campaigns (id, tenant_id, name, ivr_id, status, settings, created_at)
  VALUES (?, ?, ?, ?, 'draft', ?, datetime('now'))
`).run(
  campaignId,
  tenantId,
  'Customer Satisfaction Survey',
  ivrId,
  JSON.stringify(campaignSettings)
);

console.log('Created Campaign:', campaignId);
console.log('\n=== Summary ===');
console.log('IVR ID:', ivrId);
console.log('Trunk ID:', trunkId);
console.log('Campaign ID:', campaignId);
console.log('\nSurvey prompts needed (Arabic):');
console.log('  - survey_welcome: "شكراً لمشاركتك في استبيان رضا العملاء"');
console.log('  - survey_satisfaction_question: "على مقياس من 1 إلى 5، ما مدى رضاك عن خدمتنا؟ 1 يعني غير راضٍ، 5 يعني راضٍ جداً"');
console.log('  - survey_resolved_question: "هل تم حل مشكلتك؟ اضغط 1 لنعم، اضغط 2 للا"');
console.log('  - survey_thank_you: "شكراً لملاحظاتك. مع السلامة"');
console.log('  - survey_invalid_try_again: "إدخال غير صحيح. حاول مرة أخرى"');
