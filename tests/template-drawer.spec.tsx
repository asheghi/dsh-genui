// @vitest-environment jsdom
// TemplateDrawer: the GenUI template center (0.9.4) — category filter,
// card grid, in-place demo preview, and the "try it" hook.
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TemplateDrawer } from '../src/client/TemplateDrawer.tsx'
import { genuiTemplates } from '../src/client/templates.ts'

const GENUI_TEMPLATES = genuiTemplates()

const renderDrawer = (onUse: (t: string) => void = () => {}): ReturnType<typeof render> =>
  render(<TemplateDrawer tab="templates" onUse={onUse} />)

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('TemplateDrawer', () => {
  it('renders every category chip and template card', () => {
    renderDrawer()
    for (const c of ['All', 'Dashboard', 'Data', 'Flow', 'Charts', 'Interactive', 'Quiz', 'Advanced']) {
      expect(screen.getByRole('tab', { name: c })).toBeTruthy()
    }
    for (const tpl of GENUI_TEMPLATES) {
      expect(screen.getByText(tpl.name)).toBeTruthy()
    }
  })

  it('category filter: clicking "Quiz" shows only chart-category templates', () => {
    renderDrawer()
    fireEvent.click(screen.getByRole('tab', { name: 'Quiz' }))
    expect(screen.queryByText('Project dashboard')).toBeNull()
    expect(screen.getByText('Pop quiz')).toBeTruthy()
  })

  it('clicking a card: the preview renders the demo and shows "Try it / Copy"', async () => {
    renderDrawer()
    fireEvent.click(screen.getByText('Project dashboard'))
    // The demo preview is rendered by GenuiBlock: the first screen shows the
    // example title and the stat labels.
    const preview = document.querySelector('[data-genui-template-preview]')
    expect(preview).toBeTruthy()
    expect(screen.getByText('This week’s key metrics')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try it: insert into composer' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Copy instruction/ })).toBeTruthy()
  })

  it('the "try it" callback receives the template instruction', () => {
    const onUse = vi.fn()
    renderDrawer(onUse)
    fireEvent.click(screen.getByText('Project dashboard'))
    fireEvent.click(screen.getByRole('button', { name: 'Try it: insert into composer' }))
    expect(onUse).toHaveBeenCalledTimes(1)
    expect(onUse.mock.calls[0][0]).toContain('dsh-ui')
    expect(onUse.mock.calls[0][0]).toContain('dashboard')
  })

  it('"copy instruction" goes through the clipboard (silent fallback without navigator)', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const onUse = vi.fn()
    renderDrawer(onUse)
    fireEvent.click(screen.getByText('Project dashboard'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Copy instruction/ }))
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain('dsh-ui')
  })

  it('the achievements panel renders the trophy page (dsh-ui self-rendered, no extra mode tabs)', () => {
    const withTab = render(<TemplateDrawer tab="achievements" onUse={() => {}} />)
    expect(document.querySelector('[data-genui-achievements]')).toBeTruthy()
    expect(screen.getByText(/GenUI exploration trophies/)).toBeTruthy()
    // The drawer no longer carries a "templates|trophies" mode switch (the
    // panel header buttons own that).
    expect(screen.queryByRole('tab', { name: 'Trophies' })).toBeNull()
    withTab.unmount()
  })
})
