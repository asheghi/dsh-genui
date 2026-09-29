import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface SessionListEntry {
  id?: unknown
  retainedBy?: unknown
}

interface SessionListSnapshot {
  current?: unknown
  byId?: unknown
}

/**
 * Resolve the current main-view session from the host session list snapshot.
 *
 * @param list - session list snapshot provided by the host
 * @returns the current session id; undefined when the snapshot shape is unrecognized
 */
export function resolveViewedSessionId(list: unknown): SessionId | undefined {
  if (typeof list !== 'object' || list === null) return undefined
  const snapshot = list as SessionListSnapshot
  if (typeof snapshot.current === 'string') return snapshot.current as SessionId
  if (typeof snapshot.byId !== 'object' || snapshot.byId === null || Array.isArray(snapshot.byId)) return undefined

  const viewed = Object.values(snapshot.byId as Record<string, unknown>).find((entry): entry is SessionListEntry => {
    if (typeof entry !== 'object' || entry === null) return false
    const retainedBy = (entry as SessionListEntry).retainedBy
    if (typeof retainedBy !== 'object' || retainedBy === null || Array.isArray(retainedBy)) return false
    const mainView = (retainedBy as { mainView?: unknown }).mainView
    return typeof mainView === 'number' && mainView > 0
  })
  return typeof viewed?.id === 'string' ? viewed.id as SessionId : undefined
}
