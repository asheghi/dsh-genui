// @vitest-environment jsdom
// GenUI v2.6 LOCAL-FIRST interaction:
// 1) submit grades IN PLACE when the questions carry `answer`/`explanation`
//    data — score + per-question ✓/✗ + explanations, zero model round trip,
//    questions lock until "Start over" resets them locally;
// 2) without answer data the submit keeps the v2.5 fallback (ONE action);
// 3) actionable buttons show a brief local "Sent" feedback on click.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from './markdown-labels.tsx'
import { hasFenceRegistry } from './helpers/fence-host'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec, validateGenuiSpec } from '../src/client/guard.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
beforeEach(() => {
  vi.useFakeTimers()
})

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

/** A 2-question paper WITH local answers. */
const paper = {
  items: [
    { type: 'radio', label: '1. What is 9+6?', group: 'q1', answer: 1, explanation: '9+6=15: add the units', options: ['14', '15', '16'] },
    { type: 'radio', label: '2. What is the capital?', group: 'q2', answer: 'Beijing', explanation: 'Beijing is the capital', options: ['Shanghai', 'Guangzhou', 'Beijing'] },
    { type: 'submit', label: 'Hand in', action: 'grade', groups: ['q1', 'q2'] },
  ],
}

describe.skipIf(!hasFenceRegistry)('v2.6: local grading (zero round trip)', () => {
  it('grades IN PLACE: score, per-question ✓/✗, correct answers, explanations — NO action fired', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced(paper)} />
      </GenuiActionContext.Provider>,
    )
    const groups = container.querySelectorAll('[role="radiogroup"]')
    fireEvent.click(groups[0]!.querySelectorAll('input')[1]!) // q1: 15 ✓
    fireEvent.click(groups[1]!.querySelectorAll('input')[2]!) // q2: Beijing ✓
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)

    const grade = container.querySelector('[data-genui-grade]')
    expect(grade).not.toBeNull()
    expect(grade!.textContent).toContain('2 / 2')
    expect(grade!.textContent).toContain('Score')
    expect(grade!.textContent).toContain('What is 9+6?')
    expect(grade!.textContent).toContain('add the units')
    expect(grade!.textContent).toContain('Beijing is the capital')
    // all answered correctly: no ✗ rows, no correct-answer reveals
    expect(grade!.textContent).not.toContain('✗')
    expect(grade!.textContent).not.toContain('Correct answer:')
    // zero model round trip
    expect(actions).toHaveLength(0)
  })

  it('marks wrong answers with ✗ and reveals the correct answer + explanation', () => {
    const { container } = render(<MarkdownText text={fenced(paper)} />)
    const groups = container.querySelectorAll('[role="radiogroup"]')
    fireEvent.click(groups[0]!.querySelectorAll('input')[0]!) // q1: 14 ✗
    fireEvent.click(groups[1]!.querySelectorAll('input')[0]!) // q2: Shanghai ✗
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)

    const grade = container.querySelector('[data-genui-grade]')!
    expect(grade.textContent).toContain('0 / 2')
    expect(grade.textContent).toContain('✗')
    expect(grade.textContent).toContain('Correct answer:15')
    expect(grade.textContent).toContain('Correct answer:Beijing')
    expect(grade.textContent).toContain('9+6=15: add the units')
  })

  it('locks the questions after grading; Start over resets locally and unlocks', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced(paper)} />
      </GenuiActionContext.Provider>,
    )
    const groups = container.querySelectorAll('[role="radiogroup"]')
    const inputs = () => [...container.querySelectorAll('[role="radiogroup"] input')] as HTMLInputElement[]
    fireEvent.click(groups[0]!.querySelectorAll('input')[1]!)
    fireEvent.click(groups[1]!.querySelectorAll('input')[1]!)
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)

    // graded → locked
    expect(inputs().every(i => i.disabled)).toBe(true)
    expect(container.querySelector('[data-genui-grade]')).not.toBeNull()

    // Start over → reset, unlocked, no action.
    fireEvent.click(container.querySelector('[data-genui-grade] button')!)
    expect(container.querySelector('[data-genui-grade]')).toBeNull()
    expect(container.querySelector('[class*="submitRow"] button')).not.toBeNull()
    expect(inputs().every(i => !i.disabled)).toBe(true)
    expect(actions).toHaveLength(0)

    // can answer and grade again (inputs order: q1[0..2], q2[3..5])
    fireEvent.click(inputs()[1]!) // q1: 15 ✓
    fireEvent.click(inputs()[4]!) // q2: Guangzhou ✗
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)
    expect(container.querySelector('[data-genui-grade]')!.textContent).toContain('1 / 2')
  })

  it('fires resetAction (optional) when Start over is clicked', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const spec = { ...paper, items: [...paper.items] }
    spec.items[2] = { ...spec.items[2]!, resetAction: 'redo' }
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced(spec)} />
      </GenuiActionContext.Provider>,
    )
    const groups = container.querySelectorAll('[role="radiogroup"]')
    fireEvent.click(groups[0]!.querySelectorAll('input')[1]!) // q1: 15 ✓
    fireEvent.click(groups[1]!.querySelectorAll('input')[2]!) // q2: Beijing ✓
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)
    fireEvent.click(container.querySelector('[data-genui-grade] button')!)
    // resetAction goes through the same per-name trailing debounce
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['redo', { type: 'submit-reset', groups: ['q1', 'q2'] }]])
  })
})

