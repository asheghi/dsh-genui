// @vitest-environment jsdom
// GenUI gallery: the full-vocabulary spec renders through the real fence
// path (parse → repair → GenuiBlock) and every component family appears.
// Regression net: if a future vocabulary addition breaks rendering of any
// existing type, this file catches it.
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { hasFenceRegistry } from './helpers/fence-host'
import { MarkdownText } from './markdown-labels.tsx'
import { gallerySpec } from '../src/client/gallery.ts'
import { repairGenuiSpec } from '../src/client/guard.ts'
import { GENUI_LIMITS } from '../src/client/genui-runtime/index.ts'

afterEach(cleanup)

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

describe('gallery spec', () => {
  it('survives the guard unchanged', () => {
    const repaired = repairGenuiSpec(gallerySpec)
    expect(repaired).toEqual(gallerySpec)
  })

  it.skipIf(!hasFenceRegistry)('renders every component family through the fence path', () => {
    render(<MarkdownText text={fenced(gallerySpec)} />)
    const body = document.body.textContent ?? ''
    // Layout + text hierarchy
    expect(body).toContain('Typography scale')
    expect(body).toContain('Body: rendered through the component whitelist')
    // Display
    expect(body).toContain('Success')
    expect(body).toContain('CPU')
    expect(body).toContain('Training progress')
    expect(document.querySelector('audio[controls][preload="none"]')).not.toBeNull()
    expect(body).toContain('Performance metrics')
    expect(body).toContain('Version')
    expect(body).toContain('Titled item')
    // Avatars render their initial: the two avatars sit adjacent in a row.
    expect(body).toContain('AB')
    expect(screenCount('tab', 'label')).toBeLessThanOrEqual(GENUI_LIMITS.maxTabs)
    // Charts
    expect(document.querySelector('svg')).not.toBeNull()
    // Interactive controls
    expect(document.querySelector('input[type="checkbox"]')).not.toBeNull()
    expect(document.querySelector('textarea')).not.toBeNull()
    expect(document.querySelector('select')).not.toBeNull()
    expect(screenAllByRole('switch').length).toBeGreaterThan(0)
    expect(document.querySelector('input[type="radio"]')).not.toBeNull()
    expect(body).toContain('Copy token')
    expect(document.querySelector('img[src="/demo-image.png"]')).not.toBeNull()
    expect(document.querySelector('audio[controls][preload="metadata"]')).not.toBeNull()
    expect(document.querySelector('video[controls][preload="metadata"]')).not.toBeNull()
    // Advanced
    expect(document.querySelector('[data-genui-callout]')).not.toBeNull()
    expect(document.querySelector('[data-genui-quiz]')).not.toBeNull()
    expect(document.querySelector('[data-genui-scene3d]')).not.toBeNull()
    expect(document.querySelector('nav[aria-label="breadcrumb"]')).not.toBeNull()
    // Containers
    expect(document.querySelector('table')).not.toBeNull()
    expect(document.querySelector('ol')).not.toBeNull()
    expect(document.querySelector('dl')).not.toBeNull()
    expect(document.querySelector('pre')).not.toBeNull() // code / mermaid fallback
  })
})

/** Query helpers that survive the hashed css-module class names. */
function screenCount(role: string, label: string): number {
  return Array.from(document.querySelectorAll(`[role="${role}"]`)).filter(el => el.textContent?.includes(label)).length
}

function screenAllByRole(role: string, label?: string): Element[] {
  const els = Array.from(document.querySelectorAll(`[role="${role}"]`))
  return label === undefined ? els : els.filter(el => el.textContent?.includes(label))
}
