/**
 * achievement-store.ts — achievement state store and tracking entry points
 * (module-level singleton).
 *
 * Stores only counts and unlock timestamps; never messages/content. Persisted
 * in localStorage, with a subscription API consumed by the toast and the
 * achievements page. Tracking entry points:
 *  - recordFence(spec): one UI render with non-duplicate content (deduped by
 *    spec fingerprint; the LRU fingerprint table prevents recounting replays
 *    across reloads)
 *  - recordPanel(): the panel dock appeared
 *  - recordInteraction(): a component action was reported back (after debounce)
 *  - recordTemplateUse(): a template was tried from the template center
 */
import type { GenuiSpec } from './spec.ts'
import { ACHIEVEMENTS, checkAchievements, countSpecKinds, emptyState, type AchieveState, type AchievementDef } from './achievements.ts'

const STORE_KEY = 'dsh.genui.achievements'
const SEEN_KEY = 'dsh.genui.achievements.seen'
const SEEN_MAX = 200

interface AchieveStore {
  state: AchieveState
  unlocked: Record<string, number>
}

let store: AchieveStore = loadStore()
const listeners = new Set<() => void>()
/** Queue of unlock toasts (FIFO; the achievements page reads it too). */
let toastQueue: AchievementDef[] = []

function loadStore(): AchieveStore {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (raw === null) return { state: emptyState(), unlocked: {} }
    const parsed = JSON.parse(raw) as Partial<AchieveStore>
    const state = { ...emptyState(), ...(parsed.state ?? {}) }
    return { state, unlocked: typeof parsed.unlocked === 'object' && parsed.unlocked !== null ? parsed.unlocked as Record<string, number> : {} }
  } catch {
    return { state: emptyState(), unlocked: {} }
  }
}

function saveStore(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch {
    // Quota / privacy-mode failures are non-fatal: achievements still tick
    // in memory for this page session.
  }
}

function readSeen(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function writeSeen(list: string[]): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(list.slice(0, SEEN_MAX)))
  } catch {
    // non-fatal
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

/** Apply one state update: persist + check for new unlocks (push to the toast
 *  queue) + notify subscribers. */
function applyDelta(patch: Partial<AchieveState>): void {
  store.state = { ...store.state, ...patch }
  const fresh = checkAchievements(store.state, store.unlocked)
  for (const ach of fresh) store.unlocked[ach.id] = Date.now()
  if (fresh.length > 0) toastQueue.push(...fresh)
  saveStore()
  emit()
}

/** 53-bit string hash (cyrb53-style): dedupe fingerprints are stored as
 *  hashes, never as the serialized spec itself — localStorage must not
 *  persist conversation-derived content (table rows, text, …). */
function fingerprintOf(spec: GenuiSpec): string {
  const s = JSON.stringify(spec)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  return `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}`
}

/** Record one fence render with non-duplicate content. */
export function recordFence(spec: GenuiSpec): void {
  const fingerprint = fingerprintOf(spec)
  const seen = readSeen()
  if (seen.includes(fingerprint)) return
  writeSeen([fingerprint, ...seen])
  const kinds = countSpecKinds(spec)
  applyDelta({
    fences: store.state.fences + 1,
    charts: store.state.charts + (kinds.charts > 0 ? 1 : 0),
    advanced: store.state.advanced + (kinds.advanced > 0 ? 1 : 0),
  })
}

/** Record the panel dock appearing (only when the session goes from none to some). */
export function recordPanel(): void {
  applyDelta({ panels: store.state.panels + 1 })
}

/** Record one component interaction action reported back. */
export function recordInteraction(): void {
  applyDelta({ interactions: store.state.interactions + 1 })
}

/** Record one template trial. */
export function recordTemplateUse(): void {
  applyDelta({ templates: store.state.templates + 1 })
}

/** Current state snapshot (read by subscribers). */
export function getAchievementSnapshot(): { state: AchieveState, unlocked: Record<string, number> } {
  return store
}

/** Take new unlocks (consumed by the toast; one-shot). */
export function consumeUnlocks(): AchievementDef[] {
  const queue = toastQueue
  toastQueue = []
  return queue
}

/** Subscribe to state changes (the toast and the achievements page). */
export function subscribeAchievements(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Spec data source for the achievements page (rendered inside the panel). */
export function achievementCount(): { total: number, unlocked: number } {
  return {
    total: ACHIEVEMENTS.length,
    unlocked: ACHIEVEMENTS.filter(a => store.unlocked[a.id] !== undefined).length,
  }
}
