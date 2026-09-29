// Regression corpus for the fence-killing field-name defects observed in two
// real sessions (2026-09-15, dsh-genui 0.10.0 / upstream main 0.11.1-preview.1):
// 62 emitted ```dsh-ui fences, 17 of which never rendered. Every one of the 17
// was a single component dropped by repair — `callout.text`, `table` without
// `columns`, `keyvalue.items` — which fails `isRenderableProcess` and sends the
// WHOLE fence back to a raw code block (fence-render.tsx → resolveGenuiSpec
// null → FenceFallback / DOM-channel "keep the stock block").
//
// The bodies below are reduced but shape-faithful samples of those fences
// (values trimmed, field names verbatim). Each must render; a regression here
// means a user sees raw JSON instead of the UI the model intended.
import { describe, expect, it } from 'vitest'
import { processGenuiSpec, isRenderableProcess } from '../src/client/guard.ts'
import { parsePartialGenuiSpec } from '../src/client/parse-partial.ts'

/** The render decision the fence channels actually make, minus React. */
function renders(raw: string): boolean {
  const parsed = parsePartialGenuiSpec(raw)
  if (parsed === null) return false
  return isRenderableProcess(processGenuiSpec(parsed))
}

describe('field-name regression corpus (real-session fences)', () => {
  it.each([
    ['callout body written as text', '{"title":"Intranet todos","items":[{"type":"callout","tone":"warning","title":"To confirm","text":"1) registry push not run; 2) mirror source to confirm."}]}'],
    ['callout body written as body', '{"items":[{"type":"callout","body":"Note: back up before writing."}]}'],
    ['keyvalue pairs packed into items', '{"title":"Design finalized","items":[{"type":"keyvalue","items":[["Design doc","plans/result-export.md"],["Commit","03afb1e"]]}]}'],
    ['keyvalue pairs packed into rows', '{"items":[{"type":"keyvalue","rows":[{"key":"Task card","value":"7/7"},{"key":"pytest","value":"327 passed"}]}]}'],
    ['table given only a 2-D data array', '{"title":"Delivery summary","items":[{"type":"table","data":[["Task","Owner","Result"],["t1 implementation","engineer","✅ 550 lines"],["t2 tests","engineer","✅ 213 checks"]]}]}'],
    ['table given only headers+data', '{"items":[{"type":"table","headers":["Check","Result"],"data":[["/health","200 OK"],["Home not logged in","302 → CAS"]]}]}'],
    ['diff written as items', '{"items":[{"type":"diff","items":[{"path":"app/api.py","oldText":null,"newText":"def export_csv(): ..."}]}]}'],
    ['image written as url', '{"items":[{"type":"image","url":"https://example.com/a.png","alt":"Cover"}]}'],
    ['code written as content', '{"items":[{"type":"code","lang":"python","content":"rows_to_csv(rows)"}]}'],
    ['copy written as content', '{"items":[{"type":"copy","content":"git push origin main"}]}'],
    ['quiz uses title+choices', '{"items":[{"type":"quiz","title":"Which statement is read-only?","choices":["SELECT","INSERT"],"answer":0}]}'],
  ])('renders a fence whose component uses the model-intuitive field name: %s', (_label, raw) => {
    expect(renders(raw)).toBe(true)
  })

  // Issue #186 corpus: high-frequency miswrites observed across ten degraded
  // real-session fences (0.11.0 / DSH 0.1.5-rc.2). Each must now render
  // outright — the aliases/normalization fix them before validation.
  it.each([
    ['table packs a 2-D array into items and omits columns', '{"items":[{"type":"table","items":[["Check","Result"],["/health","200 OK"],["Home not logged in","302 → CAS"]]}]}'],
    ['keyvalue records written as {label,value}', '{"items":[{"type":"keyvalue","items":[{"label":"Task card","value":"7/7"},{"label":"pytest","value":"327 passed"}]}]}'],
    ['file-tree uses nodes with records written as {label,desc,children}', '{"items":[{"type":"file-tree","nodes":[{"label":"src","desc":"Source","children":[{"label":"main.py"}]},{"label":"README.md"}]}]}'],
    ['callout tone written as danger with the body written as desc', '{"items":[{"type":"callout","tone":"danger","desc":"Mirror source to confirm."}]}'],
    ['a bare component array sent at the root', '[{"type":"stat","label":"Passed","value":"327"},{"type":"callout","content":"All passed."}]'],
  ])('renders an issue #186 miswrite outright: %s', (_label, raw) => {
    expect(renders(raw)).toBe(true)
  })

  it('unwraps a double-encoded fence body (issue #186 case 8)', () => {
    const inner = JSON.stringify({ items: [{ type: 'stat', label: 'Passed', value: '327' }] })
    // The whole spec arrived as a JSON string (literal \" in the fence body).
    expect(renders(JSON.stringify(inner))).toBe(true)
    const parsed = parsePartialGenuiSpec(JSON.stringify(inner))
    expect(parsed).not.toBeNull()
    expect(processGenuiSpec(parsed).repaired?.items).toEqual([{ type: 'stat', label: 'Passed', value: '327' }])
  })

  it('repairs the issue #186 shapes into canonical trees', () => {
    const processed = processGenuiSpec(JSON.parse('{"items":[{"type":"file-tree","nodes":[{"label":"src","children":[{"label":"main.py"}]}]}]}'))
    // label→name at every depth, `type:dir` defaulted for parents, stray
    // record fields (desc) dropped silently by repair.
    expect(processed.repaired?.items[0]).toEqual({
      type: 'file-tree',
      items: [{ name: 'src', type: 'dir', children: [{ name: 'main.py' }] }],
    })
    const callout = processGenuiSpec(JSON.parse('{"items":[{"type":"callout","tone":"danger","desc":"x"}]}'))
    expect(callout.repaired?.items[0]).toEqual({ type: 'callout', content: 'x', tone: 'error' })
    const table = processGenuiSpec(JSON.parse('{"items":[{"type":"table","items":[["Check","Result"],["/health","200"]]}]}'))
    expect(table.repaired?.items[0]).toEqual({ type: 'table', columns: ['Check', 'Result'], rows: [['/health', '200']] })
  })

  it('renders the two real large fences end to end', () => {    // The MR17072 risk-inventory fence (api.shop.sc.weibo.com session): a
    // callout + 8-row table + list, previously degraded to one code block.
    const riskInventory = JSON.stringify({
      title: 'MR !7072 code review · latent risk inventory',
      gap: 14,
      items: [
        { type: 'callout', tone: 'error', title: 'Blocker: the MR\'s own CI cases are red on HEAD', text: 'It asserts Meituanoffline.php must not contain fetch_row, but HEAD reverted it.' },
        {
          type: 'table',
          columns: ['Severity', 'Location', 'Problem', 'Impact'],
          rows: [
            ['Blocker', 'tests/FixjdstatusControllerTest.php:135', 'HEAD reverted the R1 fetch_one fix', 'CI stays red, cannot merge'],
            ['High', 'Fixjdstatus.php:650,658', 'sync writes .sync_offset even on a dry run', 'Running a dry run first silently does nothing'],
            ['Medium', 'Model/Product/Updatecount.php:230-235', 'The alert slot is claimed and then deleted', 'No alert during that window if sending fails'],
            ['Low', 'Jd/Info.php + 5 call sites', 'Return-value contract changed', 'Checked one by one, no regressions'],
          ],
        },
        {
          type: 'list',
          items: [
            { title: 'Settle the R1 wording first', description: 'Restore fetch_one and keep the guard test, or delete the test and the doc conclusion together' },
            { title: 'Guard the offset write with if ($do)', description: 'Advance only after the batch write actually succeeds' },
          ],
        },
      ],
    })
    expect(renders(riskInventory)).toBe(true)

    // The result-export design fence (clickhouse session): a nested-array
    // list plus keyvalue, previously degraded to one code block.
    const designSummary = JSON.stringify({
      title: 'Result export CSV · design finalized',
      gap: 12,
      items: [
        {
          type: 'list',
          items: [
            ['Data source: on export the server re-runs that tab\'s original SQL (through the full /api/query pipeline)'],
            ['Format: CSV only (RFC 4180 + UTF-8 BOM)'],
            ['File name: <table>-<YYYYMMDD-HHMMSS>.csv'],
          ],
        },
        { type: 'keyvalue', items: [['Design doc', 'plans/result-export.md'], ['Commit', '03afb1e (pushed)']] },
      ],
    })
    expect(renders(designSummary)).toBe(true)
  })

  it('documents the still-open object-array table case', () => {
    // `{type:'table', data:[{col:…}, …]}` with NO columns is still dropped:
    // object rows carry their own header keys, and deriving columns from them
    // without a declared column set is a separate design decision (it would
    // silently invent column order). It stays a known gap, not a silent fix.
    expect(renders('{"items":[{"type":"table","data":[{"tool":"a","result":"✅"}]}]}')).toBe(false)
  })

  it('renders and repairs the cell-dump shapes the model writes for lists/pairs', () => {
    const parsed = parsePartialGenuiSpec(JSON.stringify({
      items: [
        { type: 'list', items: [['Data source: a'], ['Format: b']] },
        { type: 'list', items: [{ title: 'Settle the R1 wording first', description: 'Restore fetch_one' }] },
        { type: 'keyvalue', items: [['Design doc', 'plans/x.md']] },
      ],
    }))
    expect(parsed).not.toBeNull()
    const processed = processGenuiSpec(parsed as unknown)
    expect(processed.errors).toEqual([])
    expect(isRenderableProcess(processed)).toBe(true)
    // Without these the list renders EMPTY and the keyvalue loses every pair —
    // both are "renders but shows nothing" variants of the same field-name
    // class of defect.
    expect(processed.repaired?.items).toEqual([
      { type: 'list', items: ['Data source: a', 'Format: b'] },
      { type: 'list', items: [{ title: 'Settle the R1 wording first', desc: 'Restore fetch_one' }] },
      { type: 'keyvalue', pairs: [{ key: 'Design doc', value: 'plans/x.md' }] },
    ])
  })

  it('leaves canonical bodies untouched (no alias churn)', () => {
    const canonical = JSON.stringify({
      title: 'Valid fence',
      items: [
        { type: 'callout', tone: 'info', title: 'Title', content: 'Body' },
        { type: 'keyvalue', pairs: [{ key: 'k', value: 'v' }] },
        { type: 'table', columns: ['a'], rows: [['1']] },
      ],
    })
    const parsed = parsePartialGenuiSpec(canonical)
    expect(parsed).not.toBeNull()
    const processed = processGenuiSpec(parsed as unknown)
    expect(processed.errors).toEqual([])
    expect(processed.warnings).toEqual([])
    expect(processed.repaired?.items).toEqual([
      { type: 'callout', tone: 'info', title: 'Title', content: 'Body' },
      { type: 'keyvalue', pairs: [{ key: 'k', value: 'v' }] },
      { type: 'table', columns: ['a'], rows: [['1']] },
    ])
  })
})
