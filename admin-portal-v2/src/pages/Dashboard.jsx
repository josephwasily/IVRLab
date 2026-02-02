import { useQuery } from '@tanstack/react-query'
import { getDashboardStats, getExtensionStats } from '../lib/api'
import { Phone, PhoneCall, Clock, Hash } from 'lucide-react'

function StatCard({ icon: Icon, label, value, subValue, color }) {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center">
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        <div className="ml-4">
          <p className="text-sm text-gray-500">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {subValue && <p className="text-xs text-gray-400">{subValue}</p>}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
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
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatCard
          icon={Phone}
          label="Active IVRs"
          value={stats?.ivrs?.active || 0}
          subValue={`${stats?.ivrs?.total || 0} total`}
          color="bg-blue-500"
        />
        <StatCard
          icon={PhoneCall}
          label="Calls Today"
          value={stats?.calls?.total || 0}
          subValue={`${stats?.calls?.completed || 0} completed`}
          color="bg-green-500"
        />
        <StatCard
          icon={Clock}
          label="Avg Duration"
          value={`${stats?.calls?.avgDuration || 0}s`}
          color="bg-purple-500"
        />
        <StatCard
          icon={Hash}
          label="Extensions"
          value={stats?.extensions || 0}
          subValue={extStats ? `${extStats.available} available` : ''}
          color="bg-orange-500"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Quick Actions */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <a
              href="/ivr/create"
              className="block px-4 py-3 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100"
            >
              Create New IVR →
            </a>
            <a
              href="/templates"
              className="block px-4 py-3 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100"
            >
              Browse Templates →
            </a>
            <a
              href="/analytics"
              className="block px-4 py-3 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100"
            >
              View Call Logs →
            </a>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">IVR Status</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-gray-600">Active</span>
              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm">
                {stats?.ivrs?.active || 0}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-gray-600">Draft</span>
              <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm">
                {stats?.ivrs?.draft || 0}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-gray-600">Inactive</span>
              <span className="px-3 py-1 bg-gray-100 text-gray-800 rounded-full text-sm">
                {stats?.ivrs?.inactive || 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Partner Logos Footer */}
      <div className="mt-8 py-6 border-t border-gray-200">
        <p className="text-center text-sm text-gray-500 mb-4">Proudly built by</p>
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
