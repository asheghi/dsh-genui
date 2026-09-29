// @vitest-environment jsdom
// v2.9 polish batch regressions:
// 1) chart hover tooltips (title attrs on bars / grouped bars / donut arcs,
//    SVG <title> on line dots);
// 2) slider form node (default + durable value + submit fields collection);
// 3) table local sorting (asc / desc / reset, numeric-aware);
// 4) plot series kinds (line default, area polygon, scatter dots);
// 5) asset prefetch links injected at boot.
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GenuiActionContext } from '../src/client/action-context.ts'
import { GenuiBlock, GENUI_ACTION_DEBOUNCE_MS } from '../src/client/GenuiBlock.tsx'
import { repairGenuiSpec } from '../src/client/guard.ts'
import { CORE_PRESETS } from '../src/client/echarts-lazy.ts'
import { formatChartValue, fractionDigits, tableToCsv, tableToMarkdown } from '../src/client/blocks/charts.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
})
beforeEach(() => {
  vi.useFakeTimers()
})

describe('formatChartValue', () => {
  it('rounds calculated values to the source precision without changing exact values', () => {
    expect(formatChartValue(26.7599999999998, 2)).toBe('26.76')
    expect(formatChartValue(0.30000000000000004, 1)).toBe('0.3')
    expect(formatChartValue(12.520000000000001, 2)).toBe('12.52')
    expect(formatChartValue(1.234, 3)).toBe('1.234')
    expect(formatChartValue(100, 0)).toBe('100')
    expect(formatChartValue(1000000000000001, 0)).toBe('1000000000000001')
    expect(formatChartValue(Number.MAX_SAFE_INTEGER, 0)).toBe(String(Number.MAX_SAFE_INTEGER))
    expect(formatChartValue(1.000000000000001, 15)).toBe('1.000000000000001')
  })

  it('counts decimal places in standard and exponent notation', () => {
    expect(fractionDigits(1.23)).toBe(2)
    expect(fractionDigits(1)).toBe(0)
    expect(fractionDigits(1e-7)).toBe(7)
    expect(fractionDigits(1.2e-7)).toBe(8)
    expect(fractionDigits(1e3)).toBe(0)
    expect(formatChartValue(1.2e-7, fractionDigits(1.2e-7))).toBe('0.00000012')
  })
})

function renderBlock(spec: unknown, actions: Array<[string, Record<string, unknown>]> = []) {
  return render(
    <GenuiActionContext.Provider value={(a, p) => actions.push([a, p])}>
      <GenuiBlock spec={repairGenuiSpec(spec)!} />
    </GenuiActionContext.Provider>,
  )
}

describe('v15: export, palette and card accent', () => {
  it('serialises a table to Markdown and CSV (escaping included)', () => {
    const columns = ['Channel', 'Notes']
    const rows = [['Organic', 'has,a comma'], ['Paid|search', 'has"quotes"']]
    const md = tableToMarkdown(columns, rows)
    expect(md.split('\n')[0]).toBe('| Channel | Notes |')
    expect(md.split('\n')[1]).toBe('| --- | --- |')
    expect(md).toContain('Paid\\|search')
    const csv = tableToCsv(rows)
    expect(csv.split('\n')[0]).toBe('Organic,"has,a comma"')
    expect(csv).toContain('""quotes""')
  })

  it('shows the export chips only when table.export is set', () => {
    const off = renderBlock({ items: [{ type: 'table', columns: ['A'], rows: [['1']] }] })
    expect(off.container.querySelector('[class*="tableTools"]')).toBeNull()
    off.unmount()
    const on = renderBlock({ items: [{ type: 'table', export: true, columns: ['A'], rows: [['1']] }] })
    // `[class*="tableTool"]` would also match the `.tableTools` wrapper.
    const chips = on.container.querySelectorAll('[class*="tableTools"] button')
    expect(chips).toHaveLength(2)
    expect(chips[0]!.textContent).toBe('Copy Markdown')
  })

  it('accepts a hex palette and drops invalid colours', () => {
    const spec = repairGenuiSpec({
      items: [{ type: 'chart', palette: ['#ff8800', 'not-a-colour', '#3ecf8e'], data: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] }],
    })!
    expect((spec.items[0] as { palette?: string[] }).palette).toEqual(['#ff8800', '#3ecf8e'])
  })

  it('applies a card accent without changing the layout classes', () => {
    const { container } = renderBlock({
      items: [{ type: 'card', accent: '#f59e0b', title: 'Cost', items: [{ type: 'text', content: 'x' }] }],
    })
    const card = container.querySelector('[class*="card"]') as HTMLElement
    expect(card.getAttribute('style')).toContain('#f59e0b')
  })
})

