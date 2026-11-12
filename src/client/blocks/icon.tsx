import { createElement, memo, useEffect, useState, type ReactNode } from 'react'
import css from '../GenuiBlock.module.css'
import type { GenuiIcon } from '../spec.ts'
import type { BundledIcon, IconShape } from '../icons/icon-data.ts'
import { ensureIcons, isKnownIcon, onIconsLoaded, resolveIcon } from '../icons/icon-lazy.ts'

function renderShape(shape: IconShape, index: number): ReactNode {
  return createElement(shape.tag, { ...shape.attrs, key: index })
}

const SIZES = [16, 20, 24, 32] as const

function clampSize(size: number | undefined): number {
  if (size === undefined) return 20
  return SIZES.reduce((best, s) => (Math.abs(s - size) < Math.abs(best - size) ? s : best), 20)
}

function useIcon(name: string): BundledIcon | undefined {
  const [glyph, setGlyph] = useState<BundledIcon | undefined>(() => resolveIcon(name))

  useEffect(() => {
    const immediate = resolveIcon(name)
    if (immediate !== undefined) {
      setGlyph(immediate)
      return
    }

    if (!isKnownIcon(name)) {
      setGlyph(undefined)
      return
    }
    let live = true
    const unsubscribe = onIconsLoaded(() => {
      if (live) setGlyph(resolveIcon(name))
    })
    void ensureIcons().then(() => {
      if (live) setGlyph(resolveIcon(name))
    })
    return () => { live = false; unsubscribe() }
  }, [name])

  return glyph
}

export const IconNode = memo(function IconNode({ node }: { node: GenuiIcon }) {
  const icon = useIcon(node.name)
  const size = clampSize(node.size)
  const tone = node.tone ?? 'default'
  const tile = node.tile === true

  const labelled = typeof node.label === 'string' && node.label.trim() !== ''
  return (
    <span
      className={css.iconNode}
      data-tone={tone}
      data-tile={tile ? 'true' : 'false'}

      style={tile ? { width: size + 14, height: size + 14 } : undefined}
      {...(labelled
        ? { role: 'img', 'aria-label': node.label }
        : { 'aria-hidden': true })}
    >
      {icon === undefined
        ? <span className={css.iconDot} style={{ width: size * 0.4, height: size * 0.4 }} />
        : (
          <svg {...icon.attrs} viewBox={icon.viewBox} width={size} height={size} focusable="false">
            {icon.shapes.map((shape, i) => renderShape(shape, i))}
          </svg>
        )}
    </span>
  )
})
