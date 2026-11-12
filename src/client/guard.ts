import type { GenuiWhen, GenuiComparePanel, GenuiComputed, GenuiComputedFormat, GenuiComputedRef, GenuiFileTreeNode, GenuiList, GenuiNode, GenuiPlot, GenuiPlotSeries, GenuiScene3D, GenuiSpec, GenuiDiagram, GenuiDiagramTheme, GenuiDiagramKind } from './spec.ts'
import { isComponentRoot, wrapSingleComponentRoot } from './spec.ts'
import {
  BADGE_TONES, BUTTON_TONES, CALLOUT_TONES, CARD_TONES, CHART_KINDS, CHOICE_MODES, COMPARE_MODES, COMPONENT_SCHEMAS, HERO_TONES, WHEN_OPS,
  DIAGRAM_EDGE_KINDS, DIAGRAM_KINDS, DIAGRAM_NODE_TYPES, DIAGRAM_ROUTES, DIAGRAM_VARIANTS, POPOVER_PLACEMENTS, POPOVER_TRIGGERS,
  DATE_PICKER_MODES, ECHART_PRESETS, FILE_TYPES, GENUI_NATIVE_TYPES, GENUI_SPEC_SCHEMA, INPUT_TYPES, getComponentSchema,
  ARROW_DIRS, BLOCKS_VARIANTS, BLOCK_CELL_TONES, ICON_TONES, MEDIA_ASPECT_RATIOS, MESH_SHAPES, PLOT_KINDS, PROGRESS_VARIANTS, ROW_JUSTIFY, TABLE_CELL_TYPES, TEXT_ALIGNS, TEXT_SIZES, TEXT_TONES,
} from './genui-runtime/schema.ts'
import type { ComponentFieldKind, ComponentRecordSchema, ComponentSchema } from './genui-runtime/schema.ts'
import { normalizeGenuiSpec } from './genui-runtime/normalize.ts'
import { diagnoseUnknownGenuiFields } from './genui-runtime/diagnostics.ts'
import type { GenuiDiagnostic } from './genui-runtime/diagnostics.ts'
import { GENUI_LIMITS } from './genui-runtime/limits.ts'
import { analyzeSubmissionRegistry } from './submission-registry.ts'
import { isTableDetailReachable, prepareTableRows, tableRowsForDetails } from './table-details.ts'
import { walkGenuiNodes } from './walk-spec.ts'
import { color, enu, int, num, obj, opt, safeMediaSrc, str } from './genui-runtime/value-utils.ts'
import { repairMap, validateMap } from './map-data.ts'
import { isDatePickerValueValid, isIsoDate } from './date-picker.ts'
import { classifyLinkTarget } from './file-link.ts'
import { buildComputedGraph, getComputedInputIds, getDuplicateComputedInputIds, getComputedTemplateScope, getComputedChildNodeScope } from './computed.ts'
import type { ComputedTemplateScope, ComputedNodeScope } from './computed.ts'
import { SAFE_MATH_LIMITS } from './safe-math.ts'

export interface GenuiValidation {
  ok: boolean

  errors: string[]
}

function fieldKindMatches(value: unknown, kind: ComponentFieldKind): boolean {
  switch (kind) {
    case 'string': return typeof value === 'string'
    case 'string-or-null': return value === null || typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'boolean': return typeof value === 'boolean'
    case 'nodes': return Array.isArray(value)
    case 'array': return Array.isArray(value)
    case 'object': return obj(value) !== undefined
    case 'unknown': return true
  }
}

function fieldKindLabel(kind: ComponentFieldKind): string {
  switch (kind) {
    case 'string-or-null': return 'a string or null'
    case 'number': return 'a finite number'
    case 'boolean': return 'a boolean'
    case 'nodes': case 'array': return 'an array'
    case 'object': return 'an object'
    case 'unknown': return 'a value'
    default: return 'a string'
  }
}

function hasFieldError(errors: readonly string[], at: string, field: string): boolean {
  return errors.some(error =>
    error.startsWith(`${at}.${field} `) || error.includes(`'${field}'`) || error.includes(`requires ${field}`))
}

function validateSchemaFieldKinds(
  value: Record<string, unknown>,
  at: string,
  definition: ComponentSchema,
  errors: string[],
  excludedFields: readonly string[] = [],
): void {
  for (const [field, kind] of Object.entries(definition.fields)) {
    if (excludedFields.includes(field) || value[field] === undefined) continue
    if (!fieldKindMatches(value[field], kind) && !hasFieldError(errors, at, field)) {
      errors.push(`${at}.${field} must be ${fieldKindLabel(kind)}`)
    }
  }
  for (const [field, values] of Object.entries(definition.enums)) {
    if (excludedFields.includes(field) || value[field] === undefined || !fieldKindMatches(value[field], 'string')) continue
    if (!values.includes(value[field] as string) && !hasFieldError(errors, at, field)) {
      errors.push(`${at}.${field} must be one of ${values.join(', ')}`)
    }
  }
}

function validateRecordSchema(
  value: unknown,
  at: string,
  definition: ComponentRecordSchema,
  errors: string[],
): void {
  const holder = obj(value)
  if (holder === undefined) {
    errors.push(`${at} must be an object`)
    return
  }
  for (const field of definition.required) {
    const kind = definition.fields[field]
    if (holder[field] === undefined) {
      if (!hasFieldError(errors, at, field)) errors.push(`${at}: requires ${field}${kind === undefined ? '' : ` (${fieldKindLabel(kind)})`}`)
    } else if (kind !== undefined && !fieldKindMatches(holder[field], kind)) {
      if (!hasFieldError(errors, at, field)) errors.push(`${at}.${field} must be ${fieldKindLabel(kind)}`)
    }
  }
  for (const [field, kind] of Object.entries(definition.fields)) {
    if (holder[field] !== undefined && !fieldKindMatches(holder[field], kind)) {
      if (!hasFieldError(errors, at, field)) errors.push(`${at}.${field} must be ${fieldKindLabel(kind)}`)
    }
  }
  for (const [field, values] of Object.entries(definition.enums)) {
    if (holder[field] !== undefined && typeof holder[field] === 'string' && !values.includes(holder[field])) {
      if (!hasFieldError(errors, at, field)) errors.push(`${at}.${field} must be one of ${values.join(', ')}`)
    }
  }
  for (const [field, nested] of Object.entries(definition.nested)) {
    const nestedValue = holder[field]
    if (nestedValue === undefined) continue
    if (Array.isArray(nestedValue)) {
      nestedValue.forEach((item, index) => validateRecordSchema(item, `${at}.${field}[${index}]`, nested, errors))
    } else {
      validateRecordSchema(nestedValue, `${at}.${field}`, nested, errors)
    }
  }
}

function validateNestedRecordSchemas(
  value: Record<string, unknown>,
  at: string,
  definition: ComponentSchema,
  errors: string[],
): void {
  for (const [field, nested] of Object.entries(definition.nested)) {
    const nestedValue = value[field]
    if (nestedValue === undefined) continue
    if (Array.isArray(nestedValue)) {
      const records = value.type === 'image-group' && field === 'items'
        ? nestedValue.slice(0, GENUI_LIMITS.maxImageGroupItems)
        : value.type === 'entity-card' && field === 'metadata' ? nestedValue.slice(0, GENUI_LIMITS.maxEntityMetadata)
        : value.type === 'entity-card' && field === 'actions' ? nestedValue.slice(0, GENUI_LIMITS.maxEntityActions)
        : value.type === 'map' && field === 'locations' ? nestedValue.slice(0, GENUI_LIMITS.maxMapLocations)
        : value.type === 'map' && field === 'routes' ? nestedValue.slice(0, GENUI_LIMITS.maxMapRoutes)
        : field === 'computed' ? nestedValue.slice(0, GENUI_LIMITS.maxComputedFields) : nestedValue
      records.forEach((item, index) => validateRecordSchema(item, `${at}.${field}[${index}]`, nested, errors))
    } else {
      validateRecordSchema(nestedValue, `${at}.${field}`, nested, errors)
    }
  }
}

function hasDerivableTableColumns(value: Record<string, unknown>): boolean {
  const rows = value.rows !== undefined ? value.rows : value.data
  if (!Array.isArray(rows) || rows.length === 0) return false
  return Array.isArray(rows[0])
}

function validateRegistryFields(
  value: Record<string, unknown>,
  at: string,
  definition: ComponentSchema,
  errors: string[],
): void {
  const type = String(value.type)
  const alreadyReported = (field: string): boolean => hasFieldError(errors, at, field)
  const derivableField = type === 'table' && hasDerivableTableColumns(value) ? 'columns' : null
  for (const field of definition.required) {
    const kind = definition.fields[field]
    if (kind === undefined || value[field] === undefined) {
      if (field !== derivableField && !alreadyReported(field)) errors.push(`${at}: type '${type}' requires ${field}${kind === undefined ? '' : ` (${fieldKindLabel(kind)})`}`)
      continue
    }
    if (!fieldKindMatches(value[field], kind) && !alreadyReported(field)) errors.push(`${at}.${field} must be ${fieldKindLabel(kind)}`)
  }
  validateSchemaFieldKinds(value, at, definition, errors, ['type'])
  for (const group of definition.oneOfRequired) {
    if (!group.some(field => value[field] !== undefined)
      && !errors.some(error => error.includes(`requires ${group.join(' or ')}`))) {
      errors.push(`${at}: type '${type}' requires one of ${group.join(' or ')}`)
    }
  }
  for (const rule of definition.conditionalRequired) {
    if (value[rule.when.field] !== rule.when.equals) continue
    for (const field of rule.required) {
      if (value[field] === undefined && !alreadyReported(field)) {
        errors.push(`${at}: type '${type}' requires ${field}${rule.message === undefined ? '' : ` (${rule.message})`}`)
      }
    }
  }
  validateNestedRecordSchemas(value, at, definition, errors)
}

interface RepairCtx {

  remaining: number

  truncatedTableRows: number
  truncatedListItems: number
  truncatedFileTreeItems: number
}

function repairItems(list: unknown, ctx: RepairCtx, depth: number): GenuiNode[] {
  if (!Array.isArray(list)) return []
  const out: GenuiNode[] = []
  for (const item of list) {
    if (ctx.remaining <= 0) break
    ctx.remaining -= 1
    const node = repairNode(item, ctx, depth)
    if (node !== null) out.push(node)
  }
  return out
}

function paletteValues(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  for (const item of v.slice(0, 12)) {
    const value = color(item)
    if (value === undefined) continue
    out.push(value)
  }
  return out.length > 0 ? out : undefined
}

function sparkValues(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: number[] = []
  for (const item of v.slice(0, 60)) {
    const n = typeof item === 'number' ? item : Number(item)
    if (!Number.isFinite(n)) return undefined
    out.push(n)
  }
  return out.length >= 2 ? out : undefined
}

function repairNode(value: unknown, ctx: RepairCtx, depth: number): GenuiNode | null {
  const node = repairNodeFields(value, ctx, depth)
  if (node === null) return null
  const raw = obj(value)
  const span = int(raw?.span, 2, 12)
  const when = repairWhen(raw?.when)
  const enableWhen = repairWhen(raw?.enableWhen)
  const disabledReason = str(raw?.disabledReason, 200)
  const extras = {
    ...(span === undefined ? {} : { span }),
    ...(when === undefined ? {} : { when }),
    ...(enableWhen === undefined ? {} : { enableWhen }),
    ...(disabledReason === undefined ? {} : { disabledReason }),
  }
  return Object.keys(extras).length === 0 ? node : ({ ...node, ...extras } as GenuiNode)
}

function repairWhen(value: unknown): GenuiWhen | undefined {
  const v = obj(value)
  if (v === undefined) return undefined
  const field = str(v.field, 80)
  const op = enu(v.op, WHEN_OPS)
  if (field === undefined || op === undefined) return undefined
  const raw = v.value
  const value_ = Array.isArray(raw)
    ? (raw.length > 0 && raw.length <= 12
      ? raw.filter(entry => typeof entry === 'string' || typeof entry === 'number')
        .map(entry => (typeof entry === 'number' ? entry : str(entry, 120) ?? ''))
        .filter(entry => entry !== '')
      : undefined)
    : (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? raw : undefined)
  const value2 = Array.isArray(value_) && value_.length === 0 ? undefined : value_
  return { field, op, ...(value2 === undefined ? {} : { value: value2 }) }
}

