import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Download, X } from 'lucide-react'
import {
  getCampaignReportCaptures,
  downloadCampaignReportXlsx
} from '../lib/api'
import { useI18n } from '../contexts/I18nContext'

function firstOfMonth(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1)
  return d
}

function toIsoDate(date) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export default function CampaignReportExportModal({
  campaignId,
  campaignName,
  open,
  onClose
}) {
  const { t, language } = useI18n()
  const [selected, setSelected] = useState(new Set())
  const [from, setFrom] = useState(toIsoDate(firstOfMonth()))
  const [to, setTo] = useState(toIsoDate(new Date()))
  const [digitRange, setDigitRange] = useState('1-5')
  const [isDownloading, setIsDownloading] = useState(false)
  const [error, setError] = useState(null)

  const { data: captures, isLoading, isError } = useQuery({
    queryKey: ['campaign-report-captures', campaignId],
    queryFn: () => getCampaignReportCaptures(campaignId),
    enabled: open
  })

  useEffect(() => {
    if (captures) {
      setSelected(new Set(captures.map((c) => c.nodeId)))
    }
  }, [captures])

  const [digitMin, digitMax] = useMemo(() => {
    const [a, b] = digitRange.split('-').map((n) => parseInt(n, 10))
    return [a, b]
  }, [digitRange])

  if (!open) return null

  const labelFor = (cap) =>
    (language === 'ar' ? cap.labelAr || cap.labelEn : cap.labelEn || cap.labelAr) || cap.variable

  const toggle = (nodeId) => {
    const next = new Set(selected)
    if (next.has(nodeId)) next.delete(nodeId)
    else next.add(nodeId)
    setSelected(next)
  }

  const canExport =
    !isLoading && !isError && selected.size > 0 && from && to && from <= to && !isDownloading

  const handleExport = async () => {
    setError(null)
    if (selected.size === 0) {
      setError(t('campaignReport.noSelection'))
      return
    }
    try {
      setIsDownloading(true)
      const blob = await downloadCampaignReportXlsx(campaignId, {
        from,
        to,
        captures: Array.from(selected).join(','),
        digitMin,
        digitMax,
        language
      })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      const safeName = (campaignName || 'campaign').replace(/[^A-Za-z0-9._-]+/g, '_')
      link.download = `${safeName}-report-${from}-to-${to}.xlsx`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      onClose()
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Export failed')
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h3 className="text-lg font-semibold text-gray-900">{t('campaignReport.modalTitle')}</h3>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <section>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              {t('campaignReport.captures')}
            </label>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> {t('common.loading')}
              </div>
            ) : !captures?.length ? (
              <p className="rounded-lg border border-dashed border-gray-200 p-3 text-sm text-gray-500">
                {t('campaignReport.empty')}
              </p>
            ) : (
              <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-2">
                {captures.map((cap) => (
                  <label key={cap.nodeId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={selected.has(cap.nodeId)}
                      onChange={() => toggle(cap.nodeId)}
                    />
                    <span className="flex-1">{labelFor(cap)}</span>
                    <span className="text-xs text-gray-400">{cap.variable}</span>
                  </label>
                ))}
              </div>
            )}
          </section>

          <section className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignReport.from')}</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-full rounded-md border-gray-300 text-sm shadow-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignReport.to')}</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full rounded-md border-gray-300 text-sm shadow-sm"
              />
            </div>
          </section>

          <section>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('campaignReport.digitRange')}</label>
            <select
              value={digitRange}
              onChange={(e) => setDigitRange(e.target.value)}
              className="w-full rounded-md border-gray-300 text-sm shadow-sm"
            >
              <option value="1-5">1-5</option>
              <option value="1-6">1-6</option>
              <option value="1-9">1-9</option>
            </select>
          </section>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            {t('campaignReport.cancel')}
          </button>
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isDownloading
              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('campaignReport.exporting')}</>
              : <><Download className="mr-2 h-4 w-4" />{t('campaignReport.export')}</>}
          </button>
        </div>
      </div>
    </div>
  )
}
