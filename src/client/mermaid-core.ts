import { assertSafeSvg, ensureFlowchartKind, repairMermaidSource } from './mermaid-safe.ts'
import { readMermaidThemeColor } from './mermaid-colors.ts'

let mermaidPromise: Promise<typeof import('mermaid')> | null = null

let renderSeq = 0

async function loadMermaid(target?: HTMLElement): Promise<typeof import('mermaid')> {
  mermaidPromise ??= import('mermaid')
  const m = await mermaidPromise

  const api = m.default

  const colors = new Map<string, string>()
  const token = (name: string, fallback: string): string => {
    const cached = colors.get(name)
    if (cached !== undefined) return cached
    const color = readMermaidThemeColor(name, fallback, target)
    colors.set(name, color)
    return color
  }
  api.initialize({
    startOnLoad: false,

    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      background: 'transparent',

      fontFamily: getComputedStyle(target ?? document.body).fontFamily,
      fontSize: '13px',
      primaryColor: token('--dsw-alias-bg-layer-2', '#2c2c2e'),
      primaryTextColor: token('--dsw-alias-label-primary', '#e6e6e6'),
      primaryBorderColor: token('--dsw-alias-border-l2', 'rgba(255,255,255,0.12)'),
      secondaryColor: token('--dsw-alias-bg-layer-2', '#2c2c2e'),
      secondaryTextColor: token('--dsw-alias-label-primary', '#e6e6e6'),
      secondaryBorderColor: token('--dsw-alias-border-l2', 'rgba(255,255,255,0.12)'),
      tertiaryColor: token('--dsw-alias-bg-layer-2', '#2c2c2e'),
      tertiaryTextColor: token('--dsw-alias-label-primary', '#e6e6e6'),
      tertiaryBorderColor: token('--dsw-alias-border-l2', 'rgba(255,255,255,0.12)'),
      mainBkg: token('--dsw-alias-bg-layer-2', '#2c2c2e'),
      nodeBorder: token('--dsw-alias-border-l2', 'rgba(255,255,255,0.12)'),
      nodeTextColor: token('--dsw-alias-label-primary', '#e6e6e6'),
      lineColor: token('--dsw-alias-label-tertiary', '#8a8a92'),
      textColor: token('--dsw-alias-label-primary', '#e6e6e6'),
      edgeLabelBackground: 'transparent',
      clusterBkg: 'transparent',
      clusterBorder: token('--dsw-alias-border-l2', 'rgba(255,255,255,0.12)'),
      titleColor: token('--dsw-alias-label-primary', '#e6e6e6'),
    },

    themeCSS: [
      '.node rect, .node polygon, .node circle, .node ellipse { rx: 8px; ry: 8px; stroke-width: 1px; }',
      '.cluster rect { rx: 10px; ry: 10px; }',
      '.edgePath .path { stroke-width: 1.4px; }',
      '.label { color: inherit; }',
    ].join(' '),

    suppressErrorRendering: true,
  })
  return m
}

const ALLOWED_KINDS = [
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram',
  'gantt', 'pie', 'erDiagram', 'journey', 'gitGraph',
]

async function renderInto(m: typeof import('mermaid'), id: string, code: string, container: HTMLDivElement): Promise<string> {
  container.style.position = 'fixed'
  container.style.left = '-100000px'
  container.style.top = '0'
  container.style.margin = '0'
  document.body?.appendChild(container)
  try {
    const { svg } = await m.default.render(id, code, container)
    assertSafeSvg(svg)
    return svg
  } finally {
    container.remove()
  }
}

export async function renderMermaid(code: string, target?: HTMLElement): Promise<string> {
  let trimmed = code.trim()
  const firstLine = trimmed.split('\n', 1)[0] ?? ''
  let kind = /^([A-Za-z]+)/.exec(firstLine)?.[1] ?? ''
  if (!ALLOWED_KINDS.includes(kind)) {

    const lenient = ensureFlowchartKind(trimmed)
    if (lenient !== trimmed) {
      trimmed = lenient
      kind = 'graph'
    }
  }
  if (!ALLOWED_KINDS.includes(kind)) {
    throw new Error(`mermaid kind '${kind}' is not allowed`)
  }
  const m = await loadMermaid(target)
  const container = document.createElement('div')
  try {
    try {
      return await renderInto(m, `genui-mermaid-${renderSeq++}`, trimmed, container)
    } catch (error) {

      const repaired = repairMermaidSource(trimmed)
      if (repaired !== trimmed) {
        return await renderInto(m, `genui-mermaid-${renderSeq++}`, repaired, container)
      }
      throw error
    }
  } finally {
    container.remove()
  }
}
