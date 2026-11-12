import { COMPONENT_SCHEMAS, GENUI_NATIVE_TYPES, POPOVER_PLACEMENTS, WHEN_OPS } from './genui-runtime/schema.ts'

export type GenuiWhenOp = typeof WHEN_OPS[number]

export interface GenuiWhen {

  field: string
  op: GenuiWhenOp

  value?: string | number | boolean | (string | number)[]
}

export interface GenuiLayoutHints {
  span?: number

  when?: GenuiWhen

  enableWhen?: GenuiWhen

  disabledReason?: string
}

export type GenuiNode = (
  | GenuiText
  | GenuiRow
  | GenuiCol
  | GenuiGrid
  | GenuiCard
  | GenuiButton
  | GenuiInput
  | GenuiSelect
  | GenuiDatePicker
  | GenuiSegmentedControl
  | GenuiCheckbox
  | GenuiLink
  | GenuiImage
  | GenuiImageGroup
  | GenuiCompare
  | GenuiChoices
  | GenuiCarousel
  | GenuiAudio
  | GenuiVideo
  | GenuiBadge
  | GenuiStat
  | GenuiHero
  | GenuiProgress
  | GenuiDivider
  | GenuiList
  | GenuiTable
  | GenuiChart
  | GenuiTabs
  | GenuiAvatar
  | GenuiSpacer
  | GenuiPlot
  | GenuiCallout
  | GenuiSteps
  | GenuiKeyValue
  | GenuiDiff
  | GenuiJson
  | GenuiCode
  | GenuiRadio
  | GenuiSubmit
  | GenuiSwitch
  | GenuiSlider
  | GenuiTextarea
  | GenuiAccordion
  | GenuiCopy
  | GenuiMermaid
  | GenuiSvg
  | GenuiScene3D
  | GenuiMap
  | GenuiTimeline
  | GenuiFileTree
  | GenuiBreadcrumb
  | GenuiQuiz
  | GenuiDiagram
  | GenuiIcon
  | GenuiBlocks
  | GenuiArrow
  | GenuiEditor
  | GenuiEntityCard
  | GenuiPopover
) & GenuiLayoutHints

  | (GenuiEChart & GenuiLayoutHints)

export interface GenuiMapLocation {
  id: string
  label: string
  coordinates: [number, number]
  description?: string
}
export interface GenuiMapRoute {
  id: string
  label: string

  coordinates: [number, number][]
}
export interface GenuiMap {
  type: 'map'
  title?: string

  id?: string
  locations: GenuiMapLocation[]
  routes?: GenuiMapRoute[]
  selected?: string
  center?: [number, number]
  zoom?: number
  height?: number
}

export interface GenuiSpec {

  title?: string

  gap?: number

  panel?: boolean

  append?: boolean

  computed?: GenuiComputed[]

  items: GenuiNode[]
}

export interface GenuiComputedFormat {
  locale?: string
  style?: 'decimal' | 'currency' | 'percent'
  currency?: string
  minimumFractionDigits?: number
  maximumFractionDigits?: number
}

export interface GenuiComputed {
  id: string
  expr: string
  format?: GenuiComputedFormat
}

export interface GenuiComputedRef {
  $computed: string
}

export const GENUI_COMPUTED_CELL = Symbol('dsh-genui-computed-cell')

export interface GenuiComputedCell {
  [GENUI_COMPUTED_CELL]: true
  value: number
  formatted: string
}

export interface GenuiText {
  type: 'text'
  size?: 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'muted' | 'caption'
  content: string

  center?: boolean

  tone?: 'danger' | 'success' | 'warning' | 'info' | 'muted'

  mono?: boolean

  align?: 'left' | 'center' | 'right'
}

export interface GenuiEditor {
  type: 'editor'
  id: string
  value: string
  label?: string
  placeholder?: string
  rows?: number
}

export interface GenuiEntityMetadata {
  label: string
  value: string
}

export interface GenuiEntityAction {
  label: string
  action: string
  tone?: 'primary' | 'danger' | 'success' | 'ghost'
}

export interface GenuiEntityCard {
  type: 'entity-card'
  name: string
  image?: string
  imageAlt?: string
  description?: string
  metadata?: GenuiEntityMetadata[]
  href?: string
  sourceLabel?: string
  actions?: GenuiEntityAction[]
}

export interface GenuiPopover {
  type: 'popover'
  label: string
  content: string
  trigger?: 'click' | 'hover'
  placement?: typeof POPOVER_PLACEMENTS[number]
}

export interface GenuiButton {
  type: 'button'
  label: string
  tone?: 'primary' | 'danger' | 'success' | 'ghost'
  full?: boolean
  small?: boolean
  icon?: string

  action?: string
}

