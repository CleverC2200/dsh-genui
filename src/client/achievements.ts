import type { GenuiSpec, GenuiNode } from './spec.ts'
import { t } from './i18n/index.ts'

export interface AchieveState {

  fences: number

  panels: number

  interactions: number

  templates: number

  charts: number

  advanced: number
}

export function emptyState(): AchieveState {
  return { fences: 0, panels: 0, interactions: 0, templates: 0, charts: 0, advanced: 0 }
}

export interface AchievementDef {
  id: string

  readonly name: string

  readonly description: string

  hidden?: boolean

  rarity: 'common' | 'rare' | 'legendary'
  check: (s: AchieveState) => boolean
}

const fences = (n: number) => (s: AchieveState): boolean => s.fences >= n

export function achievementName(id: string): string {
  return t(`ach.${id}.name`)
}

export function achievementDesc(id: string): string {
  return t(`ach.${id}.desc`)
}

export function rarityLabel(rarity: AchievementDef['rarity']): string {
  return t(`ach.rarity.${rarity}`)
}

function def(
  id: string,
  rarity: AchievementDef['rarity'],
  check: (s: AchieveState) => boolean,
  hidden = false,
): AchievementDef {
  return {
    id,
    rarity,
    check,
    ...(hidden ? { hidden: true } : {}),
    get name() { return achievementName(id) },
    get description() { return achievementDesc(id) },
  }
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  def('first-fence', 'common', fences(1)),
  def('fence-5', 'common', fences(5)),
  def('fence-25', 'rare', fences(25)),
  def('fence-50', 'legendary', fences(50), true),
  def('first-interaction', 'common', s => s.interactions >= 1),
  def('interaction-10', 'rare', s => s.interactions >= 10),
  def('first-panel', 'common', s => s.panels >= 1),
  def('panel-5', 'rare', s => s.panels >= 5),
  def('first-chart', 'common', s => s.charts >= 1),
  def('chart-10', 'rare', s => s.charts >= 10),
  def('first-advanced', 'rare', s => s.advanced >= 1),
  def('template-1', 'common', s => s.templates >= 1),
]

export function countSpecKinds(spec: GenuiSpec): { charts: number, advanced: number } {
  let charts = 0
  let advanced = 0
  const walk = (list: unknown): void => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (typeof item !== 'object' || item === null) continue
      const v = item as Record<string, unknown>
      const type = v.type
      if (type === 'chart' || type === 'plot' || type === 'echart') charts += 1
      if (type === 'scene3d' || type === 'mermaid' || type === 'diagram') advanced += 1

      if (Array.isArray(v.items)) walk(v.items as unknown[])
      if (Array.isArray((v as { tabs?: unknown }).tabs)) {
        for (const tab of (v as { tabs: Array<{ items?: unknown }> }).tabs) walk(tab.items)
      }
    }
  }
  walk(spec.items)
  return { charts, advanced }
}

export function buildAchievementsSpec(state: AchieveState, unlocked: Record<string, number>): GenuiSpec {
  const total = ACHIEVEMENTS.length
  const unlockedCount = ACHIEVEMENTS.filter(a => unlocked[a.id] !== undefined).length
  const items: GenuiNode[] = [
    { type: 'grid', cols: 3, items: [
      { type: 'stat', label: t('ach.stat.unlocked'), value: `${unlockedCount} / ${total}` },
      { type: 'stat', label: t('ach.stat.rendered'), value: String(state.fences) },
      { type: 'stat', label: t('ach.stat.interactions'), value: String(state.interactions) },
    ] },
    { type: 'progress', label: t('ach.progress'), value: Math.round(unlockedCount / total * 100), valueLabel: `${Math.round(unlockedCount / total * 100)}%` },
    { type: 'list', items: ACHIEVEMENTS.map(a => {
      const locked = a.hidden === true && unlocked[a.id] === undefined
      return {
        type: 'row',
        items: [
          { type: 'badge', label: rarityLabel(a.rarity), tone: unlocked[a.id] !== undefined ? 'success' : 'warn' },
          { type: 'text', size: 'body', content: locked ? t('ach.hidden.name') : a.name },
          { type: 'text', size: 'muted', content: locked ? t('ach.hidden.desc') : a.description },
        ],
      }
    }) },
  ]
  return { title: t('ach.page.title'), items }
}

export function checkAchievements(state: AchieveState, unlocked: Record<string, number>): AchievementDef[] {
  return ACHIEVEMENTS.filter(a => unlocked[a.id] === undefined && a.check(state))
}
