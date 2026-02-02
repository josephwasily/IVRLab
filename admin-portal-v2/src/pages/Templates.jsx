import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getTemplates } from '../lib/api'
import { FileText, ArrowRight } from 'lucide-react'

const categoryColors = {
  finance: 'bg-green-100 text-green-800',
  healthcare: 'bg-blue-100 text-blue-800',
  retail: 'bg-purple-100 text-purple-800',
  general: 'bg-gray-100 text-gray-800'
}

export default function Templates() {
  const { data: templates, isLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: getTemplates
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">IVR Templates</h1>
        <p className="text-gray-600 mt-1">Pre-built templates to get you started quickly</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates?.map((template) => (
          <div key={template.id} className="bg-white rounded-lg shadow overflow-hidden">
            <div className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <FileText className="w-6 h-6 text-blue-600" />
                </div>
                <span className={`text-xs px-2 py-1 rounded ${categoryColors[template.category] || categoryColors.general}`}>
                  {template.category}
                </span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">{template.name}</h3>
              <p className="text-gray-600 text-sm mb-4">{template.description}</p>
              <Link
                to={`/ivr/create?template=${template.id}`}
                className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium text-sm"
              >
                Use Template
                <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </div>
          </div>
        ))}
      </div>

      {templates?.length === 0 && (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">No Templates Yet</h2>
          <p className="text-gray-500">System templates will appear here</p>
        </div>
      )}
    </div>
  )
}
