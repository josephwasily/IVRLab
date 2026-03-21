import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { getOutboundCalls, getOutboundAnalytics, getCampaigns, getCampaignInstances } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import {
  Phone, PhoneOff, PhoneMissed, Clock, CheckCircle, XCircle,
  AlertTriangle, BarChart3, PhoneOutgoing, Loader2, History
} from 'lucide-react'
import clsx from 'clsx'

const statusConfig = {
  queued: { color: 'gray', icon: Clock, label: 'Queued' },
  dialing: { color: 'blue', icon: PhoneOutgoing, label: 'Dialing' },
  ringing: { color: 'blue', icon: Phone, label: 'Ringing' },
  answered: { color: 'green', icon: Phone, label: 'Answered' },
  completed: { color: 'emerald', icon: CheckCircle, label: 'Completed' },
  busy: { color: 'yellow', icon: PhoneOff, label: 'Busy' },
  no_answer: { color: 'orange', icon: PhoneMissed, label: 'No Answer' },
  failed: { color: 'red', icon: XCircle, label: 'Failed' },
  cancelled: { color: 'gray', icon: AlertTriangle, label: 'Cancelled' },
  abrupt_end: { color: 'rose', icon: AlertTriangle, label: 'Aborted After Answer' }
}

const filterStatusOptions = Object.entries(statusConfig).filter(([status]) => status !== 'abrupt_end')

