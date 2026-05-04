import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'

const STORAGE_KEY = 'ivr-language'

const translations = {
  ar: {
    common: {
      appName: 'منصة الرد الآلي',
      loading: 'جار التحميل...',
      builtBy: 'تم التطوير بواسطة',
      trialAccount: 'حساب تجريبي',
      logout: 'تسجيل الخروج',
      switchToArabic: 'التبديل إلى العربية',
      switchToEnglish: 'Switch to English',
      running: 'يعمل',
      offline: 'متوقف',
      refreshing: 'جار التحديث...',
      updatedAt: 'آخر تحديث {{time}}',
      unknown: 'غير معروف',
      status: 'الحالة',
      lines: 'الأسطر',
      active: 'نشط',
      draft: 'مسودة',
      inactive: 'غير نشط',
      archived: 'مؤرشف',
      completed: 'مكتمل',
      failed: 'فشل',
      paused: 'متوقف مؤقتا',
      cancelled: 'ملغي',
      notSet: 'غير محدد',
      contacts: 'جهات الاتصال',
      total: 'الإجمالي',
      available: 'متاح'
    },
    layout: {
      dashboard: 'لوحة التحكم',
      ivrFlows: 'مسارات الرد الآلي',
      prompts: 'المقاطع الصوتية',
      templates: 'القوالب',
      campaigns: 'الحملات',
      callHistory: 'سجل المكالمات',
      logs: 'سجلات أستريسك',
      trunks: 'الترانكات',
      analytics: 'التحليلات',
      asteriskWarning: 'تحذير شبكة أستريسك',
      fixLabel: 'الإصلاح',
      asteriskStatus: 'أستريسك',
      topbarLabel: 'لوحة الإدارة'
    },
    login: {
      title: 'منصة الرد الآلي',
      subtitle: 'سجّل الدخول لإدارة مسارات الرد الآلي',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
      signIn: 'تسجيل الدخول',
      signingIn: 'جار تسجيل الدخول...',
      failed: 'فشل تسجيل الدخول'
    },
    dashboard: {
      title: 'لوحة التحكم',
      activeIvrs: 'المسارات النشطة',
      callsToday: 'مكالمات اليوم',
      avgDuration: 'متوسط المدة',
      extensions: 'الامتدادات',
      totalSuffix: '{{count}} إجمالي',
      completedSuffix: '{{count}} مكتمل',
      availableSuffix: '{{count}} متاح',
      quickActions: 'إجراءات سريعة',
      createIvr: 'إنشاء مسار جديد',
      browseTemplates: 'استعراض القوالب',
      viewCallLogs: 'عرض سجل المكالمات',
      ivrStatus: 'حالة المسارات',
      builtBy: 'تم التطوير بواسطة'
    },
    ivrList: {
      title: 'مسارات الرد الآلي',
      create: 'إنشاء مسار',
      emptyTitle: 'لا توجد مسارات بعد',
      emptySubtitle: 'أنشئ أول مسار رد آلي أو ابدأ من قالب جاهز',
      browseTemplates: 'استعراض القوالب',
      table: {
        name: 'الاسم',
        extension: 'الامتداد',
        status: 'الحالة',
        language: 'اللغة',
        updated: 'آخر تحديث',
        actions: 'الإجراءات'
      },
      activate: 'تفعيل',
      deactivate: 'إيقاف',
      edit: 'تعديل',
      delete: 'حذف',
      deleteConfirm: 'هل تريد حذف "{{name}}"؟ لا يمكن التراجع عن ذلك.',
      arabic: 'العربية',
      english: 'الإنجليزية'
    },
    campaigns: {
      title: 'حملات الاتصال الخارجي',
      subtitle: 'إدارة حملات الاتصال الآلي',
      newCampaign: 'حملة جديدة',
      filterStatus: 'الحالة',
      allCampaigns: 'كل الحملات',
      emptyTitle: 'لا توجد حملات بعد',
      emptySubtitle: 'أنشئ أول حملة اتصال خارجي.',
      createCampaign: 'إنشاء حملة',
      runLabel: 'تشغيل رقم {{number}} - {{status}}',
      runsCount: '{{count}} تشغيل',
      ivrLabel: 'الرد الآلي',
      viaLabel: 'عبر {{name}}',
      processed: '{{done}} / {{total}} تمت معالجتها',
      completed: '{{count}} مكتمل',
      noAnswer: '{{count}} بدون رد',
      failed: '{{count}} فشل',
      configureTrunkFirst: 'قم بإعداد الترانك أولا',
      addContactsFirst: 'أضف جهات الاتصال أولا',
      startCampaign: 'بدء الحملة',
      startNewRun: 'بدء تشغيل جديد',
      pauseRun: 'إيقاف التشغيل مؤقتا',
      resumeRun: 'استئناف التشغيل',
      cancelRun: 'إلغاء التشغيل',
      editCampaign: 'تعديل الحملة',
      deleteCampaign: 'حذف الحملة',
      deleteConfirm: 'هل تريد حذف الحملة "{{name}}"؟',
      survey: 'استبيان',
      notification: 'إشعار',
      reminder: 'تذكير',
      collection: 'تحصيل',
      custom: 'مخصص'
    },
    campaignReport: {
      exportButton: 'تصدير التقرير',
      modalTitle: 'تصدير تقرير الاستبيان',
      captures: 'الأسئلة',
      dateRange: 'النطاق الزمني',
      from: 'من',
      to: 'إلى',
      digitRange: 'نطاق الأرقام',
      export: 'تصدير',
      exporting: 'جار التصدير...',
      cancel: 'إلغاء',
      empty: 'لا توجد أسئلة معرّفة في هذا المسار. أضف "تسمية التقرير" لأي عقدة جمع رقم واحد لتظهر هنا.',
      noSelection: 'يجب اختيار سؤال واحد على الأقل.'
    },
    campaignEdit: {
      newCampaign: 'حملة جديدة',
      managedHere: 'يتم تصميم الحملة هنا. ابدأ التشغيلات من معالج التشغيل.',
      startInstance: 'بدء تشغيل',
      save: 'حفظ',
      details: 'تفاصيل الحملة',
      campaignName: 'اسم الحملة',
      description: 'الوصف',
      campaignType: 'نوع الحملة',
      ivrFlow: 'مسار الرد الآلي',
      selectIvr: 'اختر مسار الرد الآلي...',
      dialing: 'إعدادات الاتصال',
      sipTrunk: 'الترانك',
      selectTrunk: 'اختر الترانك...',
      callerId: 'رقم المتصل',
      maxConcurrent: 'الحد الأقصى للمكالمات المتزامنة',
      retryAttempts: 'محاولات إعادة الاتصال',
      retryDelay: 'تأخير إعادة المحاولة (دقائق)',
      webhookIntegration: 'تكامل الويب هوك',
      webhookSubtitle: 'السماح للأنظمة الخارجية بتشغيل الحملة وجلب النتائج عبر API.',
      apiKey: 'مفتاح API',
      generateApiKey: 'إنشاء مفتاح API',
      regenerate: 'إعادة الإنشاء',
      copy: 'نسخ',
      copied: 'تم النسخ!',
      triggerUrl: 'رابط التشغيل',
      resultsUrl: 'رابط النتائج',
      flagConfig: 'إعداد علامة النتيجة',
      flagSubtitle: 'حدد متغيرا من المسار لإصدار علامة صح/خطأ لكل جهة اتصال في API النتائج.',
      flagVariable: 'اسم متغير العلامة',
      flagVariableHelp: 'اسم المتغير المسجل أثناء المكالمة (من عقدة جمع أو تفرع).',
      flagValue: 'قيمة العلامة الصحيحة',
      flagValueHelp: 'إذا كان المتغير يساوي هذه القيمة فإن العلامة تكون صحيحة.',
      totalInstances: 'إجمالي التشغيلات',
      runningInstances: 'التشغيلات النشطة',
      latestInstance: 'آخر تشغيل',
      runHash: 'تشغيل #{{number}}',
      noRuns: 'لا توجد تشغيلات بعد',
      startFromWizard: 'ابدأ من المعالج',
      instanceHistory: 'سجل التشغيلات',
      instanceHistorySub: 'استخدم زر بدء التشغيل لإطلاق تشغيل جديد بقائمة جهات اتصال.',
      pause: 'إيقاف',
      resume: 'استئناف',
      cancel: 'إلغاء',
      tableInstance: 'التشغيل',
      tableStatus: 'الحالة',
      tableContacts: 'جهات الاتصال',
      tableCompleted: 'مكتمل',
      tableFailed: 'فشل',
      tableStarted: 'بدأ في',
      tableResultsUrl: 'رابط النتائج',
      tableActions: 'الإجراءات',
      viewContacts: 'عرض جهات الاتصال',
      callHistory: 'سجل المكالمات',
      noInstances: 'لا توجد تشغيلات بعد. ابدأ الأول من المعالج.',
      refreshing: 'جار تحديث سجل التشغيل...',
      instanceContacts: 'جهات اتصال التشغيل',
      contactsForRun: 'جهات الاتصال والنتائج للتشغيل #{{number}}.',
      selectInstance: 'اختر تشغيلا لمراجعة جهات الاتصال.',
      selectInstanceEmpty: 'اختر تشغيلا من الأعلى لمراجعة جهات الاتصال المرفوعة.',
      noContactsForInstance: 'لا توجد جهات اتصال لهذا التشغيل.',
      refreshContacts: 'تحديث',
      viewCallHistory: 'عرض سجل المكالمات',
      refreshing2: 'جار تحديث جهات الاتصال...',
      colPhone: 'رقم الهاتف',
      colName: 'الاسم',
      colAttempts: 'المحاولات',
      colOutcome: 'النتيجة',
      colLastAttempt: 'آخر محاولة'
    },
    campaignsExtra: {
      exportReport: 'تصدير التقرير'
    },
    instanceWizard: {
      sectionTitle: 'بدء تشغيل جديد',
      sectionSubtitle: 'ارفع قائمة جهات الاتصال أو أدخل الأرقام يدويا لبدء تشغيل جديد.',
      noTrunk: 'هذه الحملة بحاجة إلى ترانك قبل بدء التشغيل.',
      noIvr: 'هذه الحملة بحاجة إلى مسار رد آلي قبل بدء التشغيل.',
      activeInstance: 'التشغيل #{{number}} في حالة {{status}}. أنه التشغيل الحالي قبل بدء واحد جديد.',
      modeCsv: 'رفع ملف',
      modeManual: 'إدخال يدوي',
      csvTitle: 'قائمة جهات الاتصال',
      csvSubtitle: 'حمل القالب أولا، املأ أرقام الهواتف، ثم ارفعه هنا.',
      downloadTemplate: 'تحميل القالب',
      selectFile: 'اختر ملف CSV أو إكسل',
      template: 'القالب',
      phoneColumn: 'عمود رقم الهاتف',
      selectColumn: 'اختر العمود...',
      startInstance: 'بدء التشغيل',
      quickEntry: 'إدخال سريع',
      quickEntryPlaceholder: 'الصق رقما واحدا في كل سطر أو اكتب الاسم - الرقم',
      phoneNumber: 'رقم الهاتف',
      name: 'الاسم',
      addRow: 'إضافة صف',
      viewCallHistory: 'عرض سجل المكالمات',
      readFileFailed: 'تعذر قراءة الملف: {{message}}',
      downloadFailed: 'تعذر تحميل القالب: {{message}}',
      createFailed: 'تعذر إنشاء التشغيل: {{message}}',
      createSuccess: 'تم بدء التشغيل #{{number}} بـ {{count}} جهة اتصال.'
    },
    nodeProperties: {
      reportLabelAr: 'تسمية التقرير (عربي)',
      reportLabelEn: 'تسمية التقرير (إنجليزي)',
      reportHelp: 'العقدات بحد أقصى رقم واحد ولها تسمية تقرير تظهر في تقرير الاستبيان.'
    },
    templates: {
      title: 'قوالب الرد الآلي',
      subtitle: 'قوالب جاهزة لتبدأ بسرعة',
      useTemplate: 'استخدام القالب',
      emptyTitle: 'لا توجد قوالب بعد',
      emptySubtitle: 'ستظهر قوالب النظام هنا'
    },
    logs: {
      title: 'السجلات المباشرة لأستريسك',
      refreshing: 'جار تحديث السجلات...',
      lastUpdate: 'آخر تحديث: {{time}}',
      loading: 'جار تحميل السجلات...',
      failed: 'تعذر تحميل السجلات: {{message}}',
      empty: 'لا توجد أسطر سجلات متاحة.'
    }
  },
  en: {
    common: {
      appName: 'IVR Platform',
      loading: 'Loading...',
      builtBy: 'Proudly built by',
      trialAccount: 'Trial Account',
      logout: 'Logout',
      switchToArabic: 'التبديل إلى العربية',
      switchToEnglish: 'Switch to English',
      running: 'Running',
      offline: 'Offline',
      refreshing: 'Refreshing...',
      updatedAt: 'Updated {{time}}',
      unknown: 'unknown',
      status: 'Status',
      lines: 'Lines',
      active: 'Active',
      draft: 'Draft',
      inactive: 'Inactive',
      archived: 'Archived',
      completed: 'Completed',
      failed: 'Failed',
      paused: 'Paused',
      cancelled: 'Cancelled',
      notSet: 'Not set',
      contacts: 'contacts',
      total: 'total',
      available: 'available'
    },
    layout: {
      dashboard: 'Dashboard',
      ivrFlows: 'IVR Flows',
      prompts: 'Prompts',
      templates: 'Templates',
      campaigns: 'Campaigns',
      callHistory: 'Call History',
      logs: 'Asterisk Logs',
      trunks: 'SIP Trunks',
      analytics: 'Analytics',
      asteriskWarning: 'Asterisk Network Warning',
      fixLabel: 'Fix',
      asteriskStatus: 'Asterisk',
      topbarLabel: 'Admin Portal'
    },
    login: {
      title: 'IVR Platform',
      subtitle: 'Sign in to manage your IVR flows',
      email: 'Email',
      password: 'Password',
      signIn: 'Sign in',
      signingIn: 'Signing in...',
      failed: 'Login failed'
    },
    dashboard: {
      title: 'Dashboard',
      activeIvrs: 'Active IVRs',
      callsToday: 'Calls Today',
      avgDuration: 'Avg Duration',
      extensions: 'Extensions',
      totalSuffix: '{{count}} total',
      completedSuffix: '{{count}} completed',
      availableSuffix: '{{count}} available',
      quickActions: 'Quick Actions',
      createIvr: 'Create New IVR',
      browseTemplates: 'Browse Templates',
      viewCallLogs: 'View Call Logs',
      ivrStatus: 'IVR Status',
      builtBy: 'Proudly built by'
    },
    ivrList: {
      title: 'IVR Flows',
      create: 'Create IVR',
      emptyTitle: 'No IVR Flows Yet',
      emptySubtitle: 'Create your first IVR flow or start from a template',
      browseTemplates: 'Browse Templates',
      table: {
        name: 'Name',
        extension: 'Extension',
        status: 'Status',
        language: 'Language',
        updated: 'Updated',
        actions: 'Actions'
      },
      activate: 'Activate',
      deactivate: 'Deactivate',
      edit: 'Edit',
      delete: 'Delete',
      deleteConfirm: 'Delete "{{name}}"? This cannot be undone.',
      arabic: 'Arabic',
      english: 'English'
    },
    campaigns: {
      title: 'Outbound Campaigns',
      subtitle: 'Manage automated calling campaigns',
      newCampaign: 'New Campaign',
      filterStatus: 'Status',
      allCampaigns: 'All Campaigns',
      emptyTitle: 'No campaigns yet',
      emptySubtitle: 'Create your first outbound calling campaign.',
      createCampaign: 'Create Campaign',
      runLabel: 'Run #{{number}} - {{status}}',
      runsCount: '{{count}} runs',
      ivrLabel: 'IVR',
      viaLabel: 'via {{name}}',
      processed: '{{done}} / {{total}} processed',
      completed: '{{count}} completed',
      noAnswer: '{{count}} no answer',
      failed: '{{count}} failed',
      configureTrunkFirst: 'Configure trunk first',
      addContactsFirst: 'Add contacts first',
      startCampaign: 'Start campaign',
      startNewRun: 'Start new run',
      pauseRun: 'Pause run',
      resumeRun: 'Resume run',
      cancelRun: 'Cancel run',
      editCampaign: 'Edit campaign',
      deleteCampaign: 'Delete campaign',
      deleteConfirm: 'Delete campaign "{{name}}"?',
      survey: 'Survey',
      notification: 'Notification',
      reminder: 'Reminder',
      collection: 'Collection',
      custom: 'Custom'
    },
    campaignReport: {
      exportButton: 'Export Report',
      modalTitle: 'Export Survey Report',
      captures: 'Questions',
      dateRange: 'Date range',
      from: 'From',
      to: 'To',
      digitRange: 'Digit range',
      export: 'Export',
      exporting: 'Exporting...',
      cancel: 'Cancel',
      empty: 'No labeled single-digit captures in this IVR. Add a "Report label" to any 1-digit collect node for it to appear here.',
      noSelection: 'Select at least one question.'
    },
    campaignEdit: {
      newCampaign: 'New Campaign',
      managedHere: 'Campaign design is managed here. Start instances from the dedicated wizard.',
      startInstance: 'Start Instance',
      save: 'Save',
      details: 'Campaign Details',
      campaignName: 'Campaign Name',
      description: 'Description',
      campaignType: 'Campaign Type',
      ivrFlow: 'IVR Flow',
      selectIvr: 'Select IVR Flow...',
      dialing: 'Dialing Configuration',
      sipTrunk: 'SIP Trunk',
      selectTrunk: 'Select Trunk...',
      callerId: 'Caller ID',
      maxConcurrent: 'Max Concurrent Calls',
      retryAttempts: 'Retry Attempts',
      retryDelay: 'Retry Delay (minutes)',
      webhookIntegration: 'Webhook Integration',
      webhookSubtitle: 'Allow external systems to trigger campaign runs and retrieve results via API.',
      apiKey: 'API Key',
      generateApiKey: 'Generate API Key',
      regenerate: 'Regenerate',
      copy: 'Copy',
      copied: 'Copied!',
      triggerUrl: 'Trigger URL',
      resultsUrl: 'Results URL',
      flagConfig: 'Result Flag Configuration',
      flagSubtitle: 'Configure a variable from the IVR flow to produce a true/false flag per contact in the results API.',
      flagVariable: 'Flag Variable Name',
      flagVariableHelp: 'The IVR variable name captured during the call (from a collect or branch node).',
      flagValue: 'Flag True Value',
      flagValueHelp: 'When the variable equals this value, the flag will be true.',
      totalInstances: 'Total Instances',
      runningInstances: 'Running Instances',
      latestInstance: 'Latest Instance',
      runHash: 'Run #{{number}}',
      noRuns: 'No instances yet',
      startFromWizard: 'Start one from the wizard',
      instanceHistory: 'Instance History',
      instanceHistorySub: 'Use Start Instance to launch a new run with a new contact list.',
      pause: 'Pause',
      resume: 'Resume',
      cancel: 'Cancel',
      tableInstance: 'Instance',
      tableStatus: 'Status',
      tableContacts: 'Contacts',
      tableCompleted: 'Completed',
      tableFailed: 'Failed',
      tableStarted: 'Started',
      tableResultsUrl: 'Results URL',
      tableActions: 'Actions',
      viewContacts: 'View Contacts',
      callHistory: 'Call History',
      noInstances: 'No instances yet. Start the first one from the wizard.',
      refreshing: 'Refreshing instance history...',
      instanceContacts: 'Instance Contacts',
      contactsForRun: 'Contacts and results for Run #{{number}}.',
      selectInstance: 'Select an instance to inspect its contacts.',
      selectInstanceEmpty: 'Select an instance above to review its uploaded contacts.',
      noContactsForInstance: 'No contacts found for this instance.',
      refreshContacts: 'Refresh',
      viewCallHistory: 'View Call History',
      refreshing2: 'Refreshing instance contacts...',
      colPhone: 'Phone',
      colName: 'Name',
      colAttempts: 'Attempts',
      colOutcome: 'Outcome',
      colLastAttempt: 'Last Attempt'
    },
    campaignsExtra: {
      exportReport: 'Export Report'
    },
    instanceWizard: {
      sectionTitle: 'Start a New Instance',
      sectionSubtitle: 'Upload a contact list or enter contacts manually to start a new instance.',
      noTrunk: 'This campaign needs a SIP trunk before an instance can start.',
      noIvr: 'This campaign needs an IVR flow before an instance can start.',
      activeInstance: 'Run #{{number}} is {{status}}. Finish it before starting another instance.',
      modeCsv: 'CSV Upload',
      modeManual: 'Manual Entry',
      csvTitle: 'CSV Contact List',
      csvSubtitle: 'Download the template first, fill in phone numbers, then upload it here.',
      downloadTemplate: 'Download Template',
      selectFile: 'Select CSV or Excel File',
      template: 'Template',
      phoneColumn: 'Phone Number Column',
      selectColumn: 'Select column...',
      startInstance: 'Start Instance',
      quickEntry: 'Quick Entry',
      quickEntryPlaceholder: 'Paste one phone number per line or use Name - Number',
      phoneNumber: 'Phone number',
      name: 'Name',
      addRow: 'Add Row',
      viewCallHistory: 'View Call History',
      readFileFailed: 'Could not read file: {{message}}',
      downloadFailed: 'Failed to download template: {{message}}',
      createFailed: 'Failed to create instance: {{message}}',
      createSuccess: 'Instance #{{number}} started with {{count}} contacts.'
    },
    nodeProperties: {
      reportLabelAr: 'Report label (Arabic)',
      reportLabelEn: 'Report label (English)',
      reportHelp: 'Collect nodes with Max Digits = 1 and a report label appear in the campaign survey report.'
    },
    templates: {
      title: 'IVR Templates',
      subtitle: 'Pre-built templates to get you started quickly',
      useTemplate: 'Use Template',
      emptyTitle: 'No Templates Yet',
      emptySubtitle: 'System templates will appear here'
    },
    logs: {
      title: 'Asterisk Live Logs',
      refreshing: 'Refreshing logs...',
      lastUpdate: 'Last update: {{time}}',
      loading: 'Loading logs...',
      failed: 'Failed to load logs: {{message}}',
      empty: 'No log lines available.'
    }
  }
}

