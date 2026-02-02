import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { 
  getCampaigns, deleteCampaign, startCampaign, pauseCampaign, 
  resumeCampaign, cancelCampaign 
} from '../lib/api'
import { 
  Plus, Trash2, Edit2, Play, Pause, Square, Users, Phone, 
  CheckCircle, XCircle, Clock, PhoneOutgoing, History, RotateCcw
} from 'lucide-react'
import clsx from 'clsx'

const statusConfig = {
  draft: { color: 'gray', icon: Edit2, label: 'Draft' },
  active: { color: 'blue', icon: CheckCircle, label: 'Active' },
  archived: { color: 'gray', icon: Clock, label: 'Archived' }
}

const runStatusConfig = {
  running: { color: 'green', icon: Play, label: 'Running' },
  paused: { color: 'yellow', icon: Pause, label: 'Paused' },
  completed: { color: 'emerald', icon: CheckCircle, label: 'Completed' },
  cancelled: { color: 'red', icon: XCircle, label: 'Cancelled' },
  failed: { color: 'red', icon: XCircle, label: 'Failed' }
}

const campaignTypes = {
  survey: 'Survey',
  notification: 'Notification',
  reminder: 'Reminder',
  collection: 'Collection',
  custom: 'Custom'
}

export default function Campaigns() {
  const queryClient = useQueryClient()
  const [filterStatus, setFilterStatus] = useState('')

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['campaigns', filterStatus],
    queryFn: () => getCampaigns({ status: filterStatus || undefined })
  })

  const deleteMutation = useMutation({
    mutationFn: deleteCampaign,
    onSuccess: () => queryClient.invalidateQueries(['campaigns'])
  })

  const startMutation = useMutation({
    mutationFn: startCampaign,
    onSuccess: () => queryClient.invalidateQueries(['campaigns'])
  })

  const pauseMutation = useMutation({
    mutationFn: pauseCampaign,
    onSuccess: () => queryClient.invalidateQueries(['campaigns'])
  })

  const resumeMutation = useMutation({
    mutationFn: resumeCampaign,
    onSuccess: () => queryClient.invalidateQueries(['campaigns'])
  })

  const cancelMutation = useMutation({
    mutationFn: cancelCampaign,
    onSuccess: () => queryClient.invalidateQueries(['campaigns'])
  })

  const getProgress = (campaign) => {
    if (!campaign.active_run) return 0
    const run = campaign.active_run
    if (run.total_contacts === 0) return 0
    return Math.round(((run.contacts_completed + run.contacts_failed) / run.total_contacts) * 100)
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Outbound Campaigns</h1>
          <p className="text-gray-500 mt-1">Manage automated calling campaigns</p>
        </div>
        <Link
          to="/campaigns/new"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-5 h-5 mr-2" />
          New Campaign
        </Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Campaigns</option>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : campaigns?.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <PhoneOutgoing className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No campaigns yet</h3>
          <p className="text-gray-500 mb-4">Create your first outbound calling campaign.</p>
          <Link
            to="/campaigns/new"
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5 mr-2" />
            Create Campaign
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {campaigns?.map((campaign) => {
            const status = statusConfig[campaign.status] || statusConfig.draft
            const StatusIcon = status.icon
            const progress = getProgress(campaign)
            const activeRun = campaign.active_run
            const runStatus = activeRun ? runStatusConfig[activeRun.status] : null

            return (
              <div key={campaign.id} className="bg-white rounded-lg shadow p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{campaign.name}</h3>
                      {/* Show run status if running, otherwise campaign status */}
                      {runStatus ? (
                        <span className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          `bg-${runStatus.color}-100 text-${runStatus.color}-800`
                        )}>
                          <runStatus.icon className="w-3 h-3 mr-1" />
                          Run #{activeRun.run_number} - {runStatus.label}
                        </span>
                      ) : (
                        <span className={clsx(
                          'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                          `bg-${status.color}-100 text-${status.color}-800`
                        )}>
                          <StatusIcon className="w-3 h-3 mr-1" />
                          {status.label}
                        </span>
                      )}
                      <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        {campaignTypes[campaign.campaign_type]}
                      </span>
                      {campaign.run_count > 0 && (
                        <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded flex items-center">
                          <History className="w-3 h-3 mr-1" />
                          {campaign.run_count} runs
                        </span>
                      )}
                    </div>
                    
                    {campaign.description && (
                      <p className="text-gray-500 text-sm mb-3">{campaign.description}</p>
                    )}

                    <div className="flex items-center gap-6 text-sm text-gray-600">
                      <div className="flex items-center">
                        <Phone className="w-4 h-4 mr-1 text-gray-400" />
                        IVR: {campaign.ivr_name || 'Not set'}
                      </div>
                      <div className="flex items-center">
                        <Users className="w-4 h-4 mr-1 text-gray-400" />
                        {campaign.total_contacts} contacts
                      </div>
                      {campaign.trunk_name && (
                        <div className="text-gray-400">
                          via {campaign.trunk_name}
                        </div>
                      )}
                    </div>

                    {/* Progress Bar - show if there's an active run */}
                    {activeRun && activeRun.total_contacts > 0 && (
                      <div className="mt-4">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>{activeRun.contacts_completed + activeRun.contacts_failed} / {activeRun.total_contacts} processed</span>
                          <span>{progress}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div 
                            className={clsx(
                              "h-2 rounded-full transition-all",
                              activeRun.status === 'completed' ? 'bg-green-500' :
                              activeRun.status === 'running' ? 'bg-blue-500' :
                              'bg-gray-400'
                            )}
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="flex gap-4 mt-1 text-xs">
                          <span className="text-green-600">
                            ✓ {activeRun.contacts_completed} completed
                          </span>
                          <span className="text-yellow-600">
                            ⌀ {activeRun.contacts_no_answer || 0} no answer
                          </span>
                          <span className="text-red-600">
                            ✗ {activeRun.contacts_failed} failed
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 ml-4">
                    {/* Start/Re-run button - always available when not running */}
                    {!campaign.is_running && !campaign.is_paused && (
                      <button
                        onClick={() => startMutation.mutate(campaign.id)}
                        disabled={!campaign.trunk_id || campaign.total_contacts === 0}
                        className="p-2 text-green-600 hover:bg-green-50 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        title={!campaign.trunk_id ? 'Configure trunk first' : 
                               campaign.total_contacts === 0 ? 'Add contacts first' : 
                               campaign.run_count > 0 ? 'Start new run' : 'Start campaign'}
                      >
                        {campaign.run_count > 0 ? <RotateCcw className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                      </button>
                    )}

                    {/* Pause button - only when running */}
                    {campaign.is_running && (
                      <button
                        onClick={() => pauseMutation.mutate(campaign.id)}
                        className="p-2 text-yellow-600 hover:bg-yellow-50 rounded-lg"
                        title="Pause run"
                      >
                        <Pause className="w-5 h-5" />
                      </button>
                    )}

                    {/* Resume button - only when paused */}
                    {campaign.is_paused && (
                      <>
                        <button
                          onClick={() => resumeMutation.mutate(campaign.id)}
                          className="p-2 text-green-600 hover:bg-green-50 rounded-lg"
                          title="Resume run"
                        >
                          <Play className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => cancelMutation.mutate(campaign.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                          title="Cancel run"
                        >
                          <Square className="w-5 h-5" />
                        </button>
                      </>
                    )}

                    {/* Edit button - always visible */}
                    <Link
                      to={`/campaigns/${campaign.id}`}
                      className="p-2 text-gray-600 hover:bg-gray-50 rounded-lg"
                      title="Edit campaign"
                    >
                      <Edit2 className="w-5 h-5" />
                    </Link>

                    {/* Delete button - only when not running */}
                    {!campaign.is_running && !campaign.is_paused && (
                      <button
                        onClick={() => {
                          if (confirm(`Delete campaign "${campaign.name}"?`)) {
                            deleteMutation.mutate(campaign.id)
                          }
                        }}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        title="Delete campaign"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
