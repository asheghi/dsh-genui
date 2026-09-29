// @vitest-environment jsdom
// Rendering error boundary: a component crash inside one GenUI block must
// degrade to an inline alert, never take down the whole chat surface.
// The boundary wraps all three render entrances (fence / toolview / panel).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../src/client/ErrorBoundary.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function Boom(): never {
  throw new Error('boom: component exploded')
}

describe('ErrorBoundary', () => {
  it('renders healthy children unchanged', () => {
    render(
      <ErrorBoundary label="this interface">
        <div>Healthy content</div>
      </ErrorBoundary>,
    )
    expect(screen.getByText('Healthy content')).not.toBeNull()
    expect(document.querySelector('[data-genui-error]')).toBeNull()
  })

  it('degrades a crashing subtree to an inline alert with the error message', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary label="this interface">
        <Boom />
      </ErrorBoundary>,
    )
    const alert = document.querySelector('[data-genui-error]')
    expect(alert).not.toBeNull()
    expect(alert?.textContent).toContain('this interface failed to render')
    expect(alert?.textContent).toContain('boom: component exploded')
    expect(spy).toHaveBeenCalled()
    // The fallback stays a small inline box — no full-tree unmount.
    expect(alert?.getAttribute('role')).toBe('alert')
  })

  it('does not break when the label is omitted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(document.querySelector('[data-genui-error]')?.textContent).toContain('failed to render')
  })

  it('siblings outside the boundary still render after a crash inside it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <div>
        <ErrorBoundary label="broken block">
          <Boom />
        </ErrorBoundary>
        <div>Rest of the chat interface</div>
      </div>,
    )
    // The whole surface survives: content outside the boundary is intact.
    expect(screen.getByText('Rest of the chat interface')).not.toBeNull()
    expect(screen.getByText(/broken block failed to render/)).not.toBeNull()
  })
})
