import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../contexts/I18nContext'
import {
  LayoutDashboard,
  Phone,
  FileText,
  BarChart3,
  LogOut,
  Menu,
  X,
  Music,
  Server,
  PhoneOutgoing,
  PhoneForwarded,
  TerminalSquare
} from 'lucide-react'
import { useState } from 'react'
import clsx from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { getAsteriskStatus } from '../lib/api'
import LanguageToggle from './LanguageToggle'

const navItems = [
  { to: '/', icon: LayoutDashboard, labelKey: 'layout.dashboard' },
  { to: '/ivr', icon: Phone, labelKey: 'layout.ivrFlows' },
  { to: '/prompts', icon: Music, labelKey: 'layout.prompts' },
  { to: '/templates', icon: FileText, labelKey: 'layout.templates' },
  { to: '/campaigns', icon: PhoneOutgoing, labelKey: 'layout.campaigns' },
  { to: '/outbound-calls', icon: PhoneForwarded, labelKey: 'layout.callHistory' },
  { to: '/logs', icon: TerminalSquare, labelKey: 'layout.logs' },
  { to: '/trunks', icon: Server, labelKey: 'layout.trunks' },
  { to: '/analytics', icon: BarChart3, labelKey: 'layout.analytics' }
]

const viewerAllowedPaths = new Set(['/analytics', '/outbound-calls', '/campaigns'])

export default function Layout() {
  const { user, logout } = useAuth()
  const { t, formatTime, isRTL } = useI18n()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { data: asteriskStatus, isFetching: isAsteriskRefreshing } = useQuery({
    queryKey: ['asterisk-status'],
    queryFn: getAsteriskStatus,
    refetchInterval: 5000,
    retry: false
  })
  const asteriskWarnings = asteriskStatus?.warnings || []
  const visibleNavItems = user?.role === 'viewer'
    ? navItems.filter((item) => viewerAllowedPaths.has(item.to))
    : navItems

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="min-h-screen flex bg-gray-100">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black bg-opacity-50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={clsx(
          'fixed inset-y-0 z-30 w-64 bg-gray-900 transition-transform lg:static lg:translate-x-0',
          isRTL ? 'right-0' : 'left-0',
          sidebarOpen ? 'translate-x-0' : (isRTL ? 'translate-x-full' : '-translate-x-full')
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex h-16 items-center justify-between bg-gray-800 px-6">
            <span className="text-xl font-bold text-white">{t('common.appName')}</span>
            <button
              className="text-gray-400 hover:text-white lg:hidden"
              onClick={() => setSidebarOpen(false)}
              title={t('common.loading')}
            >
              <X size={24} />
            </button>
          </div>

          <nav className="flex-1 space-y-2 px-4 py-6">
            {visibleNavItems.map(({ to, icon: Icon, labelKey }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) => clsx(
                  'flex items-center gap-3 rounded-lg px-4 py-3 transition-colors',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                )}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={20} />
                <span>{t(labelKey)}</span>
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-gray-800 p-4">
            <div className="mb-3 flex justify-center">
              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                {t('common.trialAccount')}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">{user?.name}</p>
                <p className="text-xs text-gray-400">{user?.tenant?.name}</p>
              </div>
              <button
                onClick={handleLogout}
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-800 hover:text-white"
                title={t('common.logout')}
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b bg-white px-6">
          <div className="flex items-center gap-3">
            <button
              className="p-2 text-gray-600 hover:text-gray-900 lg:hidden"
              onClick={() => setSidebarOpen(true)}
              title={t('layout.topbarLabel')}
            >
              <Menu size={24} />
            </button>
            <span className="hidden text-sm font-medium text-gray-500 sm:inline">{t('layout.topbarLabel')}</span>
          </div>
          <LanguageToggle />
        </header>

        <main className="flex-1 overflow-auto p-6">
          {asteriskWarnings.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
              <div className="font-semibold">{t('layout.asteriskWarning')}</div>
              <div className="mt-1 text-sm">{asteriskWarnings[0]}</div>
              <div className="mt-2 text-sm">
                Current `EXTERNAL_IP`: {asteriskStatus?.externalIp || t('common.unknown')} ·
                `external_media_address`: {asteriskStatus?.asteriskExternalMediaAddress || t('common.unknown')}
              </div>
              <div className="mt-2 text-sm">
                {t('layout.fixLabel')}: run `bash scripts/update-ip.sh &lt;EXTERNAL_IP&gt;` and then `docker compose restart asterisk`.
              </div>
            </div>
          )}
          <Outlet />
        </main>

        <footer className="flex h-auto flex-col gap-2 border-t bg-white px-6 py-3 text-sm sm:h-12 sm:flex-row sm:items-center sm:justify-between sm:py-0">
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                'inline-block h-2.5 w-2.5 rounded-full',
                asteriskStatus?.running ? 'bg-green-500' : 'bg-red-500'
              )}
            />
            <span className="text-gray-700">
              {t('layout.asteriskStatus')}: {asteriskStatus?.running ? t('common.running') : t('common.offline')}
            </span>
            <span className="text-gray-400">
              {asteriskStatus?.host}:{asteriskStatus?.port}
            </span>
          </div>
          <div className="text-gray-500">
            {isAsteriskRefreshing
              ? t('common.refreshing')
              : t('common.updatedAt', {
                  time: asteriskStatus?.checkedAt ? formatTime(asteriskStatus.checkedAt) : '-'
                })}
          </div>
        </footer>
      </div>
    </div>
  )
}