function repairNodeFields(value: unknown, ctx: RepairCtx, depth: number): GenuiNode | null {
  if (depth > GENUI_LIMITS.maxDepth) return null
  const v = obj(value)
  if (v === undefined) return null
  const type = v.type
  if (typeof type !== 'string') return null
  switch (type) {
    case 'text': {
      const content = str(v.content, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString)
      if (content === undefined) return null

      return {
        type: 'text', content,
        ...opt('size', enu(v.size, TEXT_SIZES)),
        ...opt('align', enu(v.align, TEXT_ALIGNS)),
        ...opt('tone', enu(v.tone, TEXT_TONES)),
        ...opt('mono', v.mono === true ? true : undefined),
        ...opt('center', v.center === true ? true : undefined),
      }
    }
    case 'icon': {

      const name = str(v.name, 64)
      if (name === undefined) return null
      return {
        type: 'icon', name,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('tone', enu(v.tone, ICON_TONES)),
        ...opt('size', int(v.size, 8, 96)),
        ...opt('tile', v.tile === true ? true : undefined),
      }
    }
    case 'blocks': {

      if (!Array.isArray(v.rows)) return null
      const rows = v.rows.slice(0, GENUI_LIMITS.maxBlocksRows).flatMap((entry) => {
        const row = obj(entry)
        if (row === undefined || !Array.isArray(row.cells)) return []
        const cells = row.cells.slice(0, GENUI_LIMITS.maxBlocksCells).map((cell) => {
          if (cell === null) return null
          if (typeof cell === 'string') return str(cell, GENUI_LIMITS.maxString) ?? ''
          const holder = obj(cell)
          if (holder === undefined) return null
          const text = str(holder.text, GENUI_LIMITS.maxString)
          if (text === undefined) return null
          return {
            text,
            ...opt('color', color(holder.color)),
            ...opt('tone', enu(holder.tone, BLOCK_CELL_TONES)),
            ...opt('sub', str(holder.sub, 128)),
          }
        })
        return [{
          cells,
          ...opt('label', str(row.label, 128)),
          ...opt('color', color(row.color)),
          ...opt('variant', enu(row.variant, BLOCKS_VARIANTS)),
        }]
      })
      if (rows.length === 0) return null
      return {
        type: 'blocks', rows,
        ...opt('columns', int(v.columns, 1, GENUI_LIMITS.maxBlocksCells)),
        ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
        ...opt('caption', str(v.caption, GENUI_LIMITS.maxString)),
      }
    }
    case 'arrow': {
      return {
        type: 'arrow',
        ...opt('dir', enu(v.dir, ARROW_DIRS)),
        ...opt('length', int(v.length, 16, 96)),
        ...opt('label', str(v.label, 200)),
      }
    }
    case 'row': {
      return {
        type: 'row',
        items: repairItems(v.items, ctx, depth + 1),
        ...opt('wrap', v.wrap === true ? true : undefined),
        ...opt('spacer', v.spacer === true ? true : undefined),

        ...opt('justify', enu(v.justify, ROW_JUSTIFY)),
      }
    }
    case 'carousel': {
      const source = Array.isArray(v.items) ? v.items.slice(0, GENUI_LIMITS.maxCarouselItems) : []
      return {
        type: 'carousel', items: repairItems(source, ctx, depth + 1),
        ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
        ...opt('itemWidth', num(v.itemWidth, 80, 640)),
        ...opt('gap', num(v.gap, 0, Number.MAX_SAFE_INTEGER / 4)),
      }
    }
    case 'image-group': {
      const source = Array.isArray(v.items) ? v.items.slice(0, GENUI_LIMITS.maxImageGroupItems) : []
      const items = source.flatMap(value => {
        const item = obj(value)
        const src = safeMediaSrc(item?.src)
        if (item === undefined || src === undefined) return []
        return [{ src, ...opt('alt', str(item.alt, GENUI_LIMITS.maxString)), ...opt('caption', str(item.caption, GENUI_LIMITS.maxString)) }]
      })
      return { type: 'image-group', items, ...opt('title', str(v.title, GENUI_LIMITS.maxString)) }
    }
    case 'editor': {
      const id = str(v.id, 200)
      const value = str(v.value, GENUI_LIMITS.maxEditorChars)
      if (id === undefined || value === undefined) return null
      return {
        type: 'editor', id, value,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('placeholder', str(v.placeholder, GENUI_LIMITS.maxString)),
        ...opt('rows', int(v.rows, 3, 24)),
      }
    }
    case 'entity-card': {
      const name = str(v.name, GENUI_LIMITS.maxString)
      if (name === undefined) return null
      const metadata = Array.isArray(v.metadata) ? v.metadata.slice(0, GENUI_LIMITS.maxEntityMetadata).flatMap(entry => {
        const record = obj(entry)
        const label = str(record?.label, 120)
        const value = str(record?.value, GENUI_LIMITS.maxString)
        return label === undefined || value === undefined ? [] : [{ label, value }]
      }) : undefined
      const actions = Array.isArray(v.actions) ? v.actions.slice(0, GENUI_LIMITS.maxEntityActions).flatMap(entry => {
        const record = obj(entry)
        const label = str(record?.label, 120)
        const action = str(record?.action, 200)
        if (label === undefined || action === undefined) return []
        return [{ label, action, ...opt('tone', enu(record?.tone, BUTTON_TONES)) }]
      }) : undefined
      const image = safeMediaSrc(v.image)
      const hrefTarget = classifyLinkTarget(v.href)
      const href = hrefTarget.type === 'external' ? hrefTarget.href : hrefTarget.type === 'file' ? String(v.href).trim() : undefined
      return {
        type: 'entity-card', name,
        ...opt('image', image),
        ...opt('imageAlt', str(v.imageAlt, GENUI_LIMITS.maxString)),
        ...opt('description', str(v.description, GENUI_LIMITS.maxString)),
        ...opt('metadata', metadata),
        ...opt('href', href),
        ...opt('sourceLabel', str(v.sourceLabel, 120)),
        ...opt('actions', actions),
      }
    }
    case 'popover': {
      const label = str(v.label, 200)
      const content = str(v.content, GENUI_LIMITS.maxString)
      if (label === undefined || content === undefined) return null
      return {
        type: 'popover', label, content,
        ...opt('trigger', enu(v.trigger, POPOVER_TRIGGERS)),
        ...opt('placement', enu(v.placement, POPOVER_PLACEMENTS)),
      }
    }
    case 'choices': {
      const source = Array.isArray(v.items) ? v.items.slice(0, 8) : []
      const items = source.flatMap(value => {
        const item = obj(value)
        const label = str(item?.label, 120)
        if (item === undefined || label === undefined) return []
        const disabled = item.disabled === true
        return [{
          label,
          ...opt('hint', str(item.hint, 200)),
          ...opt('meta', str(item.meta, 40)),
          ...(item.recommended === true ? { recommended: true } : {}),
          ...(disabled ? { disabled: true } : {}),

          ...opt('reason', str(item.reason, 200)),
        }]
      })
      if (items.length === 0) return null
      return {
        type: 'choices', items,
        ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
        ...opt('prompt', str(v.prompt, 400)),
        ...opt('mode', enu(v.mode, CHOICE_MODES)),
        ...opt('submit', str(v.submit, 60)),
        ...opt('action', str(v.action, 200)),
        ...opt('max', int(v.max, 1, items.length)),
        ...opt('group', str(v.group, 60)),
        ...opt('explanation', str(v.explanation, GENUI_LIMITS.maxString)),

        ...(typeof v.answer === 'number' || typeof v.answer === 'string' ? { answer: v.answer } : {}),
      }
    }
    case 'compare': {

      const panel = (value: unknown): GenuiComparePanel | undefined => {
        const item = obj(value)
        const src = safeMediaSrc(item?.src)
        if (item === undefined || src === undefined) return undefined
        return {
          src,
          ...opt('label', str(item.label, 40)),
          ...opt('alt', str(item.alt, GENUI_LIMITS.maxString)),
          ...opt('caption', str(item.caption, GENUI_LIMITS.maxString)),
        }
      }
      const before = panel(v.before)
      const after = panel(v.after)
      if (before === undefined || after === undefined) return null
      return {
        type: 'compare', before, after,
        ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
        ...opt('mode', enu(v.mode, COMPARE_MODES)),
        ...opt('height', int(v.height, 120, 640)),
      }
    }
    case 'col': {
      return {
        type: 'col',
        items: repairItems(v.items, ctx, depth + 1),
        ...opt('gap', num(v.gap, 0, 96)),
        ...opt('width', num(v.width, 1, 100)),
      }
    }
    case 'grid': {
      return { type: 'grid', cols: int(v.cols, 1, GENUI_LIMITS.maxGridCols) ?? 1, items: repairItems(v.items, ctx, depth + 1) }
    }
    case 'card': {
      return {
        type: 'card',
        items: repairItems(v.items, ctx, depth + 1),
        ...opt('eyebrow', str(v.eyebrow, 64)),
        ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
        ...opt('tone', enu(v.tone, CARD_TONES)),
        ...opt('accent', color(v.accent)),
        ...opt('flat', v.flat === true ? true : undefined),
      }
    }
    case 'button': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return {
        type: 'button', label,
        ...opt('tone', enu(v.tone, BUTTON_TONES)),
        ...opt('full', v.full === true ? true : undefined),
        ...opt('small', v.small === true ? true : undefined),
        ...opt('icon', str(v.icon, 64)),
        ...opt('action', str(v.action, 200)),
      }
    }
    case 'input': {
      return {
        type: 'input',
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('placeholder', str(v.placeholder, GENUI_LIMITS.maxString)),
        ...opt('value', str(v.value, GENUI_LIMITS.maxString)),
        ...opt('inputType', enu(v.inputType, INPUT_TYPES)),
        ...opt('action', str(v.action, 200)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'date-picker': {
      return {
        type: 'date-picker',
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('mode', enu(v.mode, DATE_PICKER_MODES)),
        ...opt('value', str(v.value, 21)),
        ...opt('min', str(v.min, 10)),
        ...opt('max', str(v.max, 10)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'segmented-control': {
      const options = repairStrings(v.options, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString)
      if (options === undefined) return null
      return {
        type: 'segmented-control', options,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('value', str(v.value, GENUI_LIMITS.maxString)),
        ...opt('id', str(v.id, 200)),
        ...opt('action', str(v.action, 200)),
      }
    }
    case 'select': {
      const options = repairStrings(v.options, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString)
      if (options === undefined) return null
      return {
        type: 'select', options,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('action', str(v.action, 200)),
        ...opt('selected', int(v.selected, 0, options.length - 1)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'checkbox': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return {
        type: 'checkbox', label,
        ...opt('checked', v.checked === true ? true : undefined),
        ...opt('action', str(v.action, 200)),
        ...opt('group', str(v.group, 200)),
      }
    }
    case 'link': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      const target = classifyLinkTarget(v.href)
      const href = target.type === 'external' ? target.href : target.type === 'file' ? String(v.href).trim() : undefined
      return { type: 'link', label, ...opt('href', href) }
    }
    case 'image': {
      const src = safeMediaSrc(v.src)
      if (src === undefined) return null
      return {
        type: 'image', src,
        ...opt('alt', str(v.alt, GENUI_LIMITS.maxString)),
        ...opt('caption', str(v.caption, GENUI_LIMITS.maxString)),
      }
    }
    case 'audio': {
      const src = safeMediaSrc(v.src)
      if (src === undefined) return null
      return {
        type: 'audio', src,
        ...opt('alt', str(v.alt, GENUI_LIMITS.maxString)),
        ...opt('loop', v.loop === true ? true : undefined),
      }
    }
    case 'video': {
      const src = safeMediaSrc(v.src)
      if (src === undefined) return null
      return {
        type: 'video', src,
        ...opt('alt', str(v.alt, GENUI_LIMITS.maxString)),
        ...opt('poster', safeMediaSrc(v.poster)),
        ...opt('loop', v.loop === true ? true : undefined),
        ...opt('muted', v.muted === true ? true : undefined),
        ...opt('aspectRatio', enu(v.aspectRatio, MEDIA_ASPECT_RATIOS)),
      }
    }
    case 'badge': {
      const label = str(v.label, GENUI_LIMITS.maxString) ?? str(v.text, GENUI_LIMITS.maxString) ?? str(v.value, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return { type: 'badge', label, ...opt('tone', enu(v.tone, BADGE_TONES)), ...opt('icon', str(v.icon, 64)) }
    }
    case 'hero': {
      const title = str(v.title, GENUI_LIMITS.maxString)
      if (title === undefined) return null
      return {
        type: 'hero', title,
        ...opt('subtitle', str(v.subtitle, GENUI_LIMITS.maxString)),
        ...opt('value', str(v.value, 128)),
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('delta', str(v.delta, 64)),
        ...opt('spark', sparkValues(v.spark)),
        ...opt('tone', enu(v.tone, HERO_TONES)),
      }
    }
    case 'stat': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      const value = str(v.value, 128)
      if (label === undefined || value === undefined) return null
      return {
        type: 'stat', label, value,
        ...opt('delta', str(v.delta, 64)),
        ...opt('spark', sparkValues(v.spark)),
        ...opt('size', v.size === 'hero' ? 'hero' as const : undefined),
      }
    }
    case 'progress': {
      const value = num(v.value, 0, 100)
      if (value === undefined) return null
      return {
        type: 'progress', value,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('valueLabel', str(v.valueLabel, 64)),
        ...opt('variant', enu(v.variant, PROGRESS_VARIANTS)),
        ...opt('target', num(v.target, 0, 100)),
      }
    }
    case 'divider': return { type: 'divider', ...opt('label', str(v.label, 64)) }
    case 'spacer': return { type: 'spacer' }
    case 'avatar': {
      const name = str(v.name, 64)
      if (name === undefined) return null
      return { type: 'avatar', name, ...opt('color', color(v.color)) }
    }
    case 'list': {
      const items = repairListItems(v.items, GENUI_LIMITS.maxListItems, ctx, depth + 1)
      if (items === undefined) return null
      return { type: 'list', items, ...opt('filter', str(v.filter, 64)) }
    }
    case 'table': {
      const prepared = prepareTableRows(v, count => { ctx.truncatedTableRows += count })
      if (prepared === null) return null
      const { columns, rows } = prepared

      const rawTypes = Array.isArray(v.types) ? v.types : undefined
      const types = rawTypes === undefined
        ? undefined
        : columns.map((_c, i) => {
          const raw = rawTypes[i]
          return typeof raw === 'string' && (TABLE_CELL_TYPES as readonly string[]).includes(raw)
            ? raw as typeof TABLE_CELL_TYPES[number]
            : 'text'
        })

      const rawDetails = Array.isArray(v.details) ? v.details : undefined
      const details = rawDetails === undefined
        ? undefined
        : rows.map((_row, i) => {
          if (!isTableDetailReachable({ columns, rows, types }, i)) return null
          const entry = repairItems(rawDetails[i], ctx, depth + 1)
          return entry.length === 0 ? null : entry
        })
      return {
        type: 'table', columns, rows,
        ...opt('types', types),
        ...opt('total', v.total === true ? true : undefined),
        ...opt('export', v.export === true ? true : undefined),
        ...opt('wrap', v.wrap === true ? true : undefined),
        ...opt('filter', str(v.filter, 64)),
        ...opt('filterColumn', int(v.filterColumn, 0, GENUI_LIMITS.maxTableCols - 1)),
        ...opt('sortField', str(v.sortField, 64)),
        ...opt('details', details !== undefined && details.some(d => d !== null) ? details : undefined),
      }
    }
    case 'chart': {
      const data = repairChartData(v.data, GENUI_LIMITS.maxChartPoints)
      const series = Array.isArray(v.series) ? repairSeries(v.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints) : undefined

      if (data === undefined && series === undefined) return null
      return {
        type: 'chart', data: data ?? [],
        ...opt('kind', enu(v.kind, CHART_KINDS)),
        ...opt('series', series),
        ...opt('horizontal', v.horizontal === true ? true : undefined),
        ...opt('stacked', v.stacked === true ? true : undefined),
        ...opt('filter', str(v.filter, 64)),
        ...opt('palette', paletteValues(v.palette)),
      }
    }
    case 'tabs': {
      const tabs = repairTabs(v.tabs, ctx, depth)
      if (tabs === undefined) return null
      return { type: 'tabs', tabs }
    }
    case 'plot': {
      const series = repairPlotSeries(v.series, GENUI_LIMITS.maxPlotSeries)
      if (series === undefined) return null
      return {
        type: 'plot', series,
        ...opt('xMin', num(v.xMin, -1e6, 1e6)),
        ...opt('xMax', num(v.xMax, -1e6, 1e6)),
        ...opt('yMin', num(v.yMin, -1e9, 1e9)),
        ...opt('yMax', num(v.yMax, -1e9, 1e9)),
        ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
      }
    }
    case 'callout': {
      const content = str(v.content, GENUI_LIMITS.maxString)
      if (content === undefined) return null
      return { type: 'callout', content, ...opt('tone', enu(v.tone, CALLOUT_TONES)), ...opt('title', str(v.title, GENUI_LIMITS.maxString)) }
    }
    case 'steps': {
      const steps = repairSteps(v.steps)
      if (steps === undefined) return null
      return { type: 'steps', steps, ...opt('current', int(v.current, 0, steps.length)) }
    }
    case 'keyvalue': {
      const pairs = repairPairs(v.pairs, GENUI_LIMITS.maxKeyValuePairs)
      if (pairs === undefined) return null
      return { type: 'keyvalue', pairs }
    }
    case 'diff': {
      const diffs = repairDiffs(v.diffs)
      if (diffs === undefined) return null
      return { type: 'diff', diffs }
    }
    case 'json': {

      if (!('value' in v)) return null
      return { type: 'json', value: v.value }
    }
    case 'code': {
      const code = str(v.code, GENUI_LIMITS.maxCode)
      if (code === undefined) return null
      return { type: 'code', code, ...opt('lang', str(v.lang, 64)) }
    }
    case 'radio': {
      const options = repairStrings(v.options, GENUI_LIMITS.maxOptions, GENUI_LIMITS.maxString)
      if (options === undefined) return null
      return {
        type: 'radio', options,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('selected', int(v.selected, 0, options.length - 1)),
        ...opt('action', str(v.action, 200)),
        ...opt('group', str(v.group, 200)),

        ...opt('answer', typeof v.answer === 'number' && Number.isFinite(v.answer)
          && v.answer >= 0 && v.answer < options.length
          ? Math.trunc(v.answer)
          : typeof v.answer === 'string' ? v.answer.slice(0, 512) : undefined),
        ...opt('explanation', str(v.explanation, GENUI_LIMITS.maxString)),
      }
    }
    case 'submit': {
      const label = str(v.label, GENUI_LIMITS.maxString)

      const action = str(v.action, 200)
      if (label === undefined) return null
      return {
        type: 'submit', label,
        ...opt('action', action),
        ...opt('resetAction', str(v.resetAction, 200)),
        ...opt('groups', repairStrings(v.groups, GENUI_LIMITS.maxOptions, 200)),
      }
    }
    case 'switch': {
      const label = str(v.label, GENUI_LIMITS.maxString)
      if (label === undefined) return null
      return { type: 'switch', label, ...opt('checked', v.checked === true ? true : undefined), ...opt('action', str(v.action, 200)) }
    }
    case 'slider': {
      const min = num(v.min, -1e9, 1e9) ?? 0
      const max = num(v.max, -1e9, 1e9) ?? 100
      const lo = Math.min(min, max)
      const hi = Math.max(min, max)
      const step = num(v.step, 1e-9, Math.max(hi - lo, 1e-9))
      const value = num(v.value, lo, hi) ?? lo
      return {
        type: 'slider',
        min: lo,
        max: hi,
        ...opt('step', step),
        value,
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('action', str(v.action, 200)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'textarea': {
      return {
        type: 'textarea',
        ...opt('label', str(v.label, GENUI_LIMITS.maxString)),
        ...opt('placeholder', str(v.placeholder, GENUI_LIMITS.maxString)),
        ...opt('rows', int(v.rows, 1, 30)),
        ...opt('value', str(v.value, GENUI_LIMITS.maxString)),
        ...opt('action', str(v.action, 200)),
        ...opt('id', str(v.id, 200)),
      }
    }
    case 'accordion': {
      const items = repairAccordion(v.items, ctx, depth)
      if (items === undefined) return null
      return { type: 'accordion', items }
    }
    case 'copy': {
      const text = str(v.text, GENUI_LIMITS.maxCode)
      if (text === undefined) return null
      return {
        type: 'copy', text, ...opt('label', str(v.label, 128)),
        ...opt('expandable', typeof v.expandable === 'boolean' ? v.expandable : undefined),
        ...opt('previewLines', int(v.previewLines, 0, GENUI_LIMITS.maxCopyPreviewLines)),
      }
    }
    case 'svg': {
      const code = v.code
      if (typeof code !== 'string' || code.length > GENUI_LIMITS.maxCode) return null
      return { type: 'svg', code, ...opt('title', str(v.title, GENUI_LIMITS.maxString)), ...opt('height', int(v.height, 100, 800)) }
    }
    case 'mermaid': {
      const code = str(v.code, GENUI_LIMITS.maxMermaid)
      if (code === undefined) return null
      return { type: 'mermaid', code }
    }
    case 'map': return repairMap(v)
    case 'scene3d': {
      const meshes = repairMeshes(v.meshes)
      if (meshes === undefined) return null
      return { type: 'scene3d', meshes, ...opt('title', str(v.title, GENUI_LIMITS.maxString)), ...opt('ambient', num(v.ambient, 0, 2)), ...opt('background', color(v.background)) }
    }
    case 'diagram': {
      const repaired = repairDiagram(v)
      return repaired
    }
    case 'timeline': {
      const items = repairTimeline(v.items, GENUI_LIMITS.maxTimelineItems)
      if (items === undefined) return null
      return { type: 'timeline', items }
    }
    case 'file-tree': {
      const items = repairTree(v.items, GENUI_LIMITS.maxListItems, ctx)
      if (items === undefined) return null
      return { type: 'file-tree', items }
    }
    case 'breadcrumb': {
      const items = repairStrings(v.items, GENUI_LIMITS.maxBreadcrumbItems, GENUI_LIMITS.maxString)
      if (items === undefined) return null
      return { type: 'breadcrumb', items }
    }
    case 'quiz': {
      const question = str(v.question, GENUI_LIMITS.maxString)
      const options = repairQuizOptions(v.options, v.answer)
      if (question === undefined || options === undefined) return null
      return {
        type: 'quiz', question, options,
        ...opt('explanation', str(v.explanation, GENUI_LIMITS.maxString)),
        ...opt('id', str(v.id, 200)),
        ...opt('action', str(v.action, 200)),
      }
    }
    case 'echart': {

      const data = v.data !== undefined ? repairChartData(v.data, GENUI_LIMITS.maxChartPoints) : undefined
      const series = v.series !== undefined && Array.isArray(v.series)
        ? repairSeries(v.series, GENUI_LIMITS.maxPlotSeries, GENUI_LIMITS.maxChartPoints)
        : undefined

      const links = Array.isArray(v.links)
        ? v.links.slice(0, GENUI_LIMITS.maxChartPoints).flatMap(entry => {
          const e = obj(entry)
          const from = e === undefined ? undefined : str(e.from, 64)
          const to = e === undefined ? undefined : str(e.to, 64)
          if (from === undefined || to === undefined) return []
          return [{ from, to, ...opt('value', num(e!.value, 0, 1e9)) }]
        })
        : undefined

      const sanitized = v.option !== undefined
        ? sanitizeEChartOption(v.option, 0, { count: GENUI_LIMITS.maxEChartOptionNodes })
        : undefined

      const option: Record<string, unknown> | undefined =
        sanitized === undefined || typeof sanitized !== 'object' || sanitized === null || Array.isArray(sanitized)
          ? undefined
          : sanitized as Record<string, unknown>

      if (option === undefined && data === undefined && series === undefined
        && (links === undefined || links.length === 0)) return null
      return {
        type: 'echart',
        ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
        ...opt('height', int(v.height, 100, 800)),
        ...opt('preset', enu(v.preset, ECHART_PRESETS)),
        ...opt('data', data),
        ...opt('series', series),
        ...opt('links', links !== undefined && links.length > 0 ? links : undefined),
        ...opt('palette', paletteValues(v.palette)),
        ...opt('option', option),
      }
    }
    default:
      return null
  }
}

function repairStrings(v: unknown, cap: number, strCap: number): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  for (const item of v) {
    if (out.length >= cap) break
    if (typeof item === 'string') {
      out.push(item.slice(0, strCap))
    } else if (item !== null && typeof item === 'object') {

      const o = item as Record<string, unknown>
      const s = typeof o.label === 'string' ? o.label
        : typeof o.value === 'string' ? o.value
        : typeof o.title === 'string' ? o.title
        : JSON.stringify(item)
      out.push(s.slice(0, strCap))
    }
  }
  return out
}

function repairListItems(
  v: unknown,
  cap: number,
  ctx: RepairCtx,
  depth: number,
): GenuiList['items'] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiList['items'] = []
  for (const item of v) {
    if (out.length >= cap) {
      if (isRepairableListItem(item, depth)) ctx.truncatedListItems += 1
      continue
    }
    if (typeof item === 'string') {
      out.push(item.slice(0, GENUI_LIMITS.maxString))
      continue
    }
    const o = obj(item)
    if (o !== undefined && typeof o.type === 'string') {

      if (ctx.remaining <= 0) break
      ctx.remaining -= 1
      const node = repairNode(o, ctx, depth)
      if (node !== null) out.push(node)
      continue
    }
    const title = o === undefined ? undefined : str(o.title, GENUI_LIMITS.maxString)
    if (title !== undefined) {
      out.push({ title, ...opt('desc', str(o?.desc, GENUI_LIMITS.maxString)) })
    }
  }
  return out
}

function isRepairableListItem(item: unknown, depth: number): boolean {
  if (typeof item === 'string') return true
  const o = obj(item)
  if (o === undefined) return false
  if (typeof o.type === 'string') {
    const ctx: RepairCtx = {
      remaining: GENUI_LIMITS.maxNodes,
      truncatedTableRows: 0,
      truncatedListItems: 0,
      truncatedFileTreeItems: 0,
    }
    return repairNode(o, ctx, depth) !== null
  }
  return str(o.title, GENUI_LIMITS.maxString) !== undefined
}

function repairChartData(v: unknown, cap: number): Array<{ label: string; value: number | GenuiComputedRef; color?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; value: number | GenuiComputedRef; color?: string }> = []
  for (const datum of v) {
    if (out.length >= cap) break
    const o = obj(datum)
    const label = o === undefined ? undefined : str(o.label, 128)
    const value = o === undefined ? undefined : num(o.value, -1e12, 1e12)
    const reference = o === undefined ? undefined : repairComputedRef(o.value)
    if (label === undefined || (value === undefined && reference === undefined)) continue
    out.push({ label, value: value ?? reference!, ...opt('color', o === undefined ? undefined : color(o.color)) })
  }
  return out
}

function repairSeries(v: unknown, cap: number, pointCap: number): Array<{ label: string; color?: string; data: Array<{ label: string; value: number | GenuiComputedRef; color?: string }> }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; color?: string; data: Array<{ label: string; value: number | GenuiComputedRef; color?: string }> }> = []
  for (const s of v) {
    if (out.length >= cap) break
    const o = obj(s)
    const label = o === undefined ? undefined : str(o.label, 128)
    const data = o === undefined ? undefined : repairChartData(o.data, pointCap)
    if (label === undefined || data === undefined) continue
    out.push({ label, data, ...opt('color', o === undefined ? undefined : color(o.color)) })
  }
  return out
}

function repairTabs(v: unknown, ctx: RepairCtx, depth: number): Array<{ label: string; items: GenuiNode[] }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; items: GenuiNode[] }> = []
  for (const tab of v) {
    if (out.length >= GENUI_LIMITS.maxTabs) break
    const o = obj(tab)
    const label = o === undefined ? undefined : str(o.label, 128)
    if (label === undefined || o === undefined) continue

    const rawItems = o.items !== undefined ? o.items
      : o.content !== undefined ? (Array.isArray(o.content) ? o.content : [o.content])
      : undefined
    if (Array.isArray(rawItems)) out.push({ label, items: repairItems(rawItems, ctx, depth + 1) })
  }
  return out
}

function repairPlotSeries(v: unknown, cap: number): GenuiPlot['series'] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiPlot['series'] = []
  for (const s of v) {
    if (out.length >= cap) break
    const o = obj(s)
    const expr = o === undefined ? undefined : str(o.expr, 512)
    if (expr === undefined || o === undefined) continue
    const params: NonNullable<GenuiPlotSeries['params']> = []
    if (Array.isArray(o.params)) {
      for (const p of o.params) {
        if (params.length >= GENUI_LIMITS.maxPlotParams) break
        const po = obj(p)
        const name = po === undefined ? undefined : str(po.name, 64)
        const value = po === undefined ? undefined : num(po.value, -1e9, 1e9)
        if (name === undefined || value === undefined) continue
        params.push({
          name, value,
          ...opt('min', po === undefined ? undefined : num(po.min, -1e9, 1e9)),
          ...opt('max', po === undefined ? undefined : num(po.max, -1e9, 1e9)),
          ...opt('step', po === undefined ? undefined : num(po.step, 1e-9, 1e9)),
          ...opt('animateTo', po === undefined ? undefined : num(po.animateTo, -1e9, 1e9)),
          ...opt('durationMs', po === undefined ? undefined : num(po.durationMs, 1, 120_000)),
          ...opt('loop', po === undefined ? undefined : po.loop === true ? true : undefined),
        })
      }
    }
    out.push({ expr, ...opt('label', str(o.label, 128)), ...opt('color', color(o.color)), ...opt('kind', enu(o.kind, PLOT_KINDS)), ...opt('params', params.length > 0 ? params : undefined) })
  }
  return out
}

function repairSteps(v: unknown): Array<{ title: string; desc?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ title: string; desc?: string }> = []
  for (const s of v) {
    if (out.length >= GENUI_LIMITS.maxSteps) break
    const o = obj(s)
    const title = o === undefined ? undefined : str(o.title, 256)
    if (title === undefined) continue
    out.push({ title, ...opt('desc', o === undefined ? undefined : str(o.desc, GENUI_LIMITS.maxString)) })
  }
  return out
}

