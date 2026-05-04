import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import {
  createCampaignInstanceFromUpload,
  createCampaignInstanceManual,
  downloadCampaignContactsTemplate
} from '../lib/api'
import {
  Upload, Users, Loader2, FileSpreadsheet, Trash2,
  Plus, Download, ExternalLink, Play
} from 'lucide-react'
import clsx from 'clsx'
import { useI18n } from '../contexts/I18nContext'

export default function CampaignInstanceForm({ campaign, instances }) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)
  const campaignId = campaign?.id

  const [mode, setMode] = useState('csv')
  const [file, setFile] = useState(null)
  const [csvHeaders, setCsvHeaders] = useState([])
  const [phoneColumn, setPhoneColumn] = useState('')
  const [manualContacts, setManualContacts] = useState([{ phone_number: '', name: '' }])
  const [notice, setNotice] = useState(null)
  const [createdRunId, setCreatedRunId] = useState(null)

  const activeInstance = instances?.find((instance) => ['running', 'paused'].includes(instance.status)) || null
  const canCreate = !!campaign?.trunk_id && !!campaign?.ivr_id && !activeInstance

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] })
    queryClient.invalidateQueries({ queryKey: ['campaign-instances', campaignId] })
    queryClient.invalidateQueries({ queryKey: ['outbound-calls'] })
    queryClient.invalidateQueries({ queryKey: ['outbound-analytics'] })
  }

  const uploadMutation = useMutation({
    mutationFn: () => createCampaignInstanceFromUpload(campaignId, file, { phone_column: phoneColumn }),
    onSuccess: (data) => {
      setCreatedRunId(data.run_id)
      setNotice({ success: true, message: t('instanceWizard.createSuccess', { number: data.run_number, count: data.imported }) })
      setFile(null)
      setCsvHeaders([])
      setPhoneColumn('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      invalidateAll()
    },
    onError: (error) => {
      setNotice({ success: false, message: t('instanceWizard.createFailed', { message: error.response?.data?.error || error.message || '' }) })
    }
  })

  const manualMutation = useMutation({
    mutationFn: (contacts) => createCampaignInstanceManual(campaignId, contacts),
    onSuccess: (data) => {
      setCreatedRunId(data.run_id)
      setNotice({ success: true, message: t('instanceWizard.createSuccess', { number: data.run_number, count: data.imported }) })
      setManualContacts([{ phone_number: '', name: '' }])
      invalidateAll()
    },
    onError: (error) => {
      setNotice({ success: false, message: t('instanceWizard.createFailed', { message: error.response?.data?.error || error.message || '' }) })
    }
  })

  const onFileChange = (event) => {
    const nextFile = event.target.files?.[0]
    if (!nextFile) return
    setNotice(null)
    setFile(nextFile)
    const reader = new FileReader()
    const lowerName = nextFile.name.toLowerCase()
    const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')
    reader.onload = (loadEvent) => {
      let headers = []
      try {
        if (isExcel) {
          const data = new Uint8Array(loadEvent.target?.result || new ArrayBuffer(0))
          const workbook = XLSX.read(data, { type: 'array' })
          const sheetName = workbook.SheetNames[0]
          const sheet = sheetName ? workbook.Sheets[sheetName] : null
          if (sheet) {
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
            headers = (rows[0] || []).map((value) => String(value || '').trim()).filter(Boolean)
          }
        } else {
          const firstLine = String(loadEvent.target?.result || '').split(/\r?\n/)[0] || ''
          headers = firstLine.split(',').map((value) => value.replace(/^"|"$/g, '').trim()).filter(Boolean)
        }
      } catch (error) {
        setNotice({ success: false, message: t('instanceWizard.readFileFailed', { message: error.message }) })
      }
      setCsvHeaders(headers)
      setPhoneColumn(headers.find((header) => /phone|mobile|number|tel/i.test(header)) || '')
    }
    if (isExcel) reader.readAsArrayBuffer(nextFile)
    else reader.readAsText(nextFile)
  }

  const onDownloadTemplate = async () => {
    try {
      const blob = await downloadCampaignContactsTemplate(campaignId)
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${campaign?.name || 'campaign'}-contacts-template.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      setNotice({ success: false, message: t('instanceWizard.downloadFailed', { message: error.response?.data?.error || error.message || '' }) })
    }
  }

  const onManualPaste = (text) => {
    const contacts = text
      .split(/[\n,;]+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[-–]/).map((part) => part.trim())
        if (parts.length === 2) {
          const [first, second] = parts
          const firstDigits = (first.match(/\d/g) || []).length
          const secondDigits = (second.match(/\d/g) || []).length
          return firstDigits > secondDigits ? { phone_number: first, name: second } : { phone_number: second, name: first }
        }
        return { phone_number: line, name: '' }
      })
    setManualContacts(contacts.length ? contacts : [{ phone_number: '', name: '' }])
  }

  const setManualContact = (index, field, value) => {
    const next = [...manualContacts]
    next[index][field] = value
    setManualContacts(next)
  }

  const startManualInstance = () => {
    const contacts = manualContacts.filter((contact) => String(contact.phone_number || '').trim())
    if (contacts.length && canCreate) manualMutation.mutate(contacts)
  }

  return (
    <div className="rounded-lg bg-white p-6 shadow">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-gray-900">{t('instanceWizard.sectionTitle')}</h2>
          <p className="mt-1 text-sm text-gray-500">{t('instanceWizard.sectionSubtitle')}</p>
        </div>
        {createdRunId && (
          <Link to={`/outbound-calls?campaign=${campaignId}&run=${createdRunId}`} className="inline-flex items-center rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50">
            <ExternalLink className="mr-2 h-4 w-4" />
            {t('instanceWizard.viewCallHistory')}
          </Link>
        )}
      </div>

      {!campaign?.trunk_id && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">{t('instanceWizard.noTrunk')}</div>}
      {!campaign?.ivr_id && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">{t('instanceWizard.noIvr')}</div>}
      {activeInstance && <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{t('instanceWizard.activeInstance', { number: activeInstance.run_number, status: t(`common.${activeInstance.status}`) })}</div>}
      {notice && <div className={clsx('mb-4 rounded-lg p-3 text-sm', notice.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>{notice.message}</div>}

      <div className="mb-4 flex gap-2">
        <button onClick={() => setMode('csv')} className={clsx('flex-1 rounded-lg border-2 px-4 py-2', mode === 'csv' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600')}>{t('instanceWizard.modeCsv')}</button>
        <button onClick={() => setMode('manual')} className={clsx('flex-1 rounded-lg border-2 px-4 py-2', mode === 'manual' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600')}>{t('instanceWizard.modeManual')}</button>
      </div>

      {mode === 'csv' ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-gray-900">{t('instanceWizard.csvTitle')}</div>
              <div className="text-xs text-gray-500">{t('instanceWizard.csvSubtitle')}</div>
            </div>
            <button onClick={onDownloadTemplate} className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <Download className="mr-2 h-4 w-4" />
              {t('instanceWizard.downloadTemplate')}
            </button>
          </div>
          <input type="file" ref={fileInputRef} onChange={onFileChange} accept=".csv,.xlsx,.xls" className="hidden" />
          {!file ? (
            <div className="text-center">
              <FileSpreadsheet className="mx-auto mb-3 h-12 w-12 text-gray-400" />
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
                  <Upload className="mr-2 h-5 w-5" />
                  {t('instanceWizard.selectFile')}
                </button>
                <button onClick={onDownloadTemplate} className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-gray-700 hover:bg-gray-50">
                  <Download className="mr-2 h-4 w-4" />
                  {t('instanceWizard.downloadTemplate')}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-gray-900">{file.name}</div>
                <div className="flex items-center gap-2">
                  <button onClick={onDownloadTemplate} className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    <Download className="mr-2 h-4 w-4" />
                    {t('instanceWizard.template')}
                  </button>
                  <button onClick={() => { setFile(null); setCsvHeaders([]); setPhoneColumn(''); if (fileInputRef.current) fileInputRef.current.value = '' }} className="p-1 text-gray-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">{t('instanceWizard.phoneColumn')} *</label>
                <select value={phoneColumn} onChange={(e) => setPhoneColumn(e.target.value)} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
                  <option value="">{t('instanceWizard.selectColumn')}</option>
                  {csvHeaders.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </div>
              <button onClick={() => canCreate && uploadMutation.mutate()} disabled={uploadMutation.isLoading || !phoneColumn || !canCreate} className="inline-flex items-center rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50">
                {uploadMutation.isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Play className="mr-2 h-5 w-5" />}
                {t('instanceWizard.startInstance')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('instanceWizard.quickEntry')}</label>
            <textarea onBlur={(e) => { if (e.target.value.trim()) { onManualPaste(e.target.value); e.target.value = '' } }} className="h-24 w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" placeholder={t('instanceWizard.quickEntryPlaceholder')} />
          </div>
          <div className="space-y-2 rounded-lg border p-2">
            {manualContacts.map((contact, index) => (
              <div key={index} className="flex items-center gap-2">
                <input value={contact.phone_number} onChange={(e) => setManualContact(index, 'phone_number', e.target.value)} placeholder={`${t('instanceWizard.phoneNumber')} *`} className="flex-1 rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                <input value={contact.name} onChange={(e) => setManualContact(index, 'name', e.target.value)} placeholder={t('instanceWizard.name')} className="flex-1 rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                <button onClick={() => setManualContacts(manualContacts.length === 1 ? manualContacts : manualContacts.filter((_, i) => i !== index))} className="p-2 text-gray-400 hover:text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setManualContacts([...manualContacts, { phone_number: '', name: '' }])} className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <Plus className="mr-2 h-4 w-4" />
              {t('instanceWizard.addRow')}
            </button>
            <button onClick={startManualInstance} disabled={manualMutation.isLoading || !manualContacts.some((contact) => contact.phone_number.trim()) || !canCreate} className="inline-flex items-center rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50">
              {manualMutation.isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Users className="mr-2 h-5 w-5" />}
              {t('instanceWizard.startInstance')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
