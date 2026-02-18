import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Volume2, Trash2 } from 'lucide-react'
import { getPrompts, getFilesystemPrompts, getPromptAudioUrl, getFilesystemAudioUrl } from '../../lib/api'

export default function NodeProperties({ node, onChange, onClose, onDelete }) {
  const [formData, setFormData] = useState(node?.data || {})
  const [playingPrompt, setPlayingPrompt] = useState(null)
  const audioRef = useState(null)

  // Fetch prompts from database
  const { data: dbPrompts } = useQuery({
    queryKey: ['prompts'],
    queryFn: () => getPrompts({})
  })

  // Fetch filesystem prompts (Arabic)
  const { data: fsPromptsAr } = useQuery({
    queryKey: ['filesystem-prompts', 'ar'],
    queryFn: () => getFilesystemPrompts('ar')
  })

  // Fetch filesystem prompts (English)  
  const { data: fsPromptsEn } = useQuery({
    queryKey: ['filesystem-prompts', 'en'],
    queryFn: () => getFilesystemPrompts('en')
  })

  useEffect(() => {
    setFormData(node?.data || {})
  }, [node])

  if (!node) {
    return (
      <div className="bg-white rounded-lg shadow p-4 w-80">
        <p className="text-gray-500 text-sm">Select a node to edit its properties</p>
      </div>
    )
  }

  const handleChange = (field, value) => {
    const updated = { ...formData, [field]: value }
    setFormData(updated)
    onChange(node.id, updated)
  }

  const handleBranchChange = (key, value) => {
    const branches = { ...formData.branches, [key]: value }
    handleChange('branches', branches)
  }

  const handleBranchDisplayNameChange = (key, value) => {
    const branchDisplayNames = { ...(formData.branchDisplayNames || {}), [key]: value }
    handleChange('branchDisplayNames', branchDisplayNames)
  }

  const addBranch = () => {
    const key = prompt('Enter branch key (e.g., "1", "2", "yes"):')
    if (key) {
      handleBranchChange(key, '')
    }
  }

  const removeBranch = (key) => {
    const branches = { ...formData.branches }
    delete branches[key]
    handleChange('branches', branches)

    if (formData.branchDisplayNames?.[key] !== undefined) {
      const branchDisplayNames = { ...formData.branchDisplayNames }
      delete branchDisplayNames[key]
      handleChange('branchDisplayNames', branchDisplayNames)
    }
  }

  // Build combined prompt list
  const allPrompts = []
  
  // Add database prompts
  if (dbPrompts) {
    dbPrompts.forEach(p => {
      allPrompts.push({
        value: p.filename.replace('.ulaw', ''),
        label: p.name,
        category: p.category || 'custom',
        language: p.language,
        source: 'db',
        id: p.id
      })
    })
  }
  
  // Add filesystem prompts (Arabic)
  if (fsPromptsAr) {
    fsPromptsAr.forEach(f => {
      const baseName = f.filename.replace('.ulaw', '')
      // Avoid duplicates
      if (!allPrompts.find(p => p.value === `ar/${baseName}`)) {
        allPrompts.push({
          value: `ar/${baseName}`,
          label: `${f.name} (Arabic)`,
          category: 'filesystem',
          language: 'ar',
          source: 'fs',
          filename: f.filename
        })
      }
    })
  }
  
  // Add filesystem prompts (English)
  if (fsPromptsEn) {
    fsPromptsEn.forEach(f => {
      const baseName = f.filename.replace('.ulaw', '')
      if (!allPrompts.find(p => p.value === `en/${baseName}`)) {
        allPrompts.push({
          value: `en/${baseName}`,
          label: `${f.name} (English)`,
          category: 'filesystem',
          language: 'en',
          source: 'fs',
          filename: f.filename
        })
      }
    })
  }

  // Group prompts by category/language
  const groupedPrompts = {
    'Arabic (ar/)': allPrompts.filter(p => p.language === 'ar'),
    'English (en/)': allPrompts.filter(p => p.language === 'en'),
    'Custom': allPrompts.filter(p => p.source === 'db')
  }

  // Prompt select component
  const PromptSelect = ({ value, onChange, placeholder }) => (
    <div className="space-y-1">
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border rounded-lg text-sm"
      >
        <option value="">{placeholder || 'Select a prompt...'}</option>
        {Object.entries(groupedPrompts).map(([group, prompts]) => (
          prompts.length > 0 && (
            <optgroup key={group} label={group}>
              {prompts.map(p => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          )
        ))}
      </select>
      {value && (
        <div className="text-xs text-gray-500 font-mono bg-gray-50 px-2 py-1 rounded">
          Path: {value}
        </div>
      )}
    </div>
  )

  return (
    <div className="bg-white rounded-lg shadow p-4 w-80">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-gray-900">Node Properties</h3>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
          <X size={18} />
        </button>
      </div>

      <div className="space-y-4">
        {/* Node ID */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Node ID</label>
          <input
            type="text"
            value={formData.id || ''}
            onChange={(e) => handleChange('id', e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
        </div>

        {/* Type-specific fields */}
        {(formData.type === 'play' || formData.type === 'play_digits') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
            <PromptSelect
              value={formData.prompt}
              onChange={(value) => handleChange('prompt', value)}
              placeholder="Select prompt to play..."
            />
          </div>
        )}

        {formData.type === 'collect' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
              <PromptSelect
                value={formData.prompt}
                onChange={(value) => handleChange('prompt', value)}
                placeholder="Select prompt for input..."
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Digits</label>
                <input
                  type="number"
                  value={formData.maxDigits || 10}
                  onChange={(e) => handleChange('maxDigits', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Timeout (s)</label>
                <input
                  type="number"
                  value={formData.timeout || 10}
                  onChange={(e) => handleChange('timeout', parseInt(e.target.value))}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Terminators</label>
              <input
                type="text"
                value={formData.terminators || '#'}
                onChange={(e) => handleChange('terminators', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="#"
              />
            </div>
          </>
        )}

        {formData.type === 'branch' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Variable</label>
              <input
                type="text"
                value={formData.variable || ''}
                onChange={(e) => handleChange('variable', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="e.g., dtmf_input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Condition (optional)</label>
              <input
                type="text"
                value={formData.condition || ''}
                onChange={(e) => handleChange('condition', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                placeholder="e.g., balance > 0"
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium text-gray-700">Branches</label>
                <button
                  onClick={addBranch}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  + Add Branch
                </button>
              </div>
              <div className="space-y-2">
                {Object.entries(formData.branches || {}).map(([key, value]) => (
                  <div key={key} className="border rounded p-2 bg-gray-50">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-mono bg-gray-100 px-2 py-1 rounded">{key}</span>
                      <span className="text-gray-400">→</span>
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => handleBranchChange(key, e.target.value)}
                        className="flex-1 px-2 py-1 border rounded text-sm"
                        placeholder="target node"
                      />
                      <button
                        onClick={() => removeBranch(key)}
                        className="text-red-500 hover:text-red-600"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <input
                      type="text"
                      value={formData.branchDisplayNames?.[key] || ''}
                      onChange={(e) => handleBranchDisplayNameChange(key, e.target.value)}
                      className="w-full px-2 py-1 border rounded text-sm"
                      placeholder="Display name for reports (optional)"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Default</label>
              <input
                type="text"
                value={formData.default || ''}
                onChange={(e) => handleChange('default', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="default target node"
              />
            </div>
          </>
        )}

        {formData.type === 'api_call' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
              <select
                value={formData.method || 'GET'}
                onChange={(e) => handleChange('method', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
                <option value="PATCH">PATCH</option>
                <option value="DELETE">DELETE</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
              <input
                type="text"
                value={formData.url || ''}
                onChange={(e) => handleChange('url', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                placeholder="{{API_URL}}/endpoint"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Result Variable</label>
              <input
                type="text"
                value={formData.resultVariable || ''}
                onChange={(e) => handleChange('resultVariable', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="api_result"
              />
            </div>
          </>
        )}

        {formData.type === 'set_variable' && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Variable Name</label>
              <input
                type="text"
                value={formData.variable || ''}
                onChange={(e) => handleChange('variable', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Expression</label>
              <input
                type="text"
                value={formData.expression ?? ''}
                onChange={(e) => handleChange('expression', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
                placeholder={'e.g., bills_result.find(b => b.inh_id === "0")?.inh_tot1 || 0'}
              />
              <p className="text-xs text-gray-500 mt-1">
                Optional JavaScript expression. If set, it is used instead of Value.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Value (Fallback)</label>
              <input
                type="text"
                value={formData.value ?? ''}
                onChange={(e) => handleChange('value', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
                placeholder="Static value when Expression is empty"
              />
            </div>
          </>
        )}

        {formData.type === 'transfer' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Destination</label>
            <input
              type="text"
              value={formData.destination || ''}
              onChange={(e) => handleChange('destination', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              placeholder="extension or number"
            />
          </div>
        )}

        {/* Common fields for non-hangup nodes */}
        {formData.type !== 'hangup' && formData.type !== 'branch' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Next Node</label>
            <input
              type="text"
              value={formData.next || ''}
              onChange={(e) => handleChange('next', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              placeholder="next node ID"
            />
          </div>
        )}

        {/* Error handling */}
        {(formData.type === 'api_call' || formData.type === 'collect') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">On Error</label>
            <input
              type="text"
              value={formData.onError || ''}
              onChange={(e) => handleChange('onError', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
              placeholder="error handler node"
            />
          </div>
        )}

        {onDelete && (
          <div className="pt-2 border-t">
            <button
              type="button"
              onClick={() => onDelete(node.id)}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50"
            >
              <Trash2 size={16} />
              Delete Node
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