function repairPairs(v: unknown, cap: number): Array<{ key: string; value: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ key: string; value: string }> = []
  for (const p of v) {
    if (out.length >= cap) break
    const o = obj(p)
    const key = o === undefined ? undefined : str(o.key, 256)
    const value = o === undefined ? undefined : str(o.value, GENUI_LIMITS.maxString)
    if (key === undefined || value === undefined) continue
    out.push({ key, value })
  }
  return out
}

function repairDiffs(v: unknown): Array<{ path: string; oldText: string | null; newText: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ path: string; oldText: string | null; newText: string }> = []
  for (const d of v) {
    if (out.length >= 24) break
    const o = obj(d)
    const path = o === undefined ? undefined : str(o.path, 1024)
    const newText = o === undefined ? undefined : str(o.newText, 20_000)
    if (path === undefined || newText === undefined) continue
    const old = o === undefined ? undefined : o.oldText
    out.push({ path, newText, oldText: old === null || typeof old !== 'string' ? null : old.slice(0, 20_000) })
  }
  return out
}

function repairAccordion(v: unknown, ctx: RepairCtx, depth: number): Array<{ title: string; items: GenuiNode[] }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ title: string; items: GenuiNode[] }> = []
  for (const item of v) {
    if (out.length >= GENUI_LIMITS.maxAccordionItems) break
    const o = obj(item)
    const title = o === undefined ? undefined : str(o.title, 256)
    if (title === undefined || o === undefined) continue
    out.push({ title, items: repairItems(o.items, ctx, depth + 1) })
  }
  return out
}