const I18nContext = createContext(null)

function getValueByPath(obj, path) {
  return path.split('.').reduce((value, key) => value?.[key], obj)
}

function interpolate(template, values) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    template
  )
}

export function I18nProvider({ children }) {
  const { user, updateLanguage } = useAuth()
  const [guestLanguage, setGuestLanguage] = useState(() => {
    if (typeof window === 'undefined') return 'ar'
    return localStorage.getItem(STORAGE_KEY) || 'ar'
  })
  const [isUpdatingLanguage, setIsUpdatingLanguage] = useState(false)
  const language = user?.language || guestLanguage || 'ar'

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, language)
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    document.title = language === 'ar' ? 'منصة الرد الآلي' : 'IVR Platform'
  }, [language])

  const t = useCallback((key, values = {}) => {
    const template =
      getValueByPath(translations[language], key) ??
      getValueByPath(translations.en, key) ??
      key

    return typeof template === 'string' ? interpolate(template, values) : template
  }, [language])

  const locale = language === 'ar' ? 'ar-EG' : 'en-US'

  const setLanguage = useCallback(async (nextLanguage) => {
    if (!['ar', 'en'].includes(nextLanguage) || nextLanguage === language) {
      return
    }

    if (user) {
      setIsUpdatingLanguage(true)
      try {
        await updateLanguage(nextLanguage)
      } finally {
        setIsUpdatingLanguage(false)
      }
      return
    }

    setGuestLanguage(nextLanguage)
  }, [language, updateLanguage, user])

  const toggleLanguage = useCallback(() => {
    return setLanguage(language === 'ar' ? 'en' : 'ar')
  }, [language, setLanguage])

  const value = useMemo(() => ({
    language,
    isRTL: language === 'ar',
    setLanguage,
    toggleLanguage,
    isUpdatingLanguage,
    t,
    formatDate: (value, options = {}) => new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...options
    }).format(new Date(value)),
    formatTime: (value, options = {}) => new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      ...options
    }).format(new Date(value)),
    formatNumber: (value) => new Intl.NumberFormat(locale).format(value ?? 0)
  }), [isUpdatingLanguage, language, locale, setLanguage, t, toggleLanguage])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}
