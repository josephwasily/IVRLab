import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getTrunks, createTrunk, updateTrunk, deleteTrunk, testTrunk } from '../lib/api'
import { Plus, Trash2, Edit2, Phone, CheckCircle, XCircle, RefreshCw, X, Server } from 'lucide-react'
import clsx from 'clsx'

const transports = [
  { value: 'udp', label: 'UDP' },
  { value: 'tcp', label: 'TCP' },
  { value: 'tls', label: 'TLS' }
]

export default function Trunks() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editingTrunk, setEditingTrunk] = useState(null)

  const { data: trunks, isLoading } = useQuery({
    queryKey: ['trunks'],
    queryFn: getTrunks
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTrunk,
    onSuccess: () => queryClient.invalidateQueries(['trunks'])
  })

  const testMutation = useMutation({
    mutationFn: testTrunk,
    onSuccess: () => queryClient.invalidateQueries(['trunks'])
  })

  const handleEdit = (trunk) => {
    setEditingTrunk(trunk)
    setShowModal(true)
  }

  const handleCreate = () => {
    setEditingTrunk(null)
    setShowModal(true)
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">SIP Trunks</h1>
          <p className="text-gray-500 mt-1">Configure outbound SIP connections for campaigns</p>
        </div>
        <button
          onClick={handleCreate}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-5 h-5 mr-2" />
          Add Trunk
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : trunks?.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Server className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No SIP trunks configured</h3>
          <p className="text-gray-500 mb-4">Add a SIP trunk to enable outbound calling.</p>
          <button
            onClick={handleCreate}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5 mr-2" />
            Add First Trunk
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Host</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Caller ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Max Channels</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {trunks?.map((trunk) => (
                <tr key={trunk.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <Phone className="w-5 h-5 text-gray-400 mr-3" />
                      <div className="font-medium text-gray-900">{trunk.name}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 font-mono">
                    {trunk.host}:{trunk.port} ({trunk.transport.toUpperCase()})
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {trunk.caller_id || '-'}
                  </td>
                  <td className="px-6 py-4">
                    <span className={clsx(
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      trunk.status === 'active' ? 'bg-green-100 text-green-800' :
                      trunk.status === 'testing' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-gray-100 text-gray-800'
                    )}>
                      {trunk.status === 'active' && <CheckCircle className="w-3 h-3 mr-1" />}
                      {trunk.status === 'inactive' && <XCircle className="w-3 h-3 mr-1" />}
                      {trunk.status.charAt(0).toUpperCase() + trunk.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">{trunk.max_channels}</td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button
                      onClick={() => testMutation.mutate(trunk.id)}
                      disabled={testMutation.isPending}
                      className="text-blue-600 hover:text-blue-900 disabled:opacity-50"
                      title="Test connection"
                    >
                      <RefreshCw className={clsx("w-5 h-5", testMutation.isPending && "animate-spin")} />
                    </button>
                    <button
                      onClick={() => handleEdit(trunk)}
                      className="text-gray-600 hover:text-gray-900"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete trunk "${trunk.name}"?`)) {
                          deleteMutation.mutate(trunk.id)
                        }
                      }}
                      className="text-red-600 hover:text-red-900"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <TrunkModal 
          trunk={editingTrunk} 
          onClose={() => setShowModal(false)} 
        />
      )}
    </div>
  )
}

function TrunkModal({ trunk, onClose }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    name: trunk?.name || '',
    host: trunk?.host || '',
    port: trunk?.port || 5060,
    transport: trunk?.transport || 'udp',
    username: trunk?.username || '',
    password: '',
    caller_id: trunk?.caller_id || '',
    codecs: trunk?.codecs || 'ulaw,alaw',
    max_channels: trunk?.max_channels || 10
  })
  const [error, setError] = useState('')

  const mutation = useMutation({
    mutationFn: (data) => trunk ? updateTrunk(trunk.id, data) : createTrunk(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['trunks'])
      onClose()
    },
    onError: (err) => setError(err.response?.data?.error || 'Failed to save trunk')
  })

  const handleSubmit = (e) => {
    e.preventDefault()
    setError('')
    
    if (!form.name || !form.host) {
      setError('Name and host are required')
      return
    }
    
    const data = { ...form }
    if (!data.password && trunk) delete data.password // Don't update password if empty
    
    mutation.mutate(data)
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-lg font-bold text-gray-900">
            {trunk ? 'Edit SIP Trunk' : 'Add SIP Trunk'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="My SIP Provider"
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Host *</label>
                <input
                  type="text"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="sip.provider.com"
                  className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
                <input
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) })}
                  className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Transport</label>
              <select
                value={form.transport}
                onChange={(e) => setForm({ ...form, transport: e.target.value })}
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
              >
                {transports.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={trunk ? '(unchanged)' : ''}
                  className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Caller ID</label>
              <input
                type="text"
                value={form.caller_id}
                onChange={(e) => setForm({ ...form, caller_id: e.target.value })}
                placeholder="+1234567890"
                className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Codecs</label>
                <input
                  type="text"
                  value={form.codecs}
                  onChange={(e) => setForm({ ...form, codecs: e.target.value })}
                  placeholder="ulaw,alaw"
                  className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Max Channels</label>
                <input
                  type="number"
                  value={form.max_channels}
                  onChange={(e) => setForm({ ...form, max_channels: parseInt(e.target.value) })}
                  min="1"
                  className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {mutation.isPending ? 'Saving...' : (trunk ? 'Update' : 'Create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