describe.skipIf(!hasFenceRegistry)('v2.6: fallback keeps v2.5 behavior without answers', () => {
  it('sends ONE action when no question carries answer data', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = render(
      <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
        <MarkdownText text={fenced({ items: [
          { type: 'radio', label: 'Question 1', group: 'q1', options: ['A', 'B'] },
          { type: 'radio', label: 'Question 2', group: 'q2', options: ['C', 'D'] },
          { type: 'submit', label: 'Hand in', action: 'grade', groups: ['q1', 'q2'] },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    const groups = container.querySelectorAll('[role="radiogroup"]')
    fireEvent.click(groups[0]!.querySelectorAll('input')[1]!)
    fireEvent.click(groups[1]!.querySelectorAll('input')[1]!)
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)
    vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS)
    expect(actions).toEqual([['grade', { type: 'submit', answers: { q1: 'B', q2: 'D' }, total: 2, answered: 2 }]])
    expect(container.querySelector('[data-genui-grade]')).toBeNull()
  })

  it('grades locally WITHOUT any action provider (fully offline)', () => {
    const { container } = render(<MarkdownText text={fenced(paper)} />)
    const groups = container.querySelectorAll('[role="radiogroup"]')
    fireEvent.click(groups[0]!.querySelectorAll('input')[1]!) // q1: 15 ✓
    fireEvent.click(groups[1]!.querySelectorAll('input')[2]!) // q2: Beijing ✓
    const submit = container.querySelector('[class*="submitRow"] button') as HTMLButtonElement
    expect(submit.disabled).toBe(false) // local grading does not need the model channel
    fireEvent.click(submit)
    expect(container.querySelector('[data-genui-grade]')!.textContent).toContain('2 / 2')
  })
})

describe.skipIf(!hasFenceRegistry)('v2.6: button local click feedback', () => {
  it('shows Sent after clicking an actionable button, then clears', () => {
    const { container } = render(
      <GenuiActionContext.Provider value={() => {}}>
        <MarkdownText text={fenced({ items: [
          { type: 'button', label: 'Refresh', action: 'refresh' },
        ] })} />
      </GenuiActionContext.Provider>,
    )
    const button = container.querySelector('button')!
    expect(button.textContent).not.toContain('Sent')
    fireEvent.click(button)
    expect(button.textContent).toContain('Sent')
    act(() => { vi.advanceTimersByTime(1400) })
    expect(button.textContent).not.toContain('Sent')
  })

  it('does not show feedback on inert (disabled) buttons', () => {
    const { container } = render(<MarkdownText text={fenced({ items: [
      { type: 'button', label: 'Show' },
    ] })} />)
    const button = container.querySelector('button')!
    fireEvent.click(button)
    expect(button.textContent).not.toContain('Sent')
    expect(button.disabled).toBe(true)
  })
})

describe.skipIf(!hasFenceRegistry)('v2.6: guard coverage', () => {
  it('repair keeps radio answer (index + label) / explanation and submit resetAction', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'radio', label: 'q', group: 'g', answer: 2, explanation: 'Because…', options: ['a', 'b', 'c'] },
        { type: 'radio', label: 'q2', group: 'g2', answer: 'c', options: ['a', 'b', 'c'] },
        { type: 'submit', label: 'Hand in', action: 'g', resetAction: 'redo', groups: ['g', 'g2'] },
      ],
    })
    const items = spec!.items as Array<Record<string, unknown>>
    expect(items[0]!.answer).toBe(2)
    expect(items[0]!.explanation).toBe('Because…')
    expect(items[1]!.answer).toBe('c')
    expect((items[2] as { resetAction?: string }).resetAction).toBe('redo')
  })

  it('repair drops an out-of-range answer index and keeps a valid one', () => {
    const spec = repairGenuiSpec({
      items: [
        { type: 'radio', label: 'q', group: 'g', answer: 99, options: ['a', 'b'] },
        { type: 'radio', label: 'q2', group: 'g2', answer: 1, options: ['a', 'b'] },
      ],
    })
    const items = spec!.items as Array<Record<string, unknown>>
    expect(items[0]!.answer).toBeUndefined()
    expect(items[1]!.answer).toBe(1)
  })

  it('validate accepts the new optional fields', () => {
    const result = validateGenuiSpec({
      items: [
        { type: 'radio', label: 'q', group: 'g', answer: 0, explanation: 'x', options: ['a'] },
        { type: 'submit', label: 'Hand in', action: 'g', resetAction: 'r', groups: ['g'] },
      ],
    })
    expect(result.ok).toBe(true)
  })
})
