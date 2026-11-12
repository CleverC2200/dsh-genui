import { getComponentSchema } from './schema.ts'
import type { ComponentRecordSchema } from './schema.ts'
import { isComponentRoot } from '../spec.ts'
import type { GenuiDiagnostic } from './diagnostics.ts'
import { isTableDetailReachable } from '../table-details.ts'
import { GENUI_LIMITS } from './limits.ts'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nodeTypeOf(value: unknown): string | undefined {
  const candidate = record(value)
  if (candidate === undefined) return undefined
  if (typeof candidate.type === 'string') return candidate.type
  if ('type' in candidate) return undefined
  const matches: string[] = []
  if (Array.isArray(candidate.columns) && Array.isArray(candidate.rows)) matches.push('table')
  if (Array.isArray(candidate.pairs)) matches.push('keyvalue')
  if (Array.isArray(candidate.steps)) matches.push('steps')
  if (Array.isArray(candidate.diffs)) matches.push('diff')
  if (Array.isArray(candidate.meshes)) matches.push('scene3d')
  if (Array.isArray(candidate.tabs)) matches.push('tabs')
  return matches.length === 1 ? matches[0] : undefined
}

function isNode(value: unknown): value is Record<string, unknown> {
  return nodeTypeOf(value) !== undefined
}

const STAT_METRIC_FIELDS = ['label', 'value', 'delta', 'spark', 'size'] as const
const LIST_ITEM_ALIASES = { label: 'title', name: 'title', description: 'desc', content: 'desc', text: 'desc', body: 'desc', detail: 'desc' } as const

function statMetricsOf(
  entries: readonly unknown[],
  path: string,
  normalizeChild: (child: unknown, childPath: string) => unknown,
): unknown[] | null {
  if (entries.length === 0) return null
  const metrics: unknown[] = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const metric = record(entry)
    if (metric === undefined) return null

    if (isNode(entry)) {
      metrics.push(normalizeChild(entry, `${path}.items[${index}]`))
      continue
    }
    if (typeof metric.label !== 'string' && typeof metric.value !== 'string') return null
    const stat: Record<string, unknown> = { type: 'stat' }
    for (const field of STAT_METRIC_FIELDS) {
      if (metric[field] !== undefined) stat[field] = metric[field]
    }
    metrics.push(stat)
  }
  return metrics
}

function normalizeAliasFields(value: Record<string, unknown>, path: string, type: string, warnings: GenuiDiagnostic[]): Record<string, unknown> {
  const definition = getComponentSchema(type)
  if (definition === undefined) return value
  const out: Record<string, unknown> = { ...value }
  for (const [alias, canonical] of Object.entries(definition.aliases)) {
    if (!(alias in out)) continue
    const aliasPath = `${path}.${alias}`
    const keptCanonical = canonical in out
    if (!keptCanonical) out[canonical] = out[alias]
    delete out[alias]
    warnings.push({
      kind: 'alias',
      path: aliasPath,
      message: keptCanonical
        ? `${aliasPath} is ignored because canonical field '${canonical}' is present`
        : `${aliasPath} normalized/adopted as '${canonical}'`,
      type,
      field: alias,
      canonical,
    })
  }
  for (const [field, values] of Object.entries(definition.valueAliases)) {
    const written = out[field]
    if (typeof written !== 'string') continue
    const canonical = Object.hasOwn(values, written) ? values[written] : undefined
    if (canonical === undefined || canonical === written) continue
    out[field] = canonical
    warnings.push({
      kind: 'alias',
      path: `${path}.${field}`,
      message: `${path}.${field} '${written}' normalized to '${canonical}'`,
      type,
      field,
      canonical,
    })
  }
  return out
}

function normalizeRecordTree(
  value: unknown,
  definition: ComponentRecordSchema,
  at: string,
  type: string,
  warnings: GenuiDiagnostic[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeRecordTree(entry, definition, `${at}[${index}]`, type, warnings))
  }
  const holder = record(value)
  if (holder === undefined) return value
  const out = { ...holder }
  for (const [alias, canonical] of Object.entries(definition.aliases)) {
    if (!(alias in out)) continue
    const keptCanonical = canonical in out
    if (!keptCanonical) out[canonical] = out[alias]
    delete out[alias]
    warnings.push({
      kind: 'alias',
      path: `${at}.${alias}`,
      message: keptCanonical
        ? `${at}.${alias} is ignored because canonical field '${canonical}' is present`
        : `${at}.${alias} normalized/adopted as '${canonical}'`,
      type,
      field: alias,
      canonical,
    })
  }
  for (const [field, nested] of Object.entries(definition.nested)) {
    if (out[field] !== undefined) out[field] = normalizeRecordTree(out[field], nested, `${at}.${field}`, type, warnings)
  }
  return out
}

