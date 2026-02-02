import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getIVRs, deleteIVR, activateIVR } from '../lib/api'
import { Plus, Edit, Trash2, Power, Copy, Phone } from 'lucide-react'
import clsx from 'clsx'

const statusColors = {
  active: 'bg-green-100 text-green-800',
  draft: 'bg-yellow-100 text-yellow-800',
  inactive: 'bg-gray-100 text-gray-800'
}

export default function IVRList() {
  const queryClient = useQueryClient()
  
  const { data: ivrs, isLoading } = useQuery({
    queryKey: ['ivrs'],
    queryFn: getIVRs
  })

  const deleteMutation = useMutation({
    mutationFn: deleteIVR,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ivrs'] })
    }
  })

  const activateMutation = useMutation({
    mutationFn: ({ id, active }) => activateIVR(id, active),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ivrs'] })
    }
  })

  const handleDelete = (ivr) => {
    if (confirm(`Delete "${ivr.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(ivr.id)
    }
  }

  const handleToggleActive = (ivr) => {
    const active = ivr.status !== 'active'
    activateMutation.mutate({ id: ivr.id, active })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">IVR Flows</h1>
        <Link
          to="/ivr/create"
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-5 h-5 mr-2" />
          Create IVR
        </Link>
      </div>

      {ivrs?.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Phone className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No IVR Flows Yet</h2>
          <p className="text-gray-500 mb-6">Create your first IVR flow or start from a template</p>
          <div className="space-x-4">
            <Link
              to="/ivr/create"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Create IVR
            </Link>
            <Link
              to="/templates"
              className="inline-flex items-center px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
            >
              Browse Templates
            </Link>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Extension</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Language</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {ivrs?.map((ivr) => (
                <tr key={ivr.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <Link to={`/ivr/${ivr.id}`} className="text-blue-600 hover:underline font-medium">
                      {ivr.name}
                    </Link>
                    {ivr.description && (
                      <p className="text-sm text-gray-500 truncate max-w-xs">{ivr.description}</p>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                      {ivr.extension}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={clsx(
                      'px-2 py-1 rounded-full text-xs font-medium',
                      statusColors[ivr.status]
                    )}>
                      {ivr.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {ivr.language === 'ar' ? 'Arabic' : 'English'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {new Date(ivr.updated_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={() => handleToggleActive(ivr)}
                        className={clsx(
                          'p-2 rounded hover:bg-gray-100',
                          ivr.status === 'active' ? 'text-green-600' : 'text-gray-400'
                        )}
                        title={ivr.status === 'active' ? 'Deactivate' : 'Activate'}
                      >
                        <Power className="w-5 h-5" />
                      </button>
                      <Link
                        to={`/ivr/${ivr.id}`}
                        className="p-2 text-blue-600 rounded hover:bg-gray-100"
                        title="Edit"
                      >
                        <Edit className="w-5 h-5" />
                      </Link>
                      <button
                        onClick={() => handleDelete(ivr)}
                        className="p-2 text-red-600 rounded hover:bg-gray-100"
                        title="Delete"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