function repairMeshes(v: unknown): GenuiScene3D['meshes'] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiScene3D['meshes'] = []
  for (const m of v) {
    if (out.length >= GENUI_LIMITS.maxMeshes) break
    const o = obj(m)
    const shape = o === undefined ? undefined : enu(o.shape, MESH_SHAPES)
    if (shape === undefined) continue
    const scale = o === undefined ? undefined : num(o.scale, -1e6, 1e6) ?? tuple3(o.scale)
    const size = o === undefined ? undefined : num(o.size, -1e6, 1e6) ?? tuple3(o.size)
    out.push({
      shape,
      ...opt('color', o === undefined ? undefined : color(o.color)),
      ...opt('position', o === undefined ? undefined : tuple3(o.position)),
      ...opt('rotation', o === undefined ? undefined : tuple3(o.rotation)),
      ...opt('scale', scale),
      ...opt('size', size),
    })
  }
  return out
}

function tuple3(v: unknown): [number, number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined
  const [a, b, c] = v
  if (typeof a !== 'number' || !Number.isFinite(a) || typeof b !== 'number' || !Number.isFinite(b)
    || typeof c !== 'number' || !Number.isFinite(c)) return undefined
  return [Math.min(1e6, Math.max(-1e6, a)), Math.min(1e6, Math.max(-1e6, b)), Math.min(1e6, Math.max(-1e6, c))]
}

function grid4(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v / 4) * 4))
}

function repairDiagramNodes(v: unknown): GenuiDiagram['nodes'] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiDiagram['nodes'] = []
  const seen = new Set<string>()
  for (const raw of v) {
    if (out.length >= GENUI_LIMITS.maxDiagramNodes) break
    const o = obj(raw)
    if (o === undefined) continue
    const id = str(o.id, 128)
    const label = str(o.label, GENUI_LIMITS.maxString)
    if (id === undefined || label === undefined) continue
    if (seen.has(id)) continue
    seen.add(id)
    const nodeType = enu(o.type, DIAGRAM_NODE_TYPES)

    const x = o.x === undefined ? undefined : grid4(num(o.x, -1e6, 1e6) ?? 0, 0, 1e6)
    const y = o.y === undefined ? undefined : grid4(num(o.y, -1e6, 1e6) ?? 0, 0, 1e6)
    const w = o.w === undefined ? undefined : grid4(num(o.w, -1e6, 1e6) ?? 96, 40, 2000)
    const h = o.h === undefined ? undefined : grid4(num(o.h, -1e6, 1e6) ?? 48, 24, 1200)
    out.push({
      id, label,
      ...opt('sub', str(o.sub, 256)),
      ...opt('description', str(o.description, GENUI_LIMITS.maxString)),
      ...opt('type', nodeType),
      ...opt('x', x),
      ...opt('y', y),
      ...opt('w', w),
      ...opt('h', h),
      ...opt('tag', str(o.tag, 32)),
    })
  }
  return out
}

function repairDiagramEdges(v: unknown): GenuiDiagram['edges'] | undefined {
  if (v === undefined) return []
  if (!Array.isArray(v)) return undefined
  const out: GenuiDiagram['edges'] = []
  for (const raw of v) {
    if (out.length >= GENUI_LIMITS.maxDiagramEdges) break
    const o = obj(raw)
    if (o === undefined) continue
    const from = str(o.from, 128)
    const to = str(o.to, 128)
    if (from === undefined || to === undefined) continue
    out.push({
      from, to,
      ...opt('label', str(o.label, GENUI_LIMITS.maxDiagramLabel)),
      ...opt('kind', enu(o.kind, DIAGRAM_EDGE_KINDS)),
      ...opt('route', enu(o.route, DIAGRAM_ROUTES)),
    })
  }
  return out
}

function repairDiagramTheme(v: unknown): GenuiDiagramTheme | undefined {
  const o = obj(v)
  if (o === undefined) return undefined
  const out: GenuiDiagramTheme = {}
  for (const key of ['paper', 'paper-2', 'ink', 'muted', 'soft', 'rule', 'accent', 'accent-tint', 'link'] as const) {
    const c = color(o[key])
    if (c !== undefined) out[key] = c
  }
  return Object.keys(out).length === 0 ? undefined : out
}

function repairDiagramZones(v: unknown): GenuiDiagram['zones'] | undefined {
  if (v === undefined) return []
  if (!Array.isArray(v)) return undefined
  const out: GenuiDiagram['zones'] = []
  for (const raw of v) {
    if (out.length >= GENUI_LIMITS.maxDiagramZones) break
    const o = obj(raw)
    if (o === undefined) continue
    const label = str(o.label, 64)
    if (label === undefined) continue
    out.push({
      label,
      ...opt('x', o.x === undefined ? undefined : grid4(num(o.x, -1e6, 1e6) ?? 0, 0, 1e6)),
      ...opt('y', o.y === undefined ? undefined : grid4(num(o.y, -1e6, 1e6) ?? 0, 0, 1e6)),
      ...opt('w', o.w === undefined ? undefined : grid4(num(o.w, -1e6, 1e6) ?? 100, 40, 2000)),
      ...opt('h', o.h === undefined ? undefined : grid4(num(o.h, -1e6, 1e6) ?? 100, 40, 1200)),
    })
  }
  return out
}

function repairDiagram(v: unknown): GenuiDiagram | null {
  const o = obj(v)
  if (o === undefined) return null
  const kind = enu(o.kind, DIAGRAM_KINDS as unknown as readonly GenuiDiagramKind[])
  if (kind === undefined) return null
  const nodes = repairDiagramNodes(o.nodes)
  if (nodes === undefined) return null
  const edges = repairDiagramEdges(o.edges)
  if (edges === undefined) return null
  const zones = repairDiagramZones(o.zones)
  if (zones === undefined) return null
  return {

    type: 'diagram', kind, nodes, edges,
    ...opt('id', str(o.id, 128)),
    ...opt('zones', zones.length > 0 ? zones : undefined),
    ...opt('variant', enu(o.variant, DIAGRAM_VARIANTS)),
    ...opt('title', str(o.title, 256)),
    ...opt('theme', repairDiagramTheme(o.theme)),
  }
}

function repairTimeline(v: unknown, cap: number): Array<{ title: string; desc?: string; time?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ title: string; desc?: string; time?: string }> = []
  for (const item of v) {
    if (out.length >= cap) break
    const o = obj(item)
    const title = o === undefined ? undefined : str(o.title, 256)
    if (title === undefined) continue
    out.push({
      title,
      ...opt('desc', o === undefined ? undefined : str(o.desc, GENUI_LIMITS.maxString)),
      ...opt('time', o === undefined ? undefined : str(o.time, 128)),
    })
  }
  return out
}

function repairTree(v: unknown, cap: number, ctx: RepairCtx): GenuiFileTreeNode[] | undefined {

  return walkTree(v, cap, GENUI_LIMITS.maxTreeDepth, ctx)
}

