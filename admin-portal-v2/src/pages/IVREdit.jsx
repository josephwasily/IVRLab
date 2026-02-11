import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getIVR, updateIVR, getIVRStats } from '../lib/api'
import { ArrowLeft, Save, Play, Settings, BarChart3, Workflow } from 'lucide-react'
import clsx from 'clsx'
import FlowBuilder from '../components/flow/FlowBuilder'

const nodeTypeLabels = {
  play: 'Play Audio',
  play_digits: 'Play Digits',
  play_sequence: 'Play Sequence',
  collect: 'Collect Input',
  branch: 'Branch/Condition',
  api_call: 'API Call',
  set_variable: 'Set Variable',
  transfer: 'Transfer',
  hangup: 'Hang Up'
}

function NodeEditor({ node, onChange }) {
  const handleChange = (field, value) => {
    onChange({ ...node, [field]: value })
  }

  return (
    <div className="space-y-4 p-4 bg-gray-50 rounded-lg">
      <div className="flex justify-between items-start">
        <div>
          <span className="text-xs text-gray-500 uppercase">{node.type}</span>
          <h4 className="font-medium">{node.id}</h4>
        </div>
        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
          {nodeTypeLabels[node.type] || node.type}
        </span>
      </div>

      {node.type === 'play' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
          <input
            type="text"
            value={node.prompt || ''}
            onChange={(e) => handleChange('prompt', e.target.value)}
            className="w-full px-3 py-2 border rounded-lg text-sm"
          />
        </div>
      )}

      {node.type === 'collect' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
            <input
              type="text"
              value={node.prompt || ''}
              onChange={(e) => handleChange('prompt', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Digits</label>
              <input
                type="number"
                value={node.maxDigits || 10}
                onChange={(e) => handleChange('maxDigits', parseInt(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Timeout (s)</label>
              <input
                type="number"
                value={node.timeout || 10}
                onChange={(e) => handleChange('timeout', parseInt(e.target.value))}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>
        </>
      )}

      {node.type === 'api_call' && (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
            <select
              value={node.method || 'GET'}
              onChange={(e) => handleChange('method', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="PATCH">PATCH</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL</label>
            <input
              type="text"
              value={node.url || ''}
              onChange={(e) => handleChange('url', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono"
              placeholder="https://api.example.com/{{account_number}}"
            />
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Next Node</label>
        <input
          type="text"
          value={node.next || ''}
          onChange={(e) => handleChange('next', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg text-sm"
        />
      </div>
    </div>
  )
}

export default function IVREdit() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('visual')
  const [selectedNode, setSelectedNode] = useState(null)
  const flowBuilderRef = useRef(null)

  const { data: ivr, isLoading } = useQuery({
    queryKey: ['ivr', id],
    queryFn: () => getIVR(id)
  })

  const { data: stats } = useQuery({
    queryKey: ['ivr-stats', id],
    queryFn: () => getIVRStats(id)
  })

  const [formData, setFormData] = useState(null)

  // Initialize form data when IVR loads
  if (ivr && !formData) {
    setFormData({
      name: ivr.name,
      description: ivr.description || '',
      language: ivr.language,
      flow_data: ivr.flow_data
    })
  }

  const updateMutation = useMutation({
    mutationFn: (data) => updateIVR(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ivr', id] })
    }
  })

  const handleSave = () => {
    if (!formData) return
    const latestFlow = flowBuilderRef.current?.getFlowData?.()
    const flowDataToSave = latestFlow || formData.flow_data
    updateMutation.mutate({
      name: formData.name,
      description: formData.description,
      language: formData.language,
      flowData: flowDataToSave
    })
  }

  const handleNodeChange = (updatedNode) => {
    if (!formData) return
    setFormData(prev => ({
      ...prev,
      flow_data: {
        ...prev.flow_data,
        nodes: {
          ...prev.flow_data.nodes,
          [updatedNode.id]: updatedNode
        }
      }
    }))
  }

  if (isLoading || !formData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  const nodes = Object.values(formData.flow_data?.nodes || {})

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center">
          <button
            onClick={() => navigate('/ivr')}
            className="p-2 text-gray-600 hover:text-gray-900 mr-4"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{ivr.name}</h1>
            <p className="text-sm text-gray-500">
              Extension: <span className="font-mono">{ivr.extension}</span>
            </p>
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="w-5 h-5 mr-2" />
          {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          {[
            { id: 'visual', label: 'Visual Builder', icon: Workflow },
            { id: 'flow', label: 'Node List', icon: Play },
            { id: 'settings', label: 'Settings', icon: Settings },
            { id: 'analytics', label: 'Analytics', icon: BarChart3 }
          ].map(({ id: tabId, label, icon: Icon }) => (
            <button
              key={tabId}
              onClick={() => setActiveTab(tabId)}
              className={clsx(
                'flex items-center py-4 px-1 border-b-2 font-medium text-sm',
                activeTab === tabId
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <Icon className="w-5 h-5 mr-2" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Visual Flow Builder Tab */}
      {activeTab === 'visual' && (
        <FlowBuilder
          ref={flowBuilderRef}
          initialFlow={formData.flow_data}
          onSave={(flowData) => {
            setFormData(prev => ({ ...prev, flow_data: flowData }))
            updateMutation.mutate({
              name: formData.name,
              description: formData.description,
              language: formData.language,
              flowData: flowData
            })
          }}
          isSaving={updateMutation.isPending}
        />
      )}

      {/* Flow Editor Tab */}
      {activeTab === 'flow' && (
        <div className="grid grid-cols-3 gap-6">
          {/* Node List */}
          <div className="col-span-1 bg-white rounded-lg shadow p-4">
            <h3 className="font-semibold text-gray-900 mb-4">Flow Nodes</h3>
            <div className="space-y-2">
              {nodes.map((node) => (
                <button
                  key={node.id}
                  onClick={() => setSelectedNode(node.id)}
                  className={clsx(
                    'w-full text-left p-3 rounded-lg border',
                    selectedNode === node.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  )}
                >
                  <div className="font-medium text-sm">{node.id}</div>
                  <div className="text-xs text-gray-500">{nodeTypeLabels[node.type] || node.type}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Node Editor */}
          <div className="col-span-2 bg-white rounded-lg shadow p-6">
            {selectedNode && formData.flow_data?.nodes[selectedNode] ? (
              <NodeEditor
                node={formData.flow_data.nodes[selectedNode]}
                onChange={handleNodeChange}
              />
            ) : (
              <div className="text-center text-gray-500 py-12">
                Select a node to edit
              </div>
            )}
          </div>
        </div>
      )}

      {/* Settings Tab */}
      {activeTab === 'settings' && (
        <div className="max-w-xl bg-white rounded-lg shadow p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
              rows={3}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Language</label>
            <select
              value={formData.language}
              onChange={(e) => setFormData(prev => ({ ...prev, language: e.target.value }))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg"
            >
              <option value="ar">Arabic</option>
              <option value="en">English</option>
            </select>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-600">
              <strong>Extension:</strong> {ivr.extension}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              <strong>Status:</strong> {ivr.status}
            </p>
            <p className="text-sm text-gray-600 mt-1">
              <strong>Version:</strong> {ivr.version}
            </p>
          </div>
        </div>
      )}

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500">Total Calls</p>
            <p className="text-3xl font-bold text-gray-900">{stats?.totalCalls || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500">Completed</p>
            <p className="text-3xl font-bold text-green-600">{stats?.completed || 0}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500">Completion Rate</p>
            <p className="text-3xl font-bold text-blue-600">{stats?.completionRate || 0}%</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-500">Avg Duration</p>
            <p className="text-3xl font-bold text-gray-900">{stats?.avgDuration || 0}s</p>
          </div>
        </div>
      )}
    </div>
  )
}
