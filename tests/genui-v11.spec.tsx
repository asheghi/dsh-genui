// @vitest-environment jsdom
// GenUI v1.1 components: plot (safe math), callout, steps, keyvalue, and the
// absorbed diff/json/code blocks render from a ```dsh-ui fence.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { hasFenceRegistry } from './helpers/fence-host'
import { MarkdownText } from './markdown-labels.tsx'
import { compileMathExpr, sampleExpr } from '../src/client/safe-math.ts'

afterEach(cleanup)

function fenced(spec: unknown): string {
  return `\`\`\`dsh-ui\n${JSON.stringify(spec)}\n\`\`\``
}

describe('SafeMath evaluator', () => {
  it('evaluates arithmetic and functions', () => {
    const f = compileMathExpr('sin(x) * 2 + 1')!
    expect(f).not.toBeNull()
    expect(f(0)).toBeCloseTo(1)
    expect(f(Math.PI / 2)).toBeCloseTo(3)
  })

  it('supports pow, sqrt, constants', () => {
    expect(compileMathExpr('sqrt(16)')!(0)).toBe(4)
    expect(compileMathExpr('2^10')!(0)).toBe(1024)
    expect(compileMathExpr('pi')!(0)).toBeCloseTo(Math.PI)
    expect(compileMathExpr('e')!(0)).toBeCloseTo(Math.E)
  })

  it('rejects injection: eval, globals, property access', () => {
    for (const bad of [
      'process.exit(1)', 'globalThis', 'this', 'constructor', 'import("fs")',
      'eval("1")', 'x.constructor', 'require("fs")', 'window', 'document',
    ]) {
      expect(compileMathExpr(bad), `should reject ${bad}`).toBeNull()
    }
  })

  it('samples a range into finite points', () => {
    const pts = sampleExpr('x^2', -2, 2, 5)
    expect(pts.length).toBe(5)
    expect(pts[0]![0]).toBe(-2)
    expect(pts[4]![0]).toBe(2)
    expect(pts[2]![1]).toBeCloseTo(0)
  })

  it('returns empty on invalid expression or range', () => {
    expect(sampleExpr('not an expr', -1, 1)).toEqual([])
    expect(sampleExpr('x', 5, 5)).toEqual([])
  })
})

describe('GenUI v1.1 components', () => {
  it.skipIf(!hasFenceRegistry)('renders a plot with multiple series and a legend', () => {
    render(<MarkdownText text={fenced({
      title: 'Function plot',
      items: [{ type: 'plot', title: 'sin vs cos', xMin: -3, xMax: 3, series: [
        { expr: 'sin(x)', label: 'sin' },
        { expr: 'cos(x)', label: 'cos', color: '#ff6b6b' },
      ] }],
    })} />)
    expect(document.querySelector('[data-genui-plot]')).not.toBeNull()
    expect(screen.getByText('sin')).toBeTruthy()
    expect(screen.getByText('cos')).toBeTruthy()
    expect(document.querySelectorAll('svg path')).not.toBeNull()
  })

  it.skipIf(!hasFenceRegistry)('renders an empty plot fallback for an invalid expression', () => {
    render(<MarkdownText text={fenced({ items: [{ type: 'plot', series: [{ expr: 'bogus(x)' }] }] })} />)
    expect(document.querySelector('[data-genui-plot]')).not.toBeNull()
    // The fallback echoes the offending expression instead of drawing a line.
    expect(document.body.textContent).toContain('bogus(x)')
  })

  it.skipIf(!hasFenceRegistry)('renders callout with tone', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'callout', tone: 'warning', title: 'Heads up', content: 'Disk almost full' },
    ] })} />)
    expect(screen.getByText('Heads up')).toBeTruthy()
    expect(screen.getByText('Disk almost full')).toBeTruthy()
    expect(document.querySelector('[data-genui-callout]')).not.toBeNull()
  })

  it.skipIf(!hasFenceRegistry)('renders steps with completion state', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'steps', current: 2, steps: [
        { title: 'Parse', desc: 'Read the input' },
        { title: 'Generate', desc: 'Produce the result' },
        { title: 'Verify', desc: 'Run the tests' },
      ] },
    ] })} />)
    expect(screen.getByText('Parse')).toBeTruthy()
    expect(screen.getByText('Verify')).toBeTruthy()
    expect(document.querySelectorAll('ol li')).toHaveLength(3)
    expect(document.querySelectorAll('li').length).toBe(3)
  })

  it.skipIf(!hasFenceRegistry)('renders keyvalue pairs', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'keyvalue', pairs: [{ key: 'Version', value: 'v2.4.1' }, { key: 'Mode', value: 'production' }] },
    ] })} />)
    expect(screen.getByText('Version')).toBeTruthy()
    expect(screen.getByText('v2.4.1')).toBeTruthy()
  })

  it('absorbed diff renders an inline diff', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'diff', diffs: [{ path: 'a.ts', oldText: 'const x = 1', newText: 'const x = 2' }] },
    ] })} />)
    expect(document.body.textContent).toContain('a.ts')
  })

  it('absorbed json renders a tree', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'json', value: { name: 'dsh', version: '0.0.1', tags: ['a', 'b'] } },
    ] })} />)
    expect(document.body.textContent).toContain('dsh')
    expect(document.body.textContent).toContain('version')
  })

  it('absorbed code renders a highlighted code block', () => {
    render(<MarkdownText text={fenced({ items: [
      { type: 'code', lang: 'ts', code: 'export const x = 42' },
    ] })} />)
    expect(document.body.textContent).toContain('export const x = 42')
  })
})