function walkTree(v: unknown, cap: number, depthLeft: number, ctx: RepairCtx): GenuiFileTreeNode[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: GenuiFileTreeNode[] = []
  for (const item of v) {
    const o = obj(item)
    const name = o === undefined ? undefined : str(o.name, 256)
    if (name === undefined) continue
    if (out.length >= cap) {
      ctx.truncatedFileTreeItems += 1
      continue
    }
    const children = o !== undefined && depthLeft > 0 && Array.isArray(o.children) ? walkTree(o.children, cap, depthLeft - 1, ctx) : undefined
    out.push({ name, ...opt('type', o === undefined ? undefined : enu(o.type, FILE_TYPES)), ...opt('children', children) })
  }
  return out
}

function repairQuizOptions(v: unknown, answer?: unknown): Array<{ label: string; correct?: boolean; feedback?: string }> | undefined {
  if (!Array.isArray(v)) return undefined
  const out: Array<{ label: string; correct?: boolean; feedback?: string }> = []
  for (const optItem of v) {
    if (out.length >= GENUI_LIMITS.maxQuizOptions) break
    const o = obj(optItem)
    const label = typeof optItem === 'string' ? str(optItem, 512) : o === undefined ? undefined : str(o.label, 512)
    if (label === undefined) continue
    out.push({
      label,
      ...opt('correct', o === undefined ? undefined : o.correct === true ? true : undefined),
      ...opt('feedback', o === undefined ? undefined : str(o.feedback, GENUI_LIMITS.maxString)),
    })
  }

  if (out.length === 0) return undefined

  if (out.some(option => option.correct === true)) return out
  const answerIndex = typeof answer === 'number' && Number.isFinite(answer)
    ? Math.trunc(answer)
    : typeof answer === 'string'
      ? out.findIndex(option => option.label === answer.slice(0, 512))
      : -1
  if (answerIndex < 0 || answerIndex >= out.length) return out
  return out.map((option, index) => index === answerIndex ? { ...option, correct: true } : option)
}

const ECHART_HTML_DANGER_RE = /<(?:script|img|svg|iframe|video|audio|object|embed|source)\b|on[a-z]+\s*=|javascript:/i

interface EChartSanitizeBudget { count: number }

function sanitizeEChartOption(v: unknown, depth: number, budget: EChartSanitizeBudget): unknown {
  if (budget.count <= 0) return undefined
  budget.count -= 1
  if (depth > GENUI_LIMITS.maxEChartOptionDepth) return undefined

  if (typeof v === 'string') {
    const s = v.slice(0, GENUI_LIMITS.maxString)

    if (s.toLowerCase().includes('url(') || ECHART_HTML_DANGER_RE.test(s)) return undefined
    return s
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v
  if (v === null) return null
  if (Array.isArray(v)) {
    const cap = Math.min(v.length, GENUI_LIMITS.maxEChartArrayLen)
    const arr: unknown[] = []
    for (let i = 0; i < cap; i++) {
      const s = sanitizeEChartOption(v[i], depth + 1, budget)
      if (s !== undefined) arr.push(s)
    }
    return arr.length > 0 || v.length === 0 ? arr : undefined
  }
  const o = obj(v)
  if (o === undefined) return undefined
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(o)) {
    const s = sanitizeEChartOption(val, depth + 1, budget)
    if (s === undefined) continue

    if (key === 'tooltip' && typeof s === 'object' && s !== null && !Array.isArray(s)) {
      (s as Record<string, unknown>).renderMode = 'richText'
    }
    out[key] = s
  }

  return Object.keys(out).length > 0 || Object.keys(o).length === 0 ? out : undefined
}

function repairComputedFields(value: unknown): GenuiComputed[] | undefined {
  if (!Array.isArray(value)) return undefined
  const output: GenuiComputed[] = []
  for (const entry of value.slice(0, GENUI_LIMITS.maxComputedFields)) {
    const item = obj(entry)
    const id = item !== undefined && typeof item.id === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(item.id)
      ? item.id
      : undefined
    const expr = item === undefined ? undefined : str(item.expr, SAFE_MATH_LIMITS.maxExpressionLength)
    if (id === undefined || expr === undefined || item === undefined
      || typeof item.expr !== 'string' || item.expr.length > SAFE_MATH_LIMITS.maxExpressionLength) continue
    const rawFormat = obj(item.format)
    let format: GenuiComputedFormat | undefined
    if (rawFormat !== undefined) {
      const style = enu(rawFormat.style, ['decimal', 'currency', 'percent'] as const) ?? 'decimal'
      const currency = typeof rawFormat.currency === 'string' && /^[A-Z]{3}$/.test(rawFormat.currency)
        ? rawFormat.currency
        : undefined
      const locale = typeof rawFormat.locale === 'string' && isValidComputedLocale(rawFormat.locale)
        ? rawFormat.locale.slice(0, 35)
        : undefined
      const minimumFractionDigits = int(rawFormat.minimumFractionDigits, 0, 12)
      const maximumFractionDigits = int(rawFormat.maximumFractionDigits, 0, 12)
      if ((style !== 'currency' || currency !== undefined)
        && (minimumFractionDigits === undefined || maximumFractionDigits === undefined || minimumFractionDigits <= maximumFractionDigits)) {
        format = {
          style,
          ...opt('currency', currency),
          ...opt('locale', locale),
          ...opt('minimumFractionDigits', minimumFractionDigits),
          ...opt('maximumFractionDigits', maximumFractionDigits),
        }
      }
    }
    output.push({ id, expr, ...opt('format', format) })
  }
  return output
}

function isValidComputedLocale(locale: string): boolean {
  if (locale.length > 35) return false
  try {
    return Intl.getCanonicalLocales(locale).length === 1
  } catch {
    return false
  }
}

function repairComputedRef(value: unknown): GenuiComputedRef | undefined {
  const reference = obj(value)
  if (reference === undefined || Object.keys(reference).length !== 1) return undefined
  const id = reference.$computed
  return typeof id === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(id) ? { $computed: id } : undefined
}

function repairCanonicalGenuiSpec(
  value: unknown,
  ctx: RepairCtx = {
    remaining: GENUI_LIMITS.maxNodes,
    truncatedTableRows: 0,
    truncatedListItems: 0,
    truncatedFileTreeItems: 0,
  },
): GenuiSpec | null {
  const v = obj(value)
  if (v === undefined) return null

  if (isComponentRoot(value)) {
    const wrapped = wrapSingleComponentRoot(value)
    if (wrapped === null) return null
    return repairCanonicalGenuiSpec(wrapped, ctx)
  }
  if (!Array.isArray(v.items)) return null
  return {
    ...opt('title', str(v.title, GENUI_LIMITS.maxString)),
    ...opt('gap', num(v.gap, 0, 96)),
    ...opt('panel', v.panel === true ? true : undefined),
    ...opt('append', v.append === true ? true : undefined),
    ...opt('computed', repairComputedFields(v.computed)),
    items: repairItems(v.items, ctx, 0),
  }
}

export function repairGenuiSpec(value: unknown): GenuiSpec | null {
  return repairCanonicalGenuiSpec(normalizeGenuiSpec(value).value)
}

export function countGenuiNodes(value: unknown, cap = Number.POSITIVE_INFINITY): number {
  let count = 0
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (count >= cap) return
      count += 1
      const v = obj(item)
      if (v === undefined) continue
      if (v.type === 'tabs' && Array.isArray(v.tabs)) {
        for (const t of v.tabs) {
          if (count >= cap) return
          const to = obj(t)
          if (to !== undefined) walk(to.items)
        }
      } else if (v.type === 'accordion' && Array.isArray(v.items)) {
        for (const it of v.items) {
          if (count >= cap) return
          const io = obj(it)
          if (io !== undefined) walk(io.items)
        }
      } else if ((v.type === 'row' || v.type === 'col' || v.type === 'grid' || v.type === 'card' || v.type === 'carousel') && Array.isArray(v.items)) {

        walk(v.items)
      } else if (v.type === 'file-tree') {

      } else if (v.type === 'list' && Array.isArray(v.items)) {

        for (const li of v.items) {
          if (count >= cap) return
          const lo = obj(li)
          if (lo !== undefined && typeof lo.type === 'string') walk([lo])
        }
      } else if (v.type === 'table' && Array.isArray(v.details)) {
        const rowCount = tableRowsForDetails(v).length
        for (let rowIndex = 0; rowIndex < Math.min(v.details.length, rowCount); rowIndex++) {
          if (count >= cap) return
          const detail = v.details[rowIndex]
          if (Array.isArray(detail) && isTableDetailReachable(v, rowIndex)) walk(detail)
        }
      }
    }
  }
  const root = obj(value)
  walk(root === undefined ? [] : root.items)
  return count
}

export const GENUI_NODE_TYPES: ReadonlySet<string> = GENUI_NATIVE_TYPES

function visitDeclaredGenuiNodes(
  value: unknown,
  cap: number,
  visit: (node: Record<string, unknown>, at: string) => void,
  options: { familyCaps?: boolean; carouselCaps?: boolean } = {},
): number {
  const familyCaps = options.familyCaps !== false
  const carouselCaps = options.carouselCaps ?? familyCaps
  let count = 0
  const declared = (candidate: unknown): boolean => {
    const o = obj(candidate)
    return o !== undefined && typeof o.type === 'string' && GENUI_NODE_TYPES.has(o.type)
  }
  function walk(list: unknown, path: string, depth: number): void {
    if (!Array.isArray(list)) return
    for (let index = 0; index < list.length; index++) {
      walkNode(list[index], `${path}[${index}]`, depth)
      if (count >= cap) return
    }
  }
  function walkNode(item: unknown, at: string, depth: number): void {
    if (count >= cap || !declared(item)) return
    const v = obj(item)
    if (v === undefined) return
    count += 1
    visit(v, at)
    if (v.type === 'tabs' && Array.isArray(v.tabs)) {
      const tabCount = familyCaps ? Math.min(v.tabs.length, GENUI_LIMITS.maxTabs) : v.tabs.length
      for (let tab = 0; tab < tabCount; tab++) {
        walkItemsOf(v.tabs[tab], `${at}.tabs[${tab}]`, depth + 1)
      }
    } else if (v.type === 'accordion' && Array.isArray(v.items)) {
      const rowCount = familyCaps ? Math.min(v.items.length, GENUI_LIMITS.maxAccordionItems) : v.items.length
      for (let row = 0; row < rowCount; row++) {
        walkItemsOf(v.items[row], `${at}.items[${row}]`, depth + 1)
      }
    } else if ((v.type === 'row' || v.type === 'col' || v.type === 'grid' || v.type === 'card' || v.type === 'carousel') && Array.isArray(v.items)) {
      const items = v.type === 'carousel' && carouselCaps ? v.items.slice(0, GENUI_LIMITS.maxCarouselItems) : v.items
      walk(items, `${at}.items`, depth + 1)
    } else if (v.type === 'list' && Array.isArray(v.items)) {
      let keptItems = 0
      for (let row = 0; row < v.items.length; row++) {
        const item = v.items[row]
        if (!isRepairableListItem(item, depth + 1)) continue
        if (keptItems >= GENUI_LIMITS.maxListItems) break
        keptItems += 1
        walkNode(item, `${at}.items[${row}]`, depth + 1)
      }
    } else if (v.type === 'table' && Array.isArray(v.details)) {
      const rowCount = tableRowsForDetails(v).length
      for (let row = 0; row < Math.min(v.details.length, rowCount); row++) {
        if (Array.isArray(v.details[row]) && isTableDetailReachable(v, row)) walk(v.details[row], `${at}.details[${row}]`, depth + 1)
      }
    }
  }
  function walkItemsOf(holder: unknown, path: string, depth: number): void {
    const o = obj(holder)
    if (o === undefined) return
    const items = o.items !== undefined ? o.items : o.content
    if (Array.isArray(items)) walk(items, `${path}.items`, depth)
    else walkNode(items, `${path}.items`, depth)
  }
  const root = obj(value)
  if (root === undefined) return count

  if (isComponentRoot(root) && declared(value)) walkNode(value, 'spec', 0)
  else walk(root.items, 'items', 0)
  return count
}

export function countDeclaredGenuiNodes(value: unknown, cap = Number.POSITIVE_INFINITY, options: { familyCaps?: boolean; carouselCaps?: boolean } = {}): number {
  return visitDeclaredGenuiNodes(value, cap, () => {}, options)
}

export function countRenderedNativeGenuiNodes(value: unknown, cap = Number.POSITIVE_INFINITY): number {
  return countDeclaredGenuiNodes(value, cap)
}

export function validateGenuiChartSemantics(value: unknown): string[] {
  const errors: string[] = []
  visitDeclaredGenuiNodes(value, GENUI_LIMITS.maxNodes + 1, (node, at) => {
    if (node.type !== 'chart') return
    validateChartNode(node, at, errors)
  })
  return errors
}

interface GenuiValidationOptions {
  deferPanelReferences?: boolean

  panelOperation?: 'replace' | 'append'
}

