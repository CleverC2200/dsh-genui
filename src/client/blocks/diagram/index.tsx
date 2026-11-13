import { renderInline } from '../../inline.ts'
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import css from '../../GenuiBlock.module.css'
import type { GenuiDiagram } from '../../spec.ts'
import type { AnswersState } from '../state.ts'
import { GENUI_LIMITS } from '../../genui-runtime/index.ts'
import { resolveLayout } from './layout.ts'
import { routeEdge, labelGeometry, type Box } from './geometry.ts'
import { resolvePalette, nodeTreatment, edgeStroke, inkAt } from './theme.ts'
import { t, type GenuiTextKey } from '../../i18n/index.ts'

const FONT_SANS = "'Geist', -apple-system, 'Segoe UI', sans-serif"
const FONT_MONO = "'Geist Mono', ui-monospace, 'SF Mono', monospace"

const NODE_H = 64
const LEGEND_COL_W = 150
const LEGEND_ROW_H = 22

const LEGEND_ITEMS: Array<{ key: GenuiTextKey; type: string | undefined }> = [
  { key: 'dgm.legend.focal', type: 'focal' },
  { key: 'dgm.legend.backend', type: 'backend' },
  { key: 'dgm.legend.store', type: 'store' },
  { key: 'dgm.legend.external', type: 'external' },
  { key: 'dgm.legend.optional', type: 'optional' },
  { key: 'dgm.legend.security', type: 'security' },
]

function buildParentMap(edges: Array<{ from: string; to: string }>): (id: string) => string | undefined {
  const parents = new Map<string, string>()
  for (const e of edges) {
    if (!parents.has(e.to)) parents.set(e.to, e.from)
  }
  return id => parents.get(id)
}

function renderNodeBox(
  box: Box,
  label: string,
  sub: string | undefined,
  type: string | undefined,
  tag: string | undefined,
  selected: boolean,
  palette: ReturnType<typeof resolvePalette>,
): React.ReactNode {
  const treatment = nodeTreatment(type, palette)
  const cx = box.x + box.w / 2

  const nameY = box.y + (box.h - NODE_H) / 2 + 28
  const subY = box.y + (box.h - NODE_H) / 2 + 44
  const tagW = Math.min(44, Math.max(24, (tag ?? '').length * 7 + 8))
  return (
    <g>
      {                                                                        }
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={6} fill={palette.paper} />
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={6}
        fill={treatment.fill}
        stroke={selected ? palette.accent : treatment.stroke}
        strokeWidth={selected ? 2.5 : 1}
        strokeDasharray={treatment.dashed === true ? '5,4' : undefined}
      />
      {tag !== undefined && (
        <>
          <rect x={box.x + 8} y={box.y + 6} width={tagW} height={12} rx={2} fill="transparent" stroke={inkAt(treatment.stroke, 0.4)} strokeWidth={0.8} />
          <text x={box.x + 8 + tagW / 2} y={box.y + 15} fill={inkAt(treatment.stroke, 0.8)} fontSize={7} fontFamily={FONT_MONO} textAnchor="middle" letterSpacing={0.8}>{tag}</text>
        </>
      )}
      <text x={cx} y={nameY} fill={palette.ink} fontSize={12} fontWeight={600} fontFamily={FONT_SANS} textAnchor="middle">{label}</text>
      {sub !== undefined && (
        <text x={cx} y={subY} fill={palette.soft} fontSize={9} fontFamily={FONT_MONO} textAnchor="middle">{sub}</text>
      )}
    </g>
  )
}

function renderEdge(edge: { from: Box; to: Box; label?: string | undefined; kind?: string | undefined }, key: number, palette: ReturnType<typeof resolvePalette>, markerId: string): React.ReactNode {
  const routed = routeEdge(edge.from, edge.to)
  const stroke = edgeStroke(edge.kind, palette)
  const dashed = edge.kind === 'dashed'

  const width = edge.kind === 'accent' ? 1.4 : 1.2
  const lg = labelGeometry(routed.a, routed.b)
  return (
    <g key={key}>
      <path
        d={routed.d}
        fill="none"
        stroke={stroke}
        strokeWidth={width}
        strokeDasharray={dashed ? '5,4' : undefined}
        markerEnd={`url(#${markerId})`}
      />
      {edge.label !== undefined && (
        <g>
          <rect
            x={lg.cx - (edge.label.length * 5 + 8) / 2}
            y={lg.maskY}
            width={edge.label.length * 5 + 8}
            height={12}
            rx={2}
            fill={palette.paper}
          />
          <text x={lg.cx} y={lg.maskY + 9} fill={palette.soft} fontSize={8} fontFamily={FONT_MONO} textAnchor="middle" letterSpacing={0.5}>{edge.label}</text>
        </g>
      )}
    </g>
  )
}

