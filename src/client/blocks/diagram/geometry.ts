export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export type Port = 'left' | 'right' | 'top' | 'bottom'

export interface Attach {
  x: number
  y: number
  port: Port
}

const R = 8

function centerOf(b: Box): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 }
}

export function center(b: Box): Point {
  return centerOf(b)
}

export function attachPoint(box: Box, toward: Box, prefer: Port | undefined): Attach {
  if (prefer === 'left') return { x: box.x, y: box.y + box.h / 2, port: 'left' }
  if (prefer === 'right') return { x: box.x + box.w, y: box.y + box.h / 2, port: 'right' }
  if (prefer === 'top') return { x: box.x + box.w / 2, y: box.y, port: 'top' }
  if (prefer === 'bottom') return { x: box.x + box.w / 2, y: box.y + box.h, port: 'bottom' }
  const c = centerOf(box)
  const t = centerOf(toward)
  const dx = t.x - c.x
  const dy = t.y - c.y
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { x: box.x + box.w, y: box.y + box.h / 2, port: 'right' }
      : { x: box.x, y: box.y + box.h / 2, port: 'left' }
  }
  return dy >= 0
    ? { x: box.x + box.w / 2, y: box.y + box.h, port: 'bottom' }
    : { x: box.x + box.w / 2, y: box.y, port: 'top' }
}

export function orthogonalPath(a: Attach, b: Attach): string {
  if (a.x === b.x) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`
  if (a.y === b.y) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`

  const horizA = a.port === 'left' || a.port === 'right'
  const horizB = b.port === 'left' || b.port === 'right'

  if (horizA && horizB) {
    const midX = (a.x + b.x) / 2
    const dirA = a.port === 'right' ? 1 : -1
    return `M ${a.x} ${a.y} H ${midX - dirA * R} Q ${midX} ${a.y} ${midX} ${a.y + R} V ${b.y - R} Q ${midX} ${b.y} ${midX + R} ${b.y} H ${b.x}`
  }

  if (!horizA && !horizB) {
    const midY = (a.y + b.y) / 2
    const dirA = a.port === 'bottom' ? 1 : -1
    return `M ${a.x} ${a.y} V ${midY - dirA * R} Q ${a.x} ${midY} ${a.x + R} ${midY} H ${b.x - R} Q ${b.x} ${midY} ${b.x} ${midY + R} V ${b.y}`
  }

  if (horizA) {
    const dirA = a.port === 'right' ? 1 : -1
    return `M ${a.x} ${a.y} H ${a.x + dirA * R * 2} Q ${a.x + dirA * R * 2} ${a.y} ${a.x + dirA * R * 2} ${b.y} V ${b.y} H ${b.x}`
  }
  const dirA = a.port === 'bottom' ? 1 : -1
  return `M ${a.x} ${a.y} V ${a.y + dirA * R * 2} Q ${a.x} ${a.y + dirA * R * 2} ${b.x} ${a.y + dirA * R * 2} H ${b.x} V ${b.y}`
}

export function routeEdge(from: Box, to: Box, opts?: { fromPort?: Port; toPort?: Port }): { d: string; a: Attach; b: Attach } {
  const a = attachPoint(from, to, opts?.fromPort)
  const b = attachPoint(to, from, opts?.toPort)
  return { d: orthogonalPath(a, b), a, b }
}

export function fanPoint(box: Box, edge: 'top' | 'bottom' | 'left' | 'right', index: number, count: number): Attach {
  const n = Math.max(1, count)
  const t = (index + 1) / (n + 1)
  if (edge === 'top' || edge === 'bottom') {
    const x = box.x + box.w * t
    return edge === 'top' ? { x, y: box.y, port: 'top' } : { x, y: box.y + box.h, port: 'bottom' }
  }
  const y = box.y + box.h * t
  return edge === 'left' ? { x: box.x, y, port: 'left' } : { x: box.x + box.w, y, port: 'right' }
}

export function labelGeometry(a: Attach, b: Attach): { cx: number; cy: number; maskY: number; vertical: boolean } {
  const cx = (a.x + b.x) / 2
  const cy = (a.y + b.y) / 2
  const vertical = Math.abs(a.x - b.x) < Math.abs(a.y - b.y)
  if (vertical) {
    const side = b.x >= a.x ? 1 : -1
    return { cx: cx + side * 16, cy, maskY: cy - 6, vertical }
  }
  return { cx, cy, maskY: cy - 20, vertical }
}

export function bridgePath(cx: number, cy: number, horizontal: boolean): string {
  return horizontal
    ? `M ${cx - 8} ${cy} a 8,8 0 0,1 16,0`
    : `M ${cx} ${cy - 8} a 8,8 0 0,0 0,16`
}
