import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAsteriskLogs, getAsteriskStatus } from '../lib/api'
import { useI18n } from '../contexts/I18nContext'

export default function Logs() {
  const [lineLimit, setLineLimit] = useState(200)
  const { t, formatTime } = useI18n()

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
    <div className="flex h-full flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('logs.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('common.status')}:{' '}
            <span className={status?.running ? 'text-green-600' : 'text-red-600'}>
              {status?.running ? t('common.running') : t('common.offline')}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">{t('common.lines')}</label>
          <select
            value={lineLimit}
            onChange={(e) => setLineLimit(parseInt(e.target.value, 10))}
            className="rounded border bg-white px-2 py-1 text-sm"
          >
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>
      </div>

      <div className="mb-3 text-xs text-gray-500">
        {isFetching
          ? t('logs.refreshing')
          : t('logs.lastUpdate', {
              time: data?.modifiedAt ? formatTime(data.modifiedAt) : '-'
            })}
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-gray-800 bg-gray-950 p-4 font-mono text-xs leading-5 whitespace-pre-wrap text-green-300">
        {isLoading && t('logs.loading')}
        {error && t('logs.failed', { message: error.message })}
        {!isLoading && !error && (logText || t('logs.empty'))}
      </div>
    </div>
  )
}