describe('v14: echart presets and links', () => {
  it('keeps sankey/graph links through repair and drops malformed edges', () => {
    const spec = repairGenuiSpec({
      items: [{
        type: 'echart',
        preset: 'sankey',
        links: [
          { from: 'Entry', to: 'API', value: 40 },
          { from: 'API' },
          { to: 'Orphan' },
          { from: 'API', to: 'Render', value: 32 },
        ],
      }],
    })!
    const node = spec.items[0] as { links?: Array<{ from: string; to: string }> }
    expect(node.links).toHaveLength(2)
    expect(node.links?.[0]).toMatchObject({ from: 'Entry', to: 'API' })
  })

  it('accepts the new presets and rejects an unknown one', () => {
    for (const preset of ['radar', 'gauge', 'funnel', 'treemap', 'sankey', 'graph', 'heatmap', 'bigline']) {
      const spec = repairGenuiSpec({ items: [{ type: 'echart', preset, data: [{ label: 'A', value: 1 }] }] })!
      expect((spec.items[0] as { preset?: string }).preset).toBe(preset)
    }
    const bad = repairGenuiSpec({ items: [{ type: 'echart', preset: 'not-a-chart', data: [{ label: 'A', value: 1 }] }] })
    // Unknown preset is dropped (undefined), the node still renders with data.
    const node = bad?.items[0] as { preset?: string } | undefined
    expect(node?.preset).toBeUndefined()
  })

  it('only the core presets map to the small engine bundle', () => {
    expect([...CORE_PRESETS].sort()).toEqual(['area', 'bar', 'bigline', 'line', 'pie', 'scatter'])
  })
})

describe('v13: hero cover block and bento column spans', () => {
  it('renders a hero with its metric, title, subtitle and tone', () => {
    const { container } = renderBlock({
      items: [{ type: 'hero', label: 'Uptime', value: '99.96%', delta: '+0.02%', tone: 'success', title: 'Service health', subtitle: 'Last 30 days' }],
    })
    const hero = container.querySelector('[class*="hero"]') as HTMLElement
    expect(hero).not.toBeNull()
    expect(hero.className).toContain('heroSuccess')
    expect(container.textContent).toContain('Uptime')
    expect(container.textContent).toContain('Service health')
    expect(container.textContent).toContain('Last 30 days')
  })

  it('spans grid columns for bento layouts', () => {
    const { container } = renderBlock({
      items: [{ type: 'grid', cols: 3, items: [
        { type: 'card', span: 2, title: 'Wide card', items: [{ type: 'text', content: 'a' }] },
        { type: 'card', title: 'Narrow card', items: [{ type: 'text', content: 'b' }] },
      ] }],
    })
    const spanned = container.querySelector('[class*="gridSpan"]') as HTMLElement
    expect(spanned).not.toBeNull()
    expect(spanned.style.gridColumn).toBe('span 2')
    expect(container.querySelectorAll('[class*="gridSpan"]')).toHaveLength(1)
  })
})