function renderMarkers(uid: string, palette: ReturnType<typeof resolvePalette>): React.ReactNode {
  return (
    <defs>
      <marker id={`${uid}-arrow`} markerWidth={8} markerHeight={6} refX={7} refY={3} orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill={palette.muted} />
      </marker>
      <marker id={`${uid}-arrow-accent`} markerWidth={8} markerHeight={6} refX={7} refY={3} orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill={palette.accent} />
      </marker>
      <marker id={`${uid}-arrow-link`} markerWidth={8} markerHeight={6} refX={7} refY={3} orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill={palette.link} />
      </marker>
    </defs>
  )
}

function renderGround(uid: string, palette: ReturnType<typeof resolvePalette>): React.ReactNode {
  return (
    <>
      <defs>
        <pattern id={`${uid}-dots`} width={22} height={22} patternUnits="userSpaceOnUse">
          <circle cx={1} cy={1} r={0.9} fill={inkAt(palette.ink, 0.10)} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={palette.paper} />
      <rect width="100%" height="100%" fill={`url(#${uid}-dots)`} opacity={0.55} />
    </>
  )
}

function renderZone(z: { label: string; x: number; y: number; w: number; h: number }, palette: ReturnType<typeof resolvePalette>): React.ReactNode {
  const labelW = z.label.length * 7 + 12
  const cx = z.x + z.w / 2
  return (
    <g>
      <rect x={z.x} y={z.y} width={z.w} height={z.h} rx={8} fill={inkAt(palette.ink, 0.02)} stroke={inkAt(palette.ink, 0.10)} strokeWidth={0.8} />
      <rect x={cx - labelW / 2} y={z.y + 4} width={labelW} height={12} rx={2} fill={palette.paper} />
      <text x={cx} y={z.y + 13} fill={inkAt(palette.ink, 0.40)} fontSize={7} fontFamily={FONT_MONO} textAnchor="middle" letterSpacing={1.2}>{z.label}</text>
    </g>
  )
}

function renderLegend(palette: ReturnType<typeof resolvePalette>, items: ReadonlyArray<{ label: string; type: string | undefined }>, width: number, cols: number): React.ReactNode {
  return (
    <g>
      <line x1={40} y1={0} x2={Math.max(120, width - 40)} y2={0} stroke={inkAt(palette.ink, 0.10)} strokeWidth={0.8} />
      <text x={40} y={16} fill={palette.soft} fontSize={8} fontFamily={FONT_MONO} letterSpacing={1.6}>{t('dgm.legend')}</text>
      {items.map((item, i) => {
        const t = nodeTreatment(item.type, palette)
        const x = 40 + (i % cols) * LEGEND_COL_W
        const y = 32 + Math.floor(i / cols) * LEGEND_ROW_H
        return (
          <g key={item.label}>
            <rect x={x} y={y} width={14} height={10} rx={2} fill={t.fill} stroke={t.stroke} strokeWidth={1} strokeDasharray={t.dashed === true ? '3,2' : undefined} />
            <text x={x + 20} y={y + 9} fill={palette.soft} fontSize={8.5} fontFamily={FONT_SANS}>{item.label}</text>
          </g>
        )
      })}
    </g>
  )
}

function markerFor(kind: string | undefined, uid: string): string {
  if (kind === 'accent') return `${uid}-arrow-accent`
  if (kind === 'link') return `${uid}-arrow-link`
  return `${uid}-arrow`
}

let uidCounter = 0
function nextUid(): string {
  uidCounter += 1
  return `genui-diagram-${uidCounter}`
}

