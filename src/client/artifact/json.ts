import type { GenuiArtifactV1 } from './types.ts'

/** Serialize a GenUI artifact with stable indentation. */
export function serializeGenuiArtifact(artifact: GenuiArtifactV1): string {
  return JSON.stringify(artifact, null, 2)
}
