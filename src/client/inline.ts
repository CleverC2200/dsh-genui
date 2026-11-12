import { createElement, useLayoutEffect, useRef, type ReactNode } from 'react'
import katex from 'katex'
import css from './GenuiBlock.module.css'
import { classifyLinkTarget } from './file-link.ts'
import { FileLink } from './file-link-context.tsx'

function InlineMath({ source, display }: { source: string; display: boolean }) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    if (ref.current === null) return
    katex.render(source, ref.current, {
      displayMode: display, throwOnError: false, trust: false,
      maxExpand: 1000, maxSize: 20, output: 'htmlAndMathml',
    })
  }, [source, display])
  return createElement('span', { ref, className: css.inlineMath })
}

const INLINE = /(?<!`)`[^`\n]+`(?!`)|\\\\|\\\$|(?<![\\$])\$\$(?:\\.|[^\\])*?\$\$|\\\[(?:\\(?!\])[^]|[^\\])*?\\\]|\\\((?:\\(?!\))[^]|[^\\])*?\\\)|(?<![\\$])\$(?!\s|\$)(?:\\.|[^$\\\n])+(?<!\s)\$(?!\d|\$)|\*\*[\s\S]+?\*\*|==[\s\S]+?==|\[[^\]\n]+\]\([^)\s]+\)|\r?\n/g
const FENCE_MARKER = /`{3,}|~{3,}/g

export function hasInlineMarkup(text: string): boolean {
  return typeof text === 'string' && /[`*=$\\\n\r]|\[/.test(text)
}

export function renderInline(text: string, allowLinks: boolean | 'file' = true, depth = 0): ReactNode {
  if (typeof text !== 'string' || text === '' || !hasInlineMarkup(text) || depth >= 8) return text
  const segments: ReactNode[] = []
  let fenceEnd = 0
  for (const opening of text.matchAll(FENCE_MARKER)) {
    const openingStart = opening.index ?? 0
    if (openingStart < fenceEnd) continue
    const marker = opening[0]
    const contentStart = openingStart + marker.length
    let closingEnd: number | undefined
    for (const candidate of text.slice(contentStart).matchAll(FENCE_MARKER)) {
      if (candidate[0][0] === marker[0] && candidate[0].length >= marker.length) {
        closingEnd = contentStart + (candidate.index ?? 0) + candidate[0].length
        break
      }
    }
    if (openingStart > fenceEnd) segments.push(renderInline(text.slice(fenceEnd, openingStart), allowLinks, depth))

    fenceEnd = closingEnd ?? text.length
    segments.push(text.slice(openingStart, fenceEnd))
    if (closingEnd === undefined) break
  }
  if (segments.length > 0) {
    if (fenceEnd < text.length) segments.push(renderInline(text.slice(fenceEnd), allowLinks, depth))
    return segments
  }
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    const token = match[0]
    if (index > last) out.push(text.slice(last, index))
    if (token === '\n' || token === '\r\n') {

      out.push('\n')
    } else if (token.startsWith('`')) {
      out.push(createElement('code', { key: key++, className: css.inlineCode }, token.slice(1, -1)))
    } else if (token === '\\$' || token === '\\\\') {

      out.push(token.slice(1))
    } else if (token.startsWith('$') || token.startsWith('\\(') || token.startsWith('\\[')) {
      const display = token.startsWith('$$') || token.startsWith('\\[')
      const width = token.startsWith('$') && !display ? 1 : 2
      out.push(createElement(InlineMath, { key: key++, source: token.slice(width, -width), display }))
    } else if (token.startsWith('**') || token.startsWith('==')) {
      const bold = token.startsWith('**')
      out.push(createElement(bold ? 'strong' : 'mark', {
        key: key++, className: bold ? css.inlineStrong : css.inlineMark,
      }, renderInline(token.slice(2, -2), allowLinks, depth + 1)))
    } else {
      const parts = /^\[([^\]\n]+)\]\(([^)\s]+)\)$/.exec(token)
      if (parts === null) {
        out.push(token)
      } else {
        const target = classifyLinkTarget(parts[2])
        const label = renderInline(parts[1]!, false, depth + 1)
        if (target.type === 'external' && allowLinks === true) {
          out.push(createElement('a', {
            key: key++, className: css.inlineLink, href: target.href, target: '_blank', rel: 'noreferrer noopener',
          }, label))
        } else if (target.type === 'file' && allowLinks !== false) {
          out.push(createElement(FileLink, {
            key: key++, path: target.file.path, label: parts[1]!,
            ...(target.file.line === undefined ? {} : { line: target.file.line }),
          }, label))
        } else {
          out.push(label)
        }
      }
    }
    last = index + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length === 0 ? text : out
}
