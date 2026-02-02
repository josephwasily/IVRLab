import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getOutboundCalls, getOutboundAnalytics, getCampaigns } from '../lib/api'
import { 
  Phone, PhoneOff, PhoneMissed, Clock, CheckCircle, XCircle, 
  AlertTriangle, BarChart3, Users, PhoneOutgoing, Loader2
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
  cancelled: { color: 'gray', icon: AlertTriangle, label: 'Cancelled' }
}

export default function OutboundCalls() {
  const [filterStatus, setFilterStatus] = useState('')
  const [filterCampaign, setFilterCampaign] = useState('')

  const { data: campaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: getCampaigns
  })

  const { data: calls, isLoading: callsLoading } = useQuery({
    queryKey: ['outbound-calls', filterStatus, filterCampaign],
    queryFn: () => getOutboundCalls({ 
      status: filterStatus || undefined,
      campaign_id: filterCampaign || undefined
    }),
    refetchInterval: 5000 // Refresh every 5 seconds
  })

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['outbound-analytics', filterCampaign],
    queryFn: () => getOutboundAnalytics({ campaign_id: filterCampaign || undefined }),
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

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Outbound Calls</h1>
          <p className="text-gray-500 mt-1">Call history and outcome analytics</p>
        </div>
      </div>

      {/* Analytics Summary */}
      {analytics?.totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-gray-900">{analytics.totals.total_calls || 0}</div>
            <div className="text-sm text-gray-500">Total Calls</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-emerald-600">{analytics.totals.completed || 0}</div>
            <div className="text-sm text-gray-500">Completed</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-orange-600">{analytics.totals.no_answer || 0}</div>
            <div className="text-sm text-gray-500">No Answer</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-yellow-600">{analytics.totals.busy || 0}</div>
            <div className="text-sm text-gray-500">Busy</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-red-600">{analytics.totals.failed || 0}</div>
            <div className="text-sm text-gray-500">Failed</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-blue-600">{analytics.totals.answer_rate || 0}%</div>
            <div className="text-sm text-gray-500">Answer Rate</div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="text-2xl font-bold text-purple-600">{formatDuration(Math.round(analytics.totals.avg_duration || 0))}</div>
            <div className="text-sm text-gray-500">Avg Duration</div>
          </div>
        </div>
      )}

      {/* Outcome Breakdown Chart */}
      {analytics?.outcomes && analytics.outcomes.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="font-medium text-gray-900 mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Call Outcomes
          </h3>
          <div className="flex gap-4 flex-wrap">
            {analytics.outcomes.map((outcome) => {
              const config = statusConfig[outcome.status] || statusConfig.queued
              const percentage = analytics.totals?.total_calls > 0 
                ? ((outcome.count / analytics.totals.total_calls) * 100).toFixed(1)
                : 0
              return (
                <div 
                  key={outcome.status} 
                  className={clsx(
                    'flex-1 min-w-[120px] p-3 rounded-lg border-2',
                    `border-${config.color}-200 bg-${config.color}-50`
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <config.icon className={`w-4 h-4 text-${config.color}-600`} />
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

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex gap-4 flex-wrap">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Statuses</option>
              {Object.entries(statusConfig).map(([value, config]) => (
                <option key={value} value={value}>{config.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Campaign</label>
            <select
              value={filterCampaign}
              onChange={(e) => setFilterCampaign(e.target.value)}
              className="rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Campaigns</option>
              <option value="none">No Campaign</option>
              {campaigns?.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Call List */}
      {callsLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      ) : calls?.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <PhoneOutgoing className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No outbound calls yet</h3>
          <p className="text-gray-500">Outbound calls will appear here when triggered.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Phone Number
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  IVR Flow
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Duration
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Hangup Cause
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Result
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Time
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {calls?.map((call) => {
                const config = statusConfig[call.status] || statusConfig.queued
                const StatusIcon = config.icon
                return (
                  <tr key={call.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Phone className="w-4 h-4 text-gray-400 mr-2" />
                        <span className="font-mono text-sm">{call.phone_number}</span>
                      </div>
                      {call.caller_id && (
                        <div className="text-xs text-gray-500">From: {call.caller_id}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={clsx(
                        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                        `bg-${config.color}-100 text-${config.color}-800`
                      )}>
                        <StatusIcon className="w-3 h-3 mr-1" />
                        {config.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {call.ivr_name || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatDuration(call.duration)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {call.hangup_cause || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {call.result && Object.keys(call.result).length > 0 ? (
                        <div className="max-w-xs overflow-hidden">
                          {Object.entries(call.result).slice(0, 3).map(([key, value]) => (
                            <div key={key} className="text-xs">
                              <span className="font-medium">{key}:</span> {value}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatTime(call.created_at)}
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