export function DiagramNode({ node, answers }: { node: GenuiDiagram; answers?: AnswersState | undefined }) {
  const uid = useMemo(nextUid, [])
  const [localSelection, setLocalSelection] = useState<{ scope: string | undefined; id: string }>({ scope: node.id, id: '' })
  const storedSelection = node.id === undefined ? undefined : answers?.fields[node.id]
  const scopedSelection = localSelection.scope === node.id ? localSelection.id : ''
  const candidate = storedSelection ?? scopedSelection
  const selectableNodes = node.nodes.slice(0, GENUI_LIMITS.maxDiagramNodes)
  const selected = selectableNodes.some(item => item.id === candidate) ? candidate : ''
  const selectedNode = selectableNodes.find(item => item.id === selected)

  const palette = useMemo(() => resolvePalette(node.variant, node.theme), [node.variant, node.theme])
  const layout = useMemo(() => resolveLayout(node, buildParentMap(node.edges ?? [])), [node])

  const byId = useMemo(() => new Map(layout.nodes.map(l => [l.node.id, l.box])), [layout])

  const titleId = `${uid}-title`
  const captionId = `${uid}-caption`
  const descId = `${uid}-desc`

  const nodes = layout.nodes.slice(0, GENUI_LIMITS.maxDiagramNodes)
  const edges = layout.edges.slice(0, GENUI_LIMITS.maxDiagramEdges)
  const zones = (node.zones ?? []).slice(0, GENUI_LIMITS.maxDiagramZones)

  useEffect(() => {
    if (node.id !== undefined && storedSelection === undefined && localSelection.scope === undefined && localSelection.id !== '') {
      answers?.setField(node.id, localSelection.id)
      setLocalSelection({ scope: node.id, id: localSelection.id })
      return
    }
    if (localSelection.scope !== node.id && localSelection.id !== '') {
      setLocalSelection({ scope: node.id, id: '' })
      return
    }
    if (selected === '' && scopedSelection !== '') {
      setLocalSelection({ scope: node.id, id: '' })
      return
    }
    if (candidate === selected) return
    setLocalSelection({ scope: node.id, id: '' })
    if (node.id !== undefined && candidate !== '') answers?.setField(node.id, '')
  }, [answers, candidate, localSelection, node.id, selected, storedSelection])

  function selectNode(id: string): void {
    setLocalSelection({ scope: node.id, id })
    if (node.id !== undefined) answers?.setField(node.id, id)
  }

  function handleNodeKeyDown(event: KeyboardEvent<SVGGElement>, id: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    selectNode(id)
  }

  let focalSeen = 0
  const focalBudget = GENUI_LIMITS.maxDiagramFocal

  const contentH = layout.height

  const legendItems = LEGEND_ITEMS
    .filter(item => item.type !== undefined
      && nodes.some(n => (n.node.type ?? 'backend') === item.type))
    .map(item => ({ label: t(item.key), type: item.type }))
  const legendCols = Math.max(1, Math.floor((layout.width - 40) / LEGEND_COL_W))
  const legendRows = Math.max(1, Math.ceil(legendItems.length / legendCols))
  const legendH = 24 + legendRows * LEGEND_ROW_H
  const canvasH = contentH + legendH + 12

  return (
    <figure className="genui-diagram" data-genui-diagram>
      {node.title !== undefined && (
        <figcaption id={captionId} style={{ fontFamily: 'inherit', fontSize: 'var(--dsl-g-font-h3)', fontWeight: 600, lineHeight: 1.4, marginBottom: 10, color: palette.ink }}>
          {renderInline(node.title)}
        </figcaption>
      )}
      <svg
        role="group"
        aria-labelledby={titleId}
        aria-describedby={descId}
        viewBox={`0 0 ${layout.width} ${canvasH}`}
        style={{
          maxWidth: '100%',
          height: 'auto',
          background: palette.paper,

          borderRadius: 'var(--dsl-g-radius-surface)',
          border: '1px solid var(--dsl-g-border)',
        }}
      >
        <title id={titleId}>{node.title ?? node.kind}</title>
        <desc id={descId}>{`${node.kind} diagram with ${nodes.length} nodes and ${edges.length} connectors`}</desc>
        {renderMarkers(uid, palette)}
        {renderGround(uid, palette)}
        {                                         }
        <g>
          {zones.map((z, i) => (
            <g key={`zone-${i}`}>
              {renderZone({ label: z.label, x: z.x ?? 0, y: z.y ?? 0, w: z.w ?? 100, h: z.h ?? 100 }, palette)}
            </g>
          ))}
        </g>
        <g>
          {edges.map((e, i) => {
            const from = byId.get(e.fromId)
            const to = byId.get(e.toId)
            if (from === undefined || to === undefined) return null
            return renderEdge({ from, to, label: e.edge.label, kind: e.edge.kind }, i, palette, markerFor(e.edge.kind, uid))
          })}
        </g>
        {                       }
        <g>
          {nodes.map(l => {
            const effectiveType = l.node.type === 'focal' && focalSeen >= focalBudget ? undefined : l.node.type
            if (l.node.type === 'focal') focalSeen += 1
            return (
              <g
                key={l.node.id}
                className={css.diagramNode}
                role="button"
                tabIndex={0}
                aria-label={l.node.label}
                aria-pressed={selected === l.node.id}
                data-selected={selected === l.node.id}
                onClick={() => selectNode(l.node.id)}
                onKeyDown={event => handleNodeKeyDown(event, l.node.id)}
              >
                {renderNodeBox(l.box, l.node.label, l.node.sub, effectiveType, l.node.tag, selected === l.node.id, palette)}
              </g>
            )
          })}
        </g>
        {                  }
        <g transform={`translate(0, ${contentH + 8})`}>
          {renderLegend(palette, legendItems, layout.width, legendCols)}
        </g>
      </svg>
      {selectedNode !== undefined && (
        <section className={css.diagramDetails} aria-live="polite">
          <span className={css.diagramDetailsHeading}>{t('dgm.details')}</span>
          <strong>{selectedNode.label}</strong>
          {(selectedNode.description ?? selectedNode.sub) !== undefined && (
            <div>{renderInline(selectedNode.description ?? selectedNode.sub ?? '')}</div>
          )}
        </section>
      )}
    </figure>
  )
}