function defaultFileTreeDirectories(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(defaultFileTreeDirectories)
  const holder = record(value)
  if (holder === undefined) return value
  const out = { ...holder }
  if (out.type === undefined && Array.isArray(out.children)) out.type = 'dir'
  if (out.children !== undefined) out.children = defaultFileTreeDirectories(out.children)
  return out
}

function normalizeNode(value: unknown, path: string, warnings: GenuiDiagnostic[]): unknown {
  const type = nodeTypeOf(value)
  const candidate = record(value)
  if (type === undefined || candidate === undefined) return value
  const node = typeof candidate.type === 'string' ? candidate : { ...candidate, type }
  const definition = getComponentSchema(type)

  if (definition === undefined) return node
  const out = normalizeAliasFields(node, path, type, warnings)

  for (const [field, nested] of Object.entries(definition.nested)) {
    if (out[field] === undefined) continue
    const nestedValue = out[field]
    const cap = type === 'image-group' && field === 'items' ? GENUI_LIMITS.maxImageGroupItems
      : type === 'entity-card' && field === 'metadata' ? GENUI_LIMITS.maxEntityMetadata
      : type === 'entity-card' && field === 'actions' ? GENUI_LIMITS.maxEntityActions
      : type === 'map' && field === 'locations' ? GENUI_LIMITS.maxMapLocations
      : type === 'map' && field === 'routes' ? GENUI_LIMITS.maxMapRoutes : undefined
    if (cap !== undefined && Array.isArray(nestedValue)) {
      out[field] = [
        ...normalizeRecordTree(nestedValue.slice(0, cap), nested, `${path}.${field}`, type, warnings) as unknown[],
        ...nestedValue.slice(cap),
      ]
    } else {
      out[field] = normalizeRecordTree(nestedValue, nested, `${path}.${field}`, type, warnings)
    }
  }
  const normalizeNodeValue = (child: unknown, childPath: string): unknown => normalizeNode(child, childPath, warnings)
  const normalizeNodeArray = (children: unknown, childPath: string): unknown => Array.isArray(children)
    ? children.map((child, index) => normalizeNodeValue(child, `${childPath}[${index}]`))
    : children

  if (type === 'file-tree' && out.items !== undefined) {
    out.items = defaultFileTreeDirectories(out.items)
  }

  if (type === 'stat' && Array.isArray(out.items) && out.label === undefined && out.value === undefined) {

    const metrics = statMetricsOf(out.items, path, normalizeNodeValue)
    if (metrics !== null) {
      warnings.push({
        kind: 'alias',
        path: `${path}.items`,
        message: `${path}.items normalized into a row of 'stat' nodes`,
        type,
        field: 'items',
        canonical: 'row',
      })
      return { type: 'row', items: metrics, ...(out.span !== undefined ? { span: out.span } : {}) }
    }
  }

  if (type === 'row' || type === 'col' || type === 'grid' || type === 'card' || type === 'carousel' || type === 'file-tree' || type === 'timeline' || type === 'breadcrumb') {
    if (type !== 'file-tree' && type !== 'timeline' && type !== 'breadcrumb') {
      if (type === 'carousel' && Array.isArray(out.items)) {
        const rendered = out.items.slice(0, GENUI_LIMITS.maxCarouselItems)
        out.items = [
          ...normalizeNodeArray(rendered, `${path}.items`) as unknown[],
          ...out.items.slice(GENUI_LIMITS.maxCarouselItems),
        ]
      } else {
        out.items = normalizeNodeArray(out.items, `${path}.items`)
      }
    }
  } else if (type === 'list' && Array.isArray(out.items)) {

    out.items = out.items.map((child, index) => {
      if (isNode(child)) return normalizeNodeValue(child, `${path}.items[${index}]`)
      if (Array.isArray(child) && child.length === 1 && typeof child[0] === 'string') return child[0]
      const holder = record(child)
      if (holder === undefined) return child
      const normalizedHolder = { ...holder }
      const itemPath = `${path}.items[${index}]`
      for (const [alias, canonical] of Object.entries(LIST_ITEM_ALIASES)) {
        if (!(alias in normalizedHolder)) continue
        const keptCanonical = canonical in normalizedHolder
        if (!keptCanonical) normalizedHolder[canonical] = normalizedHolder[alias]
        delete normalizedHolder[alias]
        warnings.push({
          kind: 'alias', path: `${itemPath}.${alias}`, type, field: alias, canonical,
          message: keptCanonical
            ? `${itemPath}.${alias} is ignored because canonical field '${canonical}' is present`
            : `${itemPath}.${alias} normalized/adopted as '${canonical}'`,
        })
      }
      if (!('title' in normalizedHolder) && typeof normalizedHolder.desc === 'string') {
        normalizedHolder.title = normalizedHolder.desc
        delete normalizedHolder.desc
        warnings.push({ kind: 'alias', path: `${itemPath}.desc`, type, field: 'desc', canonical: 'title', message: `${itemPath}.desc normalized/adopted as 'title'` })
      }
      return normalizedHolder
    })
  } else if (type === 'keyvalue' && Array.isArray(out.pairs)) {

    if (out.pairs.length > 0 && out.pairs.every(pair => Array.isArray(pair))) {
      out.pairs = out.pairs.map(pair => {
        const cells = pair as unknown[]
        return { key: cells[0], value: cells.length > 1 ? cells[1] : '' }
      })
    }
  } else if (type === 'tabs' && Array.isArray(out.tabs)) {
    out.tabs = out.tabs.map((tab, index) => {
      const holder = record(tab)
      if (holder === undefined) return tab
      const normalizedHolder = { ...holder }
      if ('content' in normalizedHolder) {
        const tabPath = `${path}.tabs[${index}].content`
        const hasItems = 'items' in normalizedHolder
        if (!hasItems) normalizedHolder.items = normalizedHolder.content
        delete normalizedHolder.content
        warnings.push({
          kind: 'alias',
          path: tabPath,
          message: hasItems
            ? `${tabPath} is ignored because canonical field 'items' is present`
            : `${tabPath} normalized/adopted as 'items'`,
          type,
          field: 'content',
          canonical: 'items',
        })
      }
      if (normalizedHolder.items !== undefined) {
        normalizedHolder.items = Array.isArray(normalizedHolder.items)
          ? normalizedHolder.items.map((child, childIndex) => normalizeNodeValue(child, `${path}.tabs[${index}].items[${childIndex}]`))
          : [normalizeNodeValue(normalizedHolder.items, `${path}.tabs[${index}].items[0]`)]
      }
      return normalizedHolder
    })
  } else if (type === 'accordion' && Array.isArray(out.items)) {
    out.items = out.items.map((item, index) => {
      const holder = record(item)
      if (holder === undefined) return item
      return { ...holder, items: Array.isArray(holder.items) ? holder.items.map((child, childIndex) => normalizeNodeValue(child, `${path}.items[${index}].items[${childIndex}]`)) : holder.items }
    })
  } else if (type === 'table' && Array.isArray(out.details)) {
    const table = { columns: out.columns, rows: out.rows, types: out.types }
    out.details = out.details.map((detail, rowIndex) => {
      if (!Array.isArray(detail) || !isTableDetailReachable(table, rowIndex)) return detail
      return detail.map((child, childIndex) => normalizeNodeValue(child, `${path}.details[${rowIndex}][${childIndex}]`))
    })
  }
  return out
}

export function normalizeGenuiSpec(value: unknown): { value: unknown; warnings: GenuiDiagnostic[] } {
  const warnings: GenuiDiagnostic[] = []
  if (typeof value === 'string') {

    try {
      const decoded: unknown = JSON.parse(value)
      if (record(decoded) !== undefined || Array.isArray(decoded)) {
        value = decoded
        warnings.push({
          kind: 'alias',
          path: 'spec',
          message: 'double-encoded JSON string unwrapped into a spec value',
        })
      }
    } catch {

    }
  }
  if (Array.isArray(value) && value.length > 0) {

    value = { items: value }
    warnings.push({
      kind: 'alias',
      path: 'items',
      message: 'root array normalized into an items envelope',
    })
  }
  const root = record(value)
  if (root === undefined) return { value, warnings }
  const out = { ...root }

  if (isComponentRoot(out)) {
    return { value: normalizeNode(out, 'spec', warnings), warnings }
  }
  if (Array.isArray(out.items)) {
    out.items = out.items.map((item, index) => normalizeNode(item, `items[${index}]`, warnings))
  }
  return { value: out, warnings }
}
