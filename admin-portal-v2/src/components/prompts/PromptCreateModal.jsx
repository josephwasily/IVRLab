import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { uploadPrompt, getVoices, generatePromptTTS } from '../../lib/api'
import { Upload, Music, X, RefreshCw, Type, Mic } from 'lucide-react'
import clsx from 'clsx'

const categories = [
  { value: 'custom', label: 'Custom' },
  { value: 'greeting', label: 'Greeting' },
  { value: 'menu', label: 'Menu' },
  { value: 'error', label: 'Error' },
  { value: 'confirmation', label: 'Confirmation' },
  { value: 'digits', label: 'Digits' }
]

const languages = [
  { value: 'ar', label: 'Arabic' },
  { value: 'en', label: 'English' }
]

function formatFileSize(bytes) {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function PromptCreateModal({ onClose, onCreated }) {
  const queryClient = useQueryClient()
  const [step, setStep] = useState(1) // Step 1: Choose mode & content, Step 2: Details
  const [mode, setMode] = useState('upload') // 'upload' or 'tts'
  const [file, setFile] = useState(null)
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('adam')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [language, setLanguage] = useState('ar')
  const [category, setCategory] = useState('custom')
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState(false)

  // Fetch available voices
  const { data: voicesData } = useQuery({
    queryKey: ['voices'],
    queryFn: getVoices
  })

  const ttsAvailable = voicesData?.available
  const voices = voicesData?.voices || []

  // Count characters based on language
  const getCharacterInfo = () => {
    if (!text) return { count: 0, label: 'characters' }

    if (language === 'ar') {
      // Count Arabic characters (Unicode range for Arabic)
      const arabicChars = (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g) || []).length
      const totalChars = text.length
      return {
        count: totalChars,
        arabicCount: arabicChars,
        label: `${totalChars} characters (${arabicChars} Arabic)`
      }
    }
    return { count: text.length, label: `${text.length} characters` }
  }

  const charInfo = getCharacterInfo()

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0]
    if (selectedFile) {
      setFile(selectedFile)
      if (!name) {
        const baseName = selectedFile.name.replace(/\.[^/.]+$/, '')
        setName(baseName.replace(/[_-]/g, ' '))
      }
    }
  }

  const canProceedToStep2 = () => {
    if (mode === 'upload') {
      return !!file
    }
    return text.trim().length > 0
  }

  const handleNext = () => {
    setError('')
    if (!canProceedToStep2()) {
      setError(mode === 'upload' ? 'Please select an audio file' : 'Please enter text to convert')
      return
    }
    setStep(2)
  }

  const handleBack = () => {
    setError('')
    setStep(1)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('Please enter a prompt name')
      return
    }

    if (mode === 'upload') {
      const formData = new FormData()
      formData.append('audio', file)
      formData.append('name', name.trim())
      formData.append('description', description.trim())
      formData.append('language', language)
      formData.append('category', category)

      setProcessing(true)
      try {
        const createdPrompt = await uploadPrompt(formData)
        queryClient.invalidateQueries({ queryKey: ['prompts'] })
        queryClient.invalidateQueries({ queryKey: ['filesystem-prompts'] })
        onCreated?.(createdPrompt)
        onClose()
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to upload prompt')
      } finally {
        setProcessing(false)
      }
      return
    }

    setProcessing(true)
    try {
      const createdPrompt = await generatePromptTTS({
        text: text.trim(),
        name: name.trim(),
        description: description.trim(),
        language,
        category,
        voice
      })
      queryClient.invalidateQueries({ queryKey: ['prompts'] })
      queryClient.invalidateQueries({ queryKey: ['filesystem-prompts'] })
      onCreated?.(createdPrompt)
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate prompt')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Create Audio Prompt</h2>
            <p className="text-sm text-gray-500">Step {step} of 2</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="h-1 bg-gray-200">
          <div
            className="h-full bg-blue-600 transition-all duration-300"
            style={{ width: step === 1 ? '50%' : '100%' }}
          />
        </div>

        <div className="p-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          {step === 1 ? (
            /* Step 1: Choose mode and content */
            <>
              {/* Mode Toggle */}
              <div className="flex mb-4 bg-gray-100 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => setMode('upload')}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors',
                    mode === 'upload'
                      ? 'bg-white shadow text-blue-600'
                      : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  <Upload className="w-4 h-4" />
                  Upload File
                </button>
                <button
                  type="button"
                  onClick={() => setMode('tts')}
                  disabled={!ttsAvailable}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-colors',
                    mode === 'tts'
                      ? 'bg-white shadow text-blue-600'
                      : 'text-gray-600 hover:text-gray-900',
                    !ttsAvailable && 'opacity-50 cursor-not-allowed'
                  )}
                  title={!ttsAvailable ? 'TTS not configured' : ''}
                >
                  <Mic className="w-4 h-4" />
                  Text to Speech
                </button>
              </div>

              {/* Language Selection (needed for TTS direction) */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                >
                  {languages.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>

              {mode === 'upload' ? (
                /* File Upload */
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Audio File
                  </label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                    <input
                      type="file"
                      accept="audio/*,.mp3,.mpeg,.wav,.ogg,.flac,.aac,.m4a,.ulaw"
                      onChange={handleFileChange}
                      className="hidden"
                      id="audio-upload"
                    />
                    <label htmlFor="audio-upload" className="cursor-pointer">
                      {file ? (
                        <div className="flex items-center justify-center">
                          <Music className="w-8 h-8 text-blue-500 mr-2" />
                          <div className="text-left">
                            <div className="font-medium text-gray-900 truncate max-w-[200px]">{file.name}</div>
                            <div className="text-sm text-gray-500">{formatFileSize(file.size)}</div>
                          </div>
                        </div>
                      ) : (
                        <>
                          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                          <p className="text-sm text-gray-600">Click to select file</p>
                          <p className="text-xs text-gray-400 mt-1">MP3, MPEG, WAV, OGG, FLAC, AAC</p>
                        </>
                      )}
                    </label>
                  </div>
                </div>
              ) : (
                /* TTS Text Input */
                <>
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Text to Convert
                    </label>
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={4}
                      placeholder={language === 'ar' ? 'أدخل النص هنا...' : 'Enter text here...'}
                      className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                      dir={language === 'ar' ? 'rtl' : 'ltr'}
                    />
                    <p className="text-xs text-gray-500 mt-1">{charInfo.label}</p>
                  </div>

                  <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Voice
                    </label>
                    <select
                      value={voice}
                      onChange={(e) => setVoice(e.target.value)}
                      className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                    >
                      {voices.map((v) => (
                        <option key={v.key} value={v.key}>{v.name}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Step 1 Actions */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!canProceedToStep2()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </>
          ) : (
            /* Step 2: Name, description, category */
            <form onSubmit={handleSubmit}>
              {/* Summary of Step 1 */}
              <div className="mb-4 p-3 bg-gray-50 rounded-lg text-sm">
                <div className="flex items-center gap-2 text-gray-700">
                  {mode === 'upload' ? (
                    <>
                      <Music className="w-4 h-4" />
                      <span className="truncate">{file?.name}</span>
                    </>
                  ) : (
                    <>
                      <Type className="w-4 h-4" />
                      <span className="truncate" dir={language === 'ar' ? 'rtl' : 'ltr'}>
                        "{text.substring(0, 50)}{text.length > 50 ? '...' : ''}"
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Name */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Prompt Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., welcome_message"
                  className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Filename used in IVR flows
                </p>
              </div>

              {/* Description */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="Optional description"
                  className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Category */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-lg border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
                >
                  {categories.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* Info Box */}
              <div className="mb-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
                Audio will be converted to mu-law format (8kHz) for Asterisk.
              </div>

              {/* Step 2 Actions */}
              <div className="flex justify-between pt-2">
                <button
                  type="button"
                  onClick={handleBack}
                  className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center"
                >
                  {processing ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      {mode === 'upload' ? 'Converting...' : 'Generating...'}
                    </>
                  ) : (
                    mode === 'upload' ? 'Upload' : 'Generate'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
