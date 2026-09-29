// Regression for the "Tetris table" fence body (issue #192).
//
// Real session sample (insight: topic research / model selection, 2026-09-16): the model closed the
// `columns` array after the header cells and then wrote the row matrix as a
// SIBLING array element that still carried the `"rows":` key —
//
//   "columns":["\u94fe\u8def","\u7528\u54ea\u679a\u51ed\u8bc1","\u4f9d\u636e"],["rows":[[...],[...]]]
//
// Both sides of the body are bracket-BALANCED, so neither the closer-appending
// scan nor the client's partial parse can recover it: the whole fence stayed a
// raw code block. This test pins the shape rewrite that recovers it.
import { describe, expect, it } from 'vitest'
import { completeFenceJson, repairFenceJson } from '../src/shared/fence-repair.ts'
import { processGenuiSpec, isRenderableProcess, partialRepairGenuiSpec } from '../src/client/guard.ts'
import { parsePartialGenuiSpec } from '../src/client/parse-partial.ts'

/** The exact body captured from the session log. */
const TETRIS_TABLE = "{\"gap\":12,\"items\":[{\"type\":\"table\",\"columns\":[\"\u94fe\u8def\",\"\u7528\u54ea\u679a\u51ed\u8bc1\",\"\u4f9d\u636e\"],[\"rows\":[[\"\u8bdd\u9898\u641c\u7d22 search/statuses\",\"\u65e2\u6709 1083114296\",\"\u53ea\u6709\u5b83\u80fd\u8c03\uff08\u4f60\u786e\u8ba4\uff09\"],[\"show_batch\uff08\u6b63\u6587 + \u5a92\u4f53\uff09\",\"2807558683\",\"\u6b63\u6587\u9010\u5b57\u76f8\u540c + url_objects\uff0c\u4e25\u683c\u8d85\u96c6 \u2192 \u4e00\u6b21\u62ff\u5168\uff0c\u4e0d\u5fc5\u4e24\u6b21\u8bf7\u6c42\"],[\"queryid / count_sp / \u8bdd\u9898\u5bf9\u8c61\",\"\u4fdd\u6301\u65e2\u6709\",\"\u4e24\u679a\u90fd\u901a\uff0c\u7f29\u5c0f\u53d8\u66f4\u9762\"],[\"\u56fe\u7247 CDN / \u89c6\u9891 CDN\",\"\u4e0d\u9700\u8981\u51ed\u8bc1\uff0c\u4f46\u9700\u975e\u7a7a Referer\",\"\u5b9e\u6d4b\uff1a\u6211\u4eec\u57df\u540d\u4f5c Referer \u2192 \u56fe\u7247 200\u3001\u89c6\u9891 206\"]]]}]}"

describe('Tetris-shaped table columns (issue #192)', () => {
  it('is bracket-balanced yet does not parse — the reason the scan alone fails', () => {
    const count = (ch: string): number => TETRIS_TABLE.split(ch).length - 1
    expect(count('{')).toBe(count('}'))
    expect(count('[')).toBe(count(']'))
    expect(() => JSON.parse(TETRIS_TABLE)).toThrow()
  })

  it('is not healed by the quote/trailing-comma tier', () => {
    expect(repairFenceJson(TETRIS_TABLE)).toBeNull()
  })

  it('rewrites the sibling row matrix into a `rows` field', () => {
    const completed = completeFenceJson(TETRIS_TABLE)
    expect(completed).not.toBeNull()
    const value = JSON.parse(completed!.text) as { items: Array<Record<string, unknown>> }
    const table = value.items[0]!
    expect(table.type).toBe('table')
    expect(table.columns).toEqual(['\u94fe\u8def', '\u7528\u54ea\u679a\u51ed\u8bc1', '\u4f9d\u636e'])
    expect(table.rows).toHaveLength(4)
    expect(table.rows?.[0]).toEqual(['\u8bdd\u9898\u641c\u7d22 search/statuses', '\u65e2\u6709 1083114296', '\u53ea\u6709\u5b83\u80fd\u8c03\uff08\u4f60\u786e\u8ba4\uff09'])
    // The rewrite must leave legal JSON for the whole body, so the shared
    // pipeline can render it instead of degrading to a code block.
    expect(partialRepairGenuiSpec(processGenuiSpec(parsePartialGenuiSpec(completed!.text)!))).not.toBeNull()
  })

  it('handles the bare-matrix spelling (no `rows` key inside the array)', () => {
    const bare = '{"items":[{"type":"table","columns":["a","b"],[["1","2"],["3","4"]]}]}'
    const completed = completeFenceJson(bare)
    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({
      items: [{ type: 'table', columns: ['a', 'b'], rows: [['1', '2'], ['3', '4']] }],
    })
  })

  it('preserves siblings after a keyed Tetris table', () => {
    const raw =
      '{"items":[' +
        '{"type":"table","columns":["a"],["rows":[["x"]]]},' +
        '{"type":"text","content":"tail"}' +
      ']}'

    const completed = completeFenceJson(raw)

    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({
      items: [
        {
          type: 'table',
          columns: ['a'],
          rows: [['x']],
        },
        {
          type: 'text',
          content: 'tail',
        },
      ],
    })
  })

  it('preserves siblings after a bare-matrix Tetris table', () => {
    const raw =
      '{"items":[' +
        '{"type":"table","columns":["a"],[["x"]]},' +
        '{"type":"text","content":"tail"}' +
      ']}'

    const completed = completeFenceJson(raw)

    expect(completed).not.toBeNull()
    expect(JSON.parse(completed!.text)).toEqual({
      items: [
        {
          type: 'table',
          columns: ['a'],
          rows: [['x']],
        },
        {
          type: 'text',
          content: 'tail',
        },
      ],
    })
  })

  it('returns null when a Tetris rewrite leaves an unrecoverable defect', () => {
    const raw = '{"items":[{"type":"table","columns":["a"],[["x"]],"broken":}]}'
    const completed = completeFenceJson(raw)

    expect(completed).toBeNull()
  })

  it('leaves a legal columns+rows body untouched', () => {
    const legal = '{"items":[{"type":"table","columns":["a"],"rows":[["1"]]}]}'
    expect(completeFenceJson(legal)).toBeNull()
  })
})
