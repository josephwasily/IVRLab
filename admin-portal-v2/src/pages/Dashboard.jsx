import { useQuery } from '@tanstack/react-query'
import { getDashboardStats, getExtensionStats } from '../lib/api'
import { useI18n } from '../contexts/I18nContext'
import { Phone, PhoneCall, Clock, Hash } from 'lucide-react'

function StatCard({ icon: Icon, label, value, subValue, color }) {
  return (
    <div className="rounded-lg bg-white p-6 shadow">
      <div className="flex items-center gap-4">
        <div className={`rounded-lg p-3 ${color}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
        <div>
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {subValue && <p className="text-xs text-gray-400">{subValue}</p>}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { t, formatNumber } = useI18n()
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: getDashboardStats
  })

  const { data: extStats } = useQuery({
    queryKey: ['extension-stats'],
    queryFn: getExtensionStats
  })

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">{t('dashboard.title')}</h1>

      <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Phone}
          label={t('dashboard.activeIvrs')}
          value={formatNumber(stats?.ivrs?.active || 0)}
          subValue={t('dashboard.totalSuffix', { count: formatNumber(stats?.ivrs?.total || 0) })}
          color="bg-blue-500"
        />
        <StatCard
          icon={PhoneCall}
          label={t('dashboard.callsToday')}
          value={formatNumber(stats?.calls?.total || 0)}
          subValue={t('dashboard.completedSuffix', { count: formatNumber(stats?.calls?.completed || 0) })}
          color="bg-green-500"
        />
        <StatCard
          icon={Clock}
          label={t('dashboard.avgDuration')}
          value={`${formatNumber(stats?.calls?.avgDuration || 0)}s`}
          color="bg-purple-500"
        />
        <StatCard
          icon={Hash}
          label={t('dashboard.extensions')}
          value={formatNumber(stats?.extensions || 0)}
          subValue={extStats ? t('dashboard.availableSuffix', { count: formatNumber(extStats.available) }) : ''}
          color="bg-orange-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{t('dashboard.quickActions')}</h2>
          <div className="space-y-3">
            <a
              href="/ivr/create"
              className="block rounded-lg bg-blue-50 px-4 py-3 text-blue-700 hover:bg-blue-100"
            >
              {t('dashboard.createIvr')}
            </a>
            <a
              href="/templates"
              className="block rounded-lg bg-gray-50 px-4 py-3 text-gray-700 hover:bg-gray-100"
            >
              {t('dashboard.browseTemplates')}
            </a>
            <a
              href="/analytics"
              className="block rounded-lg bg-gray-50 px-4 py-3 text-gray-700 hover:bg-gray-100"
            >
              {t('dashboard.viewCallLogs')}
            </a>
          </div>
        </div>

        <div className="rounded-lg bg-white p-6 shadow">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">{t('dashboard.ivrStatus')}</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b py-2">
              <span className="text-gray-600">{t('common.active')}</span>
              <span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-800">
                {formatNumber(stats?.ivrs?.active || 0)}
              </span>
            </div>
            <div className="flex items-center justify-between border-b py-2">
              <span className="text-gray-600">{t('common.draft')}</span>
              <span className="rounded-full bg-yellow-100 px-3 py-1 text-sm text-yellow-800">
                {formatNumber(stats?.ivrs?.draft || 0)}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-gray-600">{t('common.inactive')}</span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-800">
                {formatNumber(stats?.ivrs?.inactive || 0)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 border-t border-gray-200 py-6">
        <p className="mb-4 text-center text-sm text-gray-500">{t('dashboard.builtBy')}</p>
        <div className="flex items-center justify-center gap-12">
          <img
            src="/replexity_logo.jpg"
            alt="Replexity"
            className="h-12 object-contain"
          />
          <img
            src="/eplus_logo.png"
            alt="EPlus"
            className="h-12 object-contain"
          />
        </div>
      </div>
    </div>
  )
}
