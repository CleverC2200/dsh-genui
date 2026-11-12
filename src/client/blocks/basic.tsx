import { renderInline } from '../inline.ts'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import css from '../GenuiBlock.module.css'
import { useT } from '../i18n/index.ts'
import type { GenuiAudio, GenuiVideo } from '../spec.ts'

const AVATAR_COLORS = [
  'var(--dsw-static-deepseek-400)',
  'var(--dsw-static-deepseek-450)',
  'var(--dsw-static-blue-450)',
  'var(--dsw-static-green-400)',
  'var(--dsw-static-amber-400)',
  'var(--dsw-static-red-400)',
  'var(--dsw-static-deepseek-300)',
  'var(--dsw-static-neutral-bluish-400)',
]

export function avatarColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0

  return AVATAR_COLORS[h % AVATAR_COLORS.length]!
}

export function ClickFeedbackButton({ className, disabled, onClick, children }: {
  className: string
  disabled?: boolean
  onClick?: (() => void) | undefined
  children: ReactNode
}) {
  const t = useT()
  const [sent, setSent] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={onClick === undefined ? undefined : () => {
          onClick()
          if (timer.current !== null) clearTimeout(timer.current)
          setSent(true)
          timer.current = setTimeout(() => setSent(false), 1400)
        }}
      >
        {children}
        {sent && <span className={css.btnSent} aria-hidden>{t('block.triggered')}</span>}
      </button>
      {
                                                                   }
      <span className={css.visuallyHidden} role="status">{sent ? t('block.triggeredPlain') : ''}</span>
    </>
  )
}

export const AudioNode = memo(function AudioNode({ node }: { node: GenuiAudio }): ReactNode {
  const t = useT()
  const [failed, setFailed] = useState(false)
  return (
    <figure className={css.media}>
      {node.alt !== undefined && <figcaption className={css.mediaLabel}>{renderInline(node.alt)}</figcaption>}
      {failed
        ? <div className={css.mediaError} role="alert">{t('block.audioError')}</div>
        : <audio
            className={css.mediaPlayer}
            src={node.src}
            aria-label={node.alt ?? t('block.audio')}
            controls
            preload="metadata"
            loop={node.loop === true}
            onError={() => setFailed(true)}
          />}
    </figure>
  )
})

export const VideoNode = memo(function VideoNode({ node }: { node: GenuiVideo }): ReactNode {
  const t = useT()
  const [failed, setFailed] = useState(false)
  return (
    <figure className={css.media}>
      {node.alt !== undefined && <figcaption className={css.mediaLabel}>{renderInline(node.alt)}</figcaption>}
      {failed
        ? <div className={css.mediaError} role="alert">{t('block.videoError')}</div>
        : <video
            className={`${css.mediaPlayer} ${css.videoPlayer}`}
            src={node.src}
            poster={node.poster}
            aria-label={node.alt ?? t('block.video')}
            controls
            preload="metadata"
            playsInline
            loop={node.loop === true}
            muted={node.muted === true}
            style={node.aspectRatio === undefined ? undefined : { aspectRatio: node.aspectRatio.replace(':', ' / ') }}
            onError={() => setFailed(true)}
          />}
    </figure>
  )
})