function deferPanelReferences(spec: GenuiSpec, options: GenuiValidationOptions): boolean {
  return options.panelOperation === 'append'
    || (options.deferPanelReferences === true && spec.panel === true && spec.append === true)
}

function validateWhenDependencyCycles(spec: GenuiSpec): string[] {

  const registry = analyzeSubmissionRegistry(spec).registry
  const dependencies = new Map<string, Array<{ field: string; path: string }>>()
  walkGenuiNodes(spec, (node, path, ancestorConditions) => {
    const fieldId = 'id' in node && typeof node.id === 'string'
      && registry.members.get(node.id)?.kind === 'field' ? node.id : undefined
    const group = node.type === 'radio' || node.type === 'checkbox' || node.type === 'choices' ? node.group : undefined
    const key = fieldId ?? group
    if (key === undefined) return
    const edges = dependencies.get(key) ?? []
    for (const ancestor of ancestorConditions) edges.push({ field: ancestor.condition.field, path: ancestor.path })
    if (node.when !== undefined) {
      edges.push({ field: node.when.field, path: `${path}.when.field` })
    }
    dependencies.set(key, edges)
  })
  const errors: string[] = []
  const visited = new Set<string>()
  const active = new Set<string>()
  const visit = (key: string): void => {
    if (visited.has(key)) return
    active.add(key)
    for (const edge of dependencies.get(key) ?? []) {
      if (active.has(edge.field)) {
        errors.push(`${edge.path}: circular visibility dependency involving '${edge.field}'`)
        continue
      }
      visit(edge.field)
    }
    active.delete(key)
    visited.add(key)
  }
  dependencies.forEach((_edges, key) => visit(key))
  return errors
}

export function validateCanonicalGenuiSpec(value: unknown, options: GenuiValidationOptions = {}): GenuiValidation {
  const errors: string[] = []
  const v = obj(value)
  if (v === undefined) return { ok: false, errors: ['spec root must be an object'] }

  if (isComponentRoot(value)) {
    const wrapped = wrapSingleComponentRoot(value)
    if (wrapped !== null) return validateCanonicalGenuiSpec(wrapped, options)
    return { ok: false, errors: ['spec.items must be an array'] }
  }
  if (!Array.isArray(v.items)) return { ok: false, errors: ['spec.items must be an array'] }
  validateSchemaFieldKinds(v, 'spec', GENUI_SPEC_SCHEMA, errors, ['items'])
  validateNestedRecordSchemas(v, 'spec', GENUI_SPEC_SCHEMA, errors)
  if (Array.isArray(v.computed)) {
    if (v.computed.length > GENUI_LIMITS.maxComputedFields) {
      errors.push(`spec.computed exceeds ${GENUI_LIMITS.maxComputedFields} fields`)
    }
    for (const [index, entry] of v.computed.slice(0, GENUI_LIMITS.maxComputedFields).entries()) {
      const formula = obj(entry)
      if (formula === undefined) continue
      const at = `spec.computed[${index}]`
      if (typeof formula.id === 'string' && !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(formula.id)) {
        errors.push(`${at}.id must be a field name of at most 64 characters`)
      }
      if (typeof formula.expr === 'string' && formula.expr.length > SAFE_MATH_LIMITS.maxExpressionLength) {
        errors.push(`${at}.expr exceeds ${SAFE_MATH_LIMITS.maxExpressionLength} characters`)
      }
      const format = obj(formula.format)
      if (format !== undefined) {
        const style = format.style
        if (style !== undefined && !['decimal', 'currency', 'percent'].includes(String(style))) {
          errors.push(`${at}.format.style must be decimal, currency, or percent`)
        }
        if (style === 'currency' && (typeof format.currency !== 'string' || !/^[A-Z]{3}$/.test(format.currency))) {
          errors.push(`${at}.format.currency must be a three-letter uppercase currency code`)
        }
        if (format.locale !== undefined && (typeof format.locale !== 'string' || !isValidComputedLocale(format.locale))) {
          errors.push(`${at}.format.locale is invalid`)
        }
        for (const field of ['minimumFractionDigits', 'maximumFractionDigits']) {
          const value = format[field]
          if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 12)) {
            errors.push(`${at}.format.${field} must be an integer from 0 to 12`)
          }
        }
        if (typeof format.minimumFractionDigits === 'number' && typeof format.maximumFractionDigits === 'number'
          && format.minimumFractionDigits > format.maximumFractionDigits) {
          errors.push(`${at}.format.minimumFractionDigits cannot exceed maximumFractionDigits`)
        }
      }
    }
  }
  const repaired = repairCanonicalGenuiSpec(v)
  if (repaired !== null) {
    errors.push(...validateWhenDependencyCycles(repaired))

    const append = deferPanelReferences(repaired, options)
    const graph = buildComputedGraph(repaired.computed ?? [], getComputedInputIds(repaired), new Set(), append)
    for (const [id, error] of Object.entries(graph.errors)) errors.push(`spec.computed.${id}: ${error}`)
    validateComputedReferences(repaired.title, repaired.items, new Set((repaired.computed ?? []).map(field => field.id)), errors, append)
  }
  let count = 0
  let capped = false
  const walk = (list: unknown, depth: number, path: string): void => {
    if (capped) return
    if (!Array.isArray(list)) {
      errors.push(`${path} must be an array`)
      return
    }
    for (let i = 0; i < list.length; i++) {
      if (capped || count >= GENUI_LIMITS.maxNodes) {
        if (!capped) {
          errors.push(`spec exceeds ${GENUI_LIMITS.maxNodes} nodes; tail elided`)
          capped = true
        }
        return
      }
      count += 1
      const at = `${path}[${i}]`
      validateNode(list[i], depth, at, errors, walk)
    }
  }
  walk(v.items, 0, 'items')

  if (errors.length === 0 && repaired !== null) errors.push(...analyzeSubmissionRegistry(repaired,
    deferPanelReferences(repaired, options)).diagnostics)
  if (repaired !== null) {
    for (const id of getDuplicateComputedInputIds(repaired)) {
      errors.push(`spec.items contains duplicate input field ID '${id}'`)
    }
  }
  const uniqueErrors = [...new Set(errors)]
  return { ok: uniqueErrors.length === 0, errors: uniqueErrors }
}

export function validateGenuiSpec(value: unknown): GenuiValidation {
  return validateCanonicalGenuiSpec(normalizeGenuiSpec(value).value)
}

export interface GenuiProcessResult {

  deferPanelReferences?: boolean

  value: unknown

  normalized: unknown

  repaired: GenuiSpec | null

  spec: GenuiSpec | null

  errors: string[]

  warnings: GenuiDiagnostic[]

  declaredCount: number

  renderedCount: number

  declaredNativeCount: number

  renderedNativeCount: number

  renderedTotalCount: number
}

export function processGenuiSpec(value: unknown, options: GenuiValidationOptions = {}): GenuiProcessResult {
  const normalized = normalizeGenuiSpec(value)
  const repairCtx: RepairCtx = {
    remaining: GENUI_LIMITS.maxNodes,
    truncatedTableRows: 0,
    truncatedListItems: 0,
    truncatedFileTreeItems: 0,
  }
  const repaired = repairCanonicalGenuiSpec(normalized.value, repairCtx)
  const validation = validateCanonicalGenuiSpec(normalized.value, options)

  const declaredNativeCount = countDeclaredGenuiNodes(normalized.value, GENUI_LIMITS.maxNodes + 1)
  const uncappedPolicyNodeCount = countDeclaredGenuiNodes(normalized.value, GENUI_LIMITS.maxNodes + 1, { familyCaps: false, carouselCaps: true })
  const renderedNativeCount = repaired === null ? 0 : countRenderedNativeGenuiNodes(repaired)
  const renderedTotalCount = repaired === null ? 0 : countGenuiNodes(repaired)
  const errors = [...validation.errors]
  if (repaired !== null && errors.length === 0) {
    errors.push(...analyzeSubmissionRegistry(repaired,
      deferPanelReferences(repaired, options)).diagnostics)
  }
  if (declaredNativeCount > renderedNativeCount) {
    errors.push(`repair dropped ${declaredNativeCount - renderedNativeCount} declared native node(s): declared ${declaredNativeCount}, rendered ${renderedNativeCount}`)
  }
  const warnings: GenuiDiagnostic[] = [...normalized.warnings, ...diagnoseUnknownGenuiFields(normalized.value)]
  let carouselItemOverflow = 0
  let imageGroupOverflow = 0
  visitDeclaredGenuiNodes(normalized.value, GENUI_LIMITS.maxNodes + 1, node => {
    if (node.type === 'carousel' && Array.isArray(node.items)) {
      carouselItemOverflow += Math.max(0, node.items.length - GENUI_LIMITS.maxCarouselItems)
    } else if (node.type === 'image-group' && Array.isArray(node.items)) {
      imageGroupOverflow += Math.max(0, node.items.length - GENUI_LIMITS.maxImageGroupItems)
    }
  })
  const truncationReasons: string[] = []
  if (uncappedPolicyNodeCount > declaredNativeCount) {
    truncationReasons.push(`${uncappedPolicyNodeCount - declaredNativeCount} 个声明节点超出 tabs ≤ ${GENUI_LIMITS.maxTabs} / accordion ≤ ${GENUI_LIMITS.maxAccordionItems} 的上限`)
  }
  if (carouselItemOverflow > 0) {
    truncationReasons.push(`${carouselItemOverflow} 个 carousel 项超出 carousel ≤ ${GENUI_LIMITS.maxCarouselItems} 的上限`)
  }
  if (imageGroupOverflow > 0) {
    truncationReasons.push(`${imageGroupOverflow} 张图片超出 image-group ≤ ${GENUI_LIMITS.maxImageGroupItems} 的上限`)
  }
  if (repairCtx.truncatedTableRows > 0) {
    truncationReasons.push(`${repairCtx.truncatedTableRows} 行超出 table.rows ≤ ${GENUI_LIMITS.maxTableRows} 的上限`)
  }
  if (repairCtx.truncatedListItems > 0) {
    truncationReasons.push(`${repairCtx.truncatedListItems} 项超出 list.items ≤ ${GENUI_LIMITS.maxListItems} 的上限`)
  }
  if (repairCtx.truncatedFileTreeItems > 0) {
    truncationReasons.push(`${repairCtx.truncatedFileTreeItems} 个节点超出 file-tree 每层 ≤ ${GENUI_LIMITS.maxListItems} 的上限`)
  }
  if (truncationReasons.length > 0) {
    warnings.push({
      kind: 'truncated',
      path: 'spec',
      message: `策略上限截断:${truncationReasons.join('；')},未渲染;策略限制包括 tabs ≤ ${GENUI_LIMITS.maxTabs} / accordion ≤ ${GENUI_LIMITS.maxAccordionItems} / carousel ≤ ${GENUI_LIMITS.maxCarouselItems} / image-group ≤ ${GENUI_LIMITS.maxImageGroupItems} / table.rows ≤ ${GENUI_LIMITS.maxTableRows} / list.items ≤ ${GENUI_LIMITS.maxListItems} / file-tree 每层 ≤ ${GENUI_LIMITS.maxListItems};围栏照常渲染,重发时可分为多个组件`,
    })
  }
  return {
    ...(options.deferPanelReferences === true ? { deferPanelReferences: true } : {}),
    value: normalized.value,
    normalized: normalized.value,
    repaired,
    spec: repaired,
    errors: [...new Set(errors)],
    warnings,

    declaredCount: declaredNativeCount,
    renderedCount: renderedTotalCount,
    declaredNativeCount,
    renderedNativeCount,
    renderedTotalCount,
  }
}

export function isIntentionalBudgetCut(processed: GenuiProcessResult): boolean {
  return processed.errors.length > 0
    && processed.errors.every(error => error.startsWith('spec exceeds ') || error.startsWith('repair dropped '))
    && processed.renderedNativeCount === GENUI_LIMITS.maxNodes
    && processed.declaredNativeCount === GENUI_LIMITS.maxNodes + 1
}

export function isRenderableProcess(processed: GenuiProcessResult): boolean {
  return processed.spec !== null && (processed.errors.length === 0 || isIntentionalBudgetCut(processed))
}

const DECLARED_NODE_PATH_RE = /^(items\[\d+\](?:\.(?:items\[\d+\]|tabs\[\d+\]\.items\[\d+\]|details\[\d+\](?:\[\d+\])?))*)/

function errorNodePath(error: string): string | null {
  const match = DECLARED_NODE_PATH_RE.exec(error)
  return match === null ? null : match[1] ?? null
}

interface NodeSlot {
  array: unknown[]
  index: number

  preserveIndex: boolean
}

function nodeSlotAt(root: Record<string, unknown>, path: string): NodeSlot | undefined {
  const steps = [...path.matchAll(/(?:^|\.)(items|tabs|details)\[(\d+)\]|\[(\d+)\]/g)]
  if (steps.length === 0 || steps[steps.length - 1]![1] === 'tabs') return undefined
  let current: unknown = root
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!

    const list = step[1] === undefined ? current : obj(current)?.[step[1]]
    const index = Number(step[2] ?? step[3])
    if (!Array.isArray(list) || index >= list.length) return undefined
    if (i === steps.length - 1) return { array: list, index, preserveIndex: step[1] === 'details' }
    current = list[index]
    if (current === undefined) return undefined
  }
  return undefined
}

