import { Languages } from 'lucide-react'
import { useI18n } from '../contexts/I18nContext'

export default function LanguageToggle() {
  const { language, toggleLanguage, t, isUpdatingLanguage } = useI18n()

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      disabled={isUpdatingLanguage}
      className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
      title={language === 'ar' ? t('common.switchToEnglish') : t('common.switchToArabic')}
    >
      <Languages className="h-4 w-4" />
      <span>{language === 'ar' ? 'EN' : 'AR'}</span>
    </button>
  )
}
