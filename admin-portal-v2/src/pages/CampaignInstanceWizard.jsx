import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getCampaign, getCampaignInstances } from '../lib/api'
import { ArrowLeft, Loader2 } from 'lucide-react'
import CampaignInstanceForm from '../components/CampaignInstanceForm'
import { useI18n } from '../contexts/I18nContext'

export default function CampaignInstanceWizard() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()

  const { data: campaign, isLoading: loadingCampaign } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => getCampaign(id)
  })

  const { data: instances } = useQuery({
    queryKey: ['campaign-instances', id],
    queryFn: () => getCampaignInstances(id),
    refetchInterval: 10000
  })

  const latestInstance = instances?.[0] || null
  const activeInstance = instances?.find((instance) => ['running', 'paused'].includes(instance.status)) || null

  if (loadingCampaign) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-blue-600" /></div>
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center gap-4">
        <button onClick={() => navigate(`/campaigns/${id}`)} className="rounded-lg p-2 hover:bg-gray-100">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{campaign?.name || ''}</h1>
          <p className="text-sm text-gray-500">{t('instanceWizard.sectionSubtitle')}</p>
        </div>
        <Link to={`/campaigns/${id}`} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
          {t('campaignEdit.details')}
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg bg-white p-4 shadow"><div className="text-sm text-gray-500">{t('campaignEdit.totalInstances')}</div><div className="mt-1 text-2xl font-bold text-gray-900">{instances?.length || 0}</div><div className="text-xs text-gray-500">{latestInstance ? t('campaignEdit.runHash', { number: latestInstance.run_number }) : t('campaignEdit.noRuns')}</div></div>
        <div className="rounded-lg bg-white p-4 shadow"><div className="text-sm text-gray-500">{t('campaignEdit.runningInstances')}</div><div className="mt-1 text-2xl font-bold text-green-600">{instances?.filter((instance) => instance.status === 'running').length || 0}</div></div>
        <div className="rounded-lg bg-white p-4 shadow"><div className="text-sm text-gray-500">{t('campaignEdit.latestInstance')}</div><div className="mt-1 text-sm font-semibold text-gray-900">{activeInstance ? t('campaignEdit.runHash', { number: activeInstance.run_number }) : t('campaignEdit.noRuns')}</div></div>
      </div>

      <CampaignInstanceForm campaign={campaign} instances={instances} />
    </div>
  )
}
