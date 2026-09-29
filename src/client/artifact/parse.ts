import { processGenuiSpec } from '../guard.ts'
import type { BlockInteractionState } from '../interaction-store.ts'
import { GENUI_ARTIFACT_FORMAT, GENUI_ARTIFACT_VERSION, type GenuiArtifactTheme, type GenuiArtifactV1 } from './types.ts'
import { createGenuiArtifact } from './create.ts'

/** Check whether a value is a plain record object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate the field types of an artifact's persisted interaction state. */
function validState(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (value.answers !== undefined && (!isRecord(value.answers) || !Object.values(value.answers).every(item => typeof item === 'string'))) return false
  if (value.multiAnswers !== undefined && (!isRecord(value.multiAnswers) || !Object.values(value.multiAnswers).every(item => Array.isArray(item) && item.every(entry => typeof entry === 'string')))) return false
  if (value.locked !== undefined && typeof value.locked !== 'boolean') return false
  return value.fields === undefined || (isRecord(value.fields) && Object.values(value.fields).every(item => typeof item === 'string'))
}

/** Validate the artifact format and re-run the current GenUI normalization pipeline. */
export function parseGenuiArtifact(value: unknown): GenuiArtifactV1 | null {
  if (!isRecord(value) || value.format !== GENUI_ARTIFACT_FORMAT || value.version !== GENUI_ARTIFACT_VERSION || !isRecord(value.presentation)) return null
  if (value.presentation.locale !== 'en') return null
  if (value.presentation.theme !== 'light' && value.presentation.theme !== 'dark') return null
  if (value.state !== undefined && !validState(value.state)) return null
  const processed = processGenuiSpec(value.spec)
  if (processed.spec === null || processed.errors.length > 0) return null
  return createGenuiArtifact(processed.spec, value.state as BlockInteractionState | undefined, {
    locale: value.presentation.locale,
    theme: value.presentation.theme as GenuiArtifactTheme,
  })
}
