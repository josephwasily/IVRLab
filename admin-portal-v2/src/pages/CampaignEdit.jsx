import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  getCampaign, createCampaign, updateCampaign, uploadCampaignContacts, addManualContacts,
  getCampaignStats, getTrunks, getIVRFlows
} from '../lib/api'
import { 
  ArrowLeft, Save, Upload, Users, Phone, Clock, AlertCircle,
  CheckCircle, XCircle, Loader2, FileSpreadsheet, Trash2, Plus, List
} from 'lucide-react'
import clsx from 'clsx'

const campaignTypes = [
  { value: 'survey', label: 'Survey', description: 'Collect responses via IVR' },
  { value: 'notification', label: 'Notification', description: 'Play announcements' },
  { value: 'reminder', label: 'Reminder', description: 'Appointment reminders' },
  { value: 'collection', label: 'Collection', description: 'Payment reminders' },
  { value: 'custom', label: 'Custom', description: 'Custom IVR flow' }
]

export default function CampaignEdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)
  const isNew = id === 'new'

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    campaign_type: 'notification',
    ivr_id: '',
    trunk_id: '',
    caller_id: '',
    max_concurrent_calls: 1,
    retry_attempts: 3,
    retry_delay_minutes: 30,
    schedule_start: '',
    schedule_end: '',
    variables: {}
  })

  const [csvFile, setCsvFile] = useState(null)
  const [csvPreview, setCsvPreview] = useState(null)
  const [csvMapping, setCsvMapping] = useState({ phone_column: '', name_column: '', variable_columns: [] })
  const [uploadStatus, setUploadStatus] = useState(null)
  const [contactMode, setContactMode] = useState('csv') // 'csv' or 'manual'
  const [manualContacts, setManualContacts] = useState([{ phone_number: '', name: '' }])

  // Fetch campaign data if editing
  const { data: campaign, isLoading: loadingCampaign } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => getCampaign(id),
    enabled: !isNew
  })

  // Fetch stats if campaign exists
  const { data: stats } = useQuery({
    queryKey: ['campaign-stats', id],
    queryFn: () => getCampaignStats(id),
    enabled: !isNew && campaign?.status !== 'draft',
    refetchInterval: campaign?.status === 'running' ? 5000 : false
  })

  // Fetch trunks and IVR flows
  const { data: trunks } = useQuery({
    queryKey: ['trunks'],
    queryFn: getTrunks
  })

  const { data: ivrFlows } = useQuery({
    queryKey: ['ivr-flows'],
    queryFn: getIVRFlows
  })

  // Update form when campaign loads
  useEffect(() => {
    if (campaign) {
      setFormData({
        name: campaign.name || '',
        description: campaign.description || '',
        campaign_type: campaign.campaign_type || 'notification',
        ivr_id: campaign.ivr_id || '',
        trunk_id: campaign.trunk_id || '',
        caller_id: campaign.caller_id || '',
        max_concurrent_calls: campaign.max_concurrent_calls || 1,
        retry_attempts: campaign.retry_attempts || 3,
        retry_delay_minutes: campaign.retry_delay_minutes || 30,
        schedule_start: campaign.schedule_start || '',
        schedule_end: campaign.schedule_end || '',
        variables: campaign.variables || {}
      })
    }
  }, [campaign])

  const saveMutation = useMutation({
    mutationFn: (data) => isNew ? createCampaign(data) : updateCampaign(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries(['campaigns'])
      if (isNew) {
        navigate(`/campaigns/${data.id}`)
      }
    }
  })

  const uploadMutation = useMutation({
    mutationFn: ({ campaignId, file, mapping }) => uploadCampaignContacts(campaignId, file, mapping),
    onSuccess: (data) => {
      setUploadStatus({ success: true, message: `Uploaded ${data.imported} contacts` })
      setCsvFile(null)
      setCsvPreview(null)
      queryClient.invalidateQueries(['campaign', id])
    },
    onError: (error) => {
      setUploadStatus({ success: false, message: error.message })
    }
  })

  const manualUploadMutation = useMutation({
    mutationFn: ({ campaignId, contacts }) => addManualContacts(campaignId, contacts),
    onSuccess: (data) => {
      setUploadStatus({ success: true, message: `Added ${data.imported} contacts` })
      setManualContacts([{ phone_number: '', name: '' }])
      queryClient.invalidateQueries(['campaign', id])
    },
    onError: (error) => {
      setUploadStatus({ success: false, message: error.response?.data?.error || error.message })
    }
  })

  const handleFileSelect = (e) => {
    const file = e.target.files[0]
    if (!file) return

    setCsvFile(file)
    setUploadStatus(null)

    // Parse CSV preview
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target.result
      const lines = text.split('\n').slice(0, 6) // Header + 5 rows
      const rows = lines.map(line => {
        // Simple CSV parsing (handles quoted fields)
        const result = []
        let current = ''
        let inQuotes = false
        for (const char of line) {
          if (char === '"') inQuotes = !inQuotes
          else if (char === ',' && !inQuotes) {
            result.push(current.trim())
            current = ''
          } else {
            current += char
          }
        }
        result.push(current.trim())
        return result
      })

      if (rows.length > 0) {
        setCsvPreview({
          headers: rows[0],
          rows: rows.slice(1)
        })
        // Auto-detect phone column
        const phoneIdx = rows[0].findIndex(h => 
          /phone|mobile|number|tel/i.test(h)
        )
        const nameIdx = rows[0].findIndex(h => 
          /name|customer|contact/i.test(h)
        )
        setCsvMapping({
          phone_column: phoneIdx >= 0 ? rows[0][phoneIdx] : '',
          name_column: nameIdx >= 0 ? rows[0][nameIdx] : '',
          variable_columns: []
        })
      }
    }
    reader.readAsText(file)
  }

  const handleUpload = () => {
    if (!csvFile || !csvMapping.phone_column) return
    uploadMutation.mutate({
      campaignId: id,
      file: csvFile,
      mapping: csvMapping
    })
  }

  const handleAddContact = () => {
    setManualContacts([...manualContacts, { phone_number: '', name: '' }])
  }

  const handleRemoveContact = (index) => {
    if (manualContacts.length === 1) return
    setManualContacts(manualContacts.filter((_, i) => i !== index))
  }

  const handleContactChange = (index, field, value) => {
    const updated = [...manualContacts]
    updated[index][field] = value
    setManualContacts(updated)
  }

  const handleManualUpload = () => {
    const validContacts = manualContacts.filter(c => c.phone_number.trim())
    if (validContacts.length === 0) return
    manualUploadMutation.mutate({
      campaignId: id,
      contacts: validContacts
    })
  }

  const parseManualInput = (text) => {
    // Parse bulk text input - one phone per line, or comma/semicolon separated
    const lines = text.split(/[\n,;]+/).map(l => l.trim()).filter(Boolean)
    const contacts = lines.map(line => {
      // Check if line has name (format: "name - phone" or "phone - name")
      const parts = line.split(/[-–]/).map(p => p.trim())
      if (parts.length === 2) {
        const [first, second] = parts
        // Determine which is phone (has more digits)
        const firstDigits = (first.match(/\d/g) || []).length
        const secondDigits = (second.match(/\d/g) || []).length
        if (firstDigits > secondDigits) {
          return { phone_number: first, name: second }
        } else {
          return { phone_number: second, name: first }
        }
      }
      return { phone_number: line, name: '' }
    })
    setManualContacts(contacts.length > 0 ? contacts : [{ phone_number: '', name: '' }])
  }

  const handleSave = () => {
    saveMutation.mutate(formData)
  }

  if (loadingCampaign) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  const isEditable = !campaign || campaign.status === 'draft'

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate('/campaigns')}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">
            {isNew ? 'New Campaign' : campaign?.name}
          </h1>
          {campaign && (
            <p className="text-gray-500 text-sm">
              Status: {campaign.status} • Created: {new Date(campaign.created_at).toLocaleDateString()}
            </p>
          )}
        </div>
        {isEditable && (
          <button
            onClick={handleSave}
            disabled={saveMutation.isLoading || !formData.name}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saveMutation.isLoading ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <Save className="w-5 h-5 mr-2" />
            )}
            Save
          </button>
        )}
      </div>

      {/* Stats Bar (for running/completed campaigns) */}
      {stats && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h3 className="font-medium text-gray-900 mb-3">Campaign Progress</h3>
          <div className="grid grid-cols-5 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
              <div className="text-xs text-gray-500">Total</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-600">{stats.pending}</div>
              <div className="text-xs text-gray-500">Pending</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-yellow-600">{stats.in_progress}</div>
              <div className="text-xs text-gray-500">In Progress</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
              <div className="text-xs text-gray-500">Completed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-600">{stats.failed}</div>
              <div className="text-xs text-gray-500">Failed</div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Basic Info */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="font-medium text-gray-900 mb-4">Campaign Details</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Campaign Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={!isEditable}
                className="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                placeholder="Q1 Customer Survey"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                disabled={!isEditable}
                rows={2}
                className="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Campaign Type
              </label>
              <select
                value={formData.campaign_type}
                onChange={(e) => setFormData({ ...formData, campaign_type: e.target.value })}
                disabled={!isEditable}
                className="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
              >
                {campaignTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label} - {type.description}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                IVR Flow *
              </label>
              <select
                value={formData.ivr_id}
                onChange={(e) => setFormData({ ...formData, ivr_id: e.target.value })}
                disabled={!isEditable}
                className="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
              >
                <option value="">Select IVR Flow...</option>
                {ivrFlows?.map((flow) => (
                  <option key={flow.id} value={flow.id}>{flow.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Trunk & Dialing Config */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="font-medium text-gray-900 mb-4">Dialing Configuration</h3>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                SIP Trunk *
              </label>
              <select
                value={formData.trunk_id}
                onChange={(e) => setFormData({ ...formData, trunk_id: e.target.value })}
                disabled={!isEditable}
                className="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
              >
                <option value="">Select Trunk...</option>
                {trunks?.filter(t => t.status === 'active').map((trunk) => (
                  <option key={trunk.id} value={trunk.id}>{trunk.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Caller ID
              </label>
              <input
                type="text"
                value={formData.caller_id}
                onChange={(e) => setFormData({ ...formData, caller_id: e.target.value })}
                disabled={!isEditable}
                className="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                placeholder="e.g., +1234567890"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max Concurrent Calls
                </label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={formData.max_concurrent_calls}
                  onChange={(e) => setFormData({ ...formData, max_concurrent_calls: parseInt(e.target.value) })}
                  disabled={!isEditable}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Retry Attempts
                </label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  value={formData.retry_attempts}
                  onChange={(e) => setFormData({ ...formData, retry_attempts: parseInt(e.target.value) })}
                  disabled={!isEditable}
                  className="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Retry Delay (minutes)
              </label>
              <input
                type="number"
                min="1"
                value={formData.retry_delay_minutes}
                onChange={(e) => setFormData({ ...formData, retry_delay_minutes: parseInt(e.target.value) })}
                disabled={!isEditable}
                className="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Contact Upload Section */}
      {!isNew && isEditable && (
        <div className="bg-white rounded-lg shadow p-6 mt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium text-gray-900">Contact List</h3>
            {campaign?.total_contacts > 0 && (
              <span className="text-sm text-gray-500">
                <Users className="w-4 h-4 inline mr-1" />
                {campaign.total_contacts} contacts loaded
              </span>
            )}
          </div>

          {/* Mode Toggle */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setContactMode('csv')}
              className={clsx(
                'flex-1 py-2 px-4 rounded-lg border-2 flex items-center justify-center gap-2 transition-colors',
                contactMode === 'csv' 
                  ? 'border-blue-500 bg-blue-50 text-blue-700' 
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              )}
            >
              <FileSpreadsheet className="w-5 h-5" />
              CSV Upload
            </button>
            <button
              onClick={() => setContactMode('manual')}
              className={clsx(
                'flex-1 py-2 px-4 rounded-lg border-2 flex items-center justify-center gap-2 transition-colors',
                contactMode === 'manual' 
                  ? 'border-blue-500 bg-blue-50 text-blue-700' 
                  : 'border-gray-200 text-gray-600 hover:border-gray-300'
              )}
            >
              <List className="w-5 h-5" />
              Manual Entry
            </button>
          </div>

          {/* Upload Status */}
          {uploadStatus && (
            <div className={clsx(
              'flex items-center gap-2 p-3 rounded-lg mb-4',
              uploadStatus.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            )}>
              {uploadStatus.success ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <XCircle className="w-5 h-5" />
              )}
              {uploadStatus.message}
            </div>
          )}

          {/* CSV Mode */}
          {contactMode === 'csv' && (
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileSelect}
                accept=".csv"
                className="hidden"
              />
            
            {!csvFile ? (
              <>
                <FileSpreadsheet className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                <p className="text-gray-600 mb-2">Upload a CSV file with phone numbers</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  <Upload className="w-5 h-5 mr-2" />
                  Select CSV File
                </button>
                <p className="text-xs text-gray-500 mt-2">
                  CSV should have headers. Phone number column is required.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-center gap-2 mb-4">
                  <FileSpreadsheet className="w-6 h-6 text-green-600" />
                  <span className="font-medium">{csvFile.name}</span>
                  <button
                    onClick={() => {
                      setCsvFile(null)
                      setCsvPreview(null)
                    }}
                    className="p-1 text-gray-400 hover:text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* CSV Preview */}
                {csvPreview && (
                  <div className="text-left mb-4">
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50">
                            {csvPreview.headers.map((header, i) => (
                              <th key={i} className="px-3 py-2 text-left font-medium text-gray-700">
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {csvPreview.rows.map((row, i) => (
                            <tr key={i} className="border-t">
                              {row.map((cell, j) => (
                                <td key={j} className="px-3 py-2 text-gray-600">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Column Mapping */}
                    <div className="grid grid-cols-2 gap-4 mt-4 p-4 bg-gray-50 rounded-lg">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Phone Number Column *
                        </label>
                        <select
                          value={csvMapping.phone_column}
                          onChange={(e) => setCsvMapping({ ...csvMapping, phone_column: e.target.value })}
                          className="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">Select column...</option>
                          {csvPreview.headers.map((header) => (
                            <option key={header} value={header}>{header}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Name Column (optional)
                        </label>
                        <select
                          value={csvMapping.name_column}
                          onChange={(e) => setCsvMapping({ ...csvMapping, name_column: e.target.value })}
                          className="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">Select column...</option>
                          {csvPreview.headers.map((header) => (
                            <option key={header} value={header}>{header}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleUpload}
                  disabled={uploadMutation.isLoading || !csvMapping.phone_column}
                  className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {uploadMutation.isLoading ? (
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  ) : (
                    <Upload className="w-5 h-5 mr-2" />
                  )}
                  Upload Contacts
                </button>
              </>
            )}
          </div>
          )}

          {/* Manual Entry Mode */}
          {contactMode === 'manual' && (
            <div className="space-y-4">
              {/* Bulk paste area */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quick Entry (paste multiple numbers)
                </label>
                <textarea
                  placeholder="Enter phone numbers, one per line. Optionally add names like: John - 1234567890"
                  className="w-full rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 h-24"
                  onBlur={(e) => {
                    if (e.target.value.trim()) {
                      parseManualInput(e.target.value)
                      e.target.value = ''
                    }
                  }}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Formats: one number per line, comma-separated, or "Name - Number"
                </p>
              </div>

              {/* Individual contacts */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700">
                    Contacts ({manualContacts.filter(c => c.phone_number.trim()).length} valid)
                  </label>
                  <button
                    onClick={handleAddContact}
                    className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" />
                    Add Row
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto space-y-2 border rounded-lg p-2">
                  {manualContacts.map((contact, index) => (
                    <div key={index} className="flex gap-2 items-center">
                      <input
                        type="text"
                        placeholder="Phone number *"
                        value={contact.phone_number}
                        onChange={(e) => handleContactChange(index, 'phone_number', e.target.value)}
                        className="flex-1 rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
                      />
                      <input
                        type="text"
                        placeholder="Name (optional)"
                        value={contact.name}
                        onChange={(e) => handleContactChange(index, 'name', e.target.value)}
                        className="flex-1 rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm"
                      />
                      <button
                        onClick={() => handleRemoveContact(index)}
                        disabled={manualContacts.length === 1}
                        className="p-2 text-gray-400 hover:text-red-600 disabled:opacity-30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={handleManualUpload}
                disabled={manualUploadMutation.isLoading || !manualContacts.some(c => c.phone_number.trim())}
                className="inline-flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {manualUploadMutation.isLoading ? (
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                ) : (
                  <Users className="w-5 h-5 mr-2" />
                )}
                Add Contacts
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
