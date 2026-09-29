// @vitest-environment jsdom
/**
 * i18n contract: dictionary completeness, locale resolution, the `t()` lookup
 * chain, host-bridge registration, and the fact that real UI surfaces render
 * in the active language.
 *
 * This fork ships English only: `en` is the single shipped locale, the only
 * dictionary `dictOf` hands out, and the fallback. The suite is pinned to
 * `en` (see tests/setup.ts); this file owns the switching behaviour — an
 * unshipped tag leaves the active locale untouched — and restores `en`
 * afterwards so test order can never leak a locale.
 *
 * A mirroring dictionary keeps the completeness checks meaningful for a
 * locale that is not `en`: identical keys, identical placeholders, the shape
 * any future translation must satisfy.
 */
import { cleanup, act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../src/client/i18n/en.ts'
import {
  bridgeHostLocale,
  detectLocale,
  dictOf,
  FALLBACK_LOCALE,
  GENUI_LOCALE_NS,
  getLocale,
  LOCALE_IDS,
  normalizeLocale,
  setLocale,
  subscribeLocale,
  t,
} from '../src/client/i18n/index.ts'
import { genuiTemplates, TEMPLATE_CATEGORIES } from '../src/client/templates.ts'
import { defaultPanelSpec } from '../src/client/panel-command.ts'
import { ACHIEVEMENTS, buildAchievementsSpec, emptyState } from '../src/client/achievements.ts'
import { TemplateDrawer } from '../src/client/TemplateDrawer.tsx'
import { validateGenuiSpec } from '../src/client/guard.ts'

/** `{name}` placeholders of a template, sorted, for cross-dictionary comparison. */
const placeholders = (s: string): string[] => (s.match(/\{(\w+)\}/g) ?? []).sort()

/**
 * A dictionary mirroring the English key set and placeholders, prefixed so a
 * value can never be mistaken for the English one. It is never shipped and
 * never handed back by the public API.
 */
const MIRROR: Record<string, string> = Object.fromEntries(
  Object.entries(EN).map(([key, value]) => [key, `mirror ${key} ${value}`]),
)

afterEach(() => {
  cleanup()
  // Restore the suite-wide pin so test order cannot leak a locale.
  setLocale('en')
})

describe('dictionary completeness', () => {
  it('ships English as the only locale', () => {
    expect(LOCALE_IDS).toEqual(['en'])
    expect(FALLBACK_LOCALE).toBe('en')
  })

  it('dictOf returns the English dictionary for the shipped locale', () => {
    expect(dictOf('en')).toBe(EN)
    expect(Object.keys(dictOf('en'))).toEqual(Object.keys(EN))
  })

  it('no dictionary entry is empty', () => {
    for (const id of LOCALE_IDS) {
      for (const [key, value] of Object.entries(dictOf(id))) {
        expect(String(value).trim(), `${id}:${key} is empty`).not.toBe('')
      }
    }
  })

  it('every English entry is a non-blank string', () => {
    for (const [key, value] of Object.entries(EN)) {
      expect(typeof value, `${key} is not a string`).toBe('string')
      expect(value.trim(), `${key} is blank`).not.toBe('')
    }
  })

  it('a mirroring dictionary agrees with English on the key set and placeholders', () => {
    expect(Object.keys(MIRROR).sort()).toEqual(Object.keys(EN).sort())
    for (const key of Object.keys(EN) as Array<keyof typeof EN>) {
      expect(placeholders(MIRROR[key]!), `placeholder mismatch on ${key}`)
        .toEqual(placeholders(EN[key]))
    }
  })

  it('every achievement id has a name and description', () => {
    for (const a of ACHIEVEMENTS) {
      for (const suffix of ['name', 'desc'] as const) {
        const key = `ach.${a.id}.${suffix}` as keyof typeof EN
        expect(EN[key], `missing ${key}`).toBeTruthy()
      }
    }
  })

  it('every template category has a label', () => {
    for (const c of [...TEMPLATE_CATEGORIES, 'all']) {
      const key = `tpl.category.${c}` as keyof typeof EN
      expect(EN[key], `missing ${key}`).toBeTruthy()
    }
  })
})

describe('locale resolution', () => {
  it('normalizes region and script subtags onto the only shipped locale', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('en-GB')).toBe('en')
    expect(normalizeLocale('EN_us')).toBe('en')
  })

  it('rejects every unshipped language, including Chinese tags', () => {
    expect(normalizeLocale('zh')).toBeUndefined()
    expect(normalizeLocale('zh-CN')).toBeUndefined()
    expect(normalizeLocale('zh-Hant-TW')).toBeUndefined()
    expect(normalizeLocale('fr')).toBeUndefined()
    expect(normalizeLocale('')).toBeUndefined()
    expect(normalizeLocale(undefined)).toBeUndefined()
    expect(normalizeLocale(null)).toBeUndefined()
  })

  it('falls back to English when the browser names no shipped language', () => {
    expect(FALLBACK_LOCALE).toBe('en')
    // jsdom's navigator reports en-US.
    expect(detectLocale()).toBe('en')
  })

  it('ignores an unknown tag instead of blanking the UI', () => {
    setLocale('en')
    setLocale('zh')
    expect(getLocale()).toBe('en')
    setLocale('fr')
    expect(getLocale()).toBe('en')
  })

  it('does not notify subscribers for an unknown or already-active tag', () => {
    setLocale('en')
    const seen = vi.fn()
    const unsubscribe = subscribeLocale(seen)
    try {
      setLocale('en') // already active → no churn
      setLocale('zh') // unshipped → ignored
      expect(seen).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
    }
  })
})

