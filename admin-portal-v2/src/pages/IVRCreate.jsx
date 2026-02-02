import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getTemplates, createIVR } from '../lib/api'
import { ArrowLeft, Check } from 'lucide-react'
import clsx from 'clsx'

export default function IVRCreate() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    language: 'ar'
  })

  const { data: templates } = useQuery({
    queryKey: ['templates'],
    queryFn: getTemplates
  })

  const createMutation = useMutation({
    mutationFn: createIVR,
    onSuccess: (data) => {
      navigate(`/ivr/${data.id}`)
    }
  })

  const handleCreate = () => {
    createMutation.mutate({
      name: formData.name,
      description: formData.description,
      language: formData.language,
      templateId: selectedTemplate?.id
    })
  }

  return (
    <div>
      <div className="flex items-center mb-6">
        <button
          onClick={() => step > 1 ? setStep(step - 1) : navigate('/ivr')}
          className="p-2 text-gray-600 hover:text-gray-900 mr-4"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Create New IVR</h1>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center mb-8">
        {[1, 2].map((s) => (
          <div key={s} className="flex items-center">
            <div className={clsx(
              'w-8 h-8 rounded-full flex items-center justify-center font-medium',
              s <= step ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-600'
            )}>
              {s < step ? <Check className="w-5 h-5" /> : s}
            </div>
            <span className={clsx(
              'ml-2 mr-4',
              s <= step ? 'text-gray-900' : 'text-gray-400'
            )}>
              {s === 1 ? 'Choose Template' : 'Configure'}
            </span>
            {s < 2 && <div className="w-12 h-0.5 bg-gray-200 mr-4" />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div>
          <p className="text-gray-600 mb-6">
            Start from a template or create a blank IVR
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {/* Blank IVR option */}
            <button
              onClick={() => {
                setSelectedTemplate(null)
                setStep(2)
              }}
              className={clsx(
                'p-6 border-2 rounded-lg text-left hover:border-blue-500',
                !selectedTemplate ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
              )}
            >
              <h3 className="font-semibold text-gray-900 mb-2">Blank IVR</h3>
              <p className="text-sm text-gray-500">Start from scratch with an empty flow</p>
            </button>

            {/* Templates */}
            {templates?.map((template) => (
              <button
                key={template.id}
                onClick={() => {
                  setSelectedTemplate(template)
                  setFormData(prev => ({ ...prev, name: template.name }))
                  setStep(2)
                }}
                className={clsx(
                  'p-6 border-2 rounded-lg text-left hover:border-blue-500',
                  selectedTemplate?.id === template.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                )}
              >
                <div className="flex justify-between items-start">
                  <h3 className="font-semibold text-gray-900 mb-2">{template.name}</h3>
                  <span className="text-xs bg-gray-100 px-2 py-1 rounded">{template.category}</span>
                </div>
                <p className="text-sm text-gray-500">{template.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="max-w-xl">
          <div className="bg-white rounded-lg shadow p-6 space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                IVR Name *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Account Balance IVR"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                rows={3}
                placeholder="Brief description of this IVR"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Language
              </label>
              <select
                value={formData.language}
                onChange={(e) => setFormData(prev => ({ ...prev, language: e.target.value }))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="ar">Arabic</option>
                <option value="en">English</option>
              </select>
            </div>

            {selectedTemplate && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  <strong>Template:</strong> {selectedTemplate.name}
                </p>
                <p className="text-sm text-blue-600 mt-1">{selectedTemplate.description}</p>
              </div>
            )}

            <div className="flex justify-end space-x-4 pt-4">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={handleCreate}
                disabled={!formData.name || createMutation.isPending}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating...' : 'Create IVR'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
