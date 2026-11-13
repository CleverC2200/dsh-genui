import type { DiffBlockLabels, JsonTreeLabels } from './primitive-adapter.ts'
import { t } from './i18n/index.ts'

export function diffBlockLabels(): DiffBlockLabels {
  const labels = {
    copy: t('label.copy'),
    copied: t('label.copied'),
    codeLabel: t('label.code'),
    wrapLabel: t('label.wrap'),
    unwrapLabel: t('label.unwrap'),
    collapseAria: t('label.collapseDiff.aria'),

    expandAria(hidden: number) { return t('label.expandDiff.aria', { hidden }) },
    collapse: t('label.collapse'),

    expand(hidden: number) { return t('label.expandDiff', { hidden }) },

    files(count: number) { return t('label.diffFiles', { count }) },
  }
  return labels
}

export function codeBlockLabels(): { copyLabel: string, copiedLabel: string } {
  return {
    copyLabel: t('label.copy'),
    copiedLabel: t('label.copied'),
  }
}

export function jsonTreeLabels(): JsonTreeLabels {
  return {
    copyValue: t('label.copyValue'),
    copyJson: t('label.copyJson'),
    copyPath: t('label.copyPath'),
    copyPrettyJson: t('label.copyPrettyJson'),
    copyCompactJson: t('label.copyCompactJson'),
    copied: t('label.copiedDone'),
    copyFailed: t('label.copyFailed'),
    collapseNode: t('label.collapseNode'),
    expandNode: t('label.expandNode'),

    copyButtonTitle(action) { return t('label.copyButtonTitle', { action }) },
  }
}
