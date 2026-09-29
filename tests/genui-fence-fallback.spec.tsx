// @vitest-environment jsdom
// Fence fallback diagnostics: a malformed ```dsh-ui body must never fail
// silently. While the host marks the message as streaming ([data-streaming])
// a partial body is expected and renders as a plain code block; once the
// message settles, a body that still does not parse as JSON shows a visible
// diagnostic (role=alert) with the parse position, keeping the raw code
// block below so no content is lost.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderGenuiFence } from '../src/client/index.tsx'
import { describeFenceFailure } from '../src/client/fence-render.tsx'

afterEach(cleanup)

// A body that neither parses as whole JSON nor yields any partial spec:
// the string value is cut mid-way and there is no closing `}` anywhere, so
// the partial parser has nothing to recover → the renderer falls back to
// the plain code block (the settled-defect path).
const BROKEN = '{"title":"\u6f14\u793a","items":[{"type":"text","content":"\u534a\u622a'

// A body that fails whole-JSON parsing but yields a usable partial prefix:
// `{"items":[{"type":"text","content":"\u597d\u4e86"}]}` is a complete spec, so the
// partial parser renders it; the trailing `,` + unclosed `{` never reaches
// the fallback. This documents the design boundary: partial UI renders, no
// error banner (the banner is only for the no-usable-content path).
const TRAILING = '{"title":"\u6f14\u793a","items":[{"type":"text","content":"\u597d\u4e86"}]},{"type":"text","content":"\u5c3e\u5df4"}'

