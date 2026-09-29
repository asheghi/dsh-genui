/**
 * mermaid sanitization gate: the rendered SVG is the only GenUI output that
 * reaches the DOM via dangerouslySetInnerHTML, so the last line of defense is
 * assertSafeSvg, not mermaid's own sanitizer. These cases pin that gate:
 * legitimate strict-mode mermaid output must pass; anything with script tags,
 * event-handler attributes, or javascript: URIs must throw.
 */
import { describe, expect, it } from 'vitest'
import { assertSafeSvg, ensureFlowchartKind, repairMermaidSource } from '../src/client/mermaid-lazy.ts'

const LEGIT = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><style>#a{fill:red}</style><path d="M0 0L1 1" fill="none" stroke="#333"/><text>graph TD</text></svg>`

describe('assertSafeSvg', () => {
  it('passes legitimate strict-mode mermaid output (style, path, text)', () => {
    expect(() => assertSafeSvg(LEGIT)).not.toThrow()
  })

  it('rejects an inline <script> tag', () => {
    expect(() => assertSafeSvg('<svg><script>alert(1)</script></svg>')).toThrow(/sanitization/)
  })

  it('rejects a case-variant <SCRIPT> tag', () => {
    expect(() => assertSafeSvg('<svg><SCRIPT>alert(1)</SCRIPT></svg>')).toThrow(/sanitization/)
  })

  it('rejects event-handler attributes (onload, onerror, onClick)', () => {
    expect(() => assertSafeSvg('<svg onload="alert(1)"></svg>')).toThrow(/sanitization/)
    expect(() => assertSafeSvg('<svg><path onerror="alert(1)"/></svg>')).toThrow(/sanitization/)
    expect(() => assertSafeSvg('<svg onclick="alert(1)"></svg>')).toThrow(/sanitization/)
  })

  it('rejects javascript: URIs', () => {
    expect(() => assertSafeSvg('<svg><a href="javascript:alert(1)">x</a></svg>')).toThrow(/sanitization/)
  })
})

