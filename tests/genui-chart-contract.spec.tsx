// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderGenuiFence, resolveGenuiSpec } from '../src/client/fence-render.tsx'
import { createRenderUiTool, createValidateDshUiTool } from '../src/plugin/tool.ts'

afterEach(cleanup)

describe('native chart renderability contract', () => {
  it('accepts grouped bars that carry their points in series (data: [])', () => {
    // Regression: the empty-data rule used to reject the grouped-bars form
    // wholesale, so a fence containing one never rendered.
    const raw = JSON.stringify({
      items: [{
        type: 'chart',
        data: [],
        series: [
          { label: 'This month', data: [{ label: 'Q1', value: 3 }, { label: 'Q2', value: 5 }] },
          { label: 'Last month', data: [{ label: 'Q1', value: 2 }, { label: 'Q2', value: 4 }] },
        ],
      }],
    })
    const spec = resolveGenuiSpec(raw)
    expect(spec).not.toBeNull()
    expect(spec?.items).toHaveLength(1)
    // Still undrawable when neither data nor series carries a point.
    expect(resolveGenuiSpec(JSON.stringify({
      items: [{ type: 'chart', data: [], series: [{ label: 'A', data: [] }] }],
    }))).toBeNull()
  })

  it('accepts multi-series line charts (v3) and still rejects donut series', () => {
    const raw = JSON.stringify({
      items: [{
        type: 'chart',
        kind: 'line',
        series: [
          { label: 'This month', data: [{ label: 'Monday', value: 128 }] },
          { label: 'Last month', data: [{ label: 'Monday', value: 96 }] },
        ],
      }],
    })
    const spec = resolveGenuiSpec(raw)
    expect(spec).not.toBeNull()
    expect(spec?.items).toHaveLength(1)

    // Donut is a share-of-total shape: series stays rejected there.
    const donut = JSON.stringify({
      items: [{ type: 'chart', kind: 'donut', series: [{ label: 'A', data: [{ label: 'X', value: 1 }] }] }],
    })
    expect(resolveGenuiSpec(donut)).toBeNull()
    render(<div>{renderGenuiFence(donut, 'donut-series')}</div>)
    expect(screen.getByRole('alert').textContent).toContain('series is only supported for bars and line')
  })

  it('rejects empty chart collections before they can render blank', () => {
    expect(resolveGenuiSpec(JSON.stringify({
      items: [{ type: 'chart', data: [] }],
    }))).toBeNull()

    expect(resolveGenuiSpec(JSON.stringify({
      items: [{ type: 'chart', series: [] }],
    }))).toBeNull()

    expect(resolveGenuiSpec(JSON.stringify({
      items: [{
        type: 'chart',
        series: [{ label: 'A', data: [] }],
      }],
    }))).toBeNull()
  })

  it('keeps grouped bars valid with non-empty series data', () => {
    const spec = resolveGenuiSpec(JSON.stringify({
      items: [{
        type: 'chart',
        kind: 'bars',
        series: [{ label: 'A', data: [{ label: 'Monday', value: 128 }] }],
      }],
    }))
    expect(spec).not.toBeNull()
    expect(spec!.items[0]).toMatchObject({ type: 'chart', kind: 'bars' })
  })

  it('rejects a card whose children field is missing instead of rendering an empty shell', () => {
    const raw = JSON.stringify({ items: [{ type: 'card', title: 'Empty card' }] })
    expect(resolveGenuiSpec(raw)).toBeNull()

    render(<div>{renderGenuiFence(raw, 'card-missing-items')}</div>)
    expect(screen.getByRole('alert').textContent).toContain('GenUI field validation failed')
    expect(screen.getByRole('alert').textContent).toContain('requires items')
  })

  it('allows extension fields but native repair ignores them', () => {
    const spec = resolveGenuiSpec(JSON.stringify({
      items: [{
        type: 'chart',
        kind: 'line',
        data: [{ label: 'Monday', value: 128, extension: true }],
        extension: { owner: 'another-plugin' },
      }],
    })) as { items: Array<Record<string, unknown> & { data?: Array<Record<string, unknown>> }> } | null

    expect(spec).not.toBeNull()
    expect(spec!.items[0]).not.toHaveProperty('extension')
    expect(spec!.items[0]!.data?.[0]).not.toHaveProperty('extension')
  })

  it('keeps validate, render metadata, and fence resolution on one canonical tree', async () => {
    const input = {
      title: 'Protocol aliases',
      items: [
        { type: 'card', label: 'Card', content: [{ type: 'text', text: 'Body' }] },
        { type: 'table', headers: ['Name'], data: [['Apple']] },
        { type: 'callout', kind: 'warning', content: 'Note' },
        { type: 'steps', items: [{ title: 'First step' }] },
      ],
    }
    const validation = String(await createValidateDshUiTool().execute({ spec: JSON.stringify(input) }))
    expect(validation).toContain('status=valid')
    expect(validation).toContain('path=items[0].label canonical=items[0].title')
    expect(validation).toContain('path=items[1].headers canonical=items[1].columns')
    expect(validation).toContain('path=items[2].kind canonical=items[2].tone')
    expect(validation).toContain('path=items[3].items canonical=items[3].steps')

    const renderTool = createRenderUiTool()
    const meta = renderTool.output.presentationMeta!({ spec: input })
    const resolved = resolveGenuiSpec(JSON.stringify(input))
    expect(meta).toEqual(resolved)
    expect(meta).toMatchObject({
      title: 'Protocol aliases',
      items: [
        { type: 'card', title: 'Card', items: [{ type: 'text', content: 'Body' }] },
        { type: 'table', columns: ['Name'], rows: [['Apple']] },
        { type: 'callout', tone: 'warning', content: 'Note' },
        { type: 'steps', steps: [{ title: 'First step' }] },
      ],
    })
  })

  it('warns for native extension fields while preserving custom renderer payloads', async () => {
    const input = {
      items: [
        { type: 'callout', content: 'Kept', extension: true },
        { type: 'custom-widget', extension: { owner: 'plugin' } },
      ],
    }
    const validation = String(await createValidateDshUiTool().execute({ spec: JSON.stringify(input) }))
    expect(validation).toContain('status=valid')
    expect(validation).toContain('items[0].extension')
    expect(validation).toContain('unknown field')

    const renderTool = createRenderUiTool()
    const meta = renderTool.output.presentationMeta!({ spec: input }) as {
      items: Array<Record<string, unknown>>
    }
    expect(meta.items[0]).not.toHaveProperty('extension')
    expect(meta.items[1]).toEqual(input.items[1])
    expect(await renderTool.execute({ spec: input })).toContain('rendered=2')
  })
})
