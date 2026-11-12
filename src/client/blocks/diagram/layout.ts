import type { GenuiDiagram, GenuiDiagramEdge, GenuiDiagramKind, GenuiDiagramNode } from '../../spec.ts'
import { Box } from './geometry.ts'

export interface LayoutNode {
  node: GenuiDiagramNode
  box: Box
}

export interface LayoutEdge {
  edge: GenuiDiagramEdge

  fromId: string
  toId: string
}

export interface DiagramLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]

  width: number
  height: number
}

const COORDINATE_KINDS: readonly GenuiDiagramKind[] = [
  'architecture', 'it-state', 'high-level', 'process', 'medallion', 'data-flow', 'dp-integration',
]

const GAP = 32
const NODE_W = 128
const NODE_H = 64
const MARGIN = 40

function isCoord(kind: GenuiDiagramKind): boolean {
  return COORDINATE_KINDS.includes(kind)
}

function defaultBox(i: number, cols: number): Box {
  const col = i % cols
  const row = Math.floor(i / cols)
  return {
    x: MARGIN + col * (NODE_W + GAP),
    y: MARGIN + row * (NODE_H + GAP),
    w: NODE_W,
    h: NODE_H,
  }
}

function columnLayout(nodes: GenuiDiagramNode[]): LayoutNode[] {
  return nodes.map((node, i) => ({
    node,
    box: { x: MARGIN, y: MARGIN + i * (NODE_H + GAP), w: NODE_W, h: NODE_H },
  }))
}

function rowLayout(nodes: GenuiDiagramNode[]): LayoutNode[] {
  return nodes.map((node, i) => ({
    node,
    box: { x: MARGIN + i * (NODE_W + GAP), y: MARGIN, w: NODE_W, h: NODE_H },
  }))
}

function layerLayout(nodes: GenuiDiagramNode[], perRow = 3): LayoutNode[] {
  return nodes.map((node, i) => {
    const row = Math.floor(i / perRow)
    const col = i % perRow
    return {
      node,
      box: {
        x: MARGIN + col * (NODE_W + GAP),
        y: MARGIN + row * (NODE_H + GAP),
        w: NODE_W,
        h: NODE_H,
      },
    }
  })
}

function treeLayout(nodes: GenuiDiagramNode[], parentOf: (id: string) => string | undefined): LayoutNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const childrenOf = new Map<string, string[]>()
  const roots: string[] = []
  for (const n of nodes) {
    const p = parentOf(n.id)
    if (p === undefined || !byId.has(p)) {
      roots.push(n.id)
    } else {
      const list = childrenOf.get(p) ?? []
      list.push(n.id)
      childrenOf.set(p, list)
    }
  }
  const placed = new Map<string, Box>()
  const depthOf = new Map<string, number>()

  const measure = (id: string, depth: number): number => {
    depthOf.set(id, depth)
    const kids = childrenOf.get(id) ?? []
    if (kids.length === 0) return 1
    return kids.reduce((sum, k) => sum + measure(k, depth + 1), 0)
  }

  const assign = (id: string, left: number): number => {
    const depth = depthOf.get(id) ?? 0
    const kids = childrenOf.get(id) ?? []
    const w = NODE_W
    let cursor = left
    if (kids.length === 0) {
      placed.set(id, { x: left, y: MARGIN + depth * (NODE_H + GAP * 1.5), w, h: NODE_H })
      return left + w
    }
    for (const k of kids) cursor = assign(k, cursor)
    const first = placed.get(kids[0]!)!
    const last = placed.get(kids[kids.length - 1]!)!
    const cx = (first.x + last.x + last.w) / 2 - w / 2
    placed.set(id, { x: Math.max(left, cx), y: MARGIN + depth * (NODE_H + GAP * 1.5), w, h: NODE_H })
    return cursor
  }

  let left = MARGIN
  for (const r of roots) {
    left = assign(r, left) + GAP
  }
  return nodes.map(n => ({ node: n, box: placed.get(n.id) ?? { x: MARGIN, y: MARGIN, w: NODE_W, h: NODE_H } }))
}

export function resolveLayout(
  diagram: GenuiDiagram,
  parentOf?: (id: string) => string | undefined,
): DiagramLayout {
  const nodes = diagram.nodes
  const edges = diagram.edges ?? []

  let placed: LayoutNode[]
  if (isCoord(diagram.kind)) {
    placed = nodes.map((node, i) => ({
      node,
      box: {
        x: node.x ?? MARGIN + (i % 3) * (NODE_W + GAP),
        y: node.y ?? MARGIN + Math.floor(i / 3) * (NODE_H + GAP),
        w: node.w ?? NODE_W,
        h: node.h ?? NODE_H,
      },
    }))
  } else if (diagram.kind === 'tree' || diagram.kind === 'org-chart' || diagram.kind === 'nested') {
    placed = treeLayout(nodes, parentOf ?? (() => undefined))
  } else if (diagram.kind === 'layers' || diagram.kind === 'pyramid' || diagram.kind === 'gantt') {
    placed = layerLayout(nodes)
  } else if (diagram.kind === 'flowchart' || diagram.kind === 'process' || diagram.kind === 'sequence') {

    placed = columnLayout(nodes)
  } else if (diagram.kind === 'timeline' || diagram.kind === 'line' || diagram.kind === 'scatter' || diagram.kind === 'bar') {
    placed = rowLayout(nodes)
  } else {
    placed = nodes.map((node, i) => ({ node, box: defaultBox(i, 3) }))
  }

  let width = 0
  let height = 0
  for (const l of placed) {
    width = Math.max(width, l.box.x + l.box.w)
    height = Math.max(height, l.box.y + l.box.h)
  }
  width = Math.max(320, Math.ceil((width + MARGIN) / 4) * 4)

  height = Math.max(96, Math.ceil((height + MARGIN) / 4) * 4)

  const edgesOut: LayoutEdge[] = edges.map(e => ({ edge: e, fromId: e.from, toId: e.to }))

  return { nodes: placed, edges: edgesOut, width, height }
}
