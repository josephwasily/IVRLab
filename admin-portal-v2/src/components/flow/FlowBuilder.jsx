import { useCallback, useRef, useState, useEffect } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Panel
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { nodeTypes } from './FlowNodes'
import NodePalette from './NodePalette'
import NodeProperties from './NodeProperties'
import { flowToReactFlow, reactFlowToFlow } from '../../lib/flowUtils'
import { Save, Undo, ZoomIn, ZoomOut, Maximize } from 'lucide-react'

const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false
}

export default function FlowBuilder({ initialFlow, onSave, isSaving }) {
  const reactFlowWrapper = useRef(null)
  const [reactFlowInstance, setReactFlowInstance] = useState(null)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedNode, setSelectedNode] = useState(null)
  const [startNode, setStartNode] = useState('welcome')

  // Load initial flow
  useEffect(() => {
    if (initialFlow) {
      const { nodes: flowNodes, edges: flowEdges } = flowToReactFlow(initialFlow)
      setNodes(flowNodes)
      setEdges(flowEdges)
      setStartNode(initialFlow.startNode || 'welcome')
    }
  }, [initialFlow, setNodes, setEdges])

  const onConnect = useCallback(
    (params) => {
      const edge = {
        ...params,
        type: 'smoothstep',
        label: 'next'
      }
      setEdges((eds) => addEdge(edge, eds))
    },
    [setEdges]
  )

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [])

  const onDragOver = useCallback((event) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback(
    (event) => {
      event.preventDefault()

      const type = event.dataTransfer.getData('application/reactflow')
      if (!type || !reactFlowInstance) return

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      })

      const nodeId = `${type}_${Date.now()}`
      const newNode = {
        id: nodeId,
        type: getReactFlowNodeType(type),
        position,
        data: {
          id: nodeId,
          type: type,
          label: nodeId
        }
      }

      setNodes((nds) => [...nds, newNode])
      setSelectedNode(newNode)
    },
    [reactFlowInstance, setNodes]
  )

  const handleAddNode = useCallback(
    (type) => {
      const nodeId = `${type}_${Date.now()}`
      const newNode = {
        id: nodeId,
        type: getReactFlowNodeType(type),
        position: { x: 250, y: nodes.length * 100 },
        data: {
          id: nodeId,
          type: type,
          label: nodeId
        }
      }
      setNodes((nds) => [...nds, newNode])
      setSelectedNode(newNode)
    },
    [nodes.length, setNodes]
  )

  const handleNodeDataChange = useCallback(
    (nodeId, data) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            // If ID changed, update the node ID
            const newId = data.id || n.id
            return {
              ...n,
              id: newId,
              data: { ...data, label: newId }
            }
          }
          return n
        })
      )
    },
    [setNodes]
  )

  const handleSave = useCallback(() => {
    const flowData = reactFlowToFlow(nodes, edges, startNode)
    onSave(flowData)
  }, [nodes, edges, startNode, onSave])

  const handleFitView = useCallback(() => {
    reactFlowInstance?.fitView({ padding: 0.2 })
  }, [reactFlowInstance])

  return (
    <div className="flex h-[600px] gap-4">
      {/* Node Palette */}
      <NodePalette onAddNode={handleAddNode} />

      {/* Flow Canvas */}
      <div className="flex-1 bg-gray-50 rounded-lg border" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          snapToGrid
          snapGrid={[15, 15]}
        >
          <Background variant="dots" gap={15} size={1} />
          <Controls />
          <MiniMap
            nodeStrokeWidth={3}
            zoomable
            pannable
            className="!bg-gray-100"
          />
          
          <Panel position="top-right" className="flex gap-2">
            <button
              onClick={handleFitView}
              className="p-2 bg-white rounded shadow hover:bg-gray-50"
              title="Fit View"
            >
              <Maximize size={18} />
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 bg-blue-600 text-white rounded shadow hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Save size={18} />
              {isSaving ? 'Saving...' : 'Save Flow'}
            </button>
          </Panel>
          
          <Panel position="top-left" className="bg-white rounded shadow px-3 py-2">
            <div className="flex items-center gap-2 text-sm">
              <label className="text-gray-600">Start Node:</label>
              <select
                value={startNode}
                onChange={(e) => setStartNode(e.target.value)}
                className="border rounded px-2 py-1 text-sm"
              >
                {nodes.map((n) => (
                  <option key={n.id} value={n.data.id || n.id}>
                    {n.data.id || n.id}
                  </option>
                ))}
              </select>
            </div>
          </Panel>
        </ReactFlow>
      </div>

      {/* Properties Panel */}
      <NodeProperties
        node={selectedNode}
        onChange={handleNodeDataChange}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  )
}

function getReactFlowNodeType(ivrType) {
  const map = {
    play: 'playNode',
    play_digits: 'playNode',
    play_sequence: 'playNode',
    collect: 'collectNode',
    branch: 'branchNode',
    api_call: 'apiNode',
    set_variable: 'variableNode',
    transfer: 'transferNode',
    hangup: 'hangupNode'
  }
  return map[ivrType] || 'playNode'
}
