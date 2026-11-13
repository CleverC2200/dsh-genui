import { useMemo, useState } from 'react'
import type { GenuiSvg } from '../spec.ts'
import { renderInline } from '../inline.ts'
import { t } from '../i18n/index.ts'
import { GENUI_LIMITS } from '../genui-runtime/limits.ts'
import css from '../GenuiBlock.module.css'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

function parseSvgRoot(code: string): Element | null {
  const doc = new DOMParser().parseFromString(code, 'image/svg+xml')
  const root = doc.documentElement
  if (doc.doctype !== null || doc.querySelector('parsererror') !== null || root.localName !== 'svg') return null
  return root
}

function imageSource(code: string): string | null {
  try {
    const root = parseSvgRoot(code)
    if (root === null) return null
    if (root.namespaceURI !== SVG_NAMESPACE) {

      if (root.namespaceURI !== null) return null

      const patched = code.replace(/<svg(?=[\s/>])/, `<svg xmlns="${SVG_NAMESPACE}"`)
      const reparsed = parseSvgRoot(patched)
      if (reparsed === null || reparsed.namespaceURI !== SVG_NAMESPACE) return null
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(patched)}`
    }
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(code)}`
  } catch {
    return null
  }
}

export function SvgNode({ node }: { node: GenuiSvg }) {
  const oversized = node.code.length > GENUI_LIMITS.maxCode
  const src = useMemo(() => oversized ? null : imageSource(node.code), [node.code, oversized])
  const [failedSource, setFailedSource] = useState<string | null>(null)
  return (
    <div data-genui-svg>
      {node.title !== undefined && <div className={css.echartTitle}>{renderInline(node.title)}</div>}
      {src === null || failedSource === src ? (
        <div>
          <div role="status">{oversized
            ? t('block.svgTooLong', { actual: node.code.length, max: GENUI_LIMITS.maxCode })
            : t('block.svgError')}</div>
          {!oversized && <pre style={{ overflow: 'auto', maxHeight: 400 }}><code>{node.code}</code></pre>}
        </div>
      ) : (

        <img
          key={src}
          src={src}
          alt={node.title ?? t('block.svgLabel')}
          style={{ display: 'block', width: '100%', height: node.height ?? 'auto', maxHeight: 800, objectFit: 'contain' }}
          onError={() => { setFailedSource(src) }}
        />
      )}
    </div>
  )
}