describe('t() lookup chain', () => {
  it('resolves English values', () => {
    setLocale('en')
    expect(t('panel.badge')).toBe('Panel')
    expect(t('panel.badge')).toBe(EN['panel.badge'])
  })

  it('interpolates named params', () => {
    setLocale('en')
    expect(t('label.diffFiles', { count: 3 })).toBe('3 files')
    expect(t('ach.toast.unlocked', { name: 'First contact' }))
      .toBe('Trophy unlocked: First contact')
  })

  it('keeps a placeholder whose param is missing', () => {
    setLocale('en')
    expect(t('label.diffFiles')).toBe('{count} files')
  })

  it('returns the key itself for an unknown key (diagnosable, not blank)', () => {
    expect(t('does.not.exist')).toBe('does.not.exist')
  })
})

describe('host locale bridge', () => {
  /** Minimal host locale service double. */
  function hostLocale(active: string) {
    return {
      active,
      registrations: [] as Array<[string, string, Record<string, string>]>,
      syncs: [] as Array<() => void>,
      getLocale() {
        return { active: this.active }
      },
      subscribe(fn: () => void) {
        this.syncs.push(fn)
        return () => {
          this.syncs = this.syncs.filter(candidate => candidate !== fn)
        }
      },
      register(ns: string, locale: string, dict: Record<string, string>) {
        this.registrations.push([ns, locale, dict])
        return () => {
          this.registrations = this.registrations.filter(([n]) => n !== ns)
        }
      },
    }
  }

  it('registers the English dictionary once, under the genui namespace', () => {
    const host = hostLocale('en')
    const dispose = bridgeHostLocale({ get: () => host })
    // One registration per shipped locale — exactly one, since English is it.
    expect(host.registrations).toHaveLength(LOCALE_IDS.length)
    const [ns, locale, dict] = host.registrations[0]!
    expect(ns).toBe(GENUI_LOCALE_NS)
    expect(locale).toBe('en')
    expect(Object.keys(dict)).toEqual(Object.keys(EN))
    dispose()
    expect(host.registrations).toHaveLength(0)
  })

  it('ignores a host preference for a tag this fork no longer ships', () => {
    const host = hostLocale('zh')
    const dispose = bridgeHostLocale({ get: () => host })
    expect(getLocale()).toBe('en')
    dispose()
  })

  it('mirrors a host locale change onto the active locale', () => {
    const host = hostLocale('en')
    const dispose = bridgeHostLocale({ get: () => host })
    act(() => {
      host.active = 'en-GB'
      for (const sync of [...host.syncs]) sync()
    })
    expect(getLocale()).toBe('en')
    dispose()
  })

  it('degrades silently when the host ships no locale service', () => {
    const dispose = bridgeHostLocale({ get: () => undefined })
    expect(getLocale()).toBe('en')
    expect(() => dispose()).not.toThrow()
  })
})

describe('content builders follow the active locale', () => {
  it('templates render their English display text', () => {
    setLocale('en')
    const templates = genuiTemplates()
    expect(templates[0]!.name).toBe(EN['tpl.dashboard.name'])
    expect(templates[0]!.name).toBe('Project dashboard')
    // Ids stay stable and language-independent.
    expect(new Set(templates.map(x => x.id)).size).toBe(templates.length)
  })

  it('every template demo stays valid in English', () => {
    setLocale('en')
    for (const tpl of genuiTemplates()) {
      const v = validateGenuiSpec(tpl.demo)
      expect(v.ok, `${tpl.id}: ${v.ok ? '' : v.errors.join('; ')}`).toBe(true)
    }
  })

  it('the default panel spec follows the locale and stays valid', () => {
    setLocale('en')
    const spec = defaultPanelSpec()
    expect(spec.title).toBe(EN['panel.title.default'])
    expect(spec.title).toBe('GenUI panel')
    expect(validateGenuiSpec(spec).ok).toBe(true)
  })

  it('the trophy page follows the locale', () => {
    setLocale('en')
    expect(buildAchievementsSpec(emptyState(), {}).title).toBe('GenUI exploration trophies')
    expect(buildAchievementsSpec(emptyState(), {}).title).toBe(EN['ach.page.title'])
  })

  it('achievement name/description are read at access time, not frozen', () => {
    const first = ACHIEVEMENTS[0]!
    expect(first.id).toBe('first-fence')
    setLocale('en')
    expect(first.name).toBe(EN['ach.first-fence.name'])
    expect(first.name).toBe('First contact')
  })
})

describe('live components', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders the template drawer in English', () => {
    setLocale('en')
    render(<TemplateDrawer tab="templates" onUse={() => {}} />)
    expect(screen.getByRole('tab', { name: 'All' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Dashboard' })).toBeTruthy()
    expect(screen.getByText('Project dashboard')).toBeTruthy()
  })

  it('keeps rendering the shipped locale when an unshipped one is requested', () => {
    setLocale('en')
    render(<TemplateDrawer tab="templates" onUse={() => {}} />)
    expect(screen.getByText('Project dashboard')).toBeTruthy()

    act(() => {
      setLocale('zh')
    })

    expect(screen.getByText('Project dashboard')).toBeTruthy()
    expect(getLocale()).toBe('en')
  })
})
