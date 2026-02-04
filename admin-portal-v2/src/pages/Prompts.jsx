import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPrompts, uploadPrompt, deletePrompt, getFilesystemPrompts, getVoices, generatePromptTTS, getPromptAudioUrl, getFilesystemAudioUrl } from '../lib/api'
import { Upload, Trash2, Music, Clock, HardDrive, Plus, X, FolderOpen, RefreshCw, Type, Mic, Play, Pause, Square, Volume2 } from 'lucide-react'
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

function formatDuration(ms) {
  if (!ms) return '-'
  const seconds = Math.round(ms / 1000)
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`
}

function formatFileSize(bytes) {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function Prompts() {
  const queryClient = useQueryClient()
  const [showUpload, setShowUpload] = useState(false)
  const [showFilesystem, setShowFilesystem] = useState(false)
  const [filterLanguage, setFilterLanguage] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [playingId, setPlayingId] = useState(null)
  const [playingFsFile, setPlayingFsFile] = useState(null)
  const audioRef = useRef(null)

  const { data: prompts, isLoading } = useQuery({
    queryKey: ['prompts', filterLanguage, filterCategory],
    queryFn: () => getPrompts({ language: filterLanguage || undefined, category: filterCategory || undefined })
  })

  const { data: filesystemPrompts } = useQuery({
    queryKey: ['filesystem-prompts', 'ar'],
    queryFn: () => getFilesystemPrompts('ar'),
    enabled: showFilesystem
  })

  const deleteMutation = useMutation({
    mutationFn: deletePrompt,
    onSuccess: () => queryClient.invalidateQueries(['prompts'])
  })

  // Play prompt audio
  const playPrompt = (promptId) => {
    if (playingId === promptId) {
      // Stop playing
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
      setPlayingId(null)
      return
    }

    // Stop any current playback
    if (audioRef.current) {
      audioRef.current.pause()
    }
    setPlayingFsFile(null)

    const url = getPromptAudioUrl(promptId)
    audioRef.current = new Audio(url)
    audioRef.current.onended = () => setPlayingId(null)
    audioRef.current.onerror = () => {
      console.error('Error playing audio')
      setPlayingId(null)
    }
    audioRef.current.play()
    setPlayingId(promptId)
  }

  // Play filesystem prompt
  const playFilesystemPrompt = (filename) => {
    if (playingFsFile === filename) {
      // Stop playing
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
      setPlayingFsFile(null)
      return
    }

    // Stop any current playback
    if (audioRef.current) {
      audioRef.current.pause()
    }
    setPlayingId(null)

    const url = getFilesystemAudioUrl(filename, 'ar')
    audioRef.current = new Audio(url)
    audioRef.current.onended = () => setPlayingFsFile(null)
    audioRef.current.onerror = () => {
      console.error('Error playing filesystem audio')
      setPlayingFsFile(null)
    }
    audioRef.current.play()
    setPlayingFsFile(filename)
  }

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
      }
    }
  }, [])

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Audio Prompts</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowFilesystem(!showFilesystem)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-gray-700 bg-white hover:bg-gray-50"
          >
            <FolderOpen className="w-5 h-5 mr-2" />
            Browse Files
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-5 h-5 mr-2" />
            Create Prompt
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
            <select
              value={filterLanguage}
              onChange={(e) => setFilterLanguage(e.target.value)}
              className="rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Languages</option>
              {languages.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="rounded-md border-gray-300 shadow-sm focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">All Categories</option>
              {categories.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Filesystem Browser */}
      {showFilesystem && (
        <div className="bg-gray-50 rounded-lg p-4 mb-6 border border-gray-200">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-medium text-gray-900">Existing Files on Disk (Arabic)</h3>
            <button
              onClick={() => queryClient.invalidateQueries(['filesystem-prompts'])}
              className="text-gray-500 hover:text-gray-700"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {filesystemPrompts?.map((file) => (
              <div key={file.filename} className="bg-white rounded p-2 text-sm border border-gray-200 hover:border-blue-300 transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <div className="font-medium text-gray-900 truncate flex-1" title={file.name}>
                    {file.name}
                  </div>
                  <button
                    onClick={() => playFilesystemPrompt(file.filename)}
                    className={clsx(
                      'ml-2 p-1 rounded-full transition-colors',
                      playingFsFile === file.filename 
                        ? 'bg-blue-100 text-blue-600' 
                        : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
                    )}
                    title={playingFsFile === file.filename ? 'Stop' : 'Play'}
                  >
                    {playingFsFile === file.filename ? (
                      <Square className="w-3 h-3" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                  </button>
                </div>
                <div className="text-xs text-gray-500">
                  {formatFileSize(file.size)}
                </div>
              </div>
            ))}
            {filesystemPrompts?.length === 0 && (
              <div className="col-span-full text-gray-500 text-center py-4">
                No audio files found
              </div>
            )}
          </div>
        </div>
      )}

      {/* Prompts Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : prompts?.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Music className="w-16 h-16 mx-auto mb-4 text-gray-300" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No prompts yet</h3>
          <p className="text-gray-500 mb-4">
            Upload audio files to create prompts for your IVR flows.
          </p>
          <button
            onClick={() => setShowUpload(true)}
            className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Upload className="w-5 h-5 mr-2" />
            Upload First Prompt
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-12">Play</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Filename</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Language</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {prompts?.map((prompt) => (
                <tr key={prompt.id} className="hover:bg-gray-50">
                  <td className="px-4 py-4">
                    <button
                      onClick={() => playPrompt(prompt.id)}
                      className={clsx(
                        'p-2 rounded-full transition-colors',
                        playingId === prompt.id 
                          ? 'bg-blue-100 text-blue-600' 
                          : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'
                      )}
                      title={playingId === prompt.id ? 'Stop' : 'Play'}
                    >
                      {playingId === prompt.id ? (
                        <Square className="w-5 h-5" />
                      ) : (
                        <Play className="w-5 h-5" />
                      )}
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center">
                      <Music className="w-5 h-5 text-gray-400 mr-3" />
                      <div>
                        <div className="font-medium text-gray-900">{prompt.name}</div>
                        {prompt.description && (
                          <div className="text-sm text-gray-500">{prompt.description}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 font-mono">{prompt.filename}</td>
                  <td className="px-6 py-4">
                    <span className={clsx(
                      'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                      prompt.language === 'ar' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
                    )}>
                      {prompt.language === 'ar' ? 'Arabic' : 'English'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 capitalize">{prompt.category}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    <div className="flex items-center">
                      <Clock className="w-4 h-4 mr-1 text-gray-400" />
                      {formatDuration(prompt.duration_ms)}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    <div className="flex items-center">
                      <HardDrive className="w-4 h-4 mr-1 text-gray-400" />
                      {formatFileSize(prompt.file_size)}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {!prompt.is_system && (
                      <button
                        onClick={() => {
                          if (confirm(`Delete prompt "${prompt.name}"?`)) {
                            deleteMutation.mutate(prompt.id)
                          }
                        }}
                        className="text-red-600 hover:text-red-900"
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Upload Modal */}
      {showUpload && (
        <UploadModal onClose={() => setShowUpload(false)} />
      )}
    </div>
  )
}

function UploadModal({ onClose }) {
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
    } else {
      return text.trim().length > 0
    }
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
        await uploadPrompt(formData)
        queryClient.invalidateQueries(['prompts'])
        onClose()
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to upload prompt')
      } finally {
        setProcessing(false)
      }
    } else {
      setProcessing(true)
      try {
        await generatePromptTTS({
          text: text.trim(),
          name: name.trim(),
          description: description.trim(),
          language,
          category,
          voice
        })
        queryClient.invalidateQueries(['prompts'])
        onClose()
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to generate prompt')
      } finally {
        setProcessing(false)
      }
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
                  {languages.map(l => (
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
                      accept="audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a,.ulaw"
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
                          <p className="text-xs text-gray-400 mt-1">MP3, WAV, OGG, FLAC, AAC</p>
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
                      {voices.map(v => (
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
                  {categories.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>

              {/* Info Box */}
              <div className="mb-4 p-3 bg-blue-50 rounded-lg text-xs text-blue-800">
                Audio will be converted to μ-law format (8kHz) for Asterisk.
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
                    <>
                      {mode === 'upload' ? 'Upload' : 'Generate'}
                    </>
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
