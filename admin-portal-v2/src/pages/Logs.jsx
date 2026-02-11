import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAsteriskLogs, getAsteriskStatus } from '../lib/api'

export default function Logs() {
  const [lineLimit, setLineLimit] = useState(200)

  const { data: status } = useQuery({
    queryKey: ['asterisk-status'],
    queryFn: getAsteriskStatus,
    refetchInterval: 5000,
    retry: false
  })

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['asterisk-logs', lineLimit],
    queryFn: () => getAsteriskLogs(lineLimit),
    refetchInterval: 2000,
    retry: false
  })

  const logText = useMemo(() => (data?.lines || []).join('\n'), [data?.lines])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Asterisk Live Logs</h1>
          <p className="text-sm text-gray-500 mt-1">
            Status: <span className={status?.running ? 'text-green-600' : 'text-red-600'}>
              {status?.running ? 'Running' : 'Offline'}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">Lines</label>
          <select
            value={lineLimit}
            onChange={(e) => setLineLimit(parseInt(e.target.value, 10))}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>
      </div>

      <div className="mb-3 text-xs text-gray-500">
        {isFetching ? 'Refreshing logs...' : `Last update: ${data?.modifiedAt ? new Date(data.modifiedAt).toLocaleTimeString() : '-'}`}
      </div>

      <div className="flex-1 bg-gray-950 text-green-300 rounded-lg border border-gray-800 p-4 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap">
        {isLoading && 'Loading logs...'}
        {error && `Failed to load logs: ${error.message}`}
        {!isLoading && !error && (logText || 'No log lines available.')}
      </div>
    </div>
  )
}
