import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCallLogs, getCallLogsCsv, getCallSummary, getHourlyCalls, getIVRs } from '../lib/api'
import { Phone, ChevronDown, ChevronUp, Filter, Download } from 'lucide-react'
import clsx from 'clsx'

const statusColors = {
  completed: 'bg-green-100 text-green-800',
  answered: 'bg-blue-100 text-blue-800',
  failed: 'bg-red-100 text-red-800',
  no_answer: 'bg-yellow-100 text-yellow-800'
}

function toDateTimeLocalValue(date) {
  const timezoneOffsetMs = date.getTimezoneOffset() * 60 * 1000
  const localDate = new Date(date.getTime() - timezoneOffsetMs)
  return localDate.toISOString().slice(0, 16)
}

function localDateTimeToIso(value, options = {}) {
  const { endOfMinute = false } = options
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  // `datetime-local` is minute-precision. For upper-bound filters, include
  // the full selected minute so calls at HH:MM:SS are not dropped.
  if (endOfMinute) {
    date.setSeconds(59, 999)
  }
  return date.toISOString()
}

function formatHourKey(date) {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  const h = String(date.getUTCHours()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:00`
}

function buildHourlySeries(hourly, fromIso, toIso) {
  if (!fromIso || !toIso) return hourly || []
  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return hourly || []
  }

  const countsByHour = new Map((hourly || []).map((entry) => [entry.hour, Number(entry.count || 0)]))
  const cursor = new Date(from)
  cursor.setUTCMinutes(0, 0, 0)

  const end = new Date(to)
  end.setUTCMinutes(0, 0, 0)

  const series = []
  while (cursor <= end) {
    const key = formatHourKey(cursor)
    series.push({
      hour: key,
      count: countsByHour.get(key) || 0
    })
    cursor.setUTCHours(cursor.getUTCHours() + 1)
  }
  return series
}

export default function Analytics() {
  const [expandedRows, setExpandedRows] = useState(new Set())
  const [selectedIvrId, setSelectedIvrId] = useState('')
  const [fromDateTime, setFromDateTime] = useState(() => (
    toDateTimeLocalValue(new Date(Date.now() - (24 * 60 * 60 * 1000)))
  ))
  const [toDateTime, setToDateTime] = useState(() => toDateTimeLocalValue(new Date()))
  const [isExporting, setIsExporting] = useState(false)
  const defaultIvrApplied = useRef(false)
  
  // Fetch IVR list for filter dropdown
  const { data: ivrs } = useQuery({
    queryKey: ['ivrs'],
    queryFn: getIVRs
  })

  const filterParams = useMemo(() => ({
    ivrId: selectedIvrId || undefined,
    from: localDateTimeToIso(fromDateTime),
    to: localDateTimeToIso(toDateTime, { endOfMinute: true })
  }), [selectedIvrId, fromDateTime, toDateTime])

  const { data: calls, isLoading } = useQuery({
    queryKey: ['call-logs', filterParams.ivrId, filterParams.from, filterParams.to],
    queryFn: () => getCallLogs({ limit: 200, ...filterParams })
  })

  const { data: hourly } = useQuery({
    queryKey: ['hourly-calls', filterParams.ivrId, filterParams.from, filterParams.to],
    queryFn: () => getHourlyCalls(filterParams)
  })

  const { data: summary } = useQuery({
    queryKey: ['calls-summary', filterParams.ivrId, filterParams.from, filterParams.to],
    queryFn: () => getCallSummary(filterParams)
  })

  useEffect(() => {
    if (!ivrs?.length || defaultIvrApplied.current) return

    const billingFlow = ivrs.find((ivr) => (
      ivr.id === 'billing-inquiry-flow'
      || ivr.extension === '2010'
      || (ivr.name || '').toLowerCase().includes('billing invoice inquiry')
    ))

    if (billingFlow) {
      setSelectedIvrId(billingFlow.id)
    }
    defaultIvrApplied.current = true
  }, [ivrs])

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

  const getVariableValue = (call, key) => {
    const variable = call?.variables?.[key]
    if (variable && typeof variable === 'object' && variable.value !== undefined) {
      return variable.value
    }
    return variable
  }

  const formatCellValue = (value) => {
    if (value === null || value === undefined || value === '') return '-'
    if (typeof value === 'object') {
      if (value.value !== undefined) return String(value.value)
      if (Array.isArray(value)) return value.map((item) => String(item)).join(', ')
      const flattened = Object.values(value).filter((item) => item !== null && item !== undefined && item !== '')
      if (flattened.length === 0) return '-'
      return flattened.map((item) => String(item)).join(' | ')
    }
    return String(value)
  }

  const getAccountNumber = (call) => {
    return getVariableValue(call, 'account_number')
  }

  const getBalance = (call) => {
    return (
      getVariableValue(call, 'total_amount')
      ?? getVariableValue(call, 'balance')
      ?? getVariableValue(call, 'balance_amount')
    )
  }

  const handleExportCsv = async () => {
    try {
      setIsExporting(true)
      const blob = await getCallLogsCsv(filterParams)
      const dateStamp = new Date().toISOString().slice(0, 10)
      const filename = `analytics-calls-${selectedIvrId || 'all'}-${dateStamp}.csv`
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      // Keep UI non-blocking; errors are logged for debugging.
      console.error('Failed to export analytics CSV:', error)
    } finally {
      setIsExporting(false)
    }
  }

  const hourlySeries = useMemo(() => {
    return buildHourlySeries(hourly || [], filterParams.from, filterParams.to)
  }, [hourly, filterParams.from, filterParams.to])

  const maxHourlyCount = Math.max(1, ...hourlySeries.map((item) => Number(item.count || 0)))
  const totalCalls = summary?.totalCalls || 0
  const totalChartHeight = totalCalls > 0
    ? Math.min(100, 20 + (Math.log10(totalCalls + 1) * 35))
    : 0

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Analytics</h1>

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex items-center gap-2 min-w-[220px]">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={selectedIvrId}
              onChange={(e) => setSelectedIvrId(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All IVR Flows</option>
              {ivrs?.map((ivr) => (
                <option key={ivr.id} value={ivr.id}>
                  {ivr.name} ({ivr.extension})
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[220px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input
              type="datetime-local"
              value={fromDateTime}
              onChange={(e) => setFromDateTime(e.target.value)}
              max={toDateTime}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="min-w-[220px]">
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input
              type="datetime-local"
              value={toDateTime}
              onChange={(e) => setToDateTime(e.target.value)}
              min={fromDateTime}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div className="ml-auto">
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={isExporting}
              className={clsx(
                'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isExporting
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              )}
            >
              <Download className="w-4 h-4" />
              {isExporting ? 'Exporting...' : 'Export CSV'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Total Calls</h2>
          <div className="h-40 flex items-end justify-center">
            <div className="w-24 bg-blue-500 rounded-t transition-all" style={{ height: `${totalChartHeight}%` }} />
          </div>
          <p className="text-center text-3xl font-bold text-gray-900 mt-4">{totalCalls}</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Hourly Call Count</h2>
          <div className="h-40 flex items-end gap-1">
            {hourlySeries.length === 0 ? (
              <div className="w-full text-center text-sm text-gray-500 py-10">No data in selected range</div>
            ) : (
              hourlySeries.map((item, index) => {
                const height = maxHourlyCount > 0 ? (item.count / maxHourlyCount) * 100 : 0
                return (
                  <div
                    key={`${item.hour}-${index}`}
                    className="flex-1 bg-blue-500 rounded-t"
                    style={{ height: `${height}%`, minHeight: item.count > 0 ? '4px' : '0' }}
                    title={`${item.hour}: ${item.count} calls`}
                  />
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Call logs table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Recent Calls</h2>
          <span className="text-sm text-gray-500">{calls?.length || 0} rows</span>
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Account Number</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Balance</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">IVR</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Extension</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {calls?.map((call) => (
                <Fragment key={call.id}>
                  <tr 
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
                    <td className="px-6 py-4 text-sm font-mono text-gray-700">{formatCellValue(getAccountNumber(call))}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{formatCellValue(getBalance(call))}</td>
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
                    <tr className="bg-gray-50">
                      <td colSpan={9} className="px-6 py-4">
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
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
