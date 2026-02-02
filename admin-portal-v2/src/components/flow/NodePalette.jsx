import { Volume2, Hash, GitBranch, Globe, Variable, PhoneForwarded, PhoneOff } from 'lucide-react'
import clsx from 'clsx'

const nodeTypeConfig = [
  { type: 'play', label: 'Play Audio', icon: Volume2, color: 'bg-blue-100 text-blue-700', description: 'Play an audio prompt' },
  { type: 'collect', label: 'Collect Input', icon: Hash, color: 'bg-green-100 text-green-700', description: 'Collect DTMF digits' },
  { type: 'branch', label: 'Branch', icon: GitBranch, color: 'bg-purple-100 text-purple-700', description: 'Conditional routing' },
  { type: 'api_call', label: 'API Call', icon: Globe, color: 'bg-orange-100 text-orange-700', description: 'Make HTTP request' },
  { type: 'set_variable', label: 'Set Variable', icon: Variable, color: 'bg-yellow-100 text-yellow-700', description: 'Store a value' },
  { type: 'transfer', label: 'Transfer', icon: PhoneForwarded, color: 'bg-cyan-100 text-cyan-700', description: 'Transfer call' },
  { type: 'hangup', label: 'Hang Up', icon: PhoneOff, color: 'bg-red-100 text-red-700', description: 'End the call' }
]

export default function NodePalette({ onAddNode }) {
  const handleDragStart = (event, nodeType) => {
    event.dataTransfer.setData('application/reactflow', nodeType)
    event.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div className="bg-white rounded-lg shadow p-4 w-64">
      <h3 className="font-semibold text-gray-900 mb-3">Add Node</h3>
      <p className="text-xs text-gray-500 mb-4">Drag a node onto the canvas</p>
      
      <div className="space-y-2">
        {nodeTypeConfig.map(({ type, label, icon: Icon, color, description }) => (
          <div
            key={type}
            draggable
            onDragStart={(e) => handleDragStart(e, type)}
            onClick={() => onAddNode(type)}
            className={clsx(
              'flex items-center gap-3 p-3 rounded-lg cursor-grab active:cursor-grabbing',
              'border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all',
              'select-none'
            )}
          >
            <div className={clsx('p-2 rounded', color)}>
              <Icon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm text-gray-900">{label}</div>
              <div className="text-xs text-gray-500 truncate">{description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
