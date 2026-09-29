/**
 * Resolve dsh-ui fence bodies through the pipeline shared by the browser renderer and the
 * Node-side final-reply feedback guard.
 * @module @changfenhuang/dsh-genui/shared/fence-resolve
 */

import { partialRepairGenuiSpec, processGenuiSpec, type GenuiProcessResult } from '../client/guard.ts'
import { parsePartialGenuiSpec } from '../client/parse-partial.ts'
import type { GenuiSpec } from '../client/spec.ts'
import { completeFenceJson, repairFenceJson } from './fence-repair.ts'

/** Options controlling whether structured JSON repair may be applied. */
export interface FenceResolveOptions {
  /** Settled replies may use tier-2 completion repair. */
  readonly settled: boolean
}

/** Result of running one candidate fence body through the spec guard. */
export interface FenceResolution {
  /** Parsed value used for this spec processing pass; null when nothing could be parsed. */
  readonly value: unknown | null
  /** Diagnostics emitted by the spec guard; null when nothing could be parsed. */
  readonly processed: GenuiProcessResult | null
  /** Renderable spec; null when it cannot render. */
  readonly spec: GenuiSpec | null
}

/**
 * Run the spec guard and bad-node cleanup on an already parsed value.
 *
 * @param value - Parsed or partially parsed fence value.
 * @returns Spec processing result for the current candidate body.
 */
function resolveParsedFence(value: unknown): FenceResolution {
  const processed = processGenuiSpec(value)
  return { value, processed, spec: partialRepairGenuiSpec(processed) }
}

/** Return the fence resolution for a body that has nothing parsable. */
function unresolvedFence(): FenceResolution {
  return { value: null, processed: null, spec: null }
}

/**
 * Resolve a raw dsh-ui body through the renderer's unified pipeline.
 *
 * Tier-1 repair is available while streaming. Tier-2 completion repair is allowed only for
 * settled replies, so an unfinished body cannot render early.
 *
 * @param raw - Raw body between the dsh-ui fence markers.
 * @param options - Streaming or settled resolution policy.
 * @returns Render spec that passed the spec guard; null when the body cannot render.
 */
export function resolveFence(raw: string, options: FenceResolveOptions): FenceResolution {
  const parsed = parsePartialGenuiSpec(raw)
  let resolution = parsed === null ? unresolvedFence() : resolveParsedFence(parsed)
  if (resolution.spec !== null) return resolution

  const repaired = repairFenceJson(raw)
  if (repaired !== null) {
    const reparsed = parsePartialGenuiSpec(repaired.text)
    resolution = reparsed === null ? unresolvedFence() : resolveParsedFence(reparsed)
  }
  if (resolution.spec !== null || !options.settled) return resolution

  const completed = completeFenceJson(raw)
  if (completed === null) return resolution
  const reparsed = parsePartialGenuiSpec(completed.text)
  return reparsed === null ? unresolvedFence() : resolveParsedFence(reparsed)
}

/**
 * Return only the renderable spec from the unified fence resolution pipeline.
 *
 * @param raw - Raw body between the dsh-ui fence markers.
 * @param options - Streaming or settled resolution policy.
 * @returns Render spec that passed the spec guard; null when the body cannot render.
 */
export function resolveFenceSpec(raw: string, options: FenceResolveOptions): GenuiSpec | null {
  return resolveFence(raw, options).spec
}
