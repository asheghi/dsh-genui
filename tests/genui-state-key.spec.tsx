// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenuiBlock } from '../src/client/GenuiBlock.tsx'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { renderGenuiFence, renderResolvedFenceNode } from '../src/client/fence-render.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'
import { fenceStateKey, loadBlockState, saveBlockState } from '../src/client/interaction-store.ts'

const fieldSpec = repairGenuiSpec({
  items: [{ type: 'input', id: 'name', label: 'Name' }],
})!

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.useRealTimers()
})

function fieldValue(): string {
  return (screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value
}

describe('GenUI durable state identity', () => {
  it('starts a fresh in-memory lifetime when stateKey changes', () => {
    saveBlockState('state-a', { fields: { name: 'Alice' } })

    const view = render(<GenuiBlock spec={fieldSpec} stateKey="state-a" />)
    expect(fieldValue()).toBe('Alice')

    view.rerender(<GenuiBlock spec={fieldSpec} stateKey="state-b" />)
    expect(fieldValue()).toBe('')

    // The old in-memory value must never be written under the new durable key.
    act(() => { vi.advanceTimersByTime(300) })
    expect(loadBlockState('state-b')?.fields?.name).toBeUndefined()

    // Returning to the original durable identity restores its own state.
    view.rerender(<GenuiBlock spec={fieldSpec} stateKey="state-a" />)
    expect(fieldValue()).toBe('Alice')
  })

  it('keeps one volatile instance while an identity-less streaming spec grows', () => {
    const first = repairGenuiSpec({
      title: 'Part one',
      items: [{ type: 'input', id: 'name', label: 'Name' }],
    })!
    const second = repairGenuiSpec({
      title: 'Part two',
      items: [
        { type: 'input', id: 'name', label: 'Name' },
        { type: 'text', content: 'Later streamed content' },
      ],
    })!

    const view = render(<GenuiBlock spec={first} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'typing' } })
    expect(fieldValue()).toBe('typing')

    view.rerender(<GenuiBlock spec={second} />)
    expect(fieldValue()).toBe('typing')
  })

  it.each([renderGenuiFence, renderResolvedFenceNode])('keeps input and pending actions when a streaming fence settles (%#)', renderFence => {
    const spec = repairGenuiSpec({ items: [
      ...fieldSpec.items, { type: 'button', label: 'Confirm', action: 'confirm' },
    ] })!
    const raw = JSON.stringify(spec)
    const onAction = vi.fn()
    const source = { id: 'assistant:17:fence:0', order: [17, 0, 0] as const }
    const view = render(<GenuiActionContext.Provider value={onAction}>
      {renderFence(raw, 0, { sessionId: 'stream-session' })}
    </GenuiActionContext.Provider>)
    const input = screen.getByRole('textbox', { name: 'Name' })
    fireEvent.change(input, { target: { value: 'typing' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    view.rerender(<GenuiActionContext.Provider value={onAction}>
      {renderFence(raw, 0, { sessionId: 'stream-session', source })}
    </GenuiActionContext.Provider>)
    expect(screen.getByRole('textbox', { name: 'Name' })).toBe(input)
    expect(fieldValue()).toBe('typing')
    act(() => { vi.advanceTimersByTime(300) })
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(loadBlockState(fenceStateKey('stream-session', source.id, raw))?.fields?.name).toBe('typing')
  })
})
