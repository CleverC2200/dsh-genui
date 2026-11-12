const GENUI_LABEL_PATTERN = /^dsh-ui$/
const GENUI_TRAILING_PUNCTUATION = /[>`"'.,;:)\]】」』]+$/

export function normalizeFenceLanguage(lang: string): string {
  const trimmed = lang.trim()
  if (GENUI_LABEL_PATTERN.test(trimmed.toLowerCase())) return 'dsh-ui'
  const stripped = trimmed.replace(GENUI_TRAILING_PUNCTUATION, '').trim().toLowerCase()
  if (GENUI_LABEL_PATTERN.test(stripped)) return 'dsh-ui'
  return lang
}

export function isGenuiFenceLanguage(lang: string | null | undefined): boolean {
  return typeof lang === 'string' && normalizeFenceLanguage(lang) === 'dsh-ui'
}