function cloneJsonValue(value: unknown): Record<string, unknown> | null {
  try {
    return obj(JSON.parse(JSON.stringify(value))) ?? null
  } catch {
    return null
  }
}

export function partialRepairGenuiSpec(processed: GenuiProcessResult): GenuiSpec | null {
  if (isRenderableProcess(processed)) return processed.spec
  if (processed.spec === null) return null
  const root = obj(processed.value)
  if (root === undefined) return null
  const paths = new Set<string>()
  const overhangPaths = new Set<string>()
  for (const error of processed.errors) {
    if (error.startsWith('spec exceeds ')) continue
    const nodePath = errorNodePath(error)
    if (nodePath === null) continue
    if (error === `${nodePath}.details must not contain more entries than rows`) {
      overhangPaths.add(nodePath)
    } else paths.add(nodePath)
  }
  if (paths.size === 0 && overhangPaths.size === 0) return null

  const pruned = cloneJsonValue(isComponentRoot(root) ? wrapSingleComponentRoot(root) : root)
  if (pruned === null) return null

  const slots = [...paths]
    .map((path) => nodeSlotAt(pruned, path))
    .filter((slot): slot is NodeSlot => slot !== undefined)
  const overhangSlots = [...overhangPaths]
    .map((path) => nodeSlotAt(pruned, path))
    .filter((slot): slot is NodeSlot => slot !== undefined)

  for (const { array, index } of overhangSlots) {
    const table = obj(array[index])
    if (table?.type === 'table' && Array.isArray(table.details)) {
      table.details.length = Math.min(table.details.length, tableRowsForDetails(table).length)
    }
  }
  const byArray = new Map<unknown[], number[]>()
  for (const { array, index, preserveIndex } of slots) {
    if (preserveIndex) {
      array[index] = null
      continue
    }
    const indexes = byArray.get(array)
    if (indexes === undefined) byArray.set(array, [index])
    else indexes.push(index)
  }
  for (const [array, indexes] of byArray) {
    indexes.sort((a, b) => b - a)
    for (const index of indexes) array.splice(index, 1)
  }
  const retry = processGenuiSpec(pruned, { deferPanelReferences: processed.deferPanelReferences === true })
  if (!isRenderableProcess(retry) || retry.renderedNativeCount === 0) return null
  return retry.spec
}

type Walker = (list: unknown, depth: number, path: string) => void

function validateComputedReferences(title: unknown, items: unknown, computedIds: ReadonlySet<string>, errors: string[], allowExternalReferences = false): void {
  const visited = new WeakSet<object>()
  let visitedCount = 0
  const visit = (value: unknown, path: string, referenceAllowed: boolean, depth: number, templateAllowed: ComputedTemplateScope = false, nodeScope: ComputedNodeScope = false): void => {
    if (depth > GENUI_LIMITS.maxDepth * 2 || visitedCount >= GENUI_LIMITS.maxNodes * 8) return
    if (typeof value === 'string') {
      if (!templateAllowed) return
      for (const match of value.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)) {
        const id = match[1]!
        if (!allowExternalReferences && !computedIds.has(id)) errors.push(`${path} references unknown computed field '${id}'`)
      }
      return
    }
    if (value === null || typeof value !== 'object') return
    if (nodeScope === false && !referenceAllowed && !templateAllowed) return
    if (visited.has(value)) return
    visited.add(value)
    visitedCount += 1
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, referenceAllowed, depth + 1, templateAllowed, nodeScope))
      return
    }
    const record = value as Record<string, unknown>
    const nodeType = nodeScope === true ? record.type : undefined
    if (referenceAllowed && Object.keys(record).length === 1 && typeof record.$computed === 'string') {
      if (!allowExternalReferences && !computedIds.has(record.$computed)) errors.push(`${path} references unknown computed field '${record.$computed}'`)
      return
    }
    for (const [key, child] of Object.entries(record)) {
      const childAllowsReference = referenceAllowed
        || nodeType === 'table' && key === 'rows'
        || (nodeType === 'chart' || nodeType === 'echart') && (key === 'data' || key === 'series')
        || nodeType === 'echart' && key === 'option'
      visit(child, `${path}.${key}`, childAllowsReference, depth + 1, getComputedTemplateScope(nodeType, key, templateAllowed), getComputedChildNodeScope(nodeType, key, nodeScope))
    }
  }
  visit(title, 'spec.title', false, 0, true)
  visit(items, 'spec.items', false, 0, false, true)
}

function validateChartData(value: unknown, at: string, errors: string[]): void {
  if (!Array.isArray(value)) return
  for (let index = 0; index < value.length; index++) {
    const datum = obj(value[index])
    const path = `${at}[${index}]`
    if (datum === undefined) {
      errors.push(`${path} must be an object`)
      continue
    }
    if (typeof datum.label !== 'string') errors.push(`${path}.label must be a string`)
    if ((typeof datum.value !== 'number' || !Number.isFinite(datum.value))
      && repairComputedRef(datum.value) === undefined) {
      errors.push(`${path}.value must be a finite number`)
    }
    if (datum.color !== undefined && typeof datum.color !== 'string') {
      errors.push(`${path}.color must be a string`)
    }
  }
}

function validateChartSeries(value: unknown, at: string, errors: string[]): void {
  if (!Array.isArray(value)) return
  for (let index = 0; index < value.length; index++) {
    const series = obj(value[index])
    const path = `${at}[${index}]`
    if (series === undefined) {
      errors.push(`${path} must be an object`)
      continue
    }
    if (typeof series.label !== 'string') errors.push(`${path}.label must be a string`)
    if (series.color !== undefined && typeof series.color !== 'string') {
      errors.push(`${path}.color must be a string`)
    }
    if (!Array.isArray(series.data)) errors.push(`${path}.data must be an array`)
    validateChartData(series.data, `${path}.data`, errors)
  }
}

function validateChartNode(v: Record<string, unknown>, at: string, errors: string[]): void {
  if (!Array.isArray(v.data) && !Array.isArray(v.series)) {
    errors.push(`${at}: type 'chart' requires data or series (array)`)
  }
  if (v.variant !== undefined) errors.push(`${at}.variant is unsupported; use kind`)
  if (v.data !== undefined && !Array.isArray(v.data)) errors.push(`${at}.data must be an array`)
  if (v.series !== undefined && !Array.isArray(v.series)) errors.push(`${at}.series must be an array`)
  if (v.kind !== undefined
    && (typeof v.kind !== 'string'
      || !CHART_KINDS.includes(v.kind as typeof CHART_KINDS[number]))) {
    errors.push(`${at}.kind must be bars, line, or donut`)
  }
  const kind = v.kind === undefined ? 'bars' : v.kind
  const series = Array.isArray(v.series) ? v.series : undefined

  if (Array.isArray(v.data) && v.data.length === 0 && (series === undefined || series.length === 0)) {
    errors.push(`${at}.data must not be empty`)
  }
  if (series !== undefined) {
    if (series.length === 0) errors.push(`${at}.series must not be empty`)

    if (kind === 'donut') errors.push(`${at}.series is only supported for bars and line`)
    for (let index = 0; index < series.length; index++) {
      const entry = obj(series[index])
      if (entry !== undefined && Array.isArray(entry.data) && entry.data.length === 0) {
        errors.push(`${at}.series[${index}].data must not be empty`)
      }
    }
  }
  if (kind === 'donut' && v.data === undefined) {
    errors.push(`${at}.data is required for donut`)
  }
  if (kind === 'line' && v.data === undefined && (series === undefined || series.length === 0)) {
    errors.push(`${at}.data is required for line (or provide series)`)
  }
  validateChartData(v.data, `${at}.data`, errors)
  validateChartSeries(v.series, `${at}.series`, errors)
}

function validateTableRows(value: unknown, at: string, errors: string[]): void {
  if (!Array.isArray(value)) return
  for (let rowIndex = 0; rowIndex < value.length; rowIndex++) {
    const row = value[rowIndex]
    if (obj(row) !== undefined) continue
    if (!Array.isArray(row)) {
      errors.push(`${at}[${rowIndex}] must be an array or object`)
      continue
    }
    for (let cellIndex = 0; cellIndex < row.length; cellIndex++) {
      const cell = row[cellIndex]
      if (typeof cell !== 'string' && (typeof cell !== 'number' || !Number.isFinite(cell))
        && repairComputedRef(cell) === undefined) {
        errors.push(`${at}[${rowIndex}][${cellIndex}] must be a string or finite number`)
      }
    }
  }
}

function validateDatePicker(value: Record<string, unknown>, at: string, errors: string[]): void {
  const mode = value.mode === 'range' ? 'range' : 'single'
  const minimum = value.min
  const maximum = value.max
  if (minimum !== undefined && !isIsoDate(minimum)) errors.push(`${at}.min must be a valid YYYY-MM-DD date`)
  if (maximum !== undefined && !isIsoDate(maximum)) errors.push(`${at}.max must be a valid YYYY-MM-DD date`)
  if (isIsoDate(minimum) && isIsoDate(maximum) && minimum > maximum) errors.push(`${at}.min must not be after max`)
  if (value.value === undefined) return

  const dates = mode === 'range' && typeof value.value === 'string' ? value.value.split('/') : [value.value]
  if (mode === 'range' && dates.length !== 2) {
    errors.push(`${at}.value must contain start/end dates in range mode`)
    return
  }
  if (!dates.every(isIsoDate)) {
    errors.push(`${at}.value must use valid YYYY-MM-DD dates`)
    return
  }
  const dateValues = dates as string[]
  const start = dateValues[0]!
  const end = dateValues[1]
  if (end !== undefined && start > end) errors.push(`${at}.value start date must not be after end date`)
  if (isIsoDate(minimum) && dateValues.some(date => date < minimum)) errors.push(`${at}.value must not be before min`)
  if (isIsoDate(maximum) && dateValues.some(date => date > maximum)) errors.push(`${at}.value must not be after max`)
  if (typeof value.value === 'string' && !isDatePickerValueValid(value.value, mode, isIsoDate(minimum) ? minimum : undefined, isIsoDate(maximum) ? maximum : undefined)) {
    errors.push(`${at}.value is outside the date-picker mode or range`)
  }
}

