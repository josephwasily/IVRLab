import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Add auth token to requests
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle auth errors
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Auth
export const login = async (email, password) => {
  const response = await api.post('/auth/login', { email, password })
  return response.data
}

export const register = async (data) => {
  const response = await api.post('/auth/register', data)
  return response.data
}

export const getCurrentUser = async () => {
  const response = await api.get('/auth/me')
  return response.data
}

// IVRs
export const getIVRs = async () => {
  const response = await api.get('/ivr')
  return response.data
}

export const getIVR = async (id) => {
  const response = await api.get(`/ivr/${id}`)
  return response.data
}

export const createIVR = async (data) => {
  const response = await api.post('/ivr', data)
  return response.data
}

export const updateIVR = async (id, data) => {
  const response = await api.put(`/ivr/${id}`, data)
  return response.data
}

export const deleteIVR = async (id) => {
  const response = await api.delete(`/ivr/${id}`)
  return response.data
}

export const activateIVR = async (id, active) => {
  const response = await api.post(`/ivr/${id}/activate`, { active })
  return response.data
}

export const cloneIVR = async (id, name) => {
  const response = await api.post(`/ivr/${id}/clone`, { name })
  return response.data
}

// Templates
export const getTemplates = async () => {
  const response = await api.get('/templates')
  return response.data
}

export const getTemplate = async (id) => {
  const response = await api.get(`/templates/${id}`)
  return response.data
}

// Extensions
export const getExtensions = async () => {
  const response = await api.get('/extensions')
  return response.data
}

export const getExtensionStats = async () => {
  const response = await api.get('/extensions/stats')
  return response.data
}

// Analytics
export const getDashboardStats = async () => {
  const response = await api.get('/analytics/dashboard')
  return response.data
}

export const getCallLogs = async (params = {}) => {
  const response = await api.get('/analytics/calls', { params })
  return response.data
}

export const getHourlyCalls = async (hours = 24) => {
  const response = await api.get('/analytics/calls/hourly', { params: { hours } })
  return response.data
}

export const getIVRStats = async (id) => {
  const response = await api.get(`/analytics/ivr/${id}`)
  return response.data
}

// Prompts
export const getPrompts = async (params = {}) => {
  const response = await api.get('/prompts', { params })
  return response.data
}

export const getPrompt = async (id) => {
  const response = await api.get(`/prompts/${id}`)
  return response.data
}

export const uploadPrompt = async (formData) => {
  const response = await api.post('/prompts', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return response.data
}

export const updatePrompt = async (id, data) => {
  const response = await api.put(`/prompts/${id}`, data)
  return response.data
}

export const deletePrompt = async (id) => {
  const response = await api.delete(`/prompts/${id}`)
  return response.data
}

export const getFilesystemPrompts = async (language = 'ar') => {
  const response = await api.get('/prompts/filesystem/list', { params: { language } })
  return response.data
}

// TTS / Voice Generation
export const getVoices = async () => {
  const response = await api.get('/prompts/voices')
  return response.data
}

export const generatePromptTTS = async (data) => {
  const response = await api.post('/prompts/generate', data)
  return response.data
}

// SIP Trunks
export const getTrunks = async () => {
  const response = await api.get('/trunks')
  return response.data
}

export const getTrunk = async (id) => {
  const response = await api.get(`/trunks/${id}`)
  return response.data
}

export const createTrunk = async (data) => {
  const response = await api.post('/trunks', data)
  return response.data
}

export const updateTrunk = async (id, data) => {
  const response = await api.put(`/trunks/${id}`, data)
  return response.data
}

export const deleteTrunk = async (id) => {
  const response = await api.delete(`/trunks/${id}`)
  return response.data
}

export const testTrunk = async (id) => {
  const response = await api.post(`/trunks/${id}/test`)
  return response.data
}

// Outbound Campaigns
export const getCampaigns = async (params = {}) => {
  const response = await api.get('/campaigns', { params })
  return response.data
}

export const getCampaign = async (id) => {
  const response = await api.get(`/campaigns/${id}`)
  return response.data
}

export const createCampaign = async (data) => {
  const response = await api.post('/campaigns', data)
  return response.data
}

export const updateCampaign = async (id, data) => {
  const response = await api.put(`/campaigns/${id}`, data)
  return response.data
}

export const deleteCampaign = async (id) => {
  const response = await api.delete(`/campaigns/${id}`)
  return response.data
}

export const uploadCampaignContacts = async (campaignId, file, mapping) => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('phone_column', mapping.phone_column)
  if (mapping.name_column) {
    formData.append('name_column', mapping.name_column)
  }
  if (mapping.variable_columns?.length) {
    formData.append('variable_columns', JSON.stringify(mapping.variable_columns))
  }
  const response = await api.post(`/campaigns/${campaignId}/contacts`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  })
  return response.data
}

export const addManualContacts = async (campaignId, contacts, clearExisting = false) => {
  const response = await api.post(`/campaigns/${campaignId}/contacts/manual`, {
    contacts,
    clear_existing: clearExisting
  })
  return response.data
}

export const getCampaignContacts = async (campaignId, params = {}) => {
  const response = await api.get(`/campaigns/${campaignId}/contacts`, { params })
  return response.data
}

export const deleteCampaignContacts = async (campaignId) => {
  const response = await api.delete(`/campaigns/${campaignId}/contacts`)
  return response.data
}

export const deleteCampaignContact = async (campaignId, contactId) => {
  const response = await api.delete(`/campaigns/${campaignId}/contacts/${contactId}`)
  return response.data
}

export const getCampaignStats = async (id) => {
  const response = await api.get(`/campaigns/${id}/stats`)
  return response.data
}

export const startCampaign = async (id) => {
  const response = await api.post(`/campaigns/${id}/start`)
  return response.data
}

export const pauseCampaign = async (id) => {
  const response = await api.post(`/campaigns/${id}/pause`)
  return response.data
}

export const resumeCampaign = async (id) => {
  const response = await api.post(`/campaigns/${id}/resume`)
  return response.data
}

export const cancelCampaign = async (id) => {
  const response = await api.post(`/campaigns/${id}/cancel`)
  return response.data
}

export const getCampaignRuns = async (id) => {
  const response = await api.get(`/campaigns/${id}/runs`)
  return response.data
}

export const getCampaignRun = async (campaignId, runId) => {
  const response = await api.get(`/campaigns/${campaignId}/runs/${runId}`)
  return response.data
}

// IVR Flows (alias for campaigns)
export const getIVRFlows = async () => {
  const response = await api.get('/ivr')
  return response.data
}

// Triggers
export const triggerCall = async (data) => {
  const response = await api.post('/triggers/call', data)
  return response.data
}

export const getOutboundCalls = async (params = {}) => {
  const response = await api.get('/triggers/calls', { params })
  return response.data
}

export const getOutboundAnalytics = async (params = {}) => {
  const response = await api.get('/triggers/analytics', { params })
  return response.data
}

export const getCallStatus = async (callId) => {
  const response = await api.get(`/triggers/call/${callId}`)
  return response.data
}

export default api
