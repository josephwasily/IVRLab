import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as XLSX from 'xlsx'
import {
  getCampaign,
  getCampaignInstances,
  createCampaignInstanceFromUpload,
  createCampaignInstanceManual,
  downloadCampaignContactsTemplate
} from '../lib/api'
import {
  ArrowLeft, Upload, Users, Loader2, FileSpreadsheet, Trash2,
  Plus, Download, ExternalLink, Play
} from 'lucide-react'
import clsx from 'clsx'

export default function CampaignInstanceWizard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)

  const [mode, setMode] = useState('csv')
  const [file, setFile] = useState(null)
  const [csvHeaders, setCsvHeaders] = useState([])
  const [phoneColumn, setPhoneColumn] = useState('')
  const [manualContacts, setManualContacts] = useState([{ phone_number: '', name: '' }])
  const [notice, setNotice] = useState(null)
  const [createdRunId, setCreatedRunId] = useState(null)

  const { data: campaign, isLoading: loadingCampaign } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => getCampaign(id)
  })

  const { data: instances } = useQuery({
    queryKey: ['campaign-instances', id],
    queryFn: () => getCampaignInstances(id),
    refetchInterval: 10000
  })

  const activeInstance = instances?.find((instance) => ['running', 'paused'].includes(instance.status)) || null
  const latestInstance = instances?.[0] || null
  const canCreate = !!campaign?.trunk_id && !!campaign?.ivr_id && !activeInstance

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    queryClient.invalidateQueries({ queryKey: ['campaign', id] })
    queryClient.invalidateQueries({ queryKey: ['campaign-instances', id] })
    queryClient.invalidateQueries({ queryKey: ['outbound-calls'] })
    queryClient.invalidateQueries({ queryKey: ['outbound-analytics'] })
  }

  const uploadMutation = useMutation({
    mutationFn: () => createCampaignInstanceFromUpload(id, file, { phone_column: phoneColumn }),
    onSuccess: (data) => {
      setCreatedRunId(data.run_id)
      setNotice({ success: true, message: `Instance #${data.run_number} started with ${data.imported} contacts.` })
      setFile(null)
      setCsvHeaders([])
      setPhoneColumn('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      invalidateAll()
    },
    onError: (error) => {
      setNotice({ success: false, message: error.response?.data?.error || error.message || 'Failed to create instance' })
    }
  })

  const manualMutation = useMutation({
    mutationFn: (contacts) => createCampaignInstanceManual(id, contacts),
    onSuccess: (data) => {
      setCreatedRunId(data.run_id)
      setNotice({ success: true, message: `Instance #${data.run_number} started with ${data.imported} contacts.` })
      setManualContacts([{ phone_number: '', name: '' }])
      invalidateAll()
    },
    onError: (error) => {
      setNotice({ success: false, message: error.response?.data?.error || error.message || 'Failed to create instance' })
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
        setNotice({ success: false, message: `Could not read file: ${error.message}` })
      }
      setCsvHeaders(headers)
      setPhoneColumn(headers.find((header) => /phone|mobile|number|tel/i.test(header)) || '')
    }
    if (isExcel) reader.readAsArrayBuffer(nextFile)
    else reader.readAsText(nextFile)
  }

  const onDownloadTemplate = async () => {
    try {
      const blob = await downloadCampaignContactsTemplate(id)
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${campaign?.name || 'campaign'}-contacts-template.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      setNotice({ success: false, message: error.response?.data?.error || error.message || 'Failed to download template' })
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

  if (loadingCampaign) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center gap-4">
        <button onClick={() => navigate(`/campaigns/${id}`)} className="rounded-lg p-2 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Start Campaign Instance</h1>
          <p className="text-sm text-gray-500">Campaign design is shown below for reference only. This page only creates a new instance.</p>
        </div>
        <Link to={`/campaigns/${id}`} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
          Back to Campaign
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg bg-white p-4 shadow"><div className="text-sm text-gray-500">Campaign</div><div className="mt-1 font-semibold text-gray-900">{campaign?.name}</div><div className="text-xs text-gray-500">{campaign?.campaign_type || '-'}</div></div>
        <div className="rounded-lg bg-white p-4 shadow"><div className="text-sm text-gray-500">Total Instances</div><div className="mt-1 text-2xl font-bold text-gray-900">{instances?.length || 0}</div><div className="text-xs text-gray-500">{latestInstance ? `Latest: Run #${latestInstance.run_number}` : 'No instances yet'}</div></div>
        <div className="rounded-lg bg-white p-4 shadow"><div className="text-sm text-gray-500">Current Status</div><div className="mt-1 text-sm font-semibold text-gray-900">{activeInstance ? `Run #${activeInstance.run_number} ${activeInstance.status}` : 'Ready to start'}</div><div className="text-xs text-gray-500">{activeInstance ? 'Only one active instance is allowed at a time.' : 'No running or paused instances.'}</div></div>
      </div>

      <div className="mb-6 rounded-lg bg-white p-6 shadow">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium text-gray-900">Campaign Design</h2>
            <p className="mt-1 text-sm text-gray-500">These settings come from the campaign and are informational on this page.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg bg-gray-50 p-4"><div className="text-xs uppercase text-gray-500">Description</div><div className="mt-1 text-sm text-gray-900">{campaign?.description || '-'}</div></div>
          <div className="rounded-lg bg-gray-50 p-4"><div className="text-xs uppercase text-gray-500">IVR Flow</div><div className="mt-1 text-sm text-gray-900">{campaign?.ivr_name || '-'}</div></div>
          <div className="rounded-lg bg-gray-50 p-4"><div className="text-xs uppercase text-gray-500">SIP Trunk</div><div className="mt-1 text-sm text-gray-900">{campaign?.trunk_name || '-'}</div></div>
          <div className="rounded-lg bg-gray-50 p-4"><div className="text-xs uppercase text-gray-500">Caller ID</div><div className="mt-1 text-sm text-gray-900">{campaign?.caller_id || '-'}</div></div>
          <div className="rounded-lg bg-gray-50 p-4"><div className="text-xs uppercase text-gray-500">Max Concurrent Calls</div><div className="mt-1 text-sm text-gray-900">{campaign?.max_concurrent_calls || 1}</div></div>
          <div className="rounded-lg bg-gray-50 p-4"><div className="text-xs uppercase text-gray-500">Retry Policy</div><div className="mt-1 text-sm text-gray-900">{`${campaign?.max_attempts || 0} attempts, ${campaign?.retry_delay_minutes || 0} min delay`}</div></div>
        </div>
      </div>

      <div className="rounded-lg bg-white p-6 shadow">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-medium text-gray-900">Instance Wizard</h2>
            <p className="mt-1 text-sm text-gray-500">Upload a contact list or enter contacts manually to start the new instance.</p>
          </div>
          {createdRunId && (
            <Link to={`/outbound-calls?campaign=${id}&run=${createdRunId}`} className="inline-flex items-center rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50">
              <ExternalLink className="mr-2 h-4 w-4" />
              View Call History
            </Link>
          )}
        </div>

        {!campaign?.trunk_id && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">This campaign needs a SIP trunk before an instance can start.</div>}
        {!campaign?.ivr_id && <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">This campaign needs an IVR flow before an instance can start.</div>}
        {activeInstance && <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">{`Run #${activeInstance.run_number} is ${activeInstance.status}. Finish it before starting another instance.`}</div>}
        {notice && <div className={clsx('mb-4 rounded-lg p-3 text-sm', notice.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>{notice.message}</div>}

        <div className="mb-4 flex gap-2">
          <button onClick={() => setMode('csv')} className={clsx('flex-1 rounded-lg border-2 px-4 py-2', mode === 'csv' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600')}>CSV Upload</button>
          <button onClick={() => setMode('manual')} className={clsx('flex-1 rounded-lg border-2 px-4 py-2', mode === 'manual' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600')}>Manual Entry</button>
        </div>

        {mode === 'csv' ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-gray-900">CSV Contact List</div>
                <div className="text-xs text-gray-500">Download the template first, fill in phone numbers, then upload it here.</div>
              </div>
              <button onClick={onDownloadTemplate} className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <Download className="mr-2 h-4 w-4" />
                Download Template
              </button>
            </div>
            <input type="file" ref={fileInputRef} onChange={onFileChange} accept=".csv,.xlsx,.xls" className="hidden" />
            {!file ? (
              <div className="text-center">
                <FileSpreadsheet className="mx-auto mb-3 h-12 w-12 text-gray-400" />
                <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
                    <Upload className="mr-2 h-5 w-5" />
                    Select CSV or Excel File
                  </button>
                  <button onClick={onDownloadTemplate} className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-gray-700 hover:bg-gray-50">
                    <Download className="mr-2 h-4 w-4" />
                    Download Template
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
                      Template
                    </button>
                    <button onClick={() => { setFile(null); setCsvHeaders([]); setPhoneColumn(''); if (fileInputRef.current) fileInputRef.current.value = '' }} className="p-1 text-gray-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Phone Number Column *</label>
                  <select value={phoneColumn} onChange={(e) => setPhoneColumn(e.target.value)} className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500">
                    <option value="">Select column...</option>
                    {csvHeaders.map((header) => <option key={header} value={header}>{header}</option>)}
                  </select>
                </div>
                <button onClick={() => canCreate && uploadMutation.mutate()} disabled={uploadMutation.isLoading || !phoneColumn || !canCreate} className="inline-flex items-center rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50">
                  {uploadMutation.isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Play className="mr-2 h-5 w-5" />}
                  Start Instance
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Quick Entry</label>
              <textarea onBlur={(e) => { if (e.target.value.trim()) { onManualPaste(e.target.value); e.target.value = '' } }} className="h-24 w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500" placeholder="Paste one phone number per line or use Name - Number" />
            </div>
            <div className="space-y-2 rounded-lg border p-2">
              {manualContacts.map((contact, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input value={contact.phone_number} onChange={(e) => setManualContact(index, 'phone_number', e.target.value)} placeholder="Phone number *" className="flex-1 rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                  <input value={contact.name} onChange={(e) => setManualContact(index, 'name', e.target.value)} placeholder="Name" className="flex-1 rounded-md border-gray-300 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500" />
                  <button onClick={() => setManualContacts(manualContacts.length === 1 ? manualContacts : manualContacts.filter((_, i) => i !== index))} className="p-2 text-gray-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setManualContacts([...manualContacts, { phone_number: '', name: '' }])} className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
                <Plus className="mr-2 h-4 w-4" />
                Add Row
              </button>
              <button onClick={startManualInstance} disabled={manualMutation.isLoading || !manualContacts.some((contact) => contact.phone_number.trim()) || !canCreate} className="inline-flex items-center rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50">
                {manualMutation.isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Users className="mr-2 h-5 w-5" />}
                Start Instance
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
