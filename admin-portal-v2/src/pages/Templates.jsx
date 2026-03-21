import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getTemplates } from '../lib/api'
import { useI18n } from '../contexts/I18nContext'
import { FileText, ArrowRight, ArrowLeft } from 'lucide-react'

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
  const { t, isRTL } = useI18n()
  const ArrowIcon = isRTL ? ArrowLeft : ArrowRight

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{t('templates.title')}</h1>
        <p className="mt-1 text-gray-600">{t('templates.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {templates?.map((template) => (
          <div key={template.id} className="overflow-hidden rounded-lg bg-white shadow">
            <div className="p-6">
              <div className="mb-4 flex items-start justify-between">
                <div className="rounded-lg bg-blue-100 p-3">
                  <FileText className="h-6 w-6 text-blue-600" />
                </div>
                <span className={`rounded px-2 py-1 text-xs ${categoryColors[template.category] || categoryColors.general}`}>
                  {template.category}
                </span>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">{template.name}</h3>
              <p className="mb-4 text-sm text-gray-600">{template.description}</p>
              <Link
                to={`/ivr/create?template=${template.id}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                {t('templates.useTemplate')}
                <ArrowIcon className="h-4 w-4" />
              </Link>
            </div>
          </div>
        ))}
      </div>

      {templates?.length === 0 && (
        <div className="rounded-lg bg-white p-12 text-center shadow">
          <FileText className="mx-auto mb-4 h-16 w-16 text-gray-300" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">{t('templates.emptyTitle')}</h2>
          <p className="text-gray-500">{t('templates.emptySubtitle')}</p>
        </div>
      )}
    </div>
  )
}
