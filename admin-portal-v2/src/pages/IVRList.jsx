import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getIVRs, deleteIVR, activateIVR } from '../lib/api'
import { useI18n } from '../contexts/I18nContext'
import { Plus, Edit, Trash2, Power, Phone } from 'lucide-react'
import clsx from 'clsx'

const statusColors = {
  active: 'bg-green-100 text-green-800',
  draft: 'bg-yellow-100 text-yellow-800',
  inactive: 'bg-gray-100 text-gray-800'
}

export default function IVRList() {
  const queryClient = useQueryClient()
  const { t, formatDate } = useI18n()

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
    if (confirm(t('ivrList.deleteConfirm', { name: ivr.name }))) {
      deleteMutation.mutate(ivr.id)
    }
  }

  const handleToggleActive = (ivr) => {
    const active = ivr.status !== 'active'
    activateMutation.mutate({ id: ivr.id, active })
  }

  const statusLabels = {
    active: t('common.active'),
    draft: t('common.draft'),
    inactive: t('common.inactive')
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">{t('ivrList.title')}</h1>
        <Link
          to="/ivr/create"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
        >
          <Plus className="h-5 w-5" />
          {t('ivrList.create')}
        </Link>
      </div>

      {ivrs?.length === 0 ? (
        <div className="rounded-lg bg-white p-12 text-center shadow">
          <Phone className="mx-auto mb-4 h-16 w-16 text-gray-300" />
          <h2 className="mb-2 text-xl font-semibold text-gray-900">{t('ivrList.emptyTitle')}</h2>
          <p className="mb-6 text-gray-500">{t('ivrList.emptySubtitle')}</p>
          <div className="flex justify-center gap-4">
            <Link
              to="/ivr/create"
              className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
            >
              {t('ivrList.create')}
            </Link>
            <Link
              to="/templates"
              className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
            >
              {t('ivrList.browseTemplates')}
            </Link>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg bg-white shadow">
          <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 sm:px-6">{t('ivrList.table.name')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 sm:px-6">{t('ivrList.table.extension')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 sm:px-6">{t('ivrList.table.status')}</th>
                <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 lg:table-cell lg:px-6">{t('ivrList.table.language')}</th>
                <th className="hidden px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 xl:table-cell xl:px-6">{t('ivrList.table.updated')}</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500 sm:px-6">{t('ivrList.table.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {ivrs?.map((ivr) => (
                <tr key={ivr.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4 sm:px-6">
                    <Link to={`/ivr/${ivr.id}`} className="block max-w-[220px] truncate font-medium text-blue-600 hover:underline sm:max-w-[320px] xl:max-w-none">
                      {ivr.name}
                    </Link>
                    {ivr.description && (
                      <p className="max-w-[220px] truncate text-sm text-gray-500 sm:max-w-[320px] xl:max-w-xs">{ivr.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-4 sm:px-6">
                    <span className="rounded bg-gray-100 px-2 py-1 font-mono text-sm">
                      {ivr.extension}
                    </span>
                  </td>
                  <td className="px-4 py-4 sm:px-6">
                    <span className={clsx('rounded-full px-2 py-1 text-xs font-medium', statusColors[ivr.status])}>
                      {statusLabels[ivr.status] || ivr.status}
                    </span>
                  </td>
                  <td className="hidden px-4 py-4 text-sm text-gray-500 lg:table-cell lg:px-6">
                    {ivr.language === 'ar' ? t('ivrList.arabic') : t('ivrList.english')}
                  </td>
                  <td className="hidden px-4 py-4 text-sm text-gray-500 xl:table-cell xl:px-6">
                    {formatDate(ivr.updated_at)}
                  </td>
                  <td className="px-4 py-4 text-right sm:px-6">
                    <div className="flex justify-end gap-1 sm:gap-2">
                      <button
                        onClick={() => handleToggleActive(ivr)}
                        className={clsx(
                          'rounded p-2 hover:bg-gray-100',
                          ivr.status === 'active' ? 'text-green-600' : 'text-gray-400'
                        )}
                        title={ivr.status === 'active' ? t('ivrList.deactivate') : t('ivrList.activate')}
                      >
                        <Power className="h-5 w-5" />
                      </button>
                      <Link
                        to={`/ivr/${ivr.id}`}
                        className="rounded p-2 text-blue-600 hover:bg-gray-100"
                        title={t('ivrList.edit')}
                      >
                        <Edit className="h-5 w-5" />
                      </Link>
                      <button
                        onClick={() => handleDelete(ivr)}
                        className="rounded p-2 text-red-600 hover:bg-gray-100"
                        title={t('ivrList.delete')}
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  )
}