function validateNode(value: unknown, depth: number, at: string, errors: string[], walk: Walker): void {
  if (depth > GENUI_LIMITS.maxDepth) {
    errors.push(`${at}: exceeds max depth ${GENUI_LIMITS.maxDepth}`)
    return
  }
  const v = obj(value)
  if (v === undefined) {
    errors.push(`${at}: must be an object`)
    return
  }
  const type = v.type
  if (typeof type !== 'string') {
    errors.push(`${at}: missing string 'type'`)
    return
  }

  for (const key of ['when', 'enableWhen'] as const) {
    if (v[key] === undefined) continue
    const when = obj(v[key])
    if (when === undefined) { errors.push(`${at}.${key}: must be an object`); continue }
    if (typeof when.field !== 'string' || when.field.trim() === '') errors.push(`${at}.${key}.field: requires a field id or group (string)`)
    if (enu(when.op, WHEN_OPS) === undefined) errors.push(`${at}.${key}.op: must be one of ${WHEN_OPS.join(' / ')}`)
    if ((when.op === 'in' || when.op === 'not-in') && !Array.isArray(when.value)) {
      errors.push(`${at}.${key}.value: '${String(when.op)}' requires an array`)
    }
  }
  const isStr = (name: string): void => { if (v[name] !== undefined && typeof v[name] !== 'string') errors.push(`${at}: '${name}' must be a string`) }
  const isNum = (name: string): void => { if (v[name] !== undefined && (typeof v[name] !== 'number' || !Number.isFinite(v[name]))) errors.push(`${at}: '${name}' must be a finite number`) }
  switch (type) {
    case 'text':
      if (typeof v.content !== 'string' && typeof v.text !== 'string') {
        errors.push(`${at}: type 'text' requires content or text (string)`)
      }
      isStr('content')
      isStr('text')
      break
    case 'row': case 'col': case 'card': case 'grid': case 'carousel':
      if (!Array.isArray(v.items)) errors.push(`${at}: type '${type}' requires items (array)`)
      walk(type === 'carousel' && Array.isArray(v.items) ? v.items.slice(0, GENUI_LIMITS.maxCarouselItems) : v.items, depth + 1, `${at}.items`)
      if (type === 'grid') isNum('cols')
      break
    case 'button': case 'checkbox': case 'link': case 'switch':
      if (typeof v.label !== 'string') errors.push(`${at}: type '${type}' requires label (string)`)
      isStr('label')
      break
    case 'image-group':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'image-group' requires items (array)`)
      else v.items.slice(0, GENUI_LIMITS.maxImageGroupItems).forEach((item, index) => {
        const image = obj(item)
        if (image !== undefined && typeof image.src === 'string' && safeMediaSrc(image.src) === undefined) {
          errors.push(`${at}.items[${index}].src must be an http(s) or relative media URL`)
        }
      })
      break
    case 'choices': {
      if (!Array.isArray(v.items) || v.items.length === 0) {
        errors.push(`${at}: type 'choices' requires items (non-empty array)`)
        break
      }
      if (v.items.length > 8) errors.push(`${at}: 'choices' keeps at most 8 options`)

      if (typeof v.submit === 'string' && v.submit.trim() !== ''
        && (typeof v.action !== 'string' || v.action.trim() === '')) {
        errors.push(`${at}: 'choices' with submit requires action — drop submit for a purely local selection`)
      }
      v.items.slice(0, 8).forEach((item: unknown, index: number) => {
        const choice = obj(item)
        if (choice === undefined || typeof choice.label !== 'string' || choice.label.trim() === '') {
          errors.push(`${at}.items[${index}]: requires label (string)`)
        }
      })
      isStr('title')
      isStr('prompt')
      isStr('mode')
      isStr('submit')
      break
    }
    case 'compare':
      for (const side of ['before', 'after'] as const) {
        const panel = obj(v[side])
        if (panel === undefined) {
          errors.push(`${at}: type 'compare' requires ${side} (object with src)`)
          continue
        }
        if (typeof panel.src !== 'string') {
          errors.push(`${at}.${side}: requires src (string)`)
        } else if (safeMediaSrc(panel.src) === undefined) {
          errors.push(`${at}.${side}.src must be an http(s) or relative media URL`)
        }
      }
      isStr('title')
      isStr('mode')
      break
    case 'image': case 'audio': case 'video':
      if (typeof v.src !== 'string') errors.push(`${at}: type '${type}' requires src (string)`)
      isStr('src')
      isStr('alt')
      if (type === 'video') isStr('poster')
      break
    case 'slider':
      isStr('label')
      isNum('min'); isNum('max'); isNum('step'); isNum('value')
      break
    case 'date-picker':
      isStr('label'); isStr('value'); isStr('min'); isStr('max'); isStr('id')
      validateDatePicker(v, at, errors)
      break
    case 'segmented-control':
      isStr('label'); isStr('value'); isStr('id'); isStr('action')
      if (!Array.isArray(v.options) || v.options.length === 0) {
        errors.push(`${at}: type 'segmented-control' requires a non-empty options array`)
      } else {
        if (v.options.length > GENUI_LIMITS.maxOptions) errors.push(`${at}: 'segmented-control' keeps at most ${GENUI_LIMITS.maxOptions} options`)
        if (v.options.some(option => typeof option !== 'string' || option.trim() === '')) errors.push(`${at}.options must contain non-empty strings`)
        if (typeof v.value === 'string' && !v.options.includes(v.value)) errors.push(`${at}.value must match an option`)
        if (new Set(v.options).size !== v.options.length) errors.push(`${at}.options must be unique`)
      }
      break
    case 'input': case 'textarea':
      isStr('label'); isStr('placeholder'); isStr('value')
      break
    case 'select': case 'radio':
      if (!Array.isArray(v.options)) errors.push(`${at}: type '${type}' requires options (array)`)
      break
    case 'submit':
      if (typeof v.label !== 'string') errors.push(`${at}: type 'submit' requires label (string)`)

      break
    case 'badge':
      if (typeof v.label !== 'string' && typeof v.text !== 'string' && typeof v.value !== 'string') {
        errors.push(`${at}: type 'badge' requires label, text, or value (string)`)
      }
      isStr('label')
      isStr('text')
      isStr('value')
      break
    case 'hero':
      if (typeof v.title !== 'string') errors.push(`${at}: type 'hero' requires title (string)`)
      isStr('subtitle')
      break
    case 'stat':
      if (typeof v.label !== 'string') errors.push(`${at}: type 'stat' requires label (string)`)
      if (typeof v.value !== 'string') errors.push(`${at}: type 'stat' requires value (string)`)
      isStr('delta')
      break
    case 'progress':
      if (typeof v.value !== 'number' || !Number.isFinite(v.value) || (v.value as number) < 0 || (v.value as number) > 100) {
        errors.push(`${at}: type 'progress' requires value (number 0..100)`)
      }
      isNum('value')
      break
    case 'avatar':
      if (typeof v.name !== 'string') errors.push(`${at}: type 'avatar' requires name (string)`)
      break
    case 'list':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'list' requires items (array)`)
      if (Array.isArray(v.items)) {
        let keptItems = 0

        for (let i = 0; i < v.items.length; i++) {
          if (keptItems >= GENUI_LIMITS.maxListItems) break
          const value = v.items[i]
          const item = obj(value)
          if (item !== undefined && typeof item.type === 'string') {
            validateNode(item, depth + 1, `${at}.items[${i}]`, errors, walk)
          }
          if (isRepairableListItem(value, depth + 1)) keptItems += 1
        }
      }
      break
    case 'table':

      if (!Array.isArray(v.columns) && !hasDerivableTableColumns(v)) errors.push(`${at}: type 'table' requires columns (array)`)
      if (!Array.isArray(v.rows)) errors.push(`${at}: type 'table' requires rows (array)`)
      if (v.types !== undefined && !Array.isArray(v.types)) {
        errors.push(`${at}.types must be an array of column cell types`)
      }
      if (v.details !== undefined && !Array.isArray(v.details)) {
        errors.push(`${at}.details must be an array aligned with rows`)
      }
      if (Array.isArray(v.details)) {
        const table = { columns: v.columns, rows: v.rows, types: v.types }
        const rowCount = tableRowsForDetails(table).length
        if (v.details.length > rowCount) errors.push(`${at}.details must not contain more entries than rows`)
        for (let i = 0; i < Math.min(v.details.length, rowCount); i++) {
          const detail = v.details[i]
          if (detail === null || !isTableDetailReachable(table, i)) continue
          if (!Array.isArray(detail)) {
            errors.push(`${at}.details[${i}] must be an array or null`)
            continue
          }
          walk(detail, depth + 1, `${at}.details[${i}]`)
        }
      }
      validateTableRows(v.rows, `${at}.rows`, errors)
      break
    case 'chart':
      validateChartNode(v, at, errors)
      break
    case 'tabs': {
      if (!Array.isArray(v.tabs)) errors.push(`${at}: type 'tabs' requires tabs (array)`)
      if (Array.isArray(v.tabs)) {
        for (let i = 0; i < v.tabs.length; i++) {
          const t = obj(v.tabs[i])
          if (t === undefined) { errors.push(`${at}.tabs[${i}] must be an object`); continue }
          if (typeof t.label !== 'string') errors.push(`${at}.tabs[${i}].label must be a string`)
          walk(t.items, depth + 1, `${at}.tabs[${i}].items`)
        }
      }
      break
    }
    case 'plot':
      if (!Array.isArray(v.series)) errors.push(`${at}: type 'plot' requires series (array)`)
      break
    case 'callout':
      if (typeof v.content !== 'string') errors.push(`${at}: type 'callout' requires content (string)`)
      break
    case 'steps':
      if (!Array.isArray(v.steps)) errors.push(`${at}: type 'steps' requires steps (array)`)
      break
    case 'keyvalue':
      if (!Array.isArray(v.pairs)) errors.push(`${at}: type 'keyvalue' requires pairs (array)`)
      break
    case 'diff':
      if (!Array.isArray(v.diffs)) errors.push(`${at}: type 'diff' requires diffs (array)`)
      break
    case 'divider':
    case 'spacer':

      break
    case 'json':
      if (!('value' in v)) errors.push(`${at}: type 'json' requires value`)
      break
    case 'code':
      if (typeof v.code !== 'string') errors.push(`${at}: type 'code' requires code (string)`)
      break
    case 'accordion':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'accordion' requires items (array)`)
      if (Array.isArray(v.items)) {
        for (let i = 0; i < v.items.length; i++) {
          const item = obj(v.items[i])
          if (item === undefined) { errors.push(`${at}.items[${i}] must be an object`); continue }
          if (typeof item.title !== 'string') errors.push(`${at}.items[${i}].title must be a string`)
          walk(item.items, depth + 1, `${at}.items[${i}].items`)
        }
      }
      break
    case 'copy':
      if (typeof v.text !== 'string') errors.push(`${at}: type 'copy' requires text (string)`)
      break
    case 'editor':
      if (typeof v.id !== 'string' || typeof v.value !== 'string') errors.push(`${at}: type 'editor' requires id and value (strings)`)
      else if (v.value.length > GENUI_LIMITS.maxEditorChars) errors.push(`${at}.value exceeds editor limit ${GENUI_LIMITS.maxEditorChars}`)
      break
    case 'entity-card':
      if (typeof v.name !== 'string') errors.push(`${at}: type 'entity-card' requires name (string)`)
      break
    case 'popover':
      if (typeof v.label !== 'string' || typeof v.content !== 'string') errors.push(`${at}: type 'popover' requires label and content (strings)`)
      break
    case 'svg':
      if (typeof v.code !== 'string') errors.push(`${at}: type 'svg' requires code (string)`)
      else if (v.code.length > GENUI_LIMITS.maxCode) {
        errors.push(`${at}.code length ${v.code.length} exceeds SVG limit ${GENUI_LIMITS.maxCode}; simplify or split the SVG`)
      }
      isNum('height')
      break
    case 'mermaid':
      if (typeof v.code !== 'string') errors.push(`${at}: type 'mermaid' requires code (string)`)
      break
    case 'map':
      validateMap(v, at, errors)
      break
    case 'scene3d':
      if (!Array.isArray(v.meshes)) errors.push(`${at}: type 'scene3d' requires meshes (array)`)
      break
    case 'timeline':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'timeline' requires items (array)`)
      break
    case 'file-tree':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'file-tree' requires items (array)`)
      break
    case 'breadcrumb':
      if (!Array.isArray(v.items)) errors.push(`${at}: type 'breadcrumb' requires items (array)`)
      break
    case 'quiz':
      if (typeof v.question !== 'string') errors.push(`${at}: type 'quiz' requires question (string)`)
      if (!Array.isArray(v.options)) errors.push(`${at}: type 'quiz' requires options (array)`)
      break
    case 'blocks': {

      if (!Array.isArray(v.rows)) { errors.push(`${at}: type 'blocks' requires rows (array)`); break }
      isNum('columns')
      v.rows.forEach((entry, i) => {
        const row = obj(entry)
        if (row === undefined) { errors.push(`${at}.rows[${i}] must be an object`); return }
        if (!Array.isArray(row.cells)) { errors.push(`${at}.rows[${i}].cells must be an array`); return }
        row.cells.forEach((cell, j) => {
          if (cell === null || typeof cell === 'string') return
          const holder = obj(cell)
          if (holder === undefined) { errors.push(`${at}.rows[${i}].cells[${j}] must be a string, null, or object`); return }
          if (typeof holder.text !== 'string') errors.push(`${at}.rows[${i}].cells[${j}].text must be a string`)
          if (holder.tone !== undefined && !BLOCK_CELL_TONES.includes(holder.tone as never)) {
            errors.push(`${at}.rows[${i}].cells[${j}].tone must be one of ${BLOCK_CELL_TONES.join(', ')}`)
          }
          if (holder.color !== undefined && color(holder.color) === undefined) {
            errors.push(`${at}.rows[${i}].cells[${j}].color must be a literal colour or host token`)
          }
        })
      })
      break
    }
    case 'icon':
      if (typeof v.name !== 'string') errors.push(`${at}: type 'icon' requires name (string)`)
      isNum('size')
      break
    case 'arrow':
      break
    case 'diagram':
      if (typeof v.kind !== 'string') errors.push(`${at}: type 'diagram' requires kind (string)`)
      if (!Array.isArray(v.nodes)) errors.push(`${at}: type 'diagram' requires nodes (array)`)
      if (v.edges !== undefined && !Array.isArray(v.edges)) errors.push(`${at}: type 'diagram' requires edges (array) when present`)
      break

    case 'echart':

      if (v.option === undefined && v.data === undefined && v.series === undefined
        && (!Array.isArray(v.links) || v.links.length === 0)) {
        errors.push(`${at}: type 'echart' requires option, data, series, or links`)
      }
      isNum('height')
      break
    default:

      if (!Object.hasOwn(COMPONENT_SCHEMAS, type)) {
        const lower = type.toLowerCase()
        const hint = GENUI_NATIVE_TYPES.has(lower) ? `; use '${lower}'` : '; use a type from COMPONENT_SCHEMAS'
        errors.push(`${at}: unknown type '${type}'${hint}`)
      }
  }
  const definition = getComponentSchema(type)
  if (definition !== undefined) {
    validateRegistryFields(v, at, definition, errors)
  }
}
