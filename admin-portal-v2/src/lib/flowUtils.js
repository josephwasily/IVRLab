import { create } from 'zustand'

// Convert IVR flow JSON to React Flow nodes and edges
export function flowToReactFlow(flowData) {
  if (!flowData || !flowData.nodes) {
    return { nodes: [], edges: [] }
  }

  const nodes = []
  const edges = []
  const nodePositions = calculateNodePositions(flowData)

  Object.values(flowData.nodes).forEach((node) => {
    nodes.push({
      id: node.id,
      type: getNodeType(node.type),
      position: nodePositions[node.id] || { x: 0, y: 0 },
      data: { ...node, label: node.id }
    })

    // Create edges based on node connections
    if (node.next) {
      edges.push({
        id: `${node.id}-${node.next}`,
        source: node.id,
        target: node.next,
        type: 'smoothstep',
        animated: false,
        label: 'next'
      })
    }

    // Handle branch nodes
    if (node.branches) {
      Object.entries(node.branches).forEach(([key, target]) => {
        edges.push({
          id: `${node.id}-${target}-${key}`,
          source: node.id,
          target: target,
          type: 'smoothstep',
          label: key,
          style: { stroke: '#6366f1' }
        })
      })
    }

    // Handle default branch
    if (node.default && node.type === 'branch') {
      edges.push({
        id: `${node.id}-${node.default}-default`,
        source: node.id,
        target: node.default,
        type: 'smoothstep',
        label: 'default',
        style: { stroke: '#9ca3af', strokeDasharray: '5,5' }
      })
    }

    // Handle error paths
    if (node.onError) {
      edges.push({
        id: `${node.id}-${node.onError}-error`,
        source: node.id,
        target: node.onError,
        type: 'smoothstep',
        label: 'error',
        style: { stroke: '#ef4444' }
      })
    }
  })

  return { nodes, edges }
}

// Calculate node positions using a simple tree layout
function calculateNodePositions(flowData) {
  const positions = {}
  const visited = new Set()
  const levels = {}
  const levelCounts = {}

  function traverse(nodeId, level = 0, index = 0) {
    if (visited.has(nodeId) || !flowData.nodes[nodeId]) return
    visited.add(nodeId)

    if (!levels[level]) {
      levels[level] = []
      levelCounts[level] = 0
    }
    levels[level].push(nodeId)

    const node = flowData.nodes[nodeId]
    const children = []

    if (node.next) children.push(node.next)
    if (node.branches) children.push(...Object.values(node.branches))
    if (node.default) children.push(node.default)
    if (node.onError) children.push(node.onError)

    children.forEach((childId, i) => traverse(childId, level + 1, i))
  }

  traverse(flowData.startNode)

  // Assign positions
  Object.entries(levels).forEach(([level, nodeIds]) => {
    const y = parseInt(level) * 150
    const totalWidth = nodeIds.length * 250
    const startX = -totalWidth / 2 + 125

    nodeIds.forEach((nodeId, index) => {
      positions[nodeId] = {
        x: startX + index * 250,
        y: y
      }
    })
  })

  return positions
}

// Map IVR node types to React Flow node types
function getNodeType(type) {
  const typeMap = {
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
  return typeMap[type] || 'default'
}

// Convert React Flow back to IVR flow JSON
export function reactFlowToFlow(nodes, edges, startNode) {
  const flowNodes = {}

  nodes.forEach((node) => {
    const nodeData = node.data || {}
    const ivrNode = {
      id: node.id,
      type: nodeData.type || 'play',
      ...nodeData
    }
    delete ivrNode.label

    const hasExplicitDefault = Object.prototype.hasOwnProperty.call(nodeData, 'default')
    const hasExplicitBranches =
      Object.prototype.hasOwnProperty.call(nodeData, 'branches') &&
      typeof nodeData.branches === 'object' &&
      nodeData.branches !== null

    // Find outgoing edges
    const outgoingEdges = edges.filter((e) => e.source === node.id)
    
    outgoingEdges.forEach((edge) => {
      const label = String(edge.label || 'next')

      if (label === 'next' || !edge.label) {
        ivrNode.next = edge.target
        return
      }

      if (label === 'error') {
        ivrNode.onError = edge.target
        return
      }

      if (label === 'default') {
        if (ivrNode.type === 'branch' && hasExplicitDefault) {
          return
        }
        ivrNode.default = edge.target
        return
      }

      if (label === 'next' || label === 'error' || label === 'default') {
        return
      }

      // Branch mappings edited in node properties are authoritative for branch nodes.
      // Only infer branch edges when explicit branches are not provided.
      if (ivrNode.type !== 'branch' || !hasExplicitBranches) {
        if (!ivrNode.branches || typeof ivrNode.branches !== 'object') {
          ivrNode.branches = {}
        }
        ivrNode.branches[label] = edge.target
      }
    })

    flowNodes[node.id] = ivrNode
  })

  return {
    startNode: startNode || nodes[0]?.id || 'welcome',
    nodes: flowNodes
  }
}

// Zustand store for flow builder state
export const useFlowStore = create((set, get) => ({
  nodes: [],
  edges: [],
  selectedNode: null,
  
  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setSelectedNode: (node) => set({ selectedNode: node }),
  
  onNodesChange: (changes) => {
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes)
    }))
  },
  
  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges)
    }))
  },
  
  addNode: (node) => {
    set((state) => ({
      nodes: [...state.nodes, node]
    }))
  },
  
  updateNodeData: (nodeId, data) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
      )
    }))
  },
  
  deleteNode: (nodeId) => {
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      selectedNode: state.selectedNode?.id === nodeId ? null : state.selectedNode
    }))
  },
  
  loadFlow: (flowData) => {
    const { nodes, edges } = flowToReactFlow(flowData)
    set({ nodes, edges, selectedNode: null })
  },
  
  getFlowData: (startNode) => {
    const { nodes, edges } = get()
    return reactFlowToFlow(nodes, edges, startNode)
  }
}))

// Helper functions from reactflow
function applyNodeChanges(changes, nodes) {
  return changes.reduce((acc, change) => {
    if (change.type === 'position' && change.position) {
      return acc.map((n) =>
        n.id === change.id ? { ...n, position: change.position } : n
      )
    }
    if (change.type === 'remove') {
      return acc.filter((n) => n.id !== change.id)
    }
    if (change.type === 'select') {
      return acc.map((n) =>
        n.id === change.id ? { ...n, selected: change.selected } : n
      )
    }
    return acc
  }, nodes)
}

function applyEdgeChanges(changes, edges) {
  return changes.reduce((acc, change) => {
    if (change.type === 'remove') {
      return acc.filter((e) => e.id !== change.id)
    }
    if (change.type === 'select') {
      return acc.map((e) =>
        e.id === change.id ? { ...e, selected: change.selected } : e
      )
    }
    return acc
  }, edges)
}
