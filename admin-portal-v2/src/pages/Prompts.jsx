import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPrompts, deletePrompt, getFilesystemPrompts, getPromptAudioUrl, getFilesystemAudioUrl } from '../lib/api'
import { Upload, Trash2, Music, Clock, HardDrive, Plus, FolderOpen, RefreshCw, Play, Square } from 'lucide-react'
import clsx from 'clsx'
import PromptCreateModal from '../components/prompts/PromptCreateModal'

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
        <PromptCreateModal onClose={() => setShowUpload(false)} />
      )}
    </div>
  )
}
