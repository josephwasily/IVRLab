import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getCampaign,
  createCampaign,
  updateCampaign,
  getTrunks,
  getIVRFlows,
  getCampaignInstances,
  getCampaignInstanceContacts,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  generateCampaignApiKey
} from '../lib/api'
import { ArrowLeft, Save, Loader2, Pause, Play, Square, ExternalLink, Key, Copy, RefreshCw } from 'lucide-react'
import clsx from 'clsx'

const campaignTypes = [
  { value: 'survey', label: 'Survey', description: 'Collect responses via IVR' },
  { value: 'notification', label: 'Notification', description: 'Play announcements' },
  { value: 'reminder', label: 'Reminder', description: 'Appointment reminders' },
  { value: 'collection', label: 'Collection', description: 'Payment reminders' },
  { value: 'custom', label: 'Custom', description: 'Custom IVR flow' }
]

const instanceStatusClasses = {
  running: 'bg-green-100 text-green-800',
  paused: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-gray-100 text-gray-800',
  failed: 'bg-red-100 text-red-800'
}

const contactStatusClasses = {
  pending: 'bg-gray-100 text-gray-700',
  calling: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  skipped: 'bg-yellow-100 text-yellow-700'
}

export default function CampaignEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isNew = id === 'new'

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    campaign_type: 'notification',
    ivr_id: '',
    trunk_id: '',
    caller_id: '',
    max_concurrent_calls: 1,
    max_attempts: 3,
    retry_delay_minutes: 30,
    settings: {},
    flag_variable: '',
    flag_value: ''
  })
  const [selectedInstanceId, setSelectedInstanceId] = useState(null)

  const campaignKey = ['campaign', id]
  const instancesKey = ['campaign-instances', id]

  const { data: campaign, isLoading: loadingCampaign } = useQuery({
    queryKey: campaignKey,
    queryFn: () => getCampaign(id),
    enabled: !isNew
  })

  const { data: instances, isFetching: refreshingInstances } = useQuery({
    queryKey: instancesKey,
    queryFn: () => getCampaignInstances(id),
    enabled: !isNew,
    refetchInterval: 10000
  })

  const { data: instanceContacts, isFetching: refreshingContacts, refetch: refetchContacts } = useQuery({
    queryKey: ['campaign-instance-contacts', id, selectedInstanceId],
    queryFn: () => getCampaignInstanceContacts(id, selectedInstanceId),
    enabled: !isNew && !!selectedInstanceId
  })

  const { data: trunks } = useQuery({ queryKey: ['trunks'], queryFn: getTrunks })
  const { data: ivrFlows } = useQuery({ queryKey: ['ivr-flows'], queryFn: getIVRFlows })

  useEffect(() => {
    if (!campaign) return
    setFormData({
      name: campaign.name || '',
      description: campaign.description || '',
      campaign_type: campaign.campaign_type || 'notification',
      ivr_id: campaign.ivr_id || '',
      trunk_id: campaign.trunk_id || '',
      caller_id: campaign.caller_id || '',
      max_concurrent_calls: campaign.max_concurrent_calls || 1,
      max_attempts: campaign.max_attempts || 3,
      retry_delay_minutes: campaign.retry_delay_minutes || 30,
      settings: campaign.settings || {},
      flag_variable: campaign.flag_variable || '',
      flag_value: campaign.flag_value || ''
    })
  }, [campaign])

  useEffect(() => {
    if (!instances?.length) {
      setSelectedInstanceId(null)
      return
    }
    if (!selectedInstanceId || !instances.some((instance) => instance.id === selectedInstanceId)) {
      setSelectedInstanceId(instances[0].id)
    }
  }, [instances, selectedInstanceId])

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    queryClient.invalidateQueries({ queryKey: campaignKey })
    queryClient.invalidateQueries({ queryKey: instancesKey })
    queryClient.invalidateQueries({ queryKey: ['outbound-calls'] })
    queryClient.invalidateQueries({ queryKey: ['outbound-analytics'] })
  }

  const saveMutation = useMutation({
    mutationFn: (payload) => (isNew ? createCampaign(payload) : updateCampaign(id, payload)),
    onSuccess: (data) => {
      invalidateAll()
      if (isNew) navigate(`/campaigns/${data.id}`)
    }
  })

  const pauseMutation = useMutation({ mutationFn: () => pauseCampaign(id), onSuccess: invalidateAll })
  const resumeMutation = useMutation({ mutationFn: () => resumeCampaign(id), onSuccess: invalidateAll })
  const cancelMutation = useMutation({ mutationFn: () => cancelCampaign(id), onSuccess: invalidateAll })
  const apiKeyMutation = useMutation({
    mutationFn: () => generateCampaignApiKey(id),
    onSuccess: () => invalidateAll()
  })

  const [copiedField, setCopiedField] = useState(null)
  const copyToClipboard = (text, field) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const activeInstance = instances?.find((instance) => ['running', 'paused'].includes(instance.status)) || null
  const selectedInstance = instances?.find((instance) => instance.id === selectedInstanceId) || null
  const isEditable = !campaign || campaign.status === 'draft'
  const formatDateTime = (value) => (value ? new Date(value).toLocaleString() : '-')
  const contactName = (contact) => contact.variables?.name || '-'
  const contactOutcome = (contact) => contact.result?.flow_final_status || contact.result?.call_outcome || '-'

  if (loadingCampaign) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-center gap-4">
        <button onClick={() => navigate('/campaigns')} className="rounded-lg p-2 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{isNew ? 'New Campaign' : campaign?.name}</h1>
          {campaign && <p className="text-sm text-gray-500">Campaign design is managed here. Start instances from the dedicated wizard.</p>}
        </div>
        {!isNew && (
          <Link to={`/campaigns/${id}/instances/new`} className="inline-flex items-center rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700 hover:bg-green-100">
            <Play className="mr-2 h-4 w-4" />
            Start Instance
          </Link>
        )}
        {isEditable && (
          <button onClick={() => saveMutation.mutate(formData)} disabled={saveMutation.isLoading || !formData.name || !formData.ivr_id} className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
            {saveMutation.isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
            Save
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-6 shadow">
          <h3 className="mb-4 font-medium text-gray-900">Campaign Details</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Campaign Name *</label>
              <input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
              <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} disabled={!isEditable} rows={2} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Campaign Type</label>
              <select value={formData.campaign_type} onChange={(e) => setFormData({ ...formData, campaign_type: e.target.value })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100">
                {campaignTypes.map((type) => <option key={type.value} value={type.value}>{type.label} - {type.description}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">IVR Flow *</label>
              <select value={formData.ivr_id} onChange={(e) => setFormData({ ...formData, ivr_id: e.target.value })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100">
                <option value="">Select IVR Flow...</option>
                {ivrFlows?.filter((flow) => flow.status === 'active').map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <h3 className="mb-4 font-medium text-gray-900">Dialing Configuration</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">SIP Trunk *</label>
              <select value={formData.trunk_id} onChange={(e) => setFormData({ ...formData, trunk_id: e.target.value })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100">
                <option value="">Select Trunk...</option>
                {trunks?.filter((trunk) => trunk.status === 'active').map((trunk) => <option key={trunk.id} value={trunk.id}>{trunk.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Caller ID</label>
              <input value={formData.caller_id} onChange={(e) => setFormData({ ...formData, caller_id: e.target.value })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Max Concurrent Calls</label>
                <input type="number" min="1" value={formData.max_concurrent_calls} onChange={(e) => setFormData({ ...formData, max_concurrent_calls: parseInt(e.target.value, 10) || 1 })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Retry Attempts</label>
                <input type="number" min="0" value={formData.max_attempts} onChange={(e) => setFormData({ ...formData, max_attempts: parseInt(e.target.value, 10) || 0 })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Retry Delay (minutes)</label>
              <input type="number" min="1" value={formData.retry_delay_minutes} onChange={(e) => setFormData({ ...formData, retry_delay_minutes: parseInt(e.target.value, 10) || 1 })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
            </div>
          </div>
        </div>
      </div>

      {!isNew && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg bg-white p-6 shadow">
            <h3 className="mb-4 flex items-center gap-2 font-medium text-gray-900"><Key className="h-4 w-4" />Webhook Integration</h3>
            <p className="mb-4 text-sm text-gray-500">Allow external systems to trigger campaign runs and retrieve results via API.</p>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">API Key</label>
                {campaign?.webhook_api_key ? (
                  <div className="flex items-center gap-2">
                    <input readOnly value={campaign.webhook_api_key} className="flex-1 rounded-md border-gray-300 bg-gray-50 font-mono text-xs shadow-sm" />
                    <button onClick={() => copyToClipboard(campaign.webhook_api_key, 'apiKey')} className="rounded-md border border-gray-300 p-2 hover:bg-gray-50" title="Copy">
                      <Copy className="h-4 w-4 text-gray-500" />
                    </button>
                    <button onClick={() => apiKeyMutation.mutate()} disabled={apiKeyMutation.isLoading} className="rounded-md border border-gray-300 p-2 hover:bg-gray-50" title="Regenerate">
                      <RefreshCw className={clsx('h-4 w-4 text-gray-500', apiKeyMutation.isLoading && 'animate-spin')} />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => apiKeyMutation.mutate()} disabled={apiKeyMutation.isLoading} className="inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100">
                    {apiKeyMutation.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Key className="mr-2 h-4 w-4" />}
                    Generate API Key
                  </button>
                )}
                {copiedField === 'apiKey' && <p className="mt-1 text-xs text-green-600">Copied!</p>}
              </div>
              {campaign?.webhook_api_key && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Trigger URL</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-700">POST /api/webhooks/campaigns/{id}/trigger</code>
                      <button onClick={() => copyToClipboard(`${window.location.origin}/api/webhooks/campaigns/${id}/trigger`, 'triggerUrl')} className="rounded-md border border-gray-300 p-2 hover:bg-gray-50">
                        <Copy className="h-4 w-4 text-gray-500" />
                      </button>
                    </div>
                    {copiedField === 'triggerUrl' && <p className="mt-1 text-xs text-green-600">Copied!</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Results URL</label>
                    <code className="block rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-700">GET /api/webhooks/campaigns/{id}/runs/{'<run_id>'}/results</code>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-white p-6 shadow">
            <h3 className="mb-4 font-medium text-gray-900">Result Flag Configuration</h3>
            <p className="mb-4 text-sm text-gray-500">Configure a variable from the IVR flow to produce a true/false flag per contact in the results API.</p>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Flag Variable Name</label>
                <input value={formData.flag_variable} onChange={(e) => setFormData({ ...formData, flag_variable: e.target.value })} placeholder="e.g. confirm_payment" className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                <p className="mt-1 text-xs text-gray-400">The IVR variable name captured during the call (from a collect or branch node).</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Flag True Value</label>
                <input value={formData.flag_value} onChange={(e) => setFormData({ ...formData, flag_value: e.target.value })} placeholder="e.g. 1" className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                <p className="mt-1 text-xs text-gray-400">When the variable equals this value, the flag will be true.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isNew && (
        <>
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-white p-4 shadow"><div className="text-sm text-gray-500">Total Instances</div><div className="mt-1 text-2xl font-bold text-gray-900">{instances?.length || 0}</div></div>
            <div className="rounded-lg bg-white p-4 shadow"><div className="text-sm text-gray-500">Running Instances</div><div className="mt-1 text-2xl font-bold text-green-600">{instances?.filter((instance) => instance.status === 'running').length || 0}</div></div>
            <div className="rounded-lg bg-white p-4 shadow"><div className="text-sm text-gray-500">Latest Instance</div><div className="mt-1 text-sm font-medium text-gray-900">{instances?.[0] ? `Run #${instances[0].run_number}` : 'No instances yet'}</div><div className="text-xs text-gray-500">{instances?.[0] ? formatDateTime(instances[0].started_at) : 'Start one from the wizard'}</div></div>
          </div>

          <div className="mt-6 rounded-lg bg-white p-6 shadow">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-medium text-gray-900">Instance History</h3>
                <p className="mt-1 text-sm text-gray-500">Use Start Instance to launch a new run with a new contact list.</p>
              </div>
              <div className="flex gap-2">
                <Link to={`/campaigns/${id}/instances/new`} className="inline-flex items-center rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 hover:bg-green-100">
                  <Play className="mr-2 h-4 w-4" />
                  Start Instance
                </Link>
                {activeInstance?.status === 'running' && <button onClick={() => pauseMutation.mutate()} className="inline-flex items-center rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-700 hover:bg-yellow-100"><Pause className="mr-2 h-4 w-4" />Pause</button>}
                {activeInstance?.status === 'paused' && <button onClick={() => resumeMutation.mutate()} className="inline-flex items-center rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 hover:bg-green-100"><Play className="mr-2 h-4 w-4" />Resume</button>}
                {activeInstance?.status === 'paused' && <button onClick={() => cancelMutation.mutate()} className="inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"><Square className="mr-2 h-4 w-4" />Cancel</button>}
              </div>
            </div>

            {instances?.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead><tr className="border-b">{['Instance', 'Status', 'Contacts', 'Completed', 'Failed', 'Started', 'Results URL', 'Actions'].map((label) => <th key={label} className="px-2 py-2 text-left">{label}</th>)}</tr></thead>
                  <tbody>
                    {instances.map((instance) => (
                      <tr key={instance.id} className={clsx('border-b hover:bg-gray-50', selectedInstanceId === instance.id && 'bg-blue-50')}>
                        <td className="px-2 py-3 font-medium">{`Run #${instance.run_number}`}</td>
                        <td className="px-2 py-3"><span className={clsx('rounded-full px-2 py-1 text-xs font-medium', instanceStatusClasses[instance.status] || 'bg-gray-100 text-gray-700')}>{instance.status}</span></td>
                        <td className="px-2 py-3">{instance.total_contacts || 0}</td>
                        <td className="px-2 py-3 text-green-600">{instance.contacts_completed || 0}</td>
                        <td className="px-2 py-3 text-red-600">{instance.contacts_failed || 0}</td>
                        <td className="px-2 py-3 text-gray-500">{formatDateTime(instance.started_at)}</td>
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-1">
                            <code className="max-w-[200px] truncate rounded bg-gray-100 px-2 py-1 text-[10px] text-gray-600" title={`${window.location.origin}/api/webhooks/campaigns/${id}/runs/${instance.id}/results`}>
                              /api/webhooks/campaigns/{id}/runs/{instance.id}/results
                            </code>
                            <button onClick={() => copyToClipboard(`${window.location.origin}/api/webhooks/campaigns/${id}/runs/${instance.id}/results`, `resultsUrl-${instance.id}`)} className="shrink-0 rounded border border-gray-200 p-1 hover:bg-gray-50" title="Copy Results URL">
                              <Copy className="h-3 w-3 text-gray-500" />
                            </button>
                            {copiedField === `resultsUrl-${instance.id}` && <span className="text-[10px] text-green-600">Copied!</span>}
                          </div>
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setSelectedInstanceId(instance.id)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">View Contacts</button>
                            <Link to={`/outbound-calls?campaign=${id}&run=${instance.id}`} className="inline-flex items-center rounded-lg border border-blue-200 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-50"><ExternalLink className="mr-1 h-3 w-3" />Call History</Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">No instances yet. Start the first one from the wizard.</div>}
            {refreshingInstances && <div className="mt-3 text-xs text-gray-400">Refreshing instance history...</div>}
          </div>

          <div className="mt-6 rounded-lg bg-white p-6 shadow">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium text-gray-900">Instance Contacts</h3>
                <p className="mt-1 text-sm text-gray-500">{selectedInstance ? `Contacts and results for Run #${selectedInstance.run_number}.` : 'Select an instance to inspect its contacts.'}</p>
              </div>
              {selectedInstance && (
                <div className="flex gap-2">
                  <button onClick={() => refetchContacts()} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">Refresh</button>
                  <Link to={`/outbound-calls?campaign=${id}&run=${selectedInstance.id}`} className="inline-flex items-center rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"><ExternalLink className="mr-2 h-4 w-4" />View Call History</Link>
                </div>
              )}
            </div>

            {!selectedInstance ? (
              <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">Select an instance above to review its uploaded contacts.</div>
            ) : instanceContacts?.contacts?.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b bg-gray-50"><tr>{['Phone', 'Name', 'Status', 'Attempts', 'Outcome', 'Last Attempt'].map((label) => <th key={label} className="px-3 py-2 text-left text-gray-600">{label}</th>)}</tr></thead>
                  <tbody>
                    {instanceContacts.contacts.map((contact) => (
                      <tr key={contact.id} className="border-b hover:bg-gray-50">
                        <td className="px-3 py-2 font-mono">{contact.phone_number}</td>
                        <td className="px-3 py-2 text-gray-600">{contactName(contact)}</td>
                        <td className="px-3 py-2"><span className={clsx('rounded px-2 py-0.5 text-xs', contactStatusClasses[contact.status] || 'bg-gray-100 text-gray-700')}>{contact.status}</span></td>
                        <td className="px-3 py-2">{contact.attempts || 0}</td>
                        <td className="px-3 py-2 text-gray-600">{contactOutcome(contact)}</td>
                        <td className="px-3 py-2 text-gray-500">{formatDateTime(contact.last_attempt_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">No contacts found for this instance.</div>}
            {refreshingContacts && <div className="mt-3 text-xs text-gray-400">Refreshing instance contacts...</div>}
          </div>
        </>
      )}
    </div>
  )
}
