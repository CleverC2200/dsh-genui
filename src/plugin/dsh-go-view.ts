import type { GenuiSpec } from '../client/spec.ts'
import { compileDshGo, fitsNativeView } from './dsh-go-compiler.ts'
import type { NativeView } from './dsh-go-types.ts'

export function toDshGoView(spec: GenuiSpec): NativeView | null {
  try {
    if (spec.panel || spec.append) return null
    const result = compileDshGo(spec,'tool')
    return result.issues.length || !fitsNativeView(result.view,'tool') ? null:result.view
  } catch { return null }
}