export interface GenuiInput {
  type: 'input'
  label?: string
  placeholder?: string
  value?: string
  inputType?: 'text' | 'email' | 'password' | 'color' | 'number'

  action?: string

  id?: string
}

export interface GenuiSelect {
  type: 'select'
  label?: string
  options: string[]

  action?: string

  selected?: number

  id?: string
}

export interface GenuiDatePicker {
  type: 'date-picker'
  label?: string
  mode?: 'single' | 'range'

  value?: string
  min?: string
  max?: string

  id?: string
}

export interface GenuiSegmentedControl {
  type: 'segmented-control'
  label?: string
  options: string[]
  value?: string
  id?: string
  action?: string
}

export const GENUI_CHECKBOX_VALUE = Symbol('dsh-genui-checkbox-value')

export interface GenuiCheckbox {
  [GENUI_CHECKBOX_VALUE]?: string
  type: 'checkbox'
  label: string
  checked?: boolean

  action?: string

  group?: string
}

export interface GenuiLink {
  type: 'link'
  label: string

  href?: string
}

export interface GenuiImage {
  type: 'image'
  src: string

  alt?: string

  caption?: string
}

export interface GenuiImageGroupItem {
  src: string
  alt?: string
  caption?: string
}

export interface GenuiImageGroup {
  type: 'image-group'
  items: GenuiImageGroupItem[]
  title?: string
}

export interface GenuiComparePanel {

  src: string

  label?: string

  alt?: string

  caption?: string
}

export interface GenuiChoiceItem {

  label: string

  hint?: string

  meta?: string

  recommended?: boolean

  disabled?: boolean

  reason?: string
}

export interface GenuiChoices {
  type: 'choices'
  title?: string

  prompt?: string

  mode?: 'single' | 'multi'
  items: GenuiChoiceItem[]

  submit?: string

  action?: string

  max?: number

  group?: string

  answer?: number | string

  explanation?: string
}

export interface GenuiCompare {
  type: 'compare'
  title?: string
  before: GenuiComparePanel
  after: GenuiComparePanel

  mode?: 'side' | 'stack' | 'slider'

  height?: number
}

export interface GenuiCarousel {
  type: 'carousel'
  items: GenuiNode[]
  title?: string

  itemWidth?: number

  gap?: number
}

export interface GenuiAudio {
  type: 'audio'
  src: string

  alt?: string
  loop?: boolean
}

export interface GenuiVideo {
  type: 'video'
  src: string

  alt?: string
  poster?: string
  loop?: boolean
  muted?: boolean
  aspectRatio?: '16:9' | '4:3' | '1:1' | '9:16'
}

export interface GenuiBadge {
  type: 'badge'
  label: string
  tone?: 'success' | 'warn' | 'danger' | 'accent'
  icon?: string
}

export interface GenuiHero {
  type: 'hero'
  title: string
  subtitle?: string

  value?: string

  label?: string
  delta?: string
  spark?: number[]
  tone?: 'accent' | 'success' | 'warning' | 'danger'
}

export interface GenuiStat {
  type: 'stat'
  label: string
  value: string
  delta?: string

  spark?: number[]

  size?: 'hero'
}

export interface GenuiProgress {
  type: 'progress'
  value: number
  label?: string
  valueLabel?: string

  variant?: 'bar' | 'ring'

  target?: number
}

export interface GenuiDivider {
  type: 'divider'

  label?: string
}

export interface GenuiAvatar {
  type: 'avatar'
  name: string
  color?: string
}

export interface GenuiSpacer {
  type: 'spacer'
}

export interface GenuiArrow {
  type: 'arrow'
  dir?: 'down' | 'right'

  length?: number

  label?: string
}

export interface GenuiIcon {
  type: 'icon'

  name: string

  label?: string
  tone?: 'default' | 'muted' | 'info' | 'success' | 'warning' | 'danger'

  size?: number

  tile?: boolean
}

export type GenuiBlockCell = string | null | {
  text: string

  color?: string

  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'muted'

  sub?: string
}

export interface GenuiBlocksRow {

  label?: string

  cells: GenuiBlockCell[]

  color?: string

  variant?: 'fill' | 'outline' | 'plain'
}

export interface GenuiBlocks {
  type: 'blocks'
  rows: GenuiBlocksRow[]

  columns?: number

  caption?: string
  title?: string
}

export interface GenuiRow {
  type: 'row'
  items: GenuiNode[]
  wrap?: boolean
  spacer?: boolean

  justify?: 'start' | 'center' | 'end' | 'between'
}

export interface GenuiCol {
  type: 'col'
  items: GenuiNode[]
  gap?: number

  width?: number
}

export interface GenuiGrid {
  type: 'grid'
  cols: number
  items: GenuiNode[]
}

