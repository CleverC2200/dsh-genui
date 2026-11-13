import { validateGenuiChartSemantics } from '../client/guard.ts'

export function validateRenderableChartSemantics(value: unknown): string[] {
  return validateGenuiChartSemantics(value)
}
