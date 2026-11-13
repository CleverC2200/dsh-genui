import { createElement, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { consumeUnlocks, subscribeAchievements } from './achievement-store.ts'
import { useT } from './i18n/index.ts'
import type { AchievementDef } from './achievements.ts'
import css from './GenuiBlock.module.css'

interface ToastItem {
  key: number
  ach: AchievementDef
}

let toastKey = 0

function AchievementToasts() {
  const t = useT()
  const [, force] = useSyncExternalStore(subscribeAchievements, () => '')
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef<Map<number, number>>(new Map())

  useEffect(() => {
    const queue = consumeUnlocks()
    if (queue.length === 0) return
    const next: ToastItem[] = queue.map(ach => ({ key: ++toastKey, ach }))
    setItems(prev => [...prev, ...next])
    for (const item of next) {
      const t = window.setTimeout(() => {
        setItems(prev => prev.filter(i => i.key !== item.key))
        timers.current.delete(item.key)
      }, 3600)
      timers.current.set(item.key, t)
    }
  }, [force])

  useEffect(() => () => {
    for (const t of timers.current.values()) window.clearTimeout(t)
  }, [])

  if (items.length === 0) return null
  return createElement('div', { className: css.achToasts, 'data-genui-achievement-toasts': true },
    items.map(item => createElement('div', { key: item.key, className: css.achToast },
      createElement('span', { className: css.achToastBadge, 'aria-hidden': true }, '🏆'),
      createElement('div', { className: css.achToastBody },
        createElement('div', { className: css.achToastName }, t('ach.toast.unlocked', { name: item.ach.name })),
        createElement('div', { className: css.achToastDesc }, item.ach.description),
      ),
    )),
  )
}

export function mountAchievementToasts(): () => void {
  if (typeof document === 'undefined') return () => {}
  const host = document.createElement('div')
  host.dataset.dshGenuiAchievements = '1'
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(createElement(AchievementToasts))
  return () => {
    root.unmount()
    host.remove()
  }
}