describe('v12: local data binding (in-place filtering)', () => {
  it('filters table rows from a bound input, live', () => {
    const { container } = renderBlock({
      items: [
        { type: 'input', id: 'q', label: 'Search' },
        { type: 'table', columns: ['Service', 'P95'], filter: 'q', rows: [['API gateway', '128'], ['Search', '190'], ['Recs', '250']] },
      ],
    })
    const rows = () => container.querySelectorAll('tbody tr')
    expect(rows()).toHaveLength(3)
    fireEvent.change(container.querySelector('input')!, { target: { value: 'Search' } })
    expect(rows()).toHaveLength(1)
    expect(container.querySelector('tbody')?.textContent).toContain('190')
    expect(container.textContent).toContain('1 / 3 rows after filtering')
    fireEvent.change(container.querySelector('input')!, { target: { value: '' } })
    expect(rows()).toHaveLength(3)
  })

  it('restricts the filter to one column when filterColumn is set', () => {
    const { container } = renderBlock({
      items: [
        { type: 'input', id: 'q' },
        { type: 'table', columns: ['Service', 'Notes'], filter: 'q', filterColumn: 0, rows: [['API', 'gateway'], ['Search', 'API']] },
      ],
    })
    fireEvent.change(container.querySelector('input')!, { target: { value: 'api' } })
    const body = container.querySelector('tbody')?.textContent ?? ''
    expect(body).toContain('API')
    expect(body).not.toContain('Search')
  })

  it('sorts by a bound select value', () => {
    const { container } = renderBlock({
      items: [
        { type: 'select', id: 'sort', options: ['P95'] },
        { type: 'table', columns: ['Service', 'P95'], sortField: 'sort', rows: [['A', '250'], ['B', '128']] },
      ],
    })
    fireEvent.change(container.querySelector('select')!, { target: { value: 'P95' } })
    const first = container.querySelector('tbody tr')?.textContent ?? ''
    expect(first).toContain('B')
  })

  it('filters chart categories and list items', () => {
    const chart = renderBlock({
      items: [
        { type: 'input', id: 'q' },
        { type: 'chart', filter: 'q', data: [{ label: 'Search', value: 82 }, { label: 'Social', value: 41 }] },
      ],
    })
    fireEvent.change(chart.container.querySelector('input')!, { target: { value: 'Search' } })
    expect(chart.container.querySelectorAll('[class*="barCol"]')).toHaveLength(1)
    chart.unmount()

    const list = renderBlock({
      items: [
        { type: 'input', id: 'q' },
        { type: 'list', filter: 'q', items: ['Apple', 'Banana', 'Apple pie'] },
      ],
    })
    fireEvent.change(list.container.querySelector('input')!, { target: { value: 'Apple' } })
    expect(list.container.querySelectorAll('[class*="li"]').length).toBeGreaterThanOrEqual(2)
    expect(list.container.textContent).toContain('2 / 3 matched')
  })
})