describe('repairMermaidSource', () => {
  it('quotes unquoted CJK and space labels in graph sources', () => {
    const repaired = repairMermaidSource('graph LR\nA[\u6a21\u578b\u751f\u6210 spec] --> B[fence \u901a\u9053]\nB --> C[plain]')
    expect(repaired).toContain('A["\u6a21\u578b\u751f\u6210 spec"]')
    expect(repaired).toContain('B["fence \u901a\u9053"]')
    expect(repaired).toContain('C[plain]') // ASCII, no space: untouched
  })

  it('leaves already-quoted labels alone', () => {
    const src = 'graph LR\nA["\u6a21\u578b\u751f\u6210 spec"] --> B["x"]'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('strips <br/> tags', () => {
    const repaired = repairMermaidSource('graph LR\nA[\u9762\u677f<br/>dock] --> B[x]')
    expect(repaired).not.toContain('<br')
    expect(repaired).toContain('A["\u9762\u677f dock"]')
  })

  it('drops backticks even inside quoted labels (the live fence failure)', () => {
    const repaired = repairMermaidSource('graph LR\nA["```dsh-ui fence \u901a\u9053"] --> B[x]')
    expect(repaired).toContain('A["dsh-ui fence \u901a\u9053"]')
  })

  it('leaves non-flowchart kinds untouched', () => {
    const src = 'sequenceDiagram\nAlice->>Bob: \u4f60\u597d'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('never quotes labeled-edge spans (-- label -->)', () => {
    const src = 'graph TD\nH -- \u5426(\u6d41\u5f0f\u4e2d) --> J'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('quotes unquoted CJK node labels but not the edge label on the same line', () => {
    const src = 'graph TD\nA[\u6a21\u578b\u751f\u6210 spec] -- \u5426(\u6d41\u5f0f\u4e2d) --> B[\u4fee\u590d\u5b8c\u6210]'
    const repaired = repairMermaidSource(src)
    expect(repaired).toContain('A["\u6a21\u578b\u751f\u6210 spec"]')
    expect(repaired).toContain('B["\u4fee\u590d\u5b8c\u6210"]')
    expect(repaired).toContain('-- \u5426(\u6d41\u5f0f\u4e2d) -->')
    expect(repaired).not.toContain('("\u6d41\u5f0f\u4e2d")')
  })

  it('leaves thick and dotted edge labels alone', () => {
    const src = 'graph LR\nA == \u91cd\u8fde(\u5df2\u6062\u590d) ==> B\nA -. \u659c\u7ebf(\u5e26\u62ec\u53f7) .-> C'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('does not swallow the destination node of an unlabeled edge', () => {
    const src = 'graph LR\nA --> B[\u6a21\u578b] -- \u4e0b\u4e00\u6b65(\u786e\u8ba4) --> C'
    const repaired = repairMermaidSource(src)
    expect(repaired).toContain('B["\u6a21\u578b"]')
    expect(repaired).toContain('-- \u4e0b\u4e00\u6b65(\u786e\u8ba4) -->')
  })

  it('preserves edge labels when nothing else needs repair', () => {
    const src = 'graph TD\nA -- \u80fd --> B -- \u4e0d\u80fd --> C'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('quotes pipe edge labels containing brackets (the [genui-action] live failure)', () => {
    const src = 'flowchart LR\nUI -->|6. \u7528\u6237\u4ea4\u4e92 \u2192 [genui-action]| M'
    const repaired = repairMermaidSource(src)
    expect(repaired).toContain('|"6. \u7528\u6237\u4ea4\u4e92 \u2192 [genui-action]"|')
    expect(repaired).not.toContain('\u2192 ["genui-action"]')
  })

  it('never double-quotes a bracket inside a pipe label', () => {
    const src = 'flowchart LR\nA -->|\u6b65\u9aa4 [\u7b2c 2 \u6b65] \u5b8c\u6210| B'
    const repaired = repairMermaidSource(src)
    expect(repaired).toContain('|"\u6b65\u9aa4 [\u7b2c 2 \u6b65] \u5b8c\u6210"|')
    expect(repaired).not.toContain('["\u7b2c 2 \u6b65"]')
  })

  it('leaves bracket-free pipe labels alone', () => {
    const src = 'flowchart LR\nA -->|1. \u8f93\u51fa fence \u6587\u672c| B'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('leaves already-quoted pipe labels alone', () => {
    const src = 'flowchart LR\nUI -->|"6. \u7528\u6237\u4ea4\u4e92 \u2192 [genui-action]"| M'
    expect(repairMermaidSource(src)).toBe(src)
  })

  it('does not touch pipe characters inside node labels', () => {
    const src = 'graph LR\nA[a | b | c] --> B[plain]'
    const repaired = repairMermaidSource(src)
    expect(repaired).toContain('A["a | b | c"]')
    expect(repaired).toContain('B[plain]')
  })

  it('quotes pipe labels with brackets while CJK node labels on the same line are quoted too', () => {
    const src = 'flowchart LR\nA[\u6a21\u578b] -->|\u8f93\u51fa [spec]| B[\u6e32\u67d3]'
    const repaired = repairMermaidSource(src)
    expect(repaired).toContain('A["\u6a21\u578b"]')
    expect(repaired).toContain('|"\u8f93\u51fa [spec]"|')
    expect(repaired).toContain('B["\u6e32\u67d3"]')
  })
})

describe('ensureFlowchartKind', () => {
  it('prepends graph TD to an undeclared flowchart body (the live AI-output failure)', () => {
    const src = 'A[\u9ad8\u5e27\u7387\u6444\u50cf\u5934 120-240fps] --> B[\u4eba\u8138\u68c0\u6d4b+\u5173\u952e\u70b9\u8ffd\u8e2a]\nB --> C[ROI \u533a\u57df: \u989d\u5934/\u9762\u988a/\u9888\u90e8/\u54ac\u808c]'
    expect(ensureFlowchartKind(src)).toBe('graph TD\n' + src)
  })

  it('handles a multi-line body with thick and dotted edges', () => {
    const src = 'A ==> B\nB -.-> C\nC --> D'
    expect(ensureFlowchartKind(src)).toBe('graph TD\n' + src)
  })

  it('leaves an already-declared graph source unchanged', () => {
    const src = 'graph LR\nA --> B'
    expect(ensureFlowchartKind(src)).toBe(src)
  })

  it('leaves an already-declared flowchart source unchanged', () => {
    const src = 'flowchart TD\nA --> B'
    expect(ensureFlowchartKind(src)).toBe(src)
  })

  it('does not guess at a sequence-diagram body (-->> messages are not flowchart edges)', () => {
    const src = 'Alice->>Bob: \u4f60\u597d\nBob-->>Alice: \u6536\u5230'
    expect(ensureFlowchartKind(src)).toBe(src)
  })

  it('leaves other declared diagram kinds alone', () => {
    const src = 'pie\n  "A" : 1\n  "B" : 2'
    expect(ensureFlowchartKind(src)).toBe(src)
  })

  it('leaves plain text alone', () => {
    const src = 'hello world \u968f\u4fbf\u5199\u7684\u6587\u5b57'
    expect(ensureFlowchartKind(src)).toBe(src)
  })

  it('trims surrounding whitespace before prepending', () => {
    const src = '\n  A --> B\n'
    expect(ensureFlowchartKind(src)).toBe('graph TD\nA --> B')
  })
})