export interface GenuiCard {
  type: 'card'
  title?: string

  eyebrow?: string

  tone?: 'info' | 'success' | 'warning' | 'danger'

  accent?: string

  flat?: boolean
  items: GenuiNode[]
}

export interface GenuiList {
  type: 'list'

  filter?: string
  items: Array<string | { title: string; desc?: string } | GenuiNode>
}

export interface GenuiTable {
  type: 'table'
  columns: string[]
  rows: Array<Array<string | number | GenuiComputedRef | GenuiComputedCell>>

  types?: TableCellType[]

  total?: boolean

  export?: boolean

  details?: Array<GenuiNode[] | null>

  filter?: string

  filterColumn?: number

  sortField?: string

  wrap?: boolean
}

export type TableCellType = 'text' | 'num' | 'delta' | 'bar' | 'badge' | 'spark' | 'ring' | 'index' | 'group'

export interface GenuiChartDatum {
  label: string
  value: number | GenuiComputedRef | null
  color?: string
}

export interface GenuiChart {
  type: 'chart'

  kind?: 'bars' | 'line' | 'donut'
  data: GenuiChartDatum[]

  series?: Array<{ label: string; color?: string; data: GenuiChartDatum[] }>

  horizontal?: boolean

  stacked?: boolean

  palette?: string[]

  filter?: string
}

export interface GenuiTab {
  label: string
  items: GenuiNode[]
}

export interface GenuiTabs {
  type: 'tabs'
  tabs: GenuiTab[]
}

export interface GenuiPlotSeries {

  expr: string

  label?: string

  color?: string

  kind?: 'line' | 'area' | 'scatter'

  params?: Array<{
    name: string
    value: number
    min?: number
    max?: number
    step?: number

    animateTo?: number

    durationMs?: number

    loop?: boolean
  }>
}

export interface GenuiPlot {
  type: 'plot'

  series: GenuiPlotSeries[]
  xMin?: number
  xMax?: number
  yMin?: number
  yMax?: number
  title?: string
}

export interface GenuiCallout {
  type: 'callout'
  tone?: 'info' | 'success' | 'warning' | 'error'

  title?: string
  content: string
}

export interface GenuiStep {
  title: string
  desc?: string
}

export interface GenuiSteps {
  type: 'steps'

  current?: number
  steps: GenuiStep[]
}

export interface GenuiKeyValue {
  type: 'keyvalue'
  pairs: Array<{ key: string; value: string }>
}

export interface GenuiDiff {
  type: 'diff'
  diffs: Array<{
    path: string
    oldText: string | null
    newText: string
  }>
}

export interface GenuiJson {
  type: 'json'

  value: unknown
}

export interface GenuiCode {
  type: 'code'
  lang?: string
  code: string
}

export interface GenuiRadio {
  type: 'radio'
  label?: string
  options: string[]

  selected?: number

  action?: string

  group?: string

  answer?: number | string

  explanation?: string
}

export interface GenuiSubmit {
  type: 'submit'
  label: string

  action?: string

  resetAction?: string

  groups?: string[]
}

export interface GenuiSwitch {
  type: 'switch'
  label: string
  checked?: boolean

  action?: string
}

export interface GenuiSlider {
  type: 'slider'
  label?: string
  min?: number
  max?: number
  step?: number

  value?: number

  action?: string

  id?: string
}

export interface GenuiTextarea {
  type: 'textarea'
  label?: string
  placeholder?: string
  rows?: number
  value?: string

  action?: string

  id?: string
}

export interface GenuiAccordionItem {
  title: string
  items: GenuiNode[]
}

export interface GenuiAccordion {
  type: 'accordion'
  items: GenuiAccordionItem[]
}

export interface GenuiCopy {
  type: 'copy'
  label?: string
  text: string

  expandable?: boolean

  previewLines?: number
}

export interface GenuiSvg {
  type: 'svg'

  code: string
  title?: string
  height?: number
}

export interface GenuiMermaid {
  type: 'mermaid'

  code: string
}

export interface GenuiMesh {

  shape: 'box' | 'sphere' | 'cone' | 'cylinder' | 'torus'

  color?: string

  position?: [number, number, number]

  rotation?: [number, number, number]

  scale?: number | [number, number, number]

  size?: number | [number, number, number]
}

export interface GenuiScene3D {
  type: 'scene3d'
  title?: string
  meshes: GenuiMesh[]

  ambient?: number

  background?: string
}

export interface GenuiTimelineItem {

  title: string

  desc?: string

  time?: string
}

export interface GenuiTimeline {
  type: 'timeline'
  items: GenuiTimelineItem[]
}

export interface GenuiFileTreeNode {

  name: string

  type?: 'file' | 'dir'

  children?: GenuiFileTreeNode[]
}