describe('v11: table master-detail rows', () => {
  it('expands a row into its detail panel and folds it back', () => {
    const { container } = renderBlock({
      items: [{
        type: 'table',
        columns: ['Service', 'P95'],
        rows: [['API gateway', '128'], ['Search', '190']],
        details: [[{ type: 'text', content: 'detail body' }], null],
      }],
    })
    // Only the row that carries details gets a toggle.
    const toggles = container.querySelectorAll('[class*="detailToggle"]')
    expect(toggles).toHaveLength(1)
    expect(toggles[0]!.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[class*="detailRow"]')).toBeNull()

    fireEvent.click(toggles[0]!)
    expect(container.querySelector('[class*="detailToggle"]')!.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[class*="detailRow"]')?.textContent).toContain('detail body')

    fireEvent.click(container.querySelector('[class*="detailToggle"]')!)
    expect(container.querySelector('[class*="detailRow"]')).toBeNull()
  })

  it('drops a details array whose entries all repair away', () => {
    const spec = repairGenuiSpec({
      items: [{
        type: 'table',
        columns: ['A'],
        rows: [['1']],
        // A known type missing its required fields repairs away; unknown types
        // are opaque by policy and would be kept, so this uses the former.
        details: [[{ type: 'stat' }]],
      }],
    })!
    const table = spec.items[0] as { details?: unknown }
    expect(table.details).toBeUndefined()
  })
})

describe('v7: table sections/totals, stacked bars, card tones', () => {
  it('renders a group header row spanning every column', () => {
    const { container } = renderBlock({
      items: [{
        type: 'table',
        columns: ['Region', 'Q1', 'Q2'],
        types: ['group', 'num', 'num'],
        rows: [['East', '', ''], ['Shanghai', '120', '138']],
      }],
    })
    const groupCell = container.querySelector('[class*="groupRow"] td')
    // v10: the header is a toggle with a chevron and the child count.
    expect(groupCell?.textContent).toBe('▾East1')
    expect(groupCell?.getAttribute('colspan')).toBe('3')
    expect(container.querySelector('[class*="groupToggle"]')?.getAttribute('aria-expanded')).toBe('true')
    // Children are indented under the section.
    expect(container.querySelectorAll('tr[class*="groupChild"]')).toHaveLength(1)
  })

  it('folds a section away and back', () => {
    const { container } = renderBlock({
      items: [{
        type: 'table',
        columns: ['Region', 'Q1'],
        types: ['group', 'num'],
        rows: [['East', ''], ['Shanghai', '120'], ['Hangzhou', '96']],
      }],
    })
    expect(container.querySelectorAll('tr[class*="groupChild"]')).toHaveLength(2)
    fireEvent.click(container.querySelector('[class*="groupToggle"]')!)
    expect(container.querySelectorAll('tr[class*="groupChild"]')).toHaveLength(0)
    expect(container.querySelector('[class*="groupToggle"]')?.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(container.querySelector('[class*="groupToggle"]')!)
    expect(container.querySelectorAll('tr[class*="groupChild"]')).toHaveLength(2)
  })

  it('sums numeric columns into a footer row', () => {
    const { container } = renderBlock({
      items: [{
        type: 'table',
        columns: ['Region', 'Q1', 'Q2'],
        types: ['group', 'num', 'num'],
        total: true,
        rows: [['East', '', ''], ['Shanghai', '120', '138'], ['Hangzhou', '96', '104']],
      }],
    })
    const footer = [...container.querySelectorAll('tfoot td')].map(td => td.textContent)
    expect(footer[0]).toBe('Total')
    expect(footer[1]).toBe('216')
    expect(footer[2]).toBe('242')
  })

  it('stacks series segments instead of grouping them', () => {
    const { container } = renderBlock({
      items: [{
        type: 'chart',
        data: [],
        stacked: true,
        series: [
          { label: 'Done', data: [{ label: 'Q1', value: 30 }] },
          { label: 'In progress', data: [{ label: 'Q1', value: 10 }] },
        ],
      }],
    })
    const segments = container.querySelectorAll('[class*="stackSeg"]')
    expect(segments).toHaveLength(2)
    // 30/40 of the total height -> 75%.
    expect((segments[0] as HTMLElement).style.height).toBe('75%')
    const stack = segments[0]!.parentElement as HTMLElement
    expect(parseFloat(stack.style.height)).toBeLessThanOrEqual(100)
    expect(stack.style.height).toBe('100%')
  })

  it('scales vertical stacks by the largest category total', () => {
    const { container } = renderBlock({
      items: [{
        type: 'chart',
        data: [],
        stacked: true,
        series: [
          { label: 'A', data: [{ label: 'Q1', value: 30 }, { label: 'Q2', value: 10 }] },
          { label: 'B', data: [{ label: 'Q1', value: 10 }, { label: 'Q2', value: 10 }] },
        ],
      }],
    })
    const stacks = [...container.querySelectorAll('[class*="barCol"] > [class*="stack"]:not([class*="stackSeg"]):not([class*="stackValue"])')] as HTMLElement[]
    expect(stacks).toHaveLength(2)
    expect(stacks.map(stack => stack.style.height)).toEqual(['100%', '50%'])
    expect(container.querySelector('[class*="chartYAxis"]')?.textContent).toContain('40')
  })

  it('scales horizontal stacks by the largest category total', () => {
    const { container } = renderBlock({
      items: [{
        type: 'chart',
        data: [],
        horizontal: true,
        stacked: true,
        series: [
          { label: 'A', data: [{ label: 'Q1', value: 30 }, { label: 'Q2', value: 10 }] },
          { label: 'B', data: [{ label: 'Q1', value: 10 }, { label: 'Q2', value: 10 }] },
        ],
      }],
    })
    const tracks = [...container.querySelectorAll('[class*="hbarTrack"]:not([class*="hbarTracks"])')] as HTMLElement[]
    expect(tracks).toHaveLength(2)
    const totals = tracks.map(track => [...track.querySelectorAll('[class*="hbarSeg"]')]
      .reduce((sum, segment) => sum + parseFloat((segment as HTMLElement).style.width), 0))
    expect(totals).toEqual([100, 50])
  })

  it('formats computed totals for vertical stacked bars and tooltips', () => {
    const { container } = renderBlock({
      items: [{
        type: 'chart',
        data: [],
        stacked: true,
        series: [
          { label: 'A', data: [{ label: 'Q1', value: 0.1 }, { label: 'Q2', value: 1.234 }] },
          { label: 'B', data: [{ label: 'Q1', value: 0.2 }, { label: 'Q2', value: 2.2 }] },
        ],
      }],
    })
    expect([...container.querySelectorAll('[class*="barValue"]')].map(node => node.textContent)).toEqual(['0.3', '3.434'])
    fireEvent.mouseEnter(container.querySelector('[class*="stackSeg"]')!)
    expect(container.querySelector('[class*="chartTip"]')?.textContent).toContain('Total0.3')
    expect(container.textContent).not.toContain('0.30000000000000004')
    expect(container.textContent).not.toContain('3.3000000000000003')
  })

  it('formats computed totals for horizontal stacked bars and tooltips', () => {
    const { container } = renderBlock({
      items: [{
        type: 'chart',
        data: [],
        horizontal: true,
        stacked: true,
        series: [
          { label: 'A', data: [{ label: 'Q1', value: 0.1 }, { label: 'Q2', value: 1.1 }] },
          { label: 'B', data: [{ label: 'Q1', value: 0.2 }, { label: 'Q2', value: 2.2 }] },
        ],
      }],
    })
    expect([...container.querySelectorAll('[class*="hbarValue"]')].map(node => node.textContent)).toEqual(['0.3', '3.3'])
    expect(container.querySelector('[class*="hbarTrack"][title]')?.getAttribute('title')).toBe('Q1: 0.3')
    fireEvent.mouseEnter(container.querySelector('[class*="hbarSeg"]')!)
    expect(container.querySelector('[class*="chartTip"]')?.textContent).toContain('Total0.3')
    expect(container.textContent).not.toContain('0.30000000000000004')
    expect(container.textContent).not.toContain('3.3000000000000003')
  })

  it('formats computed totals for horizontal grouped bars and tooltips', () => {
    const { container } = renderBlock({
      items: [{
        type: 'chart',
        data: [],
        horizontal: true,
        series: [
          { label: 'A', data: [{ label: 'Q1', value: 0.1 }, { label: 'Q2', value: 1.1 }] },
          { label: 'B', data: [{ label: 'Q1', value: 0.2 }, { label: 'Q2', value: 2.2 }] },
        ],
      }],
    })
    expect([...container.querySelectorAll('[class*="hbarValue"]')].map(node => node.textContent)).toEqual(['0.3', '3.3'])
    fireEvent.mouseEnter(container.querySelector('[class*="hbarFill"]')!)
    expect(container.querySelector('[class*="chartTip"]')?.textContent).toContain('Total0.3')
    expect(container.textContent).not.toContain('0.30000000000000004')
    expect(container.textContent).not.toContain('3.3000000000000003')
  })

  it('formats computed totals in vertical grouped bar tooltips', () => {
    const { container } = renderBlock({
      items: [{
        type: 'chart',
        data: [],
        series: [
          { label: 'A', data: [{ label: 'Q1', value: 0.1 }, { label: 'Q2', value: 1.1 }] },
          { label: 'B', data: [{ label: 'Q1', value: 0.2 }, { label: 'Q2', value: 2.2 }] },
        ],
      }],
    })
    fireEvent.mouseEnter(container.querySelector('[class*="groupedFill"]')!)
    expect(container.querySelector('[class*="chartTip"]')?.textContent).toContain('Total0.3')
    expect(container.textContent).not.toContain('0.30000000000000004')
    expect(container.textContent).not.toContain('3.3000000000000003')
  })

  it('shows an instant tooltip with the segment breakdown on hover', () => {
    const { container } = renderBlock({
      items: [{
        type: 'chart',
        data: [],
        stacked: true,
        series: [
          { label: 'Done', data: [{ label: 'Q1', value: 30 }] },
          { label: 'In progress', data: [{ label: 'Q1', value: 10 }] },
        ],
      }],
    })
    const segments = container.querySelectorAll('[class*="stackSeg"]')
    fireEvent.mouseEnter(segments[0]!)
    const tip = container.querySelector('[class*="chartTip"]')
    expect(tip?.textContent).toContain('Done')
    expect(tip?.textContent).toContain('30')
    expect(tip?.textContent).toContain('Total')
    fireEvent.mouseLeave(container.querySelector('[data-genui-chart]')!)
    expect(container.querySelector('[class*="chartTip"]')).toBeNull()
  })

  it('tints a card by tone', () => {
    const { container } = renderBlock({
      items: [{ type: 'card', tone: 'success', title: 'Passed', items: [{ type: 'text', content: 'ok' }] }],
    })
    expect(container.querySelector('[class*="cardSuccess"]')).not.toBeNull()
  })
})

describe('v6: rich table columns', () => {
  it('renders spark, ring and index cells', () => {
    const { container } = renderBlock({
      items: [{
        type: 'table',
        columns: ['#', 'Service', 'Trend', 'Uptime'],
        types: ['index', 'text', 'spark', 'ring'],
        rows: [['1', 'API', '3,5,4,8,6', '99.96']],
      }],
    })
    expect(container.querySelector('[class*="cellIndex"]')?.textContent).toBe('1')
    const spark = container.querySelector('svg[class*="cellSpark"]')
    expect(spark?.querySelector('polyline')?.getAttribute('points')?.split(' ')).toHaveLength(5)
    expect(container.querySelector('[class*="cellRing"]')?.textContent).toContain('99.96')
  })

  it('falls back to text when a spark cell has no number list', () => {
    const { container } = renderBlock({
      items: [{ type: 'table', columns: ['Trend'], types: ['spark'], rows: [['n/a']] }],
    })
    expect(container.querySelector('svg[class*="cellSpark"]')).toBeNull()
    expect(container.textContent).toContain('n/a')
  })
})

describe('v5: progress ring, target marker, stat unit split', () => {
  it('renders a ring gauge with the value in the middle', () => {
    const { container } = renderBlock({
      items: [{ type: 'progress', variant: 'ring', value: 72, label: 'Completion' }],
    })
    const ring = container.querySelector('[role="progressbar"]')
    expect(ring).not.toBeNull()
    expect(ring!.querySelector('svg')).not.toBeNull()
    expect(ring!.textContent).toContain('72%')
    expect(ring!.textContent).toContain('Completion')
  })

  it('marks the target on a bar track', () => {
    const { container } = renderBlock({
      items: [{ type: 'progress', value: 64, target: 80 }],
    })
    const mark = container.querySelector('[class*="targetMark"]') as HTMLElement
    expect(mark).not.toBeNull()
    expect(mark.style.left).toBe('80%')
  })

  it('splits a stat value into number and unit for the baseline typography', () => {
    const { container } = renderBlock({
      items: [{ type: 'stat', label: 'Memory', value: '6.8 GB' }],
    })
    const unit = container.querySelector('[class*="statUnit"]')
    expect(unit?.textContent).toBe('GB')
    expect(container.querySelector('[class*="statValue"]')?.textContent).toBe('6.8GB')
  })
})

describe('v3: stat sparkline', () => {
  it('renders one polyline point per spark value', () => {
    const { container } = renderBlock({
      items: [{ type: 'stat', label: 'P95', value: '42ms', spark: [3, 5, 4, 8, 6] }],
    })
    const spark = container.querySelector('svg[class*="statSpark"]')
    expect(spark).not.toBeNull()
    expect(spark!.querySelector('polyline')!.getAttribute('points')!.split(' ')).toHaveLength(5)
  })

  it('drops a spark that cannot draw a line', () => {
    const spec = repairGenuiSpec({ items: [{ type: 'stat', label: 'P95', value: '42ms', spark: [1] }] })!
    expect(spec.items[0]).toMatchObject({ type: 'stat' })
    expect((spec.items[0] as { spark?: number[] }).spark).toBeUndefined()
  })
})

describe('v2.9/v8: chart hover tooltips', () => {
  it('bars show the label and value in the instant tooltip', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', data: [{ label: 'One', value: 42 }] }],
    })
    fireEvent.mouseEnter(container.querySelector('[class*="barFill"]')!)
    const tip = container.querySelector('[class*="chartTip"]')
    expect(tip?.textContent).toContain('One')
    expect(tip?.textContent).toContain('42')
  })

  it('grouped bars name the series and the category total', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', series: [
        { label: 'This month', data: [{ label: 'Q1', value: 3 }] },
        { label: 'Last month', data: [{ label: 'Q1', value: 5 }] },
      ] }],
    })
    fireEvent.mouseEnter(container.querySelector('[class*="groupedFill"]')!)
    const tip = container.querySelector('[class*="chartTip"]')
    expect(tip?.textContent).toContain('This month')
    expect(tip?.textContent).toContain('3')
    expect(tip?.textContent).toContain('Total')
  })

  it('donut arcs show label, value and share', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', kind: 'donut', data: [{ label: 'A', value: 30 }] }],
    })
    fireEvent.mouseEnter(container.querySelector('[class*="donutSeg"]')!)
    const tip = container.querySelector('[class*="chartTip"]')
    expect(tip?.textContent).toContain('A')
    expect(tip?.textContent).toContain('30')
    expect(tip?.textContent).toContain('100.0%')
  })

  it('line dots show the point value', () => {
    const { container } = renderBlock({
      items: [{ type: 'chart', kind: 'line', data: [
        { label: 'Mon', value: 8 }, { label: 'Tue', value: 12 },
      ] }],
    })
    fireEvent.mouseEnter(container.querySelectorAll('[class*="lineDot"]')[0]!)
    expect(container.querySelector('[class*="chartTip"]')?.textContent).toContain('Mon')
    fireEvent.mouseEnter(container.querySelectorAll('[class*="lineDot"]')[1]!)
    expect(container.querySelector('[class*="chartTip"]')?.textContent).toContain('12')
  })
})

