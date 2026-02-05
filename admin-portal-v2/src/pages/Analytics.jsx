import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCallLogs, getHourlyCalls, getIVRs } from '../lib/api'
import { Phone, PhoneOff, Clock, ChevronDown, ChevronUp, Filter } from 'lucide-react'
import clsx from 'clsx'

const statusColors = {
  completed: 'bg-green-100 text-green-800',
  answered: 'bg-blue-100 text-blue-800',
  failed: 'bg-red-100 text-red-800',
  no_answer: 'bg-yellow-100 text-yellow-800'
}

export default function Analytics() {
  const [expandedRows, setExpandedRows] = useState(new Set())
  const [selectedIvrId, setSelectedIvrId] = useState('')
  
  // Fetch IVR list for filter dropdown
  const { data: ivrs } = useQuery({
    queryKey: ['ivrs'],
    queryFn: getIVRs
  })

  const { data: calls, isLoading } = useQuery({
    queryKey: ['call-logs', selectedIvrId],
    queryFn: () => getCallLogs({ limit: 50, ivrId: selectedIvrId || undefined })
  })

  const { data: hourly } = useQuery({
    queryKey: ['hourly-calls'],
    queryFn: () => getHourlyCalls(24)
  })

  const toggleRow = (id) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const hasVariables = (call) => {
    return call.variables && Object.keys(call.variables).length > 0
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Analytics</h1>

      {/* Hourly chart placeholder */}
      {hourly && hourly.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Calls Last 24 Hours</h2>
          <div className="h-32 flex items-end space-x-2">
            {hourly.map((item, i) => {
              const maxCount = Math.max(...hourly.map(h => h.count))
              const height = maxCount > 0 ? (item.count / maxCount) * 100 : 0
              return (
                <div
                  key={i}
                  className="flex-1 bg-blue-500 rounded-t"
                  style={{ height: `${height}%`, minHeight: item.count > 0 ? '4px' : '0' }}
                  title={`${item.hour}: ${item.count} calls`}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Call logs table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Calls</h2>
          
          {/* IVR Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={selectedIvrId}
              onChange={(e) => setSelectedIvrId(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All IVR Flows</option>
              {ivrs?.map((ivr) => (
                <option key={ivr.id} value={ivr.id}>
                  {ivr.name} ({ivr.extension})
                </option>
              ))}
            </select>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : calls?.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Phone className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>No calls yet</p>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase w-8"></th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Caller</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IVR</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Extension</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {calls?.map((call) => (
                <>
                  <tr 
                    key={call.id} 
                    className={clsx(
                      'hover:bg-gray-50',
                      hasVariables(call) && 'cursor-pointer'
                    )}
                    onClick={() => hasVariables(call) && toggleRow(call.id)}
                  >
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {hasVariables(call) && (
                        expandedRows.has(call.id) 
                          ? <ChevronUp className="w-4 h-4" />
                          : <ChevronDown className="w-4 h-4" />
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">{call.caller_id || 'Unknown'}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{call.ivr_name || '-'}</td>
                    <td className="px-6 py-4 text-sm font-mono text-gray-600">{call.extension}</td>
                    <td className="px-6 py-4">
                      <span className={clsx(
                        'px-2 py-1 rounded-full text-xs font-medium',
                        statusColors[call.status] || 'bg-gray-100 text-gray-800'
                      )}>
                        {call.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {call.duration ? `${call.duration}s` : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {call.start_time ? new Date(call.start_time).toLocaleString() : '-'}
                    </td>
                  </tr>
                  {expandedRows.has(call.id) && hasVariables(call) && (
                    <tr key={`${call.id}-vars`} className="bg-gray-50">
                      <td colSpan={7} className="px-6 py-4">
                        <div className="text-sm">
                          <h4 className="font-medium text-gray-700 mb-2">Call Variables</h4>
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {Object.entries(call.variables).map(([key, data]) => (
                              <div key={key} className="bg-white rounded p-3 border">
                                <span className="text-xs text-gray-500 block">
                                  {typeof data === 'object' && data.label ? data.label : key}
                                </span>
                                <span className="font-medium text-gray-900">
                                  {typeof data === 'object' && data.value !== undefined 
                                    ? String(data.value) 
                                    : String(data)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
