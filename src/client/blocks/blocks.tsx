import { memo } from 'react'
import css from '../GenuiBlock.module.css'
import { renderInline } from '../inline.ts'
import { GENUI_LIMITS } from '../genui-runtime/index.ts'
import type { GenuiBlocks } from '../spec.ts'

export function readableOn(color: string | undefined): string {
  const fill = (color ?? '').trim()
  const hexMatch = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(fill)
  let channels: number[]
  if (hexMatch !== null) {
    let hex = hexMatch[1]!
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
    channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16))
  } else {

    if (typeof document === 'undefined') return 'var(--dsw-alias-label-primary)'
    const style = document.createElement('span').style
    style.color = fill
    const rgb = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(style.color)
    if (rgb === null || (rgb[4] !== undefined && Number(rgb[4]) !== 1)) return 'var(--dsw-alias-label-primary)'
    channels = rgb.slice(1, 4).map(Number)
  }
  const channel = (value: number): number => {
    const v = value / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(channels[0]!)
    + 0.7152 * channel(channels[1]!)
    + 0.0722 * channel(channels[2]!)

  return luminance > 0.179 ? '#0d0d0d' : '#ffffff'
}

export const BlocksNode = memo(function BlocksNode({ node }: { node: GenuiBlocks }) {
  const rows = node.rows.slice(0, GENUI_LIMITS.maxBlocksRows)

  const columns = node.columns === undefined
    ? undefined
    : Math.max(1, Math.min(GENUI_LIMITS.maxBlocksCells, Math.trunc(node.columns)))
  const caption = node.caption?.trim()
  return (
    <figure className={css.blocksFigure} data-genui-blocks>
      {node.title !== undefined && <div className={css.blocksTitle}>{renderInline(node.title)}</div>}
      <div className={css.blocksRows}>
        {rows.map((row, i) => {
          const count = columns ?? Math.max(1, Math.min(GENUI_LIMITS.maxBlocksCells, row.cells.length))
          const cells = row.cells.slice(0, count)
          const fill = row.color
          const ink = readableOn(fill)
          const variant = row.variant ?? 'fill'
          const outline = variant === 'outline'
          const plain = variant === 'plain'
          return (
            <div key={i} className={css.blocksRow}>
              {row.label !== undefined && (
                <span className={css.blocksRowLabel}>{renderInline(row.label)}</span>
              )}
              <div
                className={css.blocksCells}
                style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
              >
                {cells.map((cell, j) => {

                  if (cell === null) return <span key={j} className={css.blocksGap} aria-hidden />

                  const spec = typeof cell === 'string' ? { text: cell } : cell
                  const cellInk = spec.color !== undefined ? readableOn(spec.color) : ink

                  const paint = spec.color !== undefined
                    ? { background: spec.color, color: cellInk }
                    : spec.tone !== undefined
                      ? undefined
                      : plain || outline
                        ? undefined
                        : fill !== undefined
                          ? { background: fill, color: ink }
                          : undefined
                  return (
                    <span key={j} className={css.blocksCellWrap}>
                      <span
                        className={`${css.blocksCell} ${outline ? css.blocksCellOutline : ''}${plain ? ` ${css.blocksCellPlain}` : ''}`}
                        data-tone={spec.tone}
                        style={paint}
                      >
                        {renderInline(spec.text)}
                      </span>
                      {spec.sub !== undefined && (
                        <span className={css.blocksSub}>{renderInline(spec.sub)}</span>
                      )}
                    </span>
                  )
                })}
                {
                                                                           }
                {Array.from({ length: Math.max(0, count - cells.length) }, (_, k) => (
                  <span key={`pad-${k}`} className={css.blocksGapPad} aria-hidden />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {caption !== undefined && caption !== '' && (
        <figcaption className={css.blocksCaption}>{renderInline(caption)}</figcaption>
      )}
    </figure>
  )
})
