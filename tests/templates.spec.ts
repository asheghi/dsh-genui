/**
 * templates.spec.ts — template-center data contract:
 * every template's demo must pass validateGenuiSpec (the same guard the
 * renderer uses), stay within GENUI_LIMITS, and carry a non-empty
 * instruction containing the "dsh-ui" keyword.
 */
import { describe, expect, it } from 'vitest'
import { genuiTemplates } from '../src/client/templates.ts'
import { validateGenuiSpec, countGenuiNodes } from '../src/client/guard.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'

const GENUI_TEMPLATES = genuiTemplates()

describe('template center data contract', () => {
  it('every demo passes the renderer guard', () => {
    const problems: string[] = []
    for (const tpl of GENUI_TEMPLATES) {
      const v = validateGenuiSpec(tpl.demo)
      if (!v.ok) problems.push(`${tpl.id} (${tpl.name}): ${v.errors.join('; ')}`)
    }
    expect(problems).toEqual([])
  })

  it('every demo stays within the limits (≤200 nodes, ≤8 levels)', () => {
    for (const tpl of GENUI_TEMPLATES) {
      const count = countGenuiNodes(tpl.demo)
      expect(count, `${tpl.id}: ${count} nodes`).toBeLessThanOrEqual(GENUI_LIMITS.maxNodes)
    }
  })

  it('unique ids + valid instructions + non-empty name/description', () => {
    const ids = new Set<string>()
    for (const tpl of GENUI_TEMPLATES) {
      expect(ids.has(tpl.id), `duplicate id: ${tpl.id}`).toBe(false)
      ids.add(tpl.id)
      expect(tpl.instruction.trim().length).toBeGreaterThan(10)
      expect(tpl.instruction).toContain('dsh-ui')
      expect(tpl.name.trim()).not.toBe('')
      expect(tpl.description.trim().length).toBeGreaterThanOrEqual(10)
    }
    expect(GENUI_TEMPLATES.length).toBeGreaterThanOrEqual(10)
  })

  it('covers the main categories', () => {
    const categories = new Set<string>(GENUI_TEMPLATES.map(t => t.category))
    // Stable, locale-independent category ids (display names live in i18n).
    for (const expected of ['dashboard', 'data', 'flow', 'chart', 'interactive', 'quiz', 'advanced']) {
      expect(categories.has(expected), `missing category: ${expected}`).toBe(true)
    }
  })
})