describe('v2.9: slider form node', () => {
  it('renders with the default value and fires a debounced action with id', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = renderBlock({
      items: [{ type: 'slider', label: 'Volume', min: 0, max: 10, value: 4, action: 'vol', id: 'v' }],
    }, actions)
    const input = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(input.value).toBe('4')
    fireEvent.change(input, { target: { value: '7' } })
    act(() => { vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS) })
    expect(actions).toEqual([['vol', { type: 'slider', value: 7, id: 'v' }]])
    // value readout follows the drag
    expect(container.textContent).toContain('7')
  })

  it('collects the value into a sibling submit fields payload', () => {
    const actions: Array<[string, Record<string, unknown>]> = []
    const { container } = renderBlock({
      items: [
        { type: 'slider', label: 'Volume', min: 0, max: 10, value: 2, action: 'vol', id: 'v' },
        { type: 'submit', label: 'Submit', action: 'send' },
      ],
    }, actions)
    fireEvent.change(container.querySelector('input[type="range"]')!, { target: { value: '9' } })
    fireEvent.click(container.querySelector('[class*="submitRow"] button')!)
    act(() => { vi.advanceTimersByTime(GENUI_ACTION_DEBOUNCE_MS) })
    const send = actions.find(([name]) => name === 'send')!
    expect(send[1]).toMatchObject({ type: 'submit', fields: { v: '9' } })
  })
})