export default function OutboundCalls() {
  const { user } = useAuth()
  const isViewer = user?.role === 'viewer'
  const [searchParams, setSearchParams] = useSearchParams()
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCampaign, setFilterCampaign] = useState(searchParams.get('campaign') || '')
  const [filterRunId, setFilterRunId] = useState(searchParams.get('run') || '')

  const { data: campaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: getCampaigns,
    enabled: !isViewer
  })

  const { data: instances } = useQuery({
    queryKey: ['campaign-instances', filterCampaign],
    queryFn: () => getCampaignInstances(filterCampaign),
    enabled: !isViewer && !!filterCampaign
  })

  useEffect(() => {
    const nextParams = {}
    if (filterCampaign) nextParams.campaign = filterCampaign
    if (filterRunId) nextParams.run = filterRunId
    setSearchParams(nextParams, { replace: true })
  }, [filterCampaign, filterRunId, setSearchParams])

  useEffect(() => {
    if (!filterCampaign) {
      if (filterRunId) setFilterRunId('')
      return
    }

    if (instances && filterRunId && !instances.some((instance) => instance.id === filterRunId)) {
      setFilterRunId('')
    }
  }, [filterCampaign, filterRunId, instances])

  const { data: calls, isLoading: callsLoading } = useQuery({
    queryKey: ['outbound-calls', filterStatus, filterCampaign, filterRunId],
    queryFn: () => getOutboundCalls({
      status: filterStatus || undefined,
      campaign_id: !isViewer ? (filterCampaign || undefined) : undefined,
      run_id: !isViewer ? (filterRunId || undefined) : undefined
    }),
    refetchInterval: 5000
  })

  const { data: analytics } = useQuery({
    queryKey: ['outbound-analytics', filterCampaign, filterRunId],
    queryFn: () => getOutboundAnalytics({
      campaign_id: filterCampaign || undefined,
      run_id: filterRunId || undefined
    }),
    refetchInterval: 10000
  })

  const formatDuration = (seconds) => {
    if (!seconds) return '-'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatTime = (dateStr) => {
    if (!dateStr) return '-'
    return new Date(dateStr).toLocaleString()
  }

  const getOutcomeLabel = (call) => {
    if (call?.status === 'completed') return 'Finished IVR'
    if (call?.status === 'cancelled') return 'Cancelled'
    if (call?.status === 'no_answer') return 'No Answer'
    if (call?.status === 'busy') return 'Busy'
    if (call?.hangup_cause === 'caller_hangup_early') return 'Answered then hung up early'
    if (call?.status === 'failed') return 'Failed'
    return '-'
  }

  const getAttemptInfo = (call) => {
    const attempt = Math.max(1, Number(call?.attempt_number || 1))
    const totalAttempts = Math.max(attempt, Number(call?.contact_attempts || 0))
    const retries = Math.max(0, totalAttempts - 1)
    return { attempt, retries }
  }

  const formatResultValue = (value) => {
    if (value === null || value === undefined || value === '') return ''
    if (typeof value === 'object') {
      if (value.value !== undefined) return String(value.value)
      return Object.values(value).map((item) => String(item)).join(' / ')
    }
    return String(value)
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Outbound Calls</h1>
          <p className="mt-1 text-gray-500">Call history and analytics by campaign instance</p>
        </div>
      </div>

      {analytics?.totals && (
        <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-9">
          {[
            ['text-gray-900', analytics.totals.total_calls || 0, 'Total Calls'],
            ['text-emerald-600', analytics.totals.completed || 0, 'Completed'],
            ['text-orange-600', analytics.totals.no_answer || 0, 'No Answer'],
            ['text-yellow-600', analytics.totals.busy || 0, 'Busy'],
            ['text-red-600', analytics.totals.failed || 0, 'Failed'],
            ['text-rose-600', analytics.totals.abrupt_ended || 0, 'Aborted After Answer'],
            ['text-gray-600', analytics.totals.cancelled || 0, 'Cancelled'],
            ['text-blue-600', `${analytics.totals.answer_rate || 0}%`, 'Answer Rate'],
            ['text-purple-600', formatDuration(Math.round(analytics.totals.avg_duration || 0)), 'Avg Duration']
          ].map(([color, value, label]) => (
            <div key={label} className="rounded-lg bg-white p-4 shadow">
              <div className={clsx('text-2xl font-bold', color)}>{value}</div>
              <div className="text-sm text-gray-500">{label}</div>
            </div>
          ))}
        </div>
      )}

      {analytics?.outcomes?.length > 0 && (
        <div className="mb-6 rounded-lg bg-white p-6 shadow">
          <h3 className="mb-4 flex items-center gap-2 font-medium text-gray-900">
            <BarChart3 className="h-5 w-5" />
            Call Outcomes
          </h3>
          <div className="flex flex-wrap gap-4">
            {analytics.outcomes.map((outcome) => {
              const config = statusConfig[outcome.status] || statusConfig.queued
              const percentage = analytics.totals?.total_calls > 0 ? ((outcome.count / analytics.totals.total_calls) * 100).toFixed(1) : 0
              return (
                <div key={outcome.status} className={clsx('min-w-[120px] flex-1 rounded-lg border-2 p-3', `border-${config.color}-200 bg-${config.color}-50`)}>
                  <div className="mb-1 flex items-center gap-2">
                    <config.icon className={`h-4 w-4 text-${config.color}-600`} />
                    <span className="text-sm font-medium text-gray-700">{config.label}</span>
                  </div>
                  <div className="text-xl font-bold text-gray-900">{outcome.count}</div>
                  <div className="text-xs text-gray-500">{percentage}%</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="mb-6 rounded-lg bg-white p-4 shadow">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
              <option value="">All Statuses</option>
              {filterStatusOptions.map(([value, config]) => (
                <option key={value} value={value}>{config.label}</option>
              ))}
            </select>
          </div>
          {!isViewer && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Campaign</label>
              <select
                value={filterCampaign}
                onChange={(e) => {
                  setFilterCampaign(e.target.value)
                  setFilterRunId('')
                }}
                className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="">All Campaigns</option>
                {campaigns?.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
                ))}
              </select>
            </div>
          )}
          {!isViewer && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Instance</label>
              <select
                value={filterRunId}
                onChange={(e) => setFilterRunId(e.target.value)}
                disabled={!filterCampaign}
                className="rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 disabled:bg-gray-100"
              >
                <option value="">All Instances</option>
                {instances?.map((instance) => (
                  <option key={instance.id} value={instance.id}>{`Run #${instance.run_number} - ${formatTime(instance.started_at)}`}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {callsLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      ) : calls?.length === 0 ? (
        <div className="rounded-lg bg-white p-12 text-center shadow">
          <PhoneOutgoing className="mx-auto mb-4 h-16 w-16 text-gray-300" />
          <h3 className="mb-2 text-lg font-medium text-gray-900">No outbound calls yet</h3>
          <p className="text-gray-500">Outbound calls will appear here when a campaign instance starts.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg bg-white shadow">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Phone Number', 'Status', 'Campaign', 'Instance', 'IVR Flow', 'Attempt', 'Duration', 'Result', 'Time'].map((label) => (
                  <th key={label} className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {calls.map((call) => {
                const displayStatus = call.status === 'failed' && call.hangup_cause === 'caller_hangup_early' ? 'abrupt_end' : call.status
                const config = statusConfig[displayStatus] || statusConfig.queued
                const StatusIcon = config.icon
                const attemptInfo = getAttemptInfo(call)
                return (
                  <tr key={call.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="flex items-center">
                        <Phone className="mr-2 h-4 w-4 text-gray-400" />
                        <span className="font-mono text-sm">{call.phone_number}</span>
                      </div>
                      {call.caller_id && <div className="text-xs text-gray-500">From: {call.caller_id}</div>}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className={clsx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', `bg-${config.color}-100 text-${config.color}-800`)}>
                        <StatusIcon className="mr-1 h-3 w-3" />
                        {config.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{call.campaign_name || '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {call.run_number ? (
                        <div>
                          <div className="flex items-center gap-1 font-medium">
                            <History className="h-4 w-4 text-gray-400" />
                            {`Run #${call.run_number}`}
                          </div>
                          <div className="text-xs text-gray-500">{formatTime(call.run_started_at)}</div>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{call.ivr_name || '-'}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                      #{attemptInfo.attempt}
                      {attemptInfo.retries > 0 && <div className="text-xs text-gray-500">Retries: {attemptInfo.retries}</div>}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{formatDuration(call.duration)}</td>
                    <td className="px-6 py-4 text-sm">
                      <div className="max-w-xs overflow-hidden">
                        <div className="text-xs font-medium text-gray-700">{getOutcomeLabel(call)}</div>
                        {call.result && typeof call.result === 'object' && Object.keys(call.result).length > 0 && (
                          <div className="text-xs text-gray-500">
                            {Object.entries(call.result)
                              .filter(([key]) => !['call_outcome', 'flow_final_status'].includes(key))
                              .slice(0, 2)
                              .map(([key, value]) => `${key}: ${formatResultValue(value)}`)
                              .join(' | ')}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                      {formatTime(call.created_at)}
                      {call.campaign_id && call.run_id && (
                        <div className="mt-1">
                          <Link to={`/campaigns/${call.campaign_id}`} className="text-xs text-blue-600 hover:text-blue-700">
                            Open campaign
                          </Link>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
