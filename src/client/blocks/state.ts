import type { GenuiSpec } from '../spec.ts'
import type { BlockInteractionState } from '../interaction-store.ts'
import type { SubmissionRegistry } from '../submission-registry.ts'

export interface GenuiBlockProps {

  spec: GenuiSpec

  onAction?: ((action: string, payload: Record<string, unknown>) => void) | undefined

  stateKey?: string | undefined

  animateEntrance?: boolean | undefined

  initialState?: BlockInteractionState | undefined
  onStateChange?: ((state: BlockInteractionState) => void) | undefined

  onStateSnapshot?: ((state: BlockInteractionState) => void) | undefined
}

export interface AnswersState {
  answers: Record<string, string>

  multiAnswers: Record<string, string[]>

  fields: Record<string, string>

  secretFields: ReadonlySet<string>

  invalidNumericFields: ReadonlySet<string>

  hidden: ReadonlySet<string>

  conditionHidden?: ReadonlySet<string>
  registry: SubmissionRegistry

  locked: boolean

  round: number
  setAnswer: (group: string, choice: string) => void
  setMultiAnswer: (group: string, choice: string, checked: boolean) => void
  setField: (id: string, value: string) => void
  clear: () => void
  setLocked: (locked: boolean) => void
}
