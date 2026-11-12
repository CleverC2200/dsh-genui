import type { GenuiArtifactV1 } from './types.ts'

export function serializeGenuiArtifact(artifact: GenuiArtifactV1): string {
  return JSON.stringify(artifact, null, 2)
}
