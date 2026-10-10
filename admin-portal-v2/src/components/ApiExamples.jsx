import { useState } from 'react'
import { Code2, Copy, Check } from 'lucide-react'
import clsx from 'clsx'
import { useI18n } from '../contexts/I18nContext'

const json = (value) => JSON.stringify(value, null, 2)

// curl with the body on separate lines so it can be pasted into a terminal as-is.
function curl({ method, url, apiKey, body }) {
  const lines = [`curl -X ${method} "${url}"`, `  -H "X-API-Key: ${apiKey}"`]
  if (body) {
    lines.push('  -H "Content-Type: application/json"')
    lines.push(`  -d '${json(body)}'`)
  }
  return lines.join(' \\\n')
}

// Ready-to-copy request/response examples for the external campaign APIs,
// filled in with this campaign's id, key, type/region and flag variable.
export default function ApiExamples({ campaign, campaignId, v2Type, v2Region }) {
  const { t } = useI18n()
  const [version, setVersion] = useState('v2')
  const [endpoint, setEndpoint] = useState('trigger')
  const [view, setView] = useState('curl')
  const [copied, setCopied] = useState(false)

  const origin = window.location.origin
  const apiKey = campaign?.webhook_api_key || '<API_KEY>'
  const flagVar = campaign?.flag_variable || 'answer'
  const flagVal = campaign?.flag_value || '1'
  const type = v2Type || '<campaign_type>'
  const runId = '4be3f58f-a963-4d62-9a84-58a58552a9e3'
  const now = '2026-10-10 09:59:43'
  const done = '2026-10-10 10:01:01'

  const contactsBody = [
    { phone_number: '01012345678', cms_id: 'case-1001', name: 'Customer name', variables: {} },
    { phone_number: '01198765432', cms_id: 'case-1002' }
  ]
  const counters = {
    total_contacts: 2, contacts_completed: 2, contacts_failed: 0,
    contacts_answered: 2, contacts_no_answer: 0, contacts_busy: 0
  }
  const contactResult = {
    phone_number: '01012345678',
    cms_id: 'case-1001',
    name: 'Customer name',
    flag: true,
    status: 'completed',
    call_status: 'completed',
    attempts: 1,
    max_attempts: campaign?.max_attempts || 3,
    variables: { [flagVar]: flagVal, flow_final_status: 'flow_completed' },
    dtmf_inputs: [{ node: flagVar, digits: flagVal, timestamp: '2026-10-10T10:00:12.000Z' }],
    duration: 41,
    last_attempt_at: now
  }
  const v2Execution = {
    execution_id: runId,
    campaign_type: type,
    region: v2Region || null,
    campaign_id: campaignId,
    campaign_name: campaign?.name || '',
    run_number: 1,
    survey_id: 'SRV-2026-001',
    cms_id: null,
    status: 'completed',
    ...counters,
    started_at: now,
    completed_at: done
  }

  const examples = {
    v2: {
      trigger: {
        label: t('apiExamples.trigger'),
        method: 'POST',
        url: `${origin}/api/v2/campaigns/executions`,
        body: { campaign_type: type, ...(v2Region && { region: v2Region }), survey_id: 'SRV-2026-001', contacts: contactsBody },
        response: { success: true, ...v2Execution, status: 'running', contacts_completed: 0, contacts_answered: 0, completed_at: null, duplicates: 0, skipped: 0 },
        status: '201 Created'
      },
      list: {
        label: t('apiExamples.list'),
        method: 'GET',
        url: `${origin}/api/v2/campaigns/executions?${new URLSearchParams({ campaign_type: type, ...(v2Region && { region: v2Region }), limit: '20' })}`,
        response: { total: 1, limit: 20, offset: 0, filters: { campaign_type: type, region: v2Region || null, survey_id: null, status: null }, executions: [v2Execution] },
        status: '200 OK'
      },
      status: {
        label: t('apiExamples.status'),
        method: 'GET',
        url: `${origin}/api/v2/campaigns/executions/${runId}`,
        response: { execution: v2Execution, results: [contactResult] },
        status: '200 OK'
      }
    },
    v1: {
      trigger: {
        label: t('apiExamples.trigger'),
        method: 'POST',
        url: `${origin}/api/webhooks/campaigns/${campaignId}/trigger`,
        body: { survey_id: 'SRV-2026-001', contacts: contactsBody },
        response: { success: true, run_id: runId, run_number: 1, survey_id: 'SRV-2026-001', total_contacts: 2, duplicates: 0, skipped: 0 },
        status: '201 Created'
      },
      list: {
        label: t('apiExamples.list'),
        method: 'GET',
        url: `${origin}/api/webhooks/runs?${new URLSearchParams({ campaign_ids: campaignId, limit: '20' })}`,
        response: {
          total: 1, limit: 20, offset: 0,
          filters: { survey_id: null, campaign_ids: [campaignId], status: null },
          runs: [{ run_id: runId, run_number: 1, campaign_id: campaignId, campaign_name: campaign?.name || '', survey_id: 'SRV-2026-001', cms_id: null, status: 'completed', ...counters, started_at: now, completed_at: done }]
        },
        status: '200 OK'
      },
      status: {
        label: t('apiExamples.status'),
        method: 'GET',
        url: `${origin}/api/webhooks/campaigns/${campaignId}/runs/${runId}/results`,
        response: {
          summary: { run_id: runId, run_number: 1, survey_id: 'SRV-2026-001', cms_id: null, status: 'completed', ...counters, started_at: now, completed_at: done },
          results: [contactResult]
        },
        status: '200 OK'
      }
    }
  }

  const ex = examples[version][endpoint]
  const views = [
    { key: 'curl', label: 'curl' },
    ...(ex.body ? [{ key: 'body', label: t('apiExamples.requestBody') }] : []),
    { key: 'response', label: `${t('apiExamples.response')} ${ex.status}` }
  ]
  const activeView = views.some((v) => v.key === view) ? view : 'curl'
  const code = activeView === 'curl'
    ? curl({ method: ex.method, url: ex.url, apiKey, body: ex.body })
    : json(activeView === 'body' ? ex.body : ex.response)

  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const errors = version === 'v2'
    ? [
        ['400', t('apiExamples.err400v2')],
        ['401', t('apiExamples.err401')],
        ['404', t('apiExamples.err404v2')],
        ['409', t('apiExamples.err409')]
      ]
    : [
        ['400', t('apiExamples.err400v1')],
        ['401', t('apiExamples.err401')],
        ['404', t('apiExamples.err404v1')],
        ['409', t('apiExamples.err409')]
      ]

  const tabClass = (active) => clsx(
    'rounded-md px-3 py-1.5 text-sm',
    active ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
  )

  return (
    <div className="rounded-lg bg-white p-6 shadow">
      <h3 className="mb-1 flex items-center gap-2 font-medium text-gray-900"><Code2 className="h-4 w-4" />{t('apiExamples.title')}</h3>
      <p className="mb-4 text-sm text-gray-500">{t('apiExamples.subtitle')}</p>

      <div className="mb-3 flex flex-wrap items-center gap-4">
        <div className="flex gap-1 rounded-lg border border-gray-200 p-1">
          {['v2', 'v1'].map((v) => (
            <button key={v} onClick={() => setVersion(v)} className={tabClass(version === v)}>{v === 'v2' ? 'API v2' : 'Webhooks v1'}</button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border border-gray-200 p-1">
          {Object.entries(examples[version]).map(([key, e]) => (
            <button key={key} onClick={() => setEndpoint(key)} className={tabClass(endpoint === key)}>{e.label}</button>
          ))}
        </div>
      </div>

      <div dir="ltr" className="mb-2 flex items-center gap-2 text-xs">
        <span className={clsx('rounded px-2 py-0.5 font-semibold', ex.method === 'POST' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800')}>{ex.method}</span>
        <code className="truncate text-gray-700" title={ex.url}>{ex.url.replace(origin, '')}</code>
      </div>

      <div className="overflow-hidden rounded-md border border-gray-800">
        <div dir="ltr" className="flex items-center justify-between bg-gray-800 px-2 py-1">
          <div className="flex gap-1">
            {views.map((v) => (
              <button key={v.key} onClick={() => setView(v.key)} className={clsx('rounded px-2 py-1 text-xs', activeView === v.key ? 'bg-gray-600 text-white' : 'text-gray-300 hover:text-white')}>{v.label}</button>
            ))}
          </div>
          <button onClick={copy} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-300 hover:text-white">
            {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
            {copied ? t('campaignEdit.copied') : t('campaignEdit.copy')}
          </button>
        </div>
        <pre dir="ltr" className="max-h-96 overflow-auto bg-gray-900 px-3 py-2 text-xs leading-relaxed text-gray-100">{code}</pre>
      </div>

      {!campaign?.webhook_api_key && <p className="mt-2 text-xs text-amber-600">{t('apiExamples.noKey')}</p>}
      {version === 'v2' && !v2Type && <p className="mt-2 text-xs text-amber-600">{t('campaignEdit.v2NotConfigured')}</p>}

      <div className="mt-4 grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
        <div>
          <div className="mb-1 font-medium text-gray-700">{t('apiExamples.contactFields')}</div>
          <ul className="space-y-1 text-gray-600">
            <li><code className="text-gray-900">phone_number</code> — {t('apiExamples.fPhone')}</li>
            <li><code className="text-gray-900">cms_id</code> — {t('apiExamples.fCmsId')}</li>
            <li><code className="text-gray-900">name</code>, <code className="text-gray-900">variables</code> — {t('apiExamples.fOptional')}</li>
            <li><code className="text-gray-900">survey_id</code> — {t('apiExamples.fSurveyId')}</li>
            <li><code className="text-gray-900">flag</code> — {t('apiExamples.fFlag', { variable: flagVar, value: flagVal })}</li>
          </ul>
        </div>
        <div>
          <div className="mb-1 font-medium text-gray-700">{t('apiExamples.errors')}</div>
          <ul className="space-y-1 text-gray-600">
            {errors.map(([code, text]) => (
              <li key={code}><code className="text-gray-900">{code}</code> — {text}</li>
            ))}
          </ul>
          <p className="mt-2 text-gray-500">{t('apiExamples.polling')}</p>
        </div>
      </div>
    </div>
  )
}