describe('v2.9: table local sorting', () => {
  const spec = {
    items: [{ type: 'table', columns: ['Name', 'Qty'], rows: [
      ['Banana', '10'], ['Apple', '25'], ['Orange', 5],
    ] }],
  }

  const bodyRows = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('tbody tr')].map(tr => tr.textContent ?? '')

  it('sorts ascending, then descending, then restores the spec order (numeric-aware)', () => {
    const { container } = renderBlock(spec)
    const headers = container.querySelectorAll('thead th button')
    expect(bodyRows(container)).toEqual(['Banana10', 'Apple25', 'Orange5'])
    // numeric-aware ascending on the Qty column (5 < 10 < 25, not "10" < "25" < "5")
    fireEvent.click(headers[1]!)
    expect(bodyRows(container)).toEqual(['Orange5', 'Banana10', 'Apple25'])
    expect(headers[1]!.closest('th')!.getAttribute('aria-sort')).toBe('ascending')
    // descending
    fireEvent.click(headers[1]!)
    expect(bodyRows(container)).toEqual(['Apple25', 'Banana10', 'Orange5'])
    expect(headers[1]!.closest('th')!.getAttribute('aria-sort')).toBe('descending')
    // third click restores the spec order
    fireEvent.click(headers[1]!)
    expect(bodyRows(container)).toEqual(['Banana10', 'Apple25', 'Orange5'])
    expect(headers[1]!.closest('th')!.getAttribute('aria-sort')).toBe('none')
  })
})

describe('v2.9: plot series kinds', () => {
  const base = { xMin: 0, xMax: 1 }

  it('renders a line by default', () => {
    const { container } = renderBlock({ items: [{ type: 'plot', ...base, series: [{ expr: 'x' }] }] })
    expect(container.querySelectorAll('polyline').length).toBeGreaterThan(0)
    expect(container.querySelector('polygon')).toBeNull()
  })

  it('renders an area polygon to the baseline', () => {
    const { container } = renderBlock({ items: [{ type: 'plot', ...base, series: [{ expr: 'x', kind: 'area' }] }] })
    expect(container.querySelector('polygon')).not.toBeNull()
    expect(container.querySelectorAll('polyline').length).toBe(0)
  })

  it('renders scatter dots without a polyline', () => {
    const { container } = renderBlock({ items: [{ type: 'plot', ...base, series: [{ expr: 'x', kind: 'scatter' }] }] })
    expect(container.querySelectorAll('circle').length).toBeGreaterThan(10)
    expect(container.querySelectorAll('polyline').length).toBe(0)
  })
})
