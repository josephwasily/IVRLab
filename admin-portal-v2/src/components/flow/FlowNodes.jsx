import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Volume2, Hash, GitBranch, Globe, Variable, PhoneForwarded, PhoneOff } from 'lucide-react'
import clsx from 'clsx'

const nodeStyles = {
  playNode: { bg: 'bg-blue-50', border: 'border-blue-300', icon: Volume2, iconColor: 'text-blue-600' },
  collectNode: { bg: 'bg-green-50', border: 'border-green-300', icon: Hash, iconColor: 'text-green-600' },
  branchNode: { bg: 'bg-purple-50', border: 'border-purple-300', icon: GitBranch, iconColor: 'text-purple-600' },
  apiNode: { bg: 'bg-orange-50', border: 'border-orange-300', icon: Globe, iconColor: 'text-orange-600' },
  variableNode: { bg: 'bg-yellow-50', border: 'border-yellow-300', icon: Variable, iconColor: 'text-yellow-600' },
  transferNode: { bg: 'bg-cyan-50', border: 'border-cyan-300', icon: PhoneForwarded, iconColor: 'text-cyan-600' },
  hangupNode: { bg: 'bg-red-50', border: 'border-red-300', icon: PhoneOff, iconColor: 'text-red-600' }
}

const typeLabels = {
  play: 'Play Audio',
  play_digits: 'Play Digits',
  play_sequence: 'Play Sequence',
  collect: 'Collect Input',
  branch: 'Branch',
  api_call: 'API Call',
  set_variable: 'Set Variable',
  transfer: 'Transfer',
  hangup: 'Hang Up'
}

function BaseNode({ data, selected, nodeType }) {
  const style = nodeStyles[nodeType] || nodeStyles.playNode
  const Icon = style.icon

  return (
    <div
      className={clsx(
        'px-4 py-3 rounded-lg border-2 min-w-[180px] shadow-sm transition-shadow',
        style.bg,
        style.border,
        selected && 'ring-2 ring-blue-500 shadow-lg'
      )}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3 !bg-gray-400" />
      
      <div className="flex items-center gap-2 mb-1">
        <Icon size={16} className={style.iconColor} />
        <span className="text-xs font-medium text-gray-500">
          {typeLabels[data.type] || data.type}
        </span>
      </div>
      
      <div className="font-semibold text-gray-900 text-sm">{data.id}</div>
      
      {data.prompt && (
        <div className="text-xs text-gray-600 mt-1 truncate max-w-[160px]">
          {data.prompt}
        </div>
      )}
      
      {data.url && (
        <div className="text-xs text-gray-600 mt-1 truncate max-w-[160px] font-mono">
          {data.method} {data.url}
        </div>
      )}
      
      {data.maxDigits && (
        <div className="text-xs text-gray-500 mt-1">
          Max: {data.maxDigits} digits
        </div>
      )}

      <Handle type="source" position={Position.Bottom} className="w-3 h-3 !bg-gray-400" />
    </div>
  )
}

export const PlayNode = memo(({ data, selected }) => (
  <BaseNode data={data} selected={selected} nodeType="playNode" />
))

export const CollectNode = memo(({ data, selected }) => (
  <BaseNode data={data} selected={selected} nodeType="collectNode" />
))

export const BranchNode = memo(({ data, selected }) => {
  const branchCount = Object.keys(data.branches || {}).length
  
  return (
    <div
      className={clsx(
        'px-4 py-3 rounded-lg border-2 min-w-[180px] shadow-sm',
        'bg-purple-50 border-purple-300',
        selected && 'ring-2 ring-blue-500 shadow-lg'
      )}
    >
      <Handle type="target" position={Position.Top} className="w-3 h-3 !bg-gray-400" />
      
      <div className="flex items-center gap-2 mb-1">
        <GitBranch size={16} className="text-purple-600" />
        <span className="text-xs font-medium text-gray-500">Branch</span>
      </div>
      
      <div className="font-semibold text-gray-900 text-sm">{data.id}</div>
      
      {data.variable && (
        <div className="text-xs text-gray-600 mt-1">
          Variable: {data.variable}
        </div>
      )}
      
      <div className="text-xs text-purple-600 mt-1">
        {branchCount} branch{branchCount !== 1 ? 'es' : ''}
      </div>

      <Handle type="source" position={Position.Bottom} className="w-3 h-3 !bg-gray-400" />
    </div>
  )
})

export const ApiNode = memo(({ data, selected }) => (
  <BaseNode data={data} selected={selected} nodeType="apiNode" />
))

export const VariableNode = memo(({ data, selected }) => (
  <BaseNode data={data} selected={selected} nodeType="variableNode" />
))

export const TransferNode = memo(({ data, selected }) => (
  <BaseNode data={data} selected={selected} nodeType="transferNode" />
))

export const HangupNode = memo(({ data, selected }) => (
  <div
    className={clsx(
      'px-4 py-3 rounded-lg border-2 min-w-[120px] shadow-sm',
      'bg-red-50 border-red-300',
      selected && 'ring-2 ring-blue-500 shadow-lg'
    )}
  >
    <Handle type="target" position={Position.Top} className="w-3 h-3 !bg-gray-400" />
    
    <div className="flex items-center gap-2">
      <PhoneOff size={16} className="text-red-600" />
      <span className="font-semibold text-gray-900 text-sm">{data.id || 'Hang Up'}</span>
    </div>
  </div>
))

export const nodeTypes = {
  playNode: PlayNode,
  collectNode: CollectNode,
  branchNode: BranchNode,
  apiNode: ApiNode,
  variableNode: VariableNode,
  transferNode: TransferNode,
  hangupNode: HangupNode
}
