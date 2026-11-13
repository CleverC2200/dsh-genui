import css from '../GenuiBlock.module.css'
import type { SkeletonShape } from '../streaming-shape.ts'

const INLINE_SHAPES: ReadonlySet<SkeletonShape> = new Set<SkeletonShape>(['control', 'rule'])

export function GenuiSkeleton({ shape, title, columns, chartKind, lines }: {
  shape: SkeletonShape
  title?: string
  columns?: number
  chartKind?: string
  lines?: number
}) {
  return (

    <div className={css.block}>
      <div className={`${css.skeleton} ${INLINE_SHAPES.has(shape) || shape === 'generic' ? css.skeletonInline : ''}`}
        data-genui-skeleton={shape} role="status"
        aria-label={title === undefined ? '正在生成界面' : `正在生成界面：${title}`}>
        {title !== undefined ? <span className={css.skeletonHeading}>{title}</span> : null}
        <SkeletonBody
          shape={shape}
          {...(columns === undefined ? {} : { columns })}
          {...(chartKind === undefined ? {} : { chartKind })}
          {...(lines === undefined ? {} : { lines })}
        />
      </div>
    </div>
  )
}

export function SkeletonBody({ shape, columns, chartKind, lines }: {
  shape: SkeletonShape
  columns?: number
  chartKind?: string
  lines?: number
}) {
  switch (shape) {
    case 'table': {

      const count = Math.min(Math.max(columns ?? 3, 1), 8)
      const widths = Array.from({ length: count }, (_, i) => (i === 0 ? '26%' : `${Math.round(56 / count)}%`))
      return (
        <span className={css.skeletonTable}>
          <span className={css.skeletonRowHead}>
            {widths.map((width, i) => <span key={i} style={{ width }} />)}
          </span>
          {[0, 1, 2, 3].map(row => (
            <span className={css.skeletonRow} key={row}>
              {widths.map((width, i) => <span key={i} style={{ width }} />)}
            </span>
          ))}
        </span>
      )
    }
    case 'chart':

      if (chartKind === 'donut' || chartKind === 'pie') {
        return (
          <span className={css.skeletonDonut}>
            <span className={css.skeletonRing} />
            <span className={css.skeletonLegend}>
              <span style={{ width: '64%' }} /><span style={{ width: '46%' }} /><span style={{ width: '54%' }} />
            </span>
          </span>
        )
      }
      return (
        <span className={css.skeletonChart}>
          <span className={css.skeletonAxis} />
          <span className={css.skeletonBars}>
            <span style={{ height: '46%' }} /><span style={{ height: '72%' }} /><span style={{ height: '38%' }} />
            <span style={{ height: '88%' }} /><span style={{ height: '58%' }} />
          </span>
        </span>
      )
    case 'list':
    case 'keyvalue':
      return (
        <span className={css.skeletonRows}>
          {[0, 1, 2].map(i => (
            <span className={css.skeletonRow} key={i}>
              <span style={{ width: '16%' }} /><span style={{ width: `${[58, 44, 66][i]}%` }} />
            </span>
          ))}
        </span>
      )
    case 'stat':
      return (
        <span className={css.skeletonStat}>
          <span style={{ width: '38%', height: 22 }} />
          <span style={{ width: '20%', height: 8 }} />
        </span>
      )
    case 'text': {

      const count = Math.min(Math.max(lines ?? 3, 1), 6)
      const widths = ['92%', '96%', '88%', '94%', '70%', '54%']
      return (
        <span className={css.skeletonRows}>
          {Array.from({ length: count }, (_, i) => (
            <span key={i} style={{ width: widths[i]!, height: 10 }} />
          ))}
        </span>
      )
    }
    case 'diagram':
      return (
        <span className={css.skeletonDiagram}>
          <span style={{ width: '34%', height: 44 }} />
          <span className={css.skeletonLink} />
          <span style={{ width: '34%', height: 44 }} />
        </span>
      )
    case 'code':
      return (
        <span className={css.skeletonRows}>
          <span style={{ width: '64%', height: 9 }} />
          <span style={{ width: '82%', height: 9 }} />
          <span style={{ width: '48%', height: 9 }} />
        </span>
      )
    case 'media':
      return <span className={css.skeletonMedia} />
    case 'control':
      return <span className={css.skeletonControl} />
    case 'rule':
      return <span className={css.skeletonRule} />
    case 'card':
    default:

      return (
        <>
          <span className={css.skeletonRows}>
            <span style={{ width: '68%', height: 10 }} />
            <span style={{ width: '44%', height: 10 }} />
          </span>
          <span className={css.skeletonBlock} />
        </>
      )
  }
}