export interface GenuiFileTree {
  type: 'file-tree'
  items: GenuiFileTreeNode[]
}

export interface GenuiBreadcrumb {
  type: 'breadcrumb'
  items: string[]
}

export interface GenuiQuizOption {
  label: string

  correct?: boolean

  feedback?: string
}

export interface GenuiQuiz {
  type: 'quiz'

  question: string

  options: GenuiQuizOption[]

  explanation?: string

  id?: string

  action?: string
}

export const DIAGRAM_KINDS = [
  'architecture', 'it-state', 'flowchart', 'sequence', 'state', 'er', 'timeline',
  'swimlane', 'quadrant', 'radar', 'loop', 'nested', 'tree', 'org-chart', 'layers',
  'venn', 'pyramid', 'bar', 'line', 'gantt', 'scatter', 'high-level', 'process',
  'medallion', 'data-flow', 'dp-integration', 'dp-security-matrix',
] as const
export type GenuiDiagramKind = typeof DIAGRAM_KINDS[number]

export type GenuiDiagramVariant = 'light' | 'dark' | 'editorial'

export type GenuiDiagramNodeType =
  | 'focal' | 'backend' | 'store' | 'external' | 'input' | 'optional' | 'security'

export interface GenuiDiagramNode {

  id: string

  label: string

  sub?: string

  description?: string

  type?: GenuiDiagramNodeType

  x?: number
  y?: number
  w?: number
  h?: number

  tag?: string
}

export interface GenuiDiagramEdge {

  from: string

  to: string

  label?: string

  kind?: 'solid' | 'dashed' | 'accent' | 'link'

  route?: 'auto' | 'orthogonal' | 'straight'
}

export interface GenuiDiagramTheme {
  paper?: string
  'paper-2'?: string
  ink?: string
  muted?: string
  soft?: string
  rule?: string
  accent?: string
  'accent-tint'?: string
  link?: string
}

export interface GenuiDiagramZone {

  label: string

  x?: number
  y?: number
  w?: number
  h?: number
}

export interface GenuiDiagram {
  type: 'diagram'

  id?: string

  kind: GenuiDiagramKind

  variant?: GenuiDiagramVariant

  title?: string

  nodes: GenuiDiagramNode[]

  edges?: GenuiDiagramEdge[]

  zones?: GenuiDiagramZone[]

  theme?: GenuiDiagramTheme
}

export type EChartPreset =
  | 'bar' | 'line' | 'area' | 'pie' | 'scatter'
  | 'radar' | 'gauge' | 'funnel' | 'treemap' | 'sankey' | 'graph' | 'heatmap' | 'bigline' | 'wordCloud'

export interface GenuiEChart {
  type: 'echart'

  title?: string

  height?: number

  preset?: EChartPreset

  data?: GenuiChartDatum[]

  series?: Array<{ label: string; color?: string; data: GenuiChartDatum[] }>

  links?: Array<{ from: string; to: string; value?: number }>

  palette?: string[]

  option?: Record<string, unknown>
}

export function parseGenuiSpec(raw: string): GenuiSpec | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (isGenuiSpec(value)) return value

  return wrapSingleComponentRoot(value)
}

export function isComponentRoot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { type?: unknown; items?: unknown; children?: unknown }
  if (typeof v.type !== 'string' || v.type === '') return false
  if (!Array.isArray(v.items)) return true
  return v.type !== 'genui' && !(v.type === 'stack' && Array.isArray(v.children))
}

export function wrapSingleComponentRoot(value: unknown): GenuiSpec | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as { type?: unknown; title?: unknown; panel?: unknown; append?: unknown }
  if (typeof v.type !== 'string' || v.type === '') return null
  const definition = GENUI_NATIVE_TYPES.has(v.type) ? COMPONENT_SCHEMAS[v.type] : undefined
  const title = typeof v.title === 'string' && definition !== undefined && !('title' in definition.fields)
    ? v.title
    : undefined
  const node: Record<string, unknown> = { ...(value as Record<string, unknown>) }

  if (title !== undefined) delete node.title
  return {
    items: [node as unknown as GenuiNode],
    ...(title !== undefined ? { title } : {}),
    ...(v.panel === true ? { panel: true } : {}),
    ...(v.append === true ? { append: true } : {}),
  }
}

export function isGenuiSpec(value: unknown): value is GenuiSpec {
  if (typeof value !== 'object' || value === null) return false
  if (isComponentRoot(value)) return false
  const v = value as { items?: unknown; title?: unknown; gap?: unknown }
  if (!Array.isArray(v.items)) return false
  if (v.title !== undefined && typeof v.title !== 'string') return false
  if (v.gap !== undefined && typeof v.gap !== 'number') return false
  return true
}
