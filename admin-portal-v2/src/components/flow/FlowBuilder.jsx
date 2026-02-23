import { useCallback, useRef, useState, useEffect, useImperativeHandle, forwardRef } from 'react'
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
import { Maximize } from 'lucide-react'

const defaultEdgeOptions = {
  type: 'smoothstep',
  animated: false
}

function getDefaultNodeData(type, nodeId) {
  const base = { id: nodeId, type, label: nodeId }

  if (type === 'play') {
    return { ...base, prompt: '', bargeIn: true }
  }
  if (type === 'play_digits') {
    return { ...base, bargeIn: true }
  }
  if (type === 'play_sequence') {
    return { ...base, sequence: [], bargeIn: true }
  }
  if (type === 'collect') {
    return { ...base, maxDigits: 10, timeout: 10, terminators: '#', bargeIn: true }
  }

  return base
}

const FlowBuilder = forwardRef(function FlowBuilder({ initialFlow, onFlowChange }, ref) {
  const reactFlowWrapper = useRef(null)
  const [reactFlowInstance, setReactFlowInstance] = useState(null)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [startNode, setStartNode] = useState('welcome')
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const startNodeRef = useRef(startNode)
  const syncingFromPropRef = useRef(false)

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null

  useEffect(() => {
    nodesRef.current = nodes
    edgesRef.current = edges
    startNodeRef.current = startNode
  }, [nodes, edges, startNode])

  useImperativeHandle(ref, () => ({
    getFlowData: () => reactFlowToFlow(nodes, edges, startNode)
  }), [nodes, edges, startNode])

  // Load initial flow
  useEffect(() => {
    if (initialFlow) {
      const currentFlow = reactFlowToFlow(nodesRef.current, edgesRef.current, startNodeRef.current)
      if (JSON.stringify(currentFlow) === JSON.stringify(initialFlow)) {
        syncingFromPropRef.current = false
        return
      }
      syncingFromPropRef.current = true
      const { nodes: flowNodes, edges: flowEdges } = flowToReactFlow(initialFlow)
      setNodes(flowNodes)
      setEdges(flowEdges)
      setStartNode(initialFlow.startNode || 'welcome')
      setSelectedNodeId(null)
    } else {
      syncingFromPropRef.current = false
    }
  }, [initialFlow, setNodes, setEdges])

  useEffect(() => {
    if (!onFlowChange) return
    const currentFlow = reactFlowToFlow(nodes, edges, startNode)

    if (syncingFromPropRef.current) {
      if (!initialFlow || JSON.stringify(currentFlow) === JSON.stringify(initialFlow)) {
        syncingFromPropRef.current = false
      }
      return
    }

    onFlowChange(currentFlow)
  }, [nodes, edges, startNode, onFlowChange, initialFlow])

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
    setSelectedNodeId(node.id)
  }, [])

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null)
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
        data: getDefaultNodeData(type, nodeId)
      }

      setNodes((nds) => [...nds, newNode])
      setSelectedNodeId(newNode.id)
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
        data: getDefaultNodeData(type, nodeId)
      }
      setNodes((nds) => [...nds, newNode])
      setSelectedNodeId(newNode.id)
    },
    [nodes.length, setNodes]
  )

  const handleNodeDataChange = useCallback(
    (nodeId, data) => {
      const requestedId = (data.id || nodeId).trim() || nodeId
      const duplicateExists = nodes.some((n) => n.id === requestedId && n.id !== nodeId)
      const newId = duplicateExists ? nodeId : requestedId

      setNodes((nds) => nds.map((n) => {
        if (n.id !== nodeId) return n
        return {
          ...n,
          id: newId,
          data: { ...data, id: newId, label: newId }
        }
      }))

      if (newId !== nodeId) {
        setEdges((eds) => eds.map((e) => ({
          ...e,
          source: e.source === nodeId ? newId : e.source,
          target: e.target === nodeId ? newId : e.target
        })))
        setStartNode((prev) => (prev === nodeId ? newId : prev))
        setSelectedNodeId((prev) => (prev === nodeId ? newId : prev))
      }
    },
    [nodes, setNodes, setEdges]
  )

  const handleDeleteNode = useCallback(
    (nodeId) => {
      setNodes((nds) => {
        const remaining = nds.filter((n) => n.id !== nodeId)
        if (startNode === nodeId) {
          setStartNode(remaining[0]?.id || 'welcome')
        }
        return remaining
      })
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
      setSelectedNodeId(null)
    },
    [setNodes, setEdges, startNode]
  )

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
        onDelete={handleDeleteNode}
        onClose={() => setSelectedNodeId(null)}
      />
    </div>
  )
})

export default FlowBuilder

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