describe('fence fallback diagnostics', () => {
  it('shows no diagnostic while the message is streaming', () => {
    render(<div data-streaming="true">{renderGenuiFence(BROKEN, 'k1')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    // The raw body stays visible as a code block during streaming.
    expect(document.body.textContent).toContain('\u534a\u622a')
  })

  it('surfaces the parse failure once the message settles', () => {
    const { rerender } = render(<div data-streaming="true">{renderGenuiFence(BROKEN, 'k2')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    rerender(<div>{renderGenuiFence(BROKEN, 'k2')}</div>)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('failed to parse')
    // Raw content preserved below the diagnostic.
    expect(document.body.textContent).toContain('\u534a\u622a')
  })

  it('treats hosts without the streaming marker as settled on first mount', () => {
    render(<div>{renderGenuiFence(BROKEN, 'k3')}</div>)
    expect(screen.getByRole('alert').textContent).toContain('failed to parse')
  })

  it('stays silent for a valid settled body', () => {
    render(<div>{renderGenuiFence('{"title":"\u597d","items":[{"type":"text","content":"\u6b63\u5e38"}]}', 'k4')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('\u6b63\u5e38')
  })

  it('renders partial UI for trailing junk without the diagnostic', () => {
    const { rerender } = render(<div data-streaming="true">{renderGenuiFence(TRAILING, 'k5')}</div>)
    rerender(<div>{renderGenuiFence(TRAILING, 'k5')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    // The finished prefix renders as real UI.
    expect(document.body.textContent).toContain('\u597d\u4e86')
  })

  it('keeps the raw body visible alongside the diagnostic', () => {
    render(<div>{renderGenuiFence(BROKEN, 'k6')}</div>)
    expect(screen.getByRole('alert').textContent).toContain('failed to parse')
    expect(document.body.textContent).toContain('\u534a\u622a')
  })
})

describe('tier-2 structural repair (settled messages only)', () => {
  // The rows array is closed with `}` instead of `]` — ending `"1"]}]}]}`
  // where `"1"]]}]}` was meant. The stray `}` lands BEFORE the table
  // object's own `}`, so the partial parser has no recoverable prefix
  // (it breaks on the mismatch and never sees the table's `}`): tier-2 must
  // skip the mismatched closer and render the repaired spec — no banner.
  const STRAY_CLOSER =
    '{"title":"x","items":[{"type":"table","columns":["a"],"rows":[["1"]}]}]}]}'
  // A missing closer (plain truncation): tier-2 appends the missing `]` `}`.
  const MISSING_CLOSER =
    '{"title":"x","items":[{"type":"text","content":"\u534a\u622a'

  it('repairs a mismatched closer once settled', () => {
    render(<div>{renderGenuiFence(STRAY_CLOSER, 't1', { source: { id: 's', order: [1, 0, 0] } })}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    // The repaired table renders silently — no amber note.
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.body.textContent).toContain('1')
  })

  it('repairs a missing closer once settled', () => {
    render(<div>{renderGenuiFence(MISSING_CLOSER, 't2', { source: { id: 's', order: [1, 0, 0] } })}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.body.textContent).toContain('\u534a\u622a')
  })

  it('never applies structural repair while streaming', () => {
    render(<div data-streaming="true">{renderGenuiFence(STRAY_CLOSER, 't3')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.body.textContent).toContain('rows')
  })

  // The exact real-world failure that motivated this repair: a long table
  // spec whose rows-array close `]` was emitted as `}` (ending `"]}]}]}`
  // instead of `"]]}]}`). Parse error at the stray `}` (position 649 in the
  // original). Partial parsing cannot recover (the mismatch precedes the
  // table object's own `}`) — only tier-2's skip-the-mismatch can.
  const REAL_WORLD =
    '{"title":"DSH \u4fa7\u53ef\u590d\u7528\u7f1d\u9699","gap":10,"items":[{"type":"table","columns":["\u7f1d\u9699","\u4f5c\u7528","recap \u7528\u6cd5"],"rows":[["ctx.llm","provider \u4e2d\u7acb LLM \u6d41\u5f0f\u670d\u52a1","recap \u751f\u6210\u8c03\u7528（compact-basic / dsh-rewind \u540c\u6b3e）"],["ctx.commands","\u4eba\u7c7b\u76f4\u63a5\u547d\u4ee4\u6ce8\u518c（/compact \u6a21\u5f0f）","\u6ce8\u518c /recap，\u76f4\u63a5\u6267\u884c、\u96f6\u6a21\u578b\u8f6e\u8be2"],["session \u4e8b\u4ef6\u6d41","append-only \u4e8b\u4ef6\u6e90（user/message、tool/result、request/header…）","recap \u4ece\u4e8b\u4ef6\u6d41\u6298\u53e0\u6765\u6e90 + \u8ffd\u52a0 log-only session/recap \u4e8b\u4ef6"],["ctx.sessionTitle","\u5f02\u6b65 LLM \u4f1a\u8bdd\u5143\u6570\u636e\u6a21\u677f","\u590d\u5236\u5b83\u7684 get/refresh/register \u670d\u52a1\u5f62\u6001"],["ctx.sessionProjections + Cache","\u72b6\u6001\u9a71\u52a8\u6298\u53e0\u5355\u5143，\u6301\u4e45\u5316\u7f13\u5b58\u4f9b GUI \u51b7\u8bfb","\u628a recap \u6ce8\u518c\u4e3a\u6295\u5f71\u5355\u5143，GUI \u514d\u8bfb\u5168\u91cf\u65e5\u5fd7"],["ctx.sessionQuery","\u4f1a\u8bdd\u8bfb\u53d6/\u641c\u7d22","recap \u5386\u53f2\u68c0\u7d22"],["client-modules","dsh.client \u58f0\u660e + /plugins/<id>/client.js","Web UI \u6e32\u67d3 recap \u5361\u7247"]}]}]}'

  it('repairs the real-world mismatched rows close', () => {
    render(<div>{renderGenuiFence(REAL_WORLD, 't4', { source: { id: 's', order: [1, 0, 0] } })}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    // The repaired table renders all seven rows.
    expect(document.body.textContent).toContain('ctx.sessionQuery')
    expect(document.body.textContent).toContain('Web UI \u6e32\u67d3 recap \u5361\u7247')
  })
})

describe('spec healing (parseable but structurally invalid)', () => {
  it('shows repaired schema failure instead of the original JSON parse failure', () => {
    const REPAIRED_SCHEMA_FAILURE = '{"items":[{"type":"stat","value":"\u597d",},]}'
    render(<div>{renderGenuiFence(REPAIRED_SCHEMA_FAILURE, 's0')}</div>)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('stat')
    expect(alert.textContent).toContain('label')
    expect(alert.textContent).not.toContain('failed to parse')
  })

  it('returns no diagnostic when settled repair produces a renderable spec', () => {
    const REPAIRED = '{"items":[{"type":"text","content":"\u597d",},]}'
    expect(describeFenceFailure(REPAIRED)).toBeNull()
  })

  it('uses settled repair for schema diagnostics', () => {
    const TIER2_SCHEMA_FAILURE = '{"items":[{"type":"stat","value":"\u597d"'
    expect(describeFenceFailure(TIER2_SCHEMA_FAILURE)).toContain('label')
    expect(describeFenceFailure(TIER2_SCHEMA_FAILURE, { settled: false })).toContain('failed to parse')
  })

  it('heals defects silently and renders the UI', () => {
    render(<div>{renderGenuiFence(
      '{"title":"x","items":[{"type":"table","columns":["a"],"rows":[["1"]]},[],["callout","info","\u5df2\u6392\u9664","x"],{"type":"button","label":"ok","action":"a"}]}',
      's1',
    )}</div>)
    // Healed nodes are dropped without any amber note.
    expect(screen.queryByRole('note')).toBeNull()
    // The repaired UI still renders.
    expect(document.body.textContent).toContain('ok')
  })

  it('stays silent for a clean spec', () => {
    render(<div>{renderGenuiFence('{"title":"x","items":[{"type":"text","content":"\u5e72\u51c0"}]}', 's2')}</div>)
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('ignores unknown-type entries (plugin custom components are valid)', () => {
    render(<div>{renderGenuiFence('{"items":[{"type":"custom-thing","x":1}]}', 's3')}</div>)
    expect(screen.queryByRole('note')).toBeNull()
  })
})

describe('automatic quote-escape repair', () => {
  // The most common model typo: Chinese text quoted with ASCII half-width
  // quotes inside a JSON string value — the exact failure that used to land
  // on the red banner (e.g. \u5bf9"\u522b\u540d\u8def\u5f84"\u5224\u5b9a\u5931\u8d25). The renderer must heal
  // it and render the UI instead of showing the diagnostic.
  const QUOTED = '{"title":"\u6f14\u793a","items":[{"type":"text","content":"\u5bf9"\u522b\u540d\u8def\u5f84"\u5224\u5b9a\u5931\u8d25"}]}'

  it('heals free-standing quotes inside string values and renders the UI', () => {
    render(<div>{renderGenuiFence(QUOTED, 'r1')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    // The repaired spec renders as real UI (not a raw code block).
    expect(document.body.textContent).toContain('\u5224\u5b9a\u5931\u8d25')
    // The auto-repair stays silent.
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('keeps the raw body as a code block when repair cannot succeed', () => {
    // Broken in a way the narrow repair cannot heal: unbalanced brackets.
    const UNREPAIRABLE = '{"title":"x","items":[{"type":"text","content":"\u534a\u622a'
    render(<div>{renderGenuiFence(UNREPAIRABLE, 'r2')}</div>)
    expect(screen.getByRole('alert').textContent).toContain('failed to parse')
    expect(document.body.textContent).toContain('\u534a\u622a')
  })

  it('does not touch already-valid JSON with escaped quotes', () => {
    const VALID = '{"title":"x","items":[{"type":"text","content":"\u4ed6\u8bf4\\"\u4f60\u597d\\""}]}'
    render(<div>{renderGenuiFence(VALID, 'r3')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('note')).toBeNull()
    expect(document.body.textContent).toContain('\u4f60\u597d')
  })

  it('repairs multiple quoted phrases in one body', () => {
    const MULTI = '{"title":"x","items":[{"type":"text","content":"\u4ed6\u8bf4"\u597d\u7684"\u7136\u540e"\u8d70\u4e86""}]}'
    render(<div>{renderGenuiFence(MULTI, 'r4')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('\u8d70\u4e86')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('heals the real-world failure: a table whose cells contain ASCII-quoted Chinese', () => {
    // Regression: the exact production incident — a table where several cell
    // values quote Chinese with half-width quotes (watch \u5bf9"\u522b\u540d\u8def\u5f84"\u5224\u5b9a\u5931\u8d25,
    // \u5fc5\u987b\u662f"\u7a7a\u7684", \u65ad\u8a00"\u7a7a\u73af\u5883"\u5931\u8d25). This body previously landed on the
    // red diagnostic banner; the repair must render the full table instead.
    const REAL = '{"title":"11 \u4e2a\u5931\u8d25\u5168\u6e05\u5355","gap":8,"items":[{"type":"table","columns":["\u6d4b\u8bd5\u6587\u4ef6","\u6d4b\u7684\u662f\u4ec0\u4e48","\u4e3a\u4ec0\u4e48\u6302","\u8ddf\u6211\u6709\u5173？"],"rows":[["hmr-config ×2","\u5f00\u53d1\u65f6\u914d\u7f6e\u6587\u4ef6\u70ed\u66f4\u65b0\u7684\u76d1\u542c\u884c\u4e3a","\u6d4b\u8bd5\u8def\u5f84\u5e26\u7b26\u53f7\u94fe\u63a5（\u673a\u5668\u4e0a ~/.dsh/source/current \u662f\u6307\u5411\u5feb\u7167\u7684\u94fe\u63a5），watch \u903b\u8f91\u5bf9"\u522b\u540d\u8def\u5f84"\u5224\u5b9a\u5931\u8d25","❌ \u57fa\u7ebf\u5c31\u6302（\u5df2\u5728\u6ca1\u6539\u52a8\u7684\u539f\u59cb\u5feb\u7167\u4e0a\u590d\u73b0）"],["profile ×1","profile \u76ee\u5f55\u81ea\u6108：\u628a"\u9519\u8bef\u7684\u7b26\u53f7\u94fe\u63a5"\u66ff\u6362\u6210\u5bf9\u7684","Node 24 \u7684\u5df2\u77e5 bug：rmSync \u5220\u4e0d\u6389\u6307\u5411\u76ee\u5f55\u7684\u7b26\u53f7\u94fe\u63a5（\u62a5 EISDIR），\u81ea\u6108\u4e00\u89e6\u53d1\u5c31\u5d29——\u8fd9\u662f\u673a\u5668\u4e0a AGENTS.md \u91cc\u8bb0\u5f55\u8fc7\u7684\u8001\u5751","❌ \u57fa\u7ebf\u5c31\u6302"],["workspace-context ×1","\u628a\u9ed8\u8ba4 DSH \u6570\u636e\u76ee\u5f55\u6807\u7b7e\u6210 ~/.dsh","\u6d4b\u8bd5\u65ad\u8a00\u4f9d\u8d56 HOME \u73af\u5883\u53d8\u91cf\u6307\u5411；\u6d4b\u8bd5\u73af\u5883\u91cc HOME \u6307\u5411\u7684\u4f4d\u7f6e\u4f7f\u65ad\u8a00\u843d\u7a7a","❌ \u57fa\u7ebf\u5c31\u6302"],["ui-trajectory client-bundle ×1","\u52a0\u8f7d\u9884\u6784\u5efa\u7684\u8f68\u8ff9\u89c6\u56fe bundle \u5e76\u9a8c\u8bc1\u6ce8\u518c","\u9700\u8981\u9884\u5148\u6784\u5efa\u597d\u7684 bundle \u4ea7\u7269，\u4ea7\u7269\u4e0e\u6e90\u7801\u4e0d\u540c\u6b65（\u8fc7\u671f\u4ea7\u7269）","❌ \u57fa\u7ebf\u5c31\u6302"],["workflow-workerthread ×1","\u9a8c\u8bc1 worker \u5b50\u8fdb\u7a0b\u7684\u73af\u5883\u5fc5\u987b\u662f"\u7a7a\u7684"","\u672c\u673a\u5168\u5c40\u73af\u5883\u53d8\u91cf（NODE_USE_ENV_PROXY、TSX_TSCONFIG_PATH \u7b49）\u6cc4\u6f0f\u8fdb worker，\u6d4b\u8bd5\u65ad\u8a00"\u7a7a\u73af\u5883"\u5931\u8d25","❌ \u57fa\u7ebf\u5c31\u6302（\u540c\u4e00\u73af\u5883\u53d8\u91cf\u4e5f\u5e72\u6270\u4e86\u522b\u5904）"],["oxlint-contract ×1","\u4ee3\u7801\u68c0\u67e5\u5668（oxlint）\u7684\u62a5\u9519\u6587\u672c\u683c\u5f0f","\u6587\u672c\u5339\u914d\u5076\u53d1\u8d85\u65f6；\u5355\u72ec\u91cd\u8dd1\u901a\u8fc7","❌ \u5e76\u884c\u8d1f\u8f7d flaky"],["code-block ×1","\u4ee3\u7801\u9ad8\u4eae\u8bed\u6cd5\u7684\u61d2\u52a0\u8f7d","\u8d85\u65f6\u7c7b（11 \u79d2\u9650），\u8d1f\u8f7d\u9ad8\u65f6\u53d8\u6162；\u5355\u72ec\u91cd\u8dd1\u901a\u8fc7","❌ \u5e76\u884c\u8d1f\u8f7d flaky"],["acp-snapshot ×3~4","\u5feb\u7167\u6d4b\u8bd5\u6846\u67b6\u7684\u56de\u5408\u7b49\u5f85\u65f6\u5e8f","\u4f9d\u8d56\u4e8b\u4ef6\u65f6\u5e8f，\u5e76\u884c\u8dd1\u65f6\u5076\u53d1；\u5355\u72ec\u8dd1 60/60 \u5168\u8fc7","❌ \u5e76\u884c\u8d1f\u8f7d flaky"]]}]}'
    render(<div>{renderGenuiFence(REAL, 'r5')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    // The repaired table renders (spot-check cells from the raw body).
    expect(document.body.textContent).toContain('hmr-config')
    expect(document.body.textContent).toContain('\u522b\u540d\u8def\u5f84')
    expect(document.body.textContent).toContain('\u7a7a\u73af\u5883')
    expect(document.body.textContent).toContain('acp-snapshot')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('drops trailing commas (tier-1, safe at any time)', () => {
    // The partial parser tolerates a trailing comma and renders the finished
    // components — either way the user sees UI, never the red banner.
    const TRAILING = '{"title":"x","items":[{"type":"text","content":"\u597d"},]}'
    render(<div>{renderGenuiFence(TRAILING, 'r6')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('\u597d')
  })

  it('completes missing brackets for settled messages (tier-2)', () => {
    // A body cut mid-structure: the partial parser renders the finished
    // prefix as UI; a settled message additionally heals the whole body.
    const CUT = '{"title":"x","items":[{"type":"text","content":"\u8865\u5168"}'
    render(<div>{renderGenuiFence(CUT, 'r7', { sessionId: 's', source: { id: 'x', order: [1, 0, 0] } })}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('\u8865\u5168')
  })

  it('does NOT complete a cut body while streaming (no source)', () => {
    // Without `context.source` the body may still be growing — completing it
    // would flash premature UI. It must stay a plain code block.
    const CUT = '{"title":"x","items":[{"type":"text","content":"\u534a\u622a'
    render(<div data-streaming="true">{renderGenuiFence(CUT, 'r8')}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('\u534a\u622a')
    // Even settled-but-source-less hosts (non-conversation surfaces) keep the
    // code block + diagnostic rather than inventing content.
    const { rerender } = render(<div data-streaming="true">{renderGenuiFence(CUT, 'r9')}</div>)
    rerender(<div>{renderGenuiFence(CUT, 'r9')}</div>)
    expect(screen.getByRole('alert').textContent).toContain('failed to parse')
  })

  it('completes an unterminated string for settled messages (tier-2)', () => {
    const CUT = '{"title":"x","items":[{"type":"text","content":"\u6ca1\u95ed\u5408'
    render(<div>{renderGenuiFence(CUT, 'r10', { sessionId: 's', source: { id: 'x', order: [1, 0, 0] } })}</div>)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(document.body.textContent).toContain('\u6ca1\u95ed\u5408')
    expect(screen.queryByRole('note')).toBeNull()
  })
})
