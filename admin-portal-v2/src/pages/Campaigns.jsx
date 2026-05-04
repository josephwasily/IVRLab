import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getCampaigns, deleteCampaign, pauseCampaign, resumeCampaign, cancelCampaign } from '../lib/api'
import { useI18n } from '../contexts/I18nContext'
import {
  Plus, Trash2, Edit2, Play, Pause, Square, Phone,
  CheckCircle, XCircle, Clock, PhoneOutgoing, History, Activity, ExternalLink, Download
} from 'lucide-react'
import clsx from 'clsx'
import CampaignReportExportModal from '../components/CampaignReportExportModal'

export default function Campaigns() {
  const queryClient = useQueryClient()
  const { t, formatNumber, language } = useI18n()
  const [filterStatus, setFilterStatus] = useState('')
  const [reportCampaign, setReportCampaign] = useState(null)

  const statusConfig = {
    draft: { color: 'gray', icon: Edit2, label: t('common.draft') },
    active: { color: 'blue', icon: CheckCircle, label: t('common.active') },
    archived: { color: 'gray', icon: Clock, label: t('common.archived') }
  }

  const runStatusConfig = {
    running: { color: 'green', icon: Play, label: t('common.running') },
    paused: { color: 'yellow', icon: Pause, label: t('common.paused') },
    completed: { color: 'emerald', icon: CheckCircle, label: t('common.completed') },
    cancelled: { color: 'red', icon: XCircle, label: t('common.cancelled') },
    failed: { color: 'red', icon: XCircle, label: t('common.failed') }
  }

  const campaignTypes = {
    survey: t('campaigns.survey'),
    notification: t('campaigns.notification'),
    reminder: t('campaigns.reminder'),
    collection: t('campaigns.collection'),
    custom: t('campaigns.custom')
  }

  const labels = language === 'ar'
    ? { instances: 'حالات التشغيل', running: 'النشطة الآن', manage: 'إدارة الحملة', results: 'عرض النتائج', start: 'بدء حالة تشغيل' }
    : { instances: 'Instances', running: 'Running now', manage: 'Manage campaign', results: 'View results', start: 'Start instance' }

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['campaigns', filterStatus],
    queryFn: () => getCampaigns({ status: filterStatus || undefined })
  })

  const invalidateCampaigns = () => queryClient.invalidateQueries({ queryKey: ['campaigns'] })

  const deleteMutation = useMutation({ mutationFn: deleteCampaign, onSuccess: invalidateCampaigns })
  const pauseMutation = useMutation({ mutationFn: pauseCampaign, onSuccess: invalidateCampaigns })
  const resumeMutation = useMutation({ mutationFn: resumeCampaign, onSuccess: invalidateCampaigns })
  const cancelMutation = useMutation({ mutationFn: cancelCampaign, onSuccess: invalidateCampaigns })

  const getProgress = (campaign) => {
    if (!campaign.active_run?.total_contacts) return 0
    const done = (campaign.active_run.contacts_completed || 0) + (campaign.active_run.contacts_failed || 0)
    return Math.round((done / campaign.active_run.total_contacts) * 100)
  }

  if (isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('campaigns.title')}</h1>
          <p className="mt-1 text-gray-500">{t('campaigns.subtitle')}</p>
        </div>
        <Link to="/campaigns/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
          <Plus className="h-5 w-5" />
          {t('campaigns.newCampaign')}
        </Link>
      </div>

      <div className="mb-6 rounded-lg bg-white p-4 shadow">
        <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaigns.filterStatus')}</label>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        >
          <option value="">{t('campaigns.allCampaigns')}</option>
          <option value="draft">{t('common.draft')}</option>
          <option value="active">{t('common.active')}</option>
          <option value="archived">{t('common.archived')}</option>
        </select>
      </div>

      {campaigns?.length === 0 ? (
        <div className="rounded-lg bg-white p-12 text-center shadow">
          <PhoneOutgoing className="mx-auto mb-4 h-16 w-16 text-gray-300" />
          <h3 className="mb-2 text-lg font-medium text-gray-900">{t('campaigns.emptyTitle')}</h3>
          <p className="mb-4 text-gray-500">{t('campaigns.emptySubtitle')}</p>
          <Link to="/campaigns/new" className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
            <Plus className="h-5 w-5" />
            {t('campaigns.createCampaign')}
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((campaign) => {
            const status = statusConfig[campaign.status] || statusConfig.draft
            const StatusIcon = status.icon
            const activeRun = campaign.active_run
            const runStatus = activeRun ? runStatusConfig[activeRun.status] : null
            const RunStatusIcon = runStatus?.icon
            const progress = getProgress(campaign)

            return (
              <div key={campaign.id} className="rounded-lg bg-white p-6 shadow">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-3">
                      <h3 className="text-lg font-semibold text-gray-900">{campaign.name}</h3>
                      {runStatus ? (
                        <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', `bg-${runStatus.color}-100 text-${runStatus.color}-800`)}>
                          {RunStatusIcon && <RunStatusIcon className="h-3 w-3" />}
                          {t('campaigns.runLabel', { number: formatNumber(activeRun.run_number), status: runStatus.label })}
                        </span>
                      ) : (
                        <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium', `bg-${status.color}-100 text-${status.color}-800`)}>
                          <StatusIcon className="h-3 w-3" />
                          {status.label}
                        </span>
                      )}
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                        {campaignTypes[campaign.campaign_type] || campaign.campaign_type}
                      </span>
                    </div>

                    {campaign.description && <p className="mb-3 text-sm text-gray-500">{campaign.description}</p>}

                    <div className="flex flex-wrap items-center gap-6 text-sm text-gray-600">
                      <div className="flex items-center gap-1">
                        <Phone className="h-4 w-4 text-gray-400" />
                        {t('campaigns.ivrLabel')}: {campaign.ivr_name || t('common.notSet')}
                      </div>
                      <div className="flex items-center gap-1">
                        <History className="h-4 w-4 text-gray-400" />
                        {labels.instances}: {formatNumber(campaign.run_count)}
                      </div>
                      <div className="flex items-center gap-1">
                        <Activity className="h-4 w-4 text-gray-400" />
                        {labels.running}: {formatNumber(campaign.running_instances_count)}
                      </div>
                      {campaign.trunk_name && <div className="text-gray-400">{t('campaigns.viaLabel', { name: campaign.trunk_name })}</div>}
                    </div>

                    {activeRun?.total_contacts > 0 && (
                      <div className="mt-4">
                        <div className="mb-1 flex justify-between text-xs text-gray-500">
                          <span>{t('campaigns.processed', { done: formatNumber((activeRun.contacts_completed || 0) + (activeRun.contacts_failed || 0)), total: formatNumber(activeRun.total_contacts) })}</span>
                          <span>{formatNumber(progress)}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-gray-200">
                          <div
                            className={clsx('h-2 rounded-full transition-all', activeRun.status === 'completed' ? 'bg-green-500' : activeRun.status === 'running' ? 'bg-blue-500' : 'bg-gray-400')}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {!campaign.is_running && !campaign.is_paused && (
                      <Link to={`/campaigns/${campaign.id}/instances/new`} className="rounded-lg p-2 text-green-600 hover:bg-green-50" title={labels.start}>
                        <Play className="h-5 w-5" />
                      </Link>
                    )}
                    {campaign.is_running && (
                      <button onClick={() => pauseMutation.mutate(campaign.id)} className="rounded-lg p-2 text-yellow-600 hover:bg-yellow-50" title={t('campaigns.pauseRun')}>
                        <Pause className="h-5 w-5" />
                      </button>
                    )}
                    {campaign.is_paused && (
                      <>
                        <button onClick={() => resumeMutation.mutate(campaign.id)} className="rounded-lg p-2 text-green-600 hover:bg-green-50" title={t('campaigns.resumeRun')}>
                          <Play className="h-5 w-5" />
                        </button>
                        <button onClick={() => cancelMutation.mutate(campaign.id)} className="rounded-lg p-2 text-red-600 hover:bg-red-50" title={t('campaigns.cancelRun')}>
                          <Square className="h-5 w-5" />
                        </button>
                      </>
                    )}
                    <Link to={`/campaigns/${campaign.id}`} className="rounded-lg p-2 text-blue-600 hover:bg-blue-50" title={labels.manage}>
                      <Edit2 className="h-5 w-5" />
                    </Link>
                    <button
                      onClick={() => setReportCampaign(campaign)}
                      className="rounded-lg p-2 text-blue-600 hover:bg-blue-50"
                      title={t('campaignsExtra.exportReport')}
                    >
                      <Download className="h-5 w-5" />
                    </button>
                    <Link to={`/outbound-calls?campaign=${campaign.id}${activeRun?.id ? `&run=${activeRun.id}` : ''}`} className="rounded-lg p-2 text-gray-600 hover:bg-gray-50" title={labels.results}>
                      <ExternalLink className="h-5 w-5" />
                    </Link>
                    {!campaign.is_running && !campaign.is_paused && (
                      <button
                        onClick={() => {
                          if (confirm(t('campaigns.deleteConfirm', { name: campaign.name }))) deleteMutation.mutate(campaign.id)
                        }}
                        className="rounded-lg p-2 text-red-600 hover:bg-red-50"
                        title={t('campaigns.deleteCampaign')}
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <CampaignReportExportModal
        campaignId={reportCampaign?.id}
        campaignName={reportCampaign?.name || ''}
        open={!!reportCampaign}
        onClose={() => setReportCampaign(null)}
      />
    </div>
  )
}
