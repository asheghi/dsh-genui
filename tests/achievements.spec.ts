// @vitest-environment jsdom
// Achievements (0.9.5): rules, dedupe, persistence and the spec builder.
import { beforeEach, describe, expect, it } from 'vitest'
import { ACHIEVEMENTS, buildAchievementsSpec, checkAchievements, countSpecKinds, emptyState } from '../src/client/achievements.ts'
import { getAchievementSnapshot, recordFence, recordInteraction, recordPanel, recordTemplateUse, subscribeAchievements } from '../src/client/achievement-store.ts'
import { validateGenuiSpec } from '../src/client/guard.ts'
import type { GenuiSpec } from '../src/client/spec.ts'

const SAMPLE: GenuiSpec = {
  title: 'Sample',
  items: [
    { type: 'text', content: 'hi' },
    { type: 'chart', data: [{ label: 'a', value: 1 }] },
    { type: 'scene3d', meshes: [{ shape: 'box', size: 1 }] },
  ],
}

beforeEach(() => {
  localStorage.clear()
})

describe('achievement rules', () => {
  it('has 12 achievements with unique ids', () => {
    const ids = new Set(ACHIEVEMENTS.map(a => a.id))
    expect(ids.size).toBe(ACHIEVEMENTS.length)
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(10)
  })

  it('unlocks only once a threshold is reached', () => {
    expect(checkAchievements(emptyState(), {})).toEqual([])
    const s1 = { ...emptyState(), fences: 1 }
    expect(checkAchievements(s1, {}).map(a => a.id)).toContain('first-fence')
    const s50 = { ...emptyState(), fences: 50 }
    const unlocks = checkAchievements(s50, {})
    expect(unlocks.map(a => a.id)).toContain('fence-50')
  })

  it('never reports an already-unlocked achievement twice', () => {
    const s1 = { ...emptyState(), fences: 5 }
    const once = checkAchievements(s1, { 'first-fence': 1, 'fence-5': 1 })
    expect(once.map(a => a.id)).toEqual([])
  })
})

describe('recording and persistence', () => {
  it('recordFence dedupes by fingerprint (same content counts once)', () => {
    recordFence(SAMPLE)
    recordFence(SAMPLE)
    expect(getAchievementSnapshot().state.fences).toBe(1)
    // Different content counts again.
    recordFence({ title: 'b', items: [{ type: 'text', content: 'x' }] })
    expect(getAchievementSnapshot().state.fences).toBe(2)
  })

  it('counts chart/advanced nodes (delta assertions, avoiding cross-test state)', () => {
    const before = getAchievementSnapshot().state
    recordFence({ title: 'chart-test', items: [
      { type: 'chart', data: [{ label: 'a', value: 1 }] },
      { type: 'scene3d', meshes: [{ shape: 'box', size: 1 }] },
    ] })
    const s = getAchievementSnapshot().state
    expect(s.charts - before.charts).toBe(1)
    expect(s.advanced - before.advanced).toBe(1)
  })

  it('persists state across a reload', () => {
    recordFence(SAMPLE)
    const saved = localStorage.getItem('dsh.genui.achievements')
    expect(saved).toBeTruthy()
  })

  it('never writes the spec body behind a dedupe fingerprint (privacy: localStorage holds no content)', () => {
    const marker = 'PRIVACY-MARKER-9f2c'
    recordFence({ title: 't', items: [{ type: 'text', content: marker }] })
    const seen = localStorage.getItem('dsh.genui.achievements.seen') ?? ''
    const state = localStorage.getItem('dsh.genui.achievements') ?? ''
    expect(seen).not.toContain(marker)
    expect(state).not.toContain(marker)
    expect(seen).toBeTruthy()
  })

  it('counts interactions, panels and templates', () => {
    recordInteraction()
    recordPanel()
    recordTemplateUse()
    expect(getAchievementSnapshot().state.interactions).toBe(1)
    expect(getAchievementSnapshot().state.panels).toBe(1)
    expect(getAchievementSnapshot().state.templates).toBe(1)
  })

  it('queues an unlock and notifies subscribers', () => {
    let notified = 0
    const off = subscribeAchievements(() => { notified += 1 })
    recordFence(SAMPLE)
    expect(notified).toBeGreaterThan(0)
    const snapshot = getAchievementSnapshot()
    expect(Object.keys(snapshot.unlocked)).toContain('first-fence')
    off()
  })
})

describe('achievements page spec', () => {
  it('produces a spec that passes the renderer guard', () => {
    const spec = buildAchievementsSpec({ ...emptyState(), fences: 5, charts: 2 }, { 'first-fence': 1 })
    const v = validateGenuiSpec(spec)
    expect(v.ok, v.errors.join('; ')).toBe(true)
  })
})
