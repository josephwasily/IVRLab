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
import { ArrowLeft, Save, Loader2, Pause, Play, Square, ExternalLink, Key, Copy, RefreshCw, Download } from 'lucide-react'
import clsx from 'clsx'
import CampaignReportExportModal from '../components/CampaignReportExportModal'
import CampaignInstanceForm from '../components/CampaignInstanceForm'
import { useI18n } from '../contexts/I18nContext'

const campaignTypeKeys = ['survey', 'notification', 'reminder', 'collection', 'custom']

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
  const [reportModalOpen, setReportModalOpen] = useState(false)
  const { t } = useI18n()

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
          <h1 className="text-2xl font-bold text-gray-900">{isNew ? t('campaignEdit.newCampaign') : campaign?.name}</h1>
          {campaign && <p className="text-sm text-gray-500">{t('campaignEdit.managedHere')}</p>}
        </div>
        {!isNew && instances?.length > 0 && (
          <button
            onClick={() => setReportModalOpen(true)}
            className="inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100"
          >
            <Download className="mr-2 h-4 w-4" />
            {t('campaignReport.exportButton')}
          </button>
        )}
        {isEditable && (
          <button onClick={() => saveMutation.mutate(formData)} disabled={saveMutation.isLoading || !formData.name || !formData.ivr_id} className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">
            {saveMutation.isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Save className="mr-2 h-5 w-5" />}
            {t('campaignEdit.save')}
          </button>
        )}
      </div>

      {!isNew && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-lg bg-white p-4 shadow"><div className="text-sm text-gray-500">{t('campaignEdit.totalInstances')}</div><div className="mt-1 text-2xl font-bold text-gray-900">{instances?.length || 0}</div></div>
            <div className="rounded-lg bg-white p-4 shadow"><div className="text-sm text-gray-500">{t('campaignEdit.runningInstances')}</div><div className="mt-1 text-2xl font-bold text-green-600">{instances?.filter((instance) => instance.status === 'running').length || 0}</div></div>
            <div className="rounded-lg bg-white p-4 shadow"><div className="text-sm text-gray-500">{t('campaignEdit.latestInstance')}</div><div className="mt-1 text-sm font-medium text-gray-900">{instances?.[0] ? t('campaignEdit.runHash', { number: instances[0].run_number }) : t('campaignEdit.noRuns')}</div><div className="text-xs text-gray-500">{instances?.[0] ? formatDateTime(instances[0].started_at) : t('campaignEdit.startFromWizard')}</div></div>
          </div>

          <div className="mb-6">
            <CampaignInstanceForm campaign={campaign} instances={instances} />
          </div>
        </>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-6 shadow">
          <h3 className="mb-4 font-medium text-gray-900">{t('campaignEdit.details')}</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.campaignName')} *</label>
              <input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.description')}</label>
              <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} disabled={!isEditable} rows={2} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.campaignType')}</label>
              <select value={formData.campaign_type} onChange={(e) => setFormData({ ...formData, campaign_type: e.target.value })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100">
                {campaignTypeKeys.map((key) => <option key={key} value={key}>{t(`campaigns.${key}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.ivrFlow')} *</label>
              <select value={formData.ivr_id} onChange={(e) => setFormData({ ...formData, ivr_id: e.target.value })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100">
                <option value="">{t('campaignEdit.selectIvr')}</option>
                {ivrFlows?.filter((flow) => flow.status === 'active').map((flow) => <option key={flow.id} value={flow.id}>{flow.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <h3 className="mb-4 font-medium text-gray-900">{t('campaignEdit.dialing')}</h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.sipTrunk')} *</label>
              <select value={formData.trunk_id} onChange={(e) => setFormData({ ...formData, trunk_id: e.target.value })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100">
                <option value="">{t('campaignEdit.selectTrunk')}</option>
                {trunks?.filter((trunk) => trunk.status === 'active').map((trunk) => <option key={trunk.id} value={trunk.id}>{trunk.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.callerId')}</label>
              <input value={formData.caller_id} onChange={(e) => setFormData({ ...formData, caller_id: e.target.value })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.maxConcurrent')}</label>
                <input type="number" min="1" value={formData.max_concurrent_calls} onChange={(e) => setFormData({ ...formData, max_concurrent_calls: parseInt(e.target.value, 10) || 1 })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.retryAttempts')}</label>
                <input type="number" min="0" value={formData.max_attempts} onChange={(e) => setFormData({ ...formData, max_attempts: parseInt(e.target.value, 10) || 0 })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.retryDelay')}</label>
              <input type="number" min="1" value={formData.retry_delay_minutes} onChange={(e) => setFormData({ ...formData, retry_delay_minutes: parseInt(e.target.value, 10) || 1 })} disabled={!isEditable} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100" />
            </div>
          </div>
        </div>
      </div>

      {!isNew && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg bg-white p-6 shadow">
            <h3 className="mb-4 flex items-center gap-2 font-medium text-gray-900"><Key className="h-4 w-4" />{t('campaignEdit.webhookIntegration')}</h3>
            <p className="mb-4 text-sm text-gray-500">{t('campaignEdit.webhookSubtitle')}</p>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.apiKey')}</label>
                {campaign?.webhook_api_key ? (
                  <div className="flex items-center gap-2">
                    <input readOnly value={campaign.webhook_api_key} className="flex-1 rounded-md border-gray-300 bg-gray-50 font-mono text-xs shadow-sm" />
                    <button onClick={() => copyToClipboard(campaign.webhook_api_key, 'apiKey')} className="rounded-md border border-gray-300 p-2 hover:bg-gray-50" title={t('campaignEdit.copy')}>
                      <Copy className="h-4 w-4 text-gray-500" />
                    </button>
                    <button onClick={() => apiKeyMutation.mutate()} disabled={apiKeyMutation.isLoading} className="rounded-md border border-gray-300 p-2 hover:bg-gray-50" title={t('campaignEdit.regenerate')}>
                      <RefreshCw className={clsx('h-4 w-4 text-gray-500', apiKeyMutation.isLoading && 'animate-spin')} />
                    </button>
                  </div>
                ) : (
                  <button onClick={() => apiKeyMutation.mutate()} disabled={apiKeyMutation.isLoading} className="inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-700 hover:bg-blue-100">
                    {apiKeyMutation.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Key className="mr-2 h-4 w-4" />}
                    {t('campaignEdit.generateApiKey')}
                  </button>
                )}
                {copiedField === 'apiKey' && <p className="mt-1 text-xs text-green-600">{t('campaignEdit.copied')}</p>}
              </div>
              {campaign?.webhook_api_key && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.triggerUrl')}</label>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-700">POST /api/webhooks/campaigns/{id}/trigger</code>
                      <button onClick={() => copyToClipboard(`${window.location.origin}/api/webhooks/campaigns/${id}/trigger`, 'triggerUrl')} className="rounded-md border border-gray-300 p-2 hover:bg-gray-50">
                        <Copy className="h-4 w-4 text-gray-500" />
                      </button>
                    </div>
                    {copiedField === 'triggerUrl' && <p className="mt-1 text-xs text-green-600">{t('campaignEdit.copied')}</p>}
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.resultsUrl')}</label>
                    <code className="block rounded-md bg-gray-100 px-3 py-2 text-xs text-gray-700">GET /api/webhooks/campaigns/{id}/runs/{'<run_id>'}/results</code>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="rounded-lg bg-white p-6 shadow">
            <h3 className="mb-4 font-medium text-gray-900">{t('campaignEdit.flagConfig')}</h3>
            <p className="mb-4 text-sm text-gray-500">{t('campaignEdit.flagSubtitle')}</p>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.flagVariable')}</label>
                <input value={formData.flag_variable} onChange={(e) => setFormData({ ...formData, flag_variable: e.target.value })} placeholder="confirm_payment" className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                <p className="mt-1 text-xs text-gray-400">{t('campaignEdit.flagVariableHelp')}</p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignEdit.flagValue')}</label>
                <input value={formData.flag_value} onChange={(e) => setFormData({ ...formData, flag_value: e.target.value })} placeholder="1" className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                <p className="mt-1 text-xs text-gray-400">{t('campaignEdit.flagValueHelp')}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isNew && (
        <>
          <div className="mt-6 rounded-lg bg-white p-6 shadow">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-medium text-gray-900">{t('campaignEdit.instanceHistory')}</h3>
                <p className="mt-1 text-sm text-gray-500">{t('campaignEdit.instanceHistorySub')}</p>
              </div>
              <div className="flex gap-2">
                {activeInstance?.status === 'running' && <button onClick={() => pauseMutation.mutate()} className="inline-flex items-center rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-sm text-yellow-700 hover:bg-yellow-100"><Pause className="mr-2 h-4 w-4" />{t('campaignEdit.pause')}</button>}
                {activeInstance?.status === 'paused' && <button onClick={() => resumeMutation.mutate()} className="inline-flex items-center rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 hover:bg-green-100"><Play className="mr-2 h-4 w-4" />{t('campaignEdit.resume')}</button>}
                {activeInstance?.status === 'paused' && <button onClick={() => cancelMutation.mutate()} className="inline-flex items-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100"><Square className="mr-2 h-4 w-4" />{t('campaignEdit.cancel')}</button>}
              </div>
            </div>

            {instances?.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead><tr className="border-b">{[t('campaignEdit.tableInstance'), t('campaignEdit.tableStatus'), t('campaignEdit.tableContacts'), t('campaignEdit.tableCompleted'), t('campaignEdit.tableFailed'), t('campaignEdit.tableStarted'), t('campaignEdit.tableResultsUrl'), t('campaignEdit.tableActions')].map((label) => <th key={label} className="px-2 py-2 text-left">{label}</th>)}</tr></thead>
                  <tbody>
                    {instances.map((instance) => (
                      <tr key={instance.id} className={clsx('border-b hover:bg-gray-50', selectedInstanceId === instance.id && 'bg-blue-50')}>
                        <td className="px-2 py-3 font-medium">{t('campaignEdit.runHash', { number: instance.run_number })}</td>
                        <td className="px-2 py-3"><span className={clsx('rounded-full px-2 py-1 text-xs font-medium', instanceStatusClasses[instance.status] || 'bg-gray-100 text-gray-700')}>{t(`common.${instance.status}`)}</span></td>
                        <td className="px-2 py-3">{instance.total_contacts || 0}</td>
                        <td className="px-2 py-3 text-green-600">{instance.contacts_completed || 0}</td>
                        <td className="px-2 py-3 text-red-600">{instance.contacts_failed || 0}</td>
                        <td className="px-2 py-3 text-gray-500">{formatDateTime(instance.started_at)}</td>
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-1">
                            <code className="max-w-[200px] truncate rounded bg-gray-100 px-2 py-1 text-[10px] text-gray-600" title={`${window.location.origin}/api/webhooks/campaigns/${id}/runs/${instance.id}/results`}>
                              /api/webhooks/campaigns/{id}/runs/{instance.id}/results
                            </code>
                            <button onClick={() => copyToClipboard(`${window.location.origin}/api/webhooks/campaigns/${id}/runs/${instance.id}/results`, `resultsUrl-${instance.id}`)} className="shrink-0 rounded border border-gray-200 p-1 hover:bg-gray-50" title={t('campaignEdit.copy')}>
                              <Copy className="h-3 w-3 text-gray-500" />
                            </button>
                            {copiedField === `resultsUrl-${instance.id}` && <span className="text-[10px] text-green-600">{t('campaignEdit.copied')}</span>}
                          </div>
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => setSelectedInstanceId(instance.id)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">{t('campaignEdit.viewContacts')}</button>
                            <Link to={`/outbound-calls?campaign=${id}&run=${instance.id}`} className="inline-flex items-center rounded-lg border border-blue-200 px-3 py-1.5 text-xs text-blue-700 hover:bg-blue-50"><ExternalLink className="mr-1 h-3 w-3" />{t('campaignEdit.callHistory')}</Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">{t('campaignEdit.noInstances')}</div>}
            {refreshingInstances && <div className="mt-3 text-xs text-gray-400">{t('campaignEdit.refreshing')}</div>}
          </div>

          <div className="mt-6 rounded-lg bg-white p-6 shadow">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="font-medium text-gray-900">{t('campaignEdit.instanceContacts')}</h3>
                <p className="mt-1 text-sm text-gray-500">{selectedInstance ? t('campaignEdit.contactsForRun', { number: selectedInstance.run_number }) : t('campaignEdit.selectInstance')}</p>
              </div>
              {selectedInstance && (
                <div className="flex gap-2">
                  <button onClick={() => refetchContacts()} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">{t('campaignEdit.refreshContacts')}</button>
                  <Link to={`/outbound-calls?campaign=${id}&run=${selectedInstance.id}`} className="inline-flex items-center rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50"><ExternalLink className="mr-2 h-4 w-4" />{t('campaignEdit.viewCallHistory')}</Link>
                </div>
              )}
            </div>

            {!selectedInstance ? (
              <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">{t('campaignEdit.selectInstanceEmpty')}</div>
            ) : instanceContacts?.contacts?.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b bg-gray-50"><tr>{[t('campaignEdit.colPhone'), t('campaignEdit.colName'), t('campaignEdit.tableStatus'), t('campaignEdit.colAttempts'), t('campaignEdit.colOutcome'), t('campaignEdit.colLastAttempt')].map((label) => <th key={label} className="px-3 py-2 text-left text-gray-600">{label}</th>)}</tr></thead>
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
            ) : <div className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-500">{t('campaignEdit.noContactsForInstance')}</div>}
            {refreshingContacts && <div className="mt-3 text-xs text-gray-400">{t('campaignEdit.refreshing2')}</div>}
          </div>
        </>
      )}
      <CampaignReportExportModal
        campaignId={id}
        campaignName={campaign?.name || ''}
        open={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
      />
    </div>
  )
}
