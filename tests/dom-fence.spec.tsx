// @vitest-environment jsdom
// DOM render channel: pure-plugin fence rendering on pristine hosts.
// Builds the stock CodeBlock surface (`.md-code-block` + banner label div +
// `<pre>`) inside a conversation row and drives the observer pipeline.
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { installDomFenceRenderer, setDomRootFactory, sourceLanguageOf } from '../src/client/dom-fence.tsx'
import { inject } from '../src/client/index.tsx'
import { clearSessionPanel, getPanelSpec } from '../src/client/panel-store.ts'

const VALID_SPEC = '{"title":"Card","items":[{"type":"text","content":"Hello, world"}]}'
const BUTTON_SPEC = '{"items":[{"type":"button","label":"Refresh","action":"refresh"}]}'
const PANEL_SPEC = '{"panel":true,"title":"Panel A","items":[{"type":"text","content":"A"}]}'
const BROKEN_SPEC = '{"items":[{"type":"text","content":'
const TIER2_SCHEMA_FAILURE = '{"items":[{"type":"stat","value":"ok"'

function makeCtx(sessionId: string | undefined, send: ReturnType<typeof vi.fn>): Context {
  return {
    sessions: { list: { getSnapshot: () => ({ current: sessionId }) } },
  } as unknown as Context
}

function makeModernCtx(sessionId: string): Context {
  return {
    sessions: {
      list: {
        getSnapshot: () => ({
          ids: ['sidebar-session', sessionId],
          byId: {
            'sidebar-session': { id: 'sidebar-session', retainedBy: { sidebar: 1 } },
            [sessionId]: { id: sessionId, retainedBy: { mainView: 1 } },
          },
          phase: 'ready',
          projectionsBySession: {},
        }),
      },
    },
  } as unknown as Context
}

function makeSourceCtx(sessionId: string, getChat: () => unknown, subscribe: (listener: () => void) => () => void): Context {
  const base = makeModernCtx(sessionId) as unknown as Record<string, unknown>
  return {
    ...base,
    get: (name: string) => name === 'uiConversation' ? {
      binding: () => ({ target: () => ({ getSnapshot: getChat, subscribe }) }),
    } : undefined,
  } as unknown as Context
}

/** Stock CodeBlock surface: wrapper.md-code-block > banner > label div + pre. */
function stockCodeBlock(raw: string, lang: string): HTMLElement {
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const banner = document.createElement('div')
  const label = document.createElement('div')
  label.textContent = lang
  banner.appendChild(label)
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = raw
  pre.appendChild(code)
  block.appendChild(banner)
  block.appendChild(pre)
  return block
}

/** Build the DSH 0.1.7 CodeToolbar DOM shape that shows only a generic label. */
function genericCodeBlock(raw: string, label = 'Code block'): HTMLElement {
  const block = stockCodeBlock(raw, label)
  block.querySelector('div')?.setAttribute('data-code-block-banner', '')
  return block
}

/** Deepsuite-style fence surface (issue #6): `.code-block` / span language
 * label + copy button in the banner, body wrapped in a content div. */
function deepsuiteCodeBlock(raw: string, lang: string, cls = 'code-block'): HTMLElement {
  const block = document.createElement('div')
  block.className = cls
  const banner = document.createElement('div')
  const label = document.createElement('span')
  label.textContent = lang
  const copy = document.createElement('button')
  copy.textContent = 'Copy'
  banner.appendChild(label)
  banner.appendChild(copy)
  const content = document.createElement('div')
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = raw
  pre.appendChild(code)
  content.appendChild(pre)
  block.appendChild(banner)
  block.appendChild(content)
  return block
}

function assistantRow(anchorKey: string, streaming = false): HTMLElement {
  const row = document.createElement('div')
  row.setAttribute('data-chat-anchor-key', anchorKey)
  row.setAttribute('data-chat-flow-kind', 'assistant-step')
  row.setAttribute('data-chat-node-key', anchorKey)
  if (streaming) row.setAttribute('data-streaming', '')
  return row
}

async function tick(ms = 40): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

/** Poll instead of a single fixed wait: the rAF sweep can land late under a
 *  loaded parallel test run, which made the growth assertion flaky. */
async function waitFor(predicate: () => boolean, ms = 1500): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (predicate()) return true
    await tick(30)
  }
  return predicate()
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('installDomFenceRenderer', () => {
  it.each(['Code', 'Code block', '\u4ee3\u7801\u5757'])('renders canonical GenUI from a generic %s banner', async label => {
    const row = assistantRow('generic-valid')
    const block = genericCodeBlock(VALID_SPEC, label)
    row.appendChild(block)
    document.body.appendChild(row)
    const dispose = installDomFenceRenderer(makeModernCtx('generic-session'), () => {})
    try {
      expect(await waitFor(() => block.hasAttribute('data-genui-rendered'))).toBe(true)
      expect(await waitFor(() => row.querySelector('.genui-dom-fence')?.textContent?.includes('Hello, world') === true)).toBe(true)
    } finally { dispose() }
  })

  it.each([
    '{"name":"ordinary","items":[]}',
    '{"items":[{"type":"text","content":',
    '{"items":[{"type":"button"}]}',
    '{"items":[{"type":"text","content":"hello","unknown":true}]}',
    '{"items":[{"type":"text","text":"alias"}]}',
  ])('keeps invalid or ordinary JSON in a generic CodeBlock: %s', async raw => {
    const row = assistantRow('generic-rejected')
    const block = genericCodeBlock(raw)
    row.appendChild(block)
    document.body.appendChild(row)
    const dispose = installDomFenceRenderer(makeModernCtx('generic-session'), () => {})
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(block.style.display).toBe('')
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
      expect(row.querySelector('.genui-dom-fence-diagnostic')).toBeNull()
    } finally { dispose() }
  })

  it.each(['json', 'javascript'])('honors explicit %s over GenUI-shaped content', async language => {
    const row = assistantRow(`explicit-${language}`)
    const block = stockCodeBlock(VALID_SPEC, language)
    row.appendChild(block)
    document.body.appendChild(row)
    const dispose = installDomFenceRenderer(makeModernCtx('explicit-session'), () => {})
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
    } finally { dispose() }
  })

  it('keeps a generic CodeBlock outside assistant conversation rows', async () => {
    const block = genericCodeBlock(VALID_SPEC)
    document.body.appendChild(block)
    const dispose = installDomFenceRenderer(makeModernCtx('sidebar-session'), () => {})
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(block.style.display).toBe('')
      expect(document.querySelector('.genui-dom-fence')).toBeNull()
    } finally { dispose() }
  })

  it('keeps explicit dsh-ui and earlier host language labels on the existing path', async () => {
    const row = assistantRow('explicit-genui')
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const dispose = installDomFenceRenderer(makeModernCtx('explicit-session'), () => {})
    try {
      expect(await waitFor(() => block.hasAttribute('data-genui-rendered'))).toBe(true)
      expect(await waitFor(() => row.querySelector('.genui-dom-fence')?.textContent?.includes('Hello, world') === true)).toBe(true)
    } finally { dispose() }
  })

  it('restores dsh-ui from ChatSnapshot when DSH shows a generic Code banner', async () => {
    const row = assistantRow('source-genui')
    const block = genericCodeBlock(VALID_SPEC)
    row.append(block)
    document.body.append(row)
    const chat = {
      nodes: {
        get: (key: string) => key === 'source-genui' ? {
          kind: 'assistant-step',
          data: { blocks: [{ kind: 'text', text: `\`\`\`dsh-ui\n${VALID_SPEC}\n\`\`\`` }] },
        } : undefined,
      },
    }
    const sourceCtx = makeSourceCtx('source-session', () => chat, () => () => {})
    expect(sourceLanguageOf(sourceCtx, block)).toBe('dsh-ui')
    const dispose = installDomFenceRenderer(sourceCtx, () => {})
    try {
      expect(await waitFor(() => block.hasAttribute('data-genui-rendered'))).toBe(true)
      expect(await waitFor(() => row.querySelector('.genui-dom-fence')?.textContent?.includes('Hello, world') === true)).toBe(true)
    } finally { dispose() }
  })

  it('parses each assistant Markdown source once after the opening language is stable', async () => {
    const row = assistantRow('cached-source')
    const block = genericCodeBlock(VALID_SPEC)
    row.append(block)
    document.body.append(row)
    let sourceReads = 0
    const data = Object.defineProperty({}, 'blocks', {
      get: () => {
        sourceReads += 1
        return [{ kind: 'text', text: `\`\`\`dsh-ui\n${VALID_SPEC}\n\`\`\`` }]
      },
    })
    const chat = { nodes: { get: () => ({ kind: 'assistant-step', data }) } }
    const dispose = installDomFenceRenderer(makeSourceCtx('source-session', () => chat, () => () => {}), () => {})
    try {
      expect(await waitFor(() => block.hasAttribute('data-genui-rendered'))).toBe(true)
      await tick(1100)
      expect(sourceReads).toBe(1)
    } finally { dispose() }
  })

  it('keeps rendering when the current session has no ChatSnapshot binding', async () => {
    const row = assistantRow('inactive-source')
    const block = genericCodeBlock(VALID_SPEC)
    row.append(block)
    document.body.append(row)
    const ctx = {
      ...makeModernCtx('inactive-session'),
      get: (name: string) => name === 'uiConversation' ? {
        binding: () => { throw new Error('session is inactive') },
      } : undefined,
    } as unknown as Context
    const dispose = installDomFenceRenderer(ctx, () => {})
    try {
      expect(await waitFor(() => block.hasAttribute('data-genui-rendered'))).toBe(true)
    } finally { dispose() }
  })

  it('retries the ChatSnapshot subscription after an unavailable session binding recovers', async () => {
    let available = false
    let subscriptions = 0
    const ctx = {
      ...makeModernCtx('recovering-session'),
      get: (name: string) => name === 'uiConversation' ? {
        binding: () => {
          if (!available) throw new Error('session is inactive')
          return { target: () => ({
            getSnapshot: () => undefined,
            subscribe: () => {
              subscriptions += 1
              return () => {}
            },
          }) }
        },
      } : undefined,
    } as unknown as Context
    const dispose = installDomFenceRenderer(ctx, () => {})
    try {
      await tick(40)
      expect(subscriptions).toBe(0)
      available = true
      expect(await waitFor(() => subscriptions === 1, 1500)).toBe(true)
    } finally { dispose() }
  })

  it.each([
    ['json', '```json'],
    ['foobar', '```foobar'],
    ['no language', '```'],
  ])('does not treat source %s as GenUI when the DOM is generic', async (_description, openingFence) => {
    const row = assistantRow(`source-other-${_description}`)
    const block = genericCodeBlock(VALID_SPEC)
    row.append(block)
    document.body.append(row)
    const chat = {
      nodes: {
        get: () => ({
          kind: 'assistant-step',
          data: { blocks: [{ kind: 'text', text: `${openingFence}\n${VALID_SPEC}\n\`\`\`` }] },
        }),
      },
    }
    const dispose = installDomFenceRenderer(makeSourceCtx('source-session', () => chat, () => () => {}), () => {})
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
    } finally { dispose() }
  })

  it('uses the ChatSnapshot subscription when the DOM appears before source data', async () => {
    const row = assistantRow('late-source', true)
    const partial = '{"items":[{"type":"text","content":"hel'
    const block = genericCodeBlock(partial)
    row.append(block)
    document.body.append(row)
    let chat: unknown = { nodes: { get: () => undefined } }
    let update: (() => void) | undefined
    const dispose = installDomFenceRenderer(makeSourceCtx('source-session', () => chat, listener => {
      update = listener
      return () => { update = undefined }
    }), () => {})
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      chat = {
        nodes: {
          get: () => ({ kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: `\`\`\`dsh-ui\n${partial}` }] } }),
        },
      }
      update?.()
      expect(await waitFor(() => block.hasAttribute('data-genui-rendered'))).toBe(true)
      expect(row.querySelector('.genui-dom-fence')).not.toBeNull()
      block.querySelector('code')!.textContent = VALID_SPEC
      chat = {
        nodes: {
          get: () => ({ kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: `\`\`\`dsh-ui\n${VALID_SPEC}\n\`\`\`` }] } }),
        },
      }
      update?.()
      expect(await waitFor(() => row.querySelector('.genui-dom-fence')?.textContent?.includes('Hello, world') === true)).toBe(true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('Hello, world')
    } finally { dispose() }
  })

  it('resolves source data that arrives before its DOM CodeBlock', async () => {
    const row = assistantRow('source-first')
    const chat = {
      nodes: {
        get: () => ({ kind: 'assistant-step', data: { blocks: [{ kind: 'text', text: `\`\`\`dsh-ui\n${VALID_SPEC}\n\`\`\`` }] } }),
      },
    }
    const dispose = installDomFenceRenderer(makeSourceCtx('source-session', () => chat, () => () => {}), () => {})
    try {
      const block = genericCodeBlock(VALID_SPEC)
      row.append(block)
      document.body.append(row)
      expect(await waitFor(() => block.hasAttribute('data-genui-rendered'))).toBe(true)
      expect(await waitFor(() => row.querySelector('.genui-dom-fence')?.textContent?.includes('Hello, world') === true)).toBe(true)
    } finally { dispose() }
  })

  it('releases the old ChatSnapshot subscription when the viewed session changes', async () => {
    let sessionId = 'session-a'
    const subscriptions: string[] = []
    const releases: string[] = []
    let sessionUpdate: (() => void) | undefined
    const ctx = {
      sessions: {
        list: {
          getSnapshot: () => ({ ids: [sessionId], byId: { [sessionId]: { id: sessionId, retainedBy: { mainView: 1 } } } }),
          subscribe: (listener: () => void) => {
            sessionUpdate = listener
            return () => { sessionUpdate = undefined }
          },
        },
      },
      get: (name: string) => name === 'uiConversation' ? {
        binding: (id: string) => ({ target: () => ({
          getSnapshot: () => undefined,
          subscribe: () => {
            subscriptions.push(id)
            return () => { releases.push(id) }
          },
        }) }),
      } : undefined,
    } as unknown as Context
    const dispose = installDomFenceRenderer(ctx, () => {})
    try {
      expect(await waitFor(() => subscriptions.includes('session-a'))).toBe(true)
      sessionId = 'session-b'
      sessionUpdate?.()
      expect(await waitFor(() => subscriptions.includes('session-b'))).toBe(true)
      expect(releases).toContain('session-a')
    } finally { dispose() }
    expect(releases).toContain('session-b')
  })

  it('uses the row fence ordinal and ignores plugin-owned code surfaces', async () => {
    const row = assistantRow('source-ordinal')
    const first = stockCodeBlock('first', 'ts')
    const second = genericCodeBlock(VALID_SPEC)
    const third = genericCodeBlock('third')
    row.append(first, second, third)
    document.body.append(row)
    const chat = {
      nodes: {
        get: () => ({
          kind: 'assistant-step',
          data: { blocks: [{ kind: 'text', text: `\`\`\`ts\nfirst\n\`\`\`\n\`\`\`dsh-ui\n${VALID_SPEC}\n\`\`\`\n\`\`\`json\nthird\n\`\`\`` }] },
        }),
      },
    }
    const sourceCtx = makeSourceCtx('source-session', () => chat, () => () => {})
    expect(sourceLanguageOf(sourceCtx, second)).toBe('dsh-ui')
    expect(sourceLanguageOf(sourceCtx, third)).toBe('json')
    const dispose = installDomFenceRenderer(sourceCtx, () => {})
    try {
      expect(await waitFor(() => second.hasAttribute('data-genui-rendered'))).toBe(true)
      expect(await waitFor(() => row.querySelector('.genui-dom-fence')?.textContent?.includes('Hello, world') === true)).toBe(true)
      expect(first.hasAttribute('data-genui-rendered')).toBe(false)
      expect(third.hasAttribute('data-genui-rendered')).toBe(false)
    } finally { dispose() }
  })

  it('keeps one streaming GenUI mount as source text grows and settles', async () => {
    const row = assistantRow('stream-source', true)
    const partial = '{"items":[{"type":"text","content":"hel'
    const block = genericCodeBlock(partial)
    row.append(block)
    document.body.append(row)
    let blocks = [{ kind: 'text', text: `\`\`\`dsh-ui\n${partial}` }]
    let update: (() => void) | undefined
    const chat = { nodes: { get: () => ({ kind: 'assistant-step', data: { blocks } }) } }
    const dispose = installDomFenceRenderer(makeSourceCtx('source-session', () => chat, listener => {
      update = listener
      return () => { update = undefined }
    }), () => {})
    try {
      expect(await waitFor(() => block.hasAttribute('data-genui-rendered'))).toBe(true)
      const mount = row.querySelector('.genui-dom-fence')
      expect(mount).not.toBeNull()
      block.querySelector('code')!.textContent = VALID_SPEC
      blocks = [{ kind: 'text', text: `\`\`\`dsh-ui\n${VALID_SPEC}\n\`\`\`` }]
      update?.()
      expect(await waitFor(() => mount?.textContent?.includes('Hello, world') === true)).toBe(true)
      row.removeAttribute('data-streaming')
      update?.()
      expect(await waitFor(() => row.querySelector('.genui-dom-fence') === mount)).toBe(true)
    } finally { dispose() }
  })

  it('previews only explicitly labelled settled SVG and restores it on dispose', async () => {
    const raw = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><rect width="50" height="20"/></svg>'
    const row = assistantRow('svg-row', true)
    const block = stockCodeBlock(raw, 'svg')
    const other = stockCodeBlock(raw, 'xml')
    row.append(block, other)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('svg-session', send), send)
    try {
      await tick()
      expect(block.style.display).not.toBe('none')
      expect(row.querySelector('[data-genui-svg-fence]')).toBeNull()
      row.removeAttribute('data-streaming')
      expect(await waitFor(() => row.querySelector('[data-genui-svg-fence] img') !== null)).toBe(true)
      expect(other.style.display).not.toBe('none')
      const source = [...row.querySelectorAll('button')].find(button => button.textContent === 'Source')!
      fireEvent.click(source)
      await tick(100)
      expect(row.querySelectorAll('[data-genui-svg-fence]')).toHaveLength(1)
      expect(row.querySelector('[data-genui-svg-fence] pre')?.textContent).toContain(raw)
      expect(send).not.toHaveBeenCalled()
    } finally { dispose() }
    expect(block.style.display).not.toBe('none')
    expect(row.querySelector('[data-genui-svg-fence]')).toBeNull()
  })

  it('declares its cordis service injects (boot sweep depends on it)', () => {
    // Regression pin: the `inject` export was once lost, so the host fiber's
    // inject gate stopped working, `apply` ran before the slots service, and
    // the whole page showed "Failed to load plugins".
    // inputTriggers is deliberately NOT in the hard-inject list: cordis
    // `inject` is a hard activation gate, the stock DSH shell does not provide
    // that service, so the fiber would wait forever and `apply` would never
    // run — leaving every dsh-ui fence silently a code block. apply() already
    // degrades optionally through ctx.get().
    expect([...inject].sort()).toEqual(['sessions', 'slots'])
  })

  it('accepts surrounding whitespace in a language label', async () => {
    const block = stockCodeBlock(VALID_SPEC, '  dsh-ui\n')
    document.body.appendChild(block)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      expect(await waitFor(() => block.hasAttribute('data-genui-rendered'))).toBe(true)
    } finally { dispose() }
  })

  it('diagnoses each rejected known surface once without hiding its prose', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const blocks = [0, 1].map(() => {
      const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
      const prose = document.createElement('p')
      prose.textContent = 'Keep this answer visible'
      block.appendChild(prose)
      document.body.appendChild(block)
      return block
    })
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick(100)
      blocks[0]!.setAttribute('data-update', '1')
      await tick(100)
      const diagnostics = warn.mock.calls.filter(args => String(args[0]).includes('pre=1'))
      expect(diagnostics).toHaveLength(2)
      expect(diagnostics.every(args => String(args[0]).includes('p'))).toBe(true)
      for (const block of blocks) {
        expect(block.style.display).not.toBe('none')
        expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      }
    } finally { dispose() }
  })

  it('renders a settled dsh-ui fence into its own root and hides the stock block', async () => {
    const row = assistantRow('s7')
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      const container = row.querySelector('.genui-dom-fence')
      expect(container).not.toBeNull()
      expect(container!.textContent).toContain('Hello, world')
    } finally {
      dispose()
    }
  })

  it('ignores non-dsh-ui code blocks', async () => {
    const row = assistantRow('s8')
    const ts = stockCodeBlock('const x = 1', 'ts')
    const plain = stockCodeBlock('hello', '')
    row.appendChild(ts)
    row.appendChild(plain)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(ts.hasAttribute('data-genui-rendered')).toBe(false)
      expect(plain.hasAttribute('data-genui-rendered')).toBe(false)
      expect(ts.style.display).toBe('')
    } finally {
      dispose()
    }
  })

  it('mounts while streaming once a component parses, and re-renders as the body grows', async () => {
    const row = assistantRow('s9', true)
    const block = stockCodeBlock('{"items":[{"type":"text","content":"Hello, world"},{"type":"te', 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      // Taken over during streaming: the first finished component renders.
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      const container = row.querySelector('.genui-dom-fence')
      expect(container).not.toBeNull()
      expect(container!.textContent).toContain('Hello, world')
      const firstReveal = container!.querySelector<HTMLElement>('[class*="reveal"]')!
      fireEvent.animationEnd(firstReveal)
      // The body grows: the second finished component appears without settle.
      block.querySelector('code')!.textContent = '{"items":[{"type":"text","content":"Hello, world"},{"type":"text","content":"Second block"}]}'
      await waitFor(() => row.querySelector('.genui-dom-fence')?.textContent?.includes('Second block') === true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('Second block')
      const reveals = container!.querySelectorAll<HTMLElement>('[class*="reveal"]')
      expect(reveals[0]).toBe(firstReveal)
      expect(reveals[0]!.style.animation).toBe('none')
      expect(reveals[1]!.style.animation).not.toBe('none')
      // Settling adds durable identity; already visible content must not re-enter.
      row.removeAttribute('data-streaming')
      expect(await waitFor(() => [...container!.querySelectorAll<HTMLElement>('[class*="reveal"]')]
        .every(element => element.style.animation === 'none'))).toBe(true)
      expect(container!.querySelector('[class*="reveal"]')).toBe(firstReveal)
    } finally {
      dispose()
    }
  })

  it('shows a skeleton while the spec is still arriving, then swaps in the real tree', async () => {
    const row = assistantRow('s9b', true)
    const block = stockCodeBlock('{"items":[{"type":"text","content":', 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      // v3: half-written JSON is replaced by the skeleton, not left on screen.
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      const skeleton = row.querySelector('.genui-dom-fence [class*="skeleton"]')
      expect(skeleton).not.toBeNull()
      expect(skeleton!.getAttribute('role')).toBe('status')
      // The component closes: the skeleton is replaced by the real tree.
      block.querySelector('code')!.textContent = '{"items":[{"type":"text","content":"Hello, world"}]}'
      await waitFor(() => row.querySelector('.genui-dom-fence')?.textContent?.includes('Hello, world') === true)
      expect(row.querySelector('.genui-dom-fence [class*="skeleton"]')).toBeNull()
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('Hello, world')
    } finally {
      dispose()
    }
  })

  it('restores the raw code block when a skeleton body never parses at settle', async () => {
    const row = assistantRow('s9b2', true)
    const block = stockCodeBlock('{"items":[{"type":"text","content":', 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(row.querySelector('.genui-dom-fence [class*="skeleton"]')).not.toBeNull()
      // The reply settles with the body still broken: the skeleton must give
      // the raw block back rather than hiding it forever.
      row.removeAttribute('data-streaming')
      await tick()
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(block.style.display).toBe('')
    } finally {
      dispose()
    }
  })

  it('never skeletons a streaming JSON fence that is not a GenUI spec', async () => {
    const row = assistantRow('s9b3', true)
    const block = stockCodeBlock('{"name":"config","value":[1,2,', '')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
    } finally {
      dispose()
    }
  })

  it('publishes a streaming panel:true fence only after the reply settles', async () => {
    const row = assistantRow('s9c', true)
    const block = stockCodeBlock('{"panel":true,"title":"Panel A","items":[{"type":"text","content":"A"}]', 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      // Streaming: the block is taken over (hidden, empty root) but the
      // panel store stays untouched — identity-less renders never publish.
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      expect(row.querySelector('.genui-dom-fence')?.textContent).toBe('')
      expect(getPanelSpec('sess-1')).toBeNull()
      // Settle: the mount gains stable source identity and publishes once.
      row.removeAttribute('data-streaming')
      await tick()
      expect(getPanelSpec('sess-1')?.title).toBe('Panel A')
    } finally {
      dispose()
    }
  })

  it('does not infer a language from a streaming body when source data is unavailable', async () => {
    const row = assistantRow('s9e', true)
    const block = stockCodeBlock('{"items":[{"type":"text","content":"Hello, world"}]', '')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
      const label = block.querySelector('div')
      label!.textContent = 'json'
      row.removeAttribute('data-streaming')
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(block.style.display).toBe('')
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
    } finally {
      dispose()
    }
  })

  it('re-applies the surgery when a host re-render wipes the container', async () => {
    const row = assistantRow('s9d', true)
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      const container = row.querySelector<HTMLElement>('.genui-dom-fence')
      expect(container).not.toBeNull()
      // Simulate a host React re-render dropping the foreign node and
      // resetting the hide during streaming.
      container!.remove()
      block.style.display = ''
      await tick()
      expect(container!.isConnected).toBe(true)
      expect(container!.previousElementSibling).toBe(block)
      expect(block.style.display).toBe('none')
    } finally {
      dispose()
    }
  })

  it('keeps the stock block visible for an unrepairable body', async () => {
    const row = assistantRow('s10')
    const block = stockCodeBlock(BROKEN_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(block.style.display).toBe('')
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
    } finally {
      dispose()
    }
  })

  it('shows a visible diagnostic for a settled unrepairable body (issue #158)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s10-diag')
    const block = stockCodeBlock(BROKEN_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-diag', send), send)
    try {
      await tick()
      const alert = row.querySelector('.genui-dom-fence-diagnostic [role="alert"]')
      expect(alert).not.toBeNull()
      expect(alert!.textContent).toContain('dsh-ui')
      // The raw body stays visible: the diagnostic explains, it never replaces.
      expect(block.style.display).toBe('')
      expect(block.textContent).toContain('content')
      // The strip is mounted BEFORE the code block, and repeated sweeps do not
      // duplicate it.
      expect(row.querySelector('.genui-dom-fence-diagnostic')!.nextElementSibling).toBe(block)
      await tick(60)
      expect(row.querySelectorAll('.genui-dom-fence-diagnostic')).toHaveLength(1)
    } finally {
      dispose()
    }
  })

  it('shows the settled schema diagnostic after tier-2 JSON repair', async () => {
    const row = assistantRow('s10-tier2-diag')
    const block = stockCodeBlock(TIER2_SCHEMA_FAILURE, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-tier2-diag', send), send)
    try {
      await tick()
      const alert = row.querySelector('.genui-dom-fence-diagnostic [role="alert"]')
      expect(alert).not.toBeNull()
      expect(alert!.textContent).toContain('label')
      expect(alert!.textContent).not.toContain('\u89e3\u6790\u5931\u8d25')
    } finally {
      dispose()
    }
  })

  it('keeps the diagnostic off a streaming body (partial JSON is not an error)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s10-stream', true)
    const block = stockCodeBlock(BROKEN_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-stream', send), send)
    try {
      await tick()
      expect(row.querySelector('.genui-dom-fence-diagnostic')).toBeNull()
    } finally {
      dispose()
    }
  })

  it('clears the diagnostic once the body becomes renderable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s10-fixed')
    const block = stockCodeBlock(BROKEN_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-fixed', send), send)
    try {
      await tick()
      expect(row.querySelector('.genui-dom-fence-diagnostic')).not.toBeNull()
      // The host re-renders the settled message with a repaired body.
      block.querySelector('code')!.textContent = VALID_SPEC
      const mounted = await waitFor(() => row.querySelector('[data-genui]') !== null)
      expect(mounted).toBe(true)
      expect(row.querySelector('.genui-dom-fence-diagnostic')).toBeNull()
      expect(block.style.display).toBe('none')
    } finally {
      dispose()
    }
  })

  it('rebuilds the diagnostic when a host re-render wipes its container', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s10-wiped')
    const block = stockCodeBlock(BROKEN_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-wiped', send), send)
    try {
      await tick()
      const container = row.querySelector('.genui-dom-fence-diagnostic')!
      container.textContent = ''
      // A mutation in the row drives the pre-paint repair pass.
      row.setAttribute('data-probe', '1')
      const restored = await waitFor(() => row.querySelector('.genui-dom-fence-diagnostic [role="alert"]') !== null)
      expect(restored).toBe(true)
      expect(row.querySelectorAll('.genui-dom-fence-diagnostic')).toHaveLength(1)
    } finally {
      dispose()
    }
  })

  it('drops the diagnostic when the block becomes a non-dsh-ui fence', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s10-relabelled')
    const block = stockCodeBlock(BROKEN_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-relabelled', send), send)
    try {
      await tick()
      expect(row.querySelector('.genui-dom-fence-diagnostic')).not.toBeNull()
      block.querySelector('div > div')!.textContent = 'json'
      const gone = await waitFor(() => row.querySelector('.genui-dom-fence-diagnostic') === null)
      expect(gone).toBe(true)
    } finally {
      dispose()
    }
  })

  it('relays component actions through the injected sender', async () => {
    const row = assistantRow('s11')
    const block = stockCodeBlock(BUTTON_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      const button = row.querySelector('.genui-dom-fence button')
      expect(button).not.toBeNull()
      fireEvent.click(button!)
      // The action rides the per-action trailing debounce (300ms).
      await tick(400)
      expect(send).toHaveBeenCalledTimes(1)
      const [sessionId, action] = send.mock.calls[0] as [string, string, unknown]
      expect(sessionId).toBe('sess-1')
      expect(action).toBe('refresh')
    } finally {
      dispose()
    }
  })

  it('relays component actions when the host omits list.current', async () => {
    const row = assistantRow('s11-modern')
    const block = stockCodeBlock(BUTTON_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeModernCtx('sess-modern'), send)
    try {
      await tick()
      fireEvent.click(row.querySelector('.genui-dom-fence button')!)
      await tick(400)
      expect(send).toHaveBeenCalledTimes(1)
      expect(send.mock.calls[0]?.slice(0, 2)).toEqual(['sess-modern', 'refresh'])
    } finally {
      dispose()
    }
  })

  it('publishes a panel:true fence to the panel store without mounting UI', async () => {
    const row = assistantRow('s12')
    const block = stockCodeBlock(PANEL_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      // The publisher renders nothing: the mounted root is an empty container.
      const container = row.querySelector('.genui-dom-fence')
      expect(container).not.toBeNull()
      expect(container!.textContent).toBe('')
      expect(getPanelSpec('sess-1')?.title).toBe('Panel A')
    } finally {
      dispose()
    }
  })

  it('publishes a panel:true fence when the host omits list.current', async () => {
    const row = assistantRow('s12-modern')
    const block = stockCodeBlock(PANEL_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeModernCtx('sess-modern-panel'), send)
    try {
      await tick()
      expect(getPanelSpec('sess-modern-panel')?.title).toBe('Panel A')
    } finally {
      dispose()
      clearSessionPanel('sess-modern-panel')
    }
  })

  it('warns once when an action has no resolvable session', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s12-missing')
    const block = stockCodeBlock(BUTTON_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx(undefined, send), send)
    try {
      await tick()
      const button = row.querySelector('.genui-dom-fence button')!
      fireEvent.click(button)
      await tick(400)
      fireEvent.click(button)
      await tick(400)
      expect(send).not.toHaveBeenCalled()
      expect(warn.mock.calls.filter(([message]) => String(message).includes('cannot resolve the viewed session'))).toHaveLength(1)
    } finally {
      dispose()
    }
  })

  it('unmounts and restores the stock block when the row leaves the DOM', async () => {
    const row = assistantRow('s13')
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      row.remove()
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(block.style.display).toBe('')
      expect(block.isConnected).toBe(false)
    } finally {
      dispose()
    }
  })

  it('skips fences without a current session (renders with no persistence)', async () => {
    const row = assistantRow('s14')
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx(undefined, send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('Hello, world')
    } finally {
      dispose()
    }
  })
})

describe('anchor-less rows (Safari fallback render path)', () => {
  // Regression pin #1: a Safari host omits data-chat-anchor-key when it
  // renders message rows (that attribute is a React key derivative, and React
  // drops the attribute entirely when the key is undefined) → rowOf misses →
  // the DOM channel silently abandons every fence. The fallback chain must
  // catch it: flow-row attribute → the code block itself.
  it('renders a settled dsh-ui fence when the row lacks data-chat-anchor-key', async () => {
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-kind', 'assistant-step')
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-safari-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('Hello, world')
    } finally {
      dispose()
    }
  })

  it('renders a fence with no owning row at all (block directly in the body)', async () => {
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    document.body.appendChild(block)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-safari-2', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      expect(document.querySelector('.genui-dom-fence')?.textContent).toContain('Hello, world')
    } finally {
      dispose()
    }
  })

  it('assigns distinct fallback identities to sibling fences in an anchor-less row', async () => {
    // Two panel:true fences in one anchor-less row must not collapse onto the
    // same dom:unknown:N source: the later fence's replace should win the fold
    // (proving they are two distinct sources) instead of being discarded as an
    // idempotent replay of the first (which would freeze the snapshot at
    // "Panel A").
    const row = document.createElement('div')
    row.setAttribute('data-chat-flow-kind', 'assistant-step')
    const first = stockCodeBlock('{"panel":true,"title":"Panel A","items":[{"type":"text","content":"A"}]}', 'dsh-ui')
    const second = stockCodeBlock('{"panel":true,"title":"Panel B","items":[{"type":"text","content":"B"}]}', 'dsh-ui')
    row.appendChild(first)
    row.appendChild(second)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-safari-3', send), send)
    try {
      await waitFor(() => getPanelSpec('sess-safari-3')?.title === 'Panel B')
      expect(getPanelSpec('sess-safari-3')?.title).toBe('Panel B')
    } finally {
      dispose()
    }
  })

  it('assigns distinct fallback identities to fences in separate anchor-less rows', async () => {
    const firstRow = document.createElement('div')
    firstRow.setAttribute('data-chat-flow-kind', 'assistant-step')
    firstRow.appendChild(stockCodeBlock('{"panel":true,"title":"Panel A","items":[{"type":"text","content":"A"}]}', 'dsh-ui'))
    const secondRow = document.createElement('div')
    secondRow.setAttribute('data-chat-flow-kind', 'assistant-step')
    secondRow.appendChild(stockCodeBlock('{"panel":true,"title":"Panel B","items":[{"type":"text","content":"B"}]}', 'dsh-ui'))
    document.body.append(firstRow, secondRow)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-safari-6', send), send)
    try {
      await waitFor(() => getPanelSpec('sess-safari-6')?.title === 'Panel B')
      expect(getPanelSpec('sess-safari-6')?.title).toBe('Panel B')
    } finally {
      dispose()
    }
  })

  it('warns once when the row anchor is missing, and stays silent for anchored rows', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const anchored = assistantRow('s15')
    const anchoredBlock = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    anchored.appendChild(anchoredBlock)
    document.body.appendChild(anchored)
    const bare = document.createElement('div')
    const bareBlock = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    bare.appendChild(bareBlock)
    document.body.appendChild(bare)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-safari-4', send), send)
    try {
      await tick()
      await tick()
      const calls = warn.mock.calls.filter(([m]) => String(m).includes('[dsh-genui]'))
      // Exactly one diagnostic: only the anchor-less block; anchored blocks
      // must stay silent across repeated sweeps.
      expect(calls).toHaveLength(1)
      expect(String(calls[0]![0])).toContain('data-chat-anchor-key')
      // Both fences render as usual (the fallback loses no content).
      expect(anchoredBlock.hasAttribute('data-genui-rendered')).toBe(true)
      expect(bareBlock.hasAttribute('data-genui-rendered')).toBe(true)
    } finally {
      dispose()
      warn.mockRestore()
    }
  })

  it('warns once for a settled unrepairable body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s16')
    const block = stockCodeBlock(BROKEN_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-safari-5', send), send)
    try {
      await tick()
      await tick()
      const calls = warn.mock.calls.filter(([m]) => String(m).includes('[dsh-genui]'))
      expect(calls).toHaveLength(1)
      expect(String(calls[0]![0])).toContain('does not parse')
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
    } finally {
      dispose()
      warn.mockRestore()
    }
  })
})

describe('persisted replay barrier across page refresh (issue #4)', () => {
  // Regression pin #4: the host anchor key is `<kindlen>:<kind><id>`, and an
  // assistant step id is `<turn>:<step>` (e.g. `14:assistant-step3:0`). The old
  // implementation took the first number in the key = the kind-length
  // constant → every message shared the same order[0] → after a refresh
  // replayBarrier (= the persisted maxSeenSeq = that constant) rejected every
  // new panel fence, freezing the dock with zero logs.
  // Fix: order[0] becomes turn*1000+step (strictly monotonic with message
  // order), so after a refresh a new message's turn necessarily exceeds the
  // persisted barrier → it updates normally.
  const PANEL = (title: string, content: string) =>
    `{"panel":true,"title":"${title}","items":[{"type":"text","content":"${content}"}]}`

  it('lets a new-turn panel fence update the dock after a refresh', async () => {
    const send = vi.fn()

    // ── Page 1: two panel fences at turn 2 and turn 3 (real host key shape) ──
    const row2 = assistantRow('14:assistant-step2:0')
    const blockA = stockCodeBlock(PANEL('Panel A', 'A'), 'dsh-ui')
    row2.appendChild(blockA)
    document.body.appendChild(row2)
    const row3 = assistantRow('14:assistant-step3:0')
    const blockB = stockCodeBlock(PANEL('Panel B', 'B'), 'dsh-ui')
    row3.appendChild(blockB)
    document.body.appendChild(row3)
    let dispose = installDomFenceRenderer(makeCtx('sess-refresh', send), send)
    try {
      await tick()
      expect(getPanelSpec('sess-refresh')?.title).toBe('Panel B')

      // ── Refresh: in-memory state is cleared (localStorage survives) and the
      //    new page reinstalls the renderer ──
      dispose()
      clearSessionPanel('sess-refresh')
      document.body.innerHTML = ''
      dispose = installDomFenceRenderer(makeCtx('sess-refresh', send), send)
      await tick()

      // History replay (same DOM rebuilt): killed by the persisted barrier, so
      // the dock keeps Panel B
      document.body.appendChild(row2)
      document.body.appendChild(row3)
      await tick()
      expect(getPanelSpec('sess-refresh')?.title).toBe('Panel B')

      // ── New message (turn 4): order[0]=4000 > barrier 3000 → the dock must update ──
      const row4 = assistantRow('14:assistant-step4:0')
      const blockC = stockCodeBlock(PANEL('Panel C', 'C'), 'dsh-ui')
      row4.appendChild(blockC)
      document.body.appendChild(row4)
      await tick()
      expect(getPanelSpec('sess-refresh')?.title).toBe('Panel C')
    } finally {
      dispose()
    }
  })

  it('keeps per-step monotonicity within one turn (later step wins)', async () => {
    // Multiple steps in one turn: step must take part in seq, so the later
    // step's fence overrides the earlier one.
    const send = vi.fn()
    const rowA = assistantRow('14:assistant-step5:0')
    const blockA = stockCodeBlock(PANEL('Panel X', 'X'), 'dsh-ui')
    rowA.appendChild(blockA)
    document.body.appendChild(rowA)
    const rowB = assistantRow('14:assistant-step5:1')
    const blockB = stockCodeBlock(PANEL('Panel Y', 'Y'), 'dsh-ui')
    rowB.appendChild(blockB)
    document.body.appendChild(rowB)
    const dispose = installDomFenceRenderer(makeCtx('sess-refresh-step', send), send)
    try {
      await tick()
      expect(getPanelSpec('sess-refresh-step')?.title).toBe('Panel Y')
    } finally {
      dispose()
    }
  })
})

describe('multi-surface discovery across host DOM shapes (issue #6)', () => {
  // Regression pin #6: a host's fence surfaces are not only `.md-code-block` —
  // the deepsuite render stack emits `.code-block` / `.code-block-small` with a
  // span (not a div) language label, and the body may be wrapped in a content
  // div. The old implementation (one selector, div labels only) found no fence
  // at all on such hosts → it silently stayed a code block with zero console
  // errors. The new implementation falls back to label+pre structure, so any
  // surface shape renders.

  it('takes over a deepsuite-style .code-block surface (span label, wrapped body)', async () => {
    const row = assistantRow('s20')
    const block = deepsuiteCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-1', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(block.style.display).toBe('none')
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('Hello, world')
    } finally {
      dispose()
    }
  })

  it('takes over a .code-block-small surface', async () => {
    const row = assistantRow('s21')
    const block = deepsuiteCodeBlock(VALID_SPEC, 'dsh-ui', 'code-block-small')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-2', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('Hello, world')
    } finally {
      dispose()
    }
  })

  it('structural backstop: an unlisted surface class renders via label+pre, warning once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s22')
    const block = deepsuiteCodeBlock(VALID_SPEC, 'dsh-ui', 'host-fence-v9')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-3', send), send)
    try {
      await tick()
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('Hello, world')
      // Exactly one drift diagnostic (no spam across repeated sweeps), and no
      // more "fence not found" silence.
      const calls = warn.mock.calls.filter(([m]) => String(m).includes('matched no known selector'))
      expect(calls).toHaveLength(1)
    } finally {
      dispose()
      warn.mockRestore()
    }
  })

  it('never self-identifies through code that literally contains the text dsh-ui', async () => {
    // A `dsh-ui` literal inside the code body (as in a documentation example)
    // must not make a json/ts fence look like dsh-ui: the label check only
    // trusts leaf elements outside the code body.
    const row = assistantRow('s23')
    const block = stockCodeBlock('{"items":[{"type":"text","content":"rendered by a dsh-ui fence"}]}', 'json')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-4', send), send)
    try {
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(block.style.display).toBe('')
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
    } finally {
      dispose()
    }
  })

  it('only the outermost element of a nested modifier surface is taken over', async () => {
    // When a host nests `code-block-small` as a modifier child of
    // `code-block`, the fence may be taken over only once (the outer element);
    // the inner and outer layers must not be treated as two fences and
    // rendered twice.
    const row = assistantRow('s24')
    const outer = deepsuiteCodeBlock(VALID_SPEC, 'dsh-ui', 'code-block')
    const inner = document.createElement('div')
    inner.className = 'code-block-small'
    inner.textContent = 'modifier'
    outer.appendChild(inner)
    row.appendChild(outer)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-5', send), send)
    try {
      await tick()
      expect(outer.hasAttribute('data-genui-rendered')).toBe(true)
      expect(inner.hasAttribute('data-genui-rendered')).toBe(false)
      expect(outer.style.display).toBe('none')
      // Only one genui container is mounted: the inner and outer layers were
      // not treated as two fences.
      expect(row.querySelectorAll('.genui-dom-fence')).toHaveLength(1)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('Hello, world')
    } finally {
      dispose()
    }
  })

  it('renders both fences when two .code-block surfaces sit side by side in one row', async () => {
    // Two independent deepsuite fences in one row: nesting dedupe must not
    // harm them; each renders and neither identity collapses.
    const row = assistantRow('s25')
    const first = deepsuiteCodeBlock('{"panel":true,"title":"Panel X","items":[{"type":"text","content":"X"}]}', 'dsh-ui')
    const second = deepsuiteCodeBlock('{"panel":true,"title":"Panel Y","items":[{"type":"text","content":"Y"}]}', 'dsh-ui')
    row.appendChild(first)
    row.appendChild(second)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-6', send), send)
    try {
      await tick()
      expect(first.hasAttribute('data-genui-rendered')).toBe(true)
      expect(second.hasAttribute('data-genui-rendered')).toBe(true)
      expect(getPanelSpec('sess-6-6')?.title).toBe('Panel Y')
    } finally {
      dispose()
    }
  })

  it('streaming takeover works on a deepsuite surface with an explicit language', async () => {
    // Both host code-surface families enter streaming rendering on an explicit
    // dsh-ui language.
    const row = assistantRow('s26', true)
    const block = deepsuiteCodeBlock('{"items":[{"type":"text","content":"Hello, world"},{"type":"te', 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-6-7', send), send)
    try {
      await tick()
      // Streaming: an explicit dsh-ui language sends the fence into the render
      // pipeline immediately.
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('Hello, world')
      // The body keeps growing → live re-render.
      block.querySelector('code')!.textContent = '{"items":[{"type":"text","content":"Hello, world"},{"type":"text","content":"Second block"}]}'
      await waitFor(() => row.querySelector('.genui-dom-fence')?.textContent?.includes('Second block') === true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('Second block')
      // Stable identity is retained after settle.
      row.removeAttribute('data-streaming')
      await tick()
      expect(block.hasAttribute('data-genui-rendered')).toBe(true)
      expect(row.querySelector('.genui-dom-fence')?.textContent).toContain('Hello, world')
    } finally {
      dispose()
    }
  })
})

describe('shared markdown root with mixed code blocks (issue #13)', () => {
  // Regression pin #13: when a dsh-ui fence shares one message container with
  // ordinary python/ts/bash code blocks, the structural backstop walked up
  // from the ordinary block's <pre>, crossed its own .md-code-block and
  // mistook the shared .markdown root for a "dsh-ui fence" → the whole message
  // went display:none and the python block was swallowed. The backstop must
  // skip the <pre> of a known surface, and the label check must not claim the
  // banner of a nested code block.

  /** Shared markdown root: the host renders one `.markdown` wrapper around
   * every code block of a message. */
  function markdownRoot(): HTMLElement {
    const root = document.createElement('div')
    root.className = 'markdown'
    return root
  }

  it('renders the dsh-ui fence and keeps a sibling python block untouched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s30')
    const root = markdownRoot()
    const genui = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    const python = stockCodeBlock('@dataclass\nclass LineSegment:\n    points: list', 'python')
    root.appendChild(genui)
    root.appendChild(python)
    row.appendChild(root)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-13-1', send), send)
    try {
      await tick()
      await tick()
      // The dsh-ui fence takes over normally; neither the python block nor the
      // shared root container may be hidden or taken over.
      expect(genui.hasAttribute('data-genui-rendered')).toBe(true)
      expect(genui.style.display).toBe('none')
      expect(python.hasAttribute('data-genui-rendered')).toBe(false)
      expect(python.style.display).toBe('')
      expect(python.textContent).toContain('LineSegment')
      expect(root.style.display).toBe('')
      // Exactly one genui container, mounted after the dsh-ui block rather
      // than after the whole message.
      expect(row.querySelectorAll('.genui-dom-fence')).toHaveLength(1)
      expect(root.querySelectorAll('.genui-dom-fence')).toHaveLength(1)
      const container = row.querySelector('.genui-dom-fence')
      expect(container?.previousElementSibling).toBe(genui)
      expect(container!.textContent).toContain('Hello, world')
      // No "unknown surface class" drift warning is expected: both surfaces are
      // hit by known selectors.
      const drift = warn.mock.calls.filter(([m]) => String(m).includes('matched no known selector'))
      expect(drift).toHaveLength(0)
    } finally {
      dispose()
      warn.mockRestore()
    }
  })

  it('renders the dsh-ui fence when the shared root contains TWO dsh-ui blocks', async () => {
    const row = assistantRow('s31')
    const root = markdownRoot()
    const first = stockCodeBlock(PANEL_SPEC, 'dsh-ui')
    const second = stockCodeBlock('{"panel":true,"title":"Panel B","items":[{"type":"text","content":"B"}]}', 'dsh-ui')
    root.appendChild(first)
    root.appendChild(second)
    row.appendChild(root)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-13-2', send), send)
    try {
      await tick()
      // Both dsh-ui blocks take over independently; the panel fold runs per
      // source, and the later one wins the dock.
      expect(first.hasAttribute('data-genui-rendered')).toBe(true)
      expect(second.hasAttribute('data-genui-rendered')).toBe(true)
      expect(root.style.display).toBe('')
      expect(root.querySelectorAll('.genui-dom-fence')).toHaveLength(2)
      expect(getPanelSpec('sess-13-2')?.title).toBe('Panel B')
    } finally {
      dispose()
    }
  })

  it('keeps the structural backstop working for an unknown surface beside a known python block', async () => {
    // Hardening must not kill the structural backstop along with it: the <pre>
    // of an unknown-class surface has no known ancestor and must still be found
    // through the label+pre fallback, while the neighbouring python block with
    // a known class stays ignored.
    const row = assistantRow('s32')
    const root = markdownRoot()
    const unknown = deepsuiteCodeBlock(VALID_SPEC, 'dsh-ui', 'host-fence-v99')
    const python = stockCodeBlock('print("hello")', 'python')
    root.appendChild(unknown)
    root.appendChild(python)
    row.appendChild(root)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-13-3', send), send)
    try {
      await tick()
      expect(unknown.hasAttribute('data-genui-rendered')).toBe(true)
      expect(unknown.style.display).toBe('none')
      expect(python.hasAttribute('data-genui-rendered')).toBe(false)
      expect(python.style.display).toBe('')
      expect(root.style.display).toBe('')
      expect(root.querySelectorAll('.genui-dom-fence')).toHaveLength(1)
    } finally {
      dispose()
    }
  })
})

describe('final-answer blank-out hardening (issue #19)', () => {
  // Regression pin #19: a final answer containing a dsh-ui fence would
  // occasionally vanish entirely (the Timeline looked fine, and a refresh
  // restored it). Both DOM-channel failure modes produce "raw block hidden +
  // replacement component missing":
  //  1. display:none first, mount second — when the mount failed the raw fence
  //     was already hidden;
  //  2. the structural backstop treated a message-level container labelled
  //     "dsh-ui + contains <pre>" as a fence surface, so the whole message
  //     (prose paragraphs included) went display:none. Fix: mount successfully
  //     first, then hide, and keep the raw code block on failure; candidate
  //     surfaces must be "banner + a single code body", and message containers
  //     are skipped outright with a warning.

  it('refuses to take over a message-level container that labels dsh-ui (prose stays visible)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const row = assistantRow('s40')
    // A host render shape where the banner label, prose and the fence body
    // share one message-level container: hiding it would blank the answer.
    const root = document.createElement('div')
    root.className = 'host-message-body'
    const label = document.createElement('div')
    label.textContent = 'dsh-ui'
    const prose = document.createElement('p')
    prose.textContent = 'This prose must stay visible no matter what'
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = VALID_SPEC
    pre.appendChild(code)
    root.append(label, prose, pre)
    row.appendChild(root)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-19-1', send), send)
    try {
      await tick()
      await tick()
      // The message container is never hidden or taken over; the prose and
      // the raw fence stay visible instead of the whole answer going blank.
      expect(root.style.display).toBe('')
      expect(root.hasAttribute('data-genui-rendered')).toBe(false)
      expect(prose.isConnected).toBe(true)
      expect(pre.isConnected).toBe(true)
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
      // Exactly one issue #19 defensive diagnostic, with no spam across sweeps.
      const calls = warn.mock.calls.filter(([m]) => String(m).includes('likely a message container'))
      expect(calls).toHaveLength(1)
    } finally {
      dispose()
      warn.mockRestore()
    }
  })

  it('refuses a surface-class element that is actually a message container', async () => {
    const row = assistantRow('s41')
    const root = document.createElement('div')
    root.className = 'md-code-block'
    const label = document.createElement('div')
    label.textContent = 'dsh-ui'
    const prose = document.createElement('p')
    prose.textContent = 'Prose'
    const pre = document.createElement('pre')
    pre.textContent = VALID_SPEC
    root.append(label, prose, pre)
    row.appendChild(root)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-19-2', send), send)
    try {
      await tick()
      expect(root.hasAttribute('data-genui-rendered')).toBe(false)
      expect(root.style.display).toBe('')
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
    } finally {
      dispose()
    }
  })

  it('preserves input and pending actions when the host wipes a streaming container', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const row = assistantRow('s42', true)
    const block = stockCodeBlock(JSON.stringify({ items: [
      { type: 'input', id: 'name', label: 'Name' },
      { type: 'button', label: 'Confirm', action: 'confirm' },
    ] }), 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-19-3', send), send)
    try {
      await tick()
      const container = row.querySelector<HTMLElement>('.genui-dom-fence')
      expect(container).not.toBeNull()
      const input = container!.querySelector('input')!
      fireEvent.change(input, { target: { value: 'typing' } })
      fireEvent.click(container!.querySelector('button')!)
      // Host re-render wipes the foreign container's children but keeps the
      // node: the stock block must not stay hidden behind an empty box.
      container!.replaceChildren()
      await tick()
      expect(block.style.display).toBe('none')
      expect(row.querySelector('.genui-dom-fence')).toBe(container)
      expect(container!.querySelector('input')).toBe(input)
      expect(input.value).toBe('typing')
      expect(container!.previousElementSibling).toBe(block)
      expect(await waitFor(() => send.mock.calls.length === 1)).toBe(true)
      await tick(350)
      expect(send).toHaveBeenCalledTimes(1)
    } finally {
      dispose()
      err.mockRestore()
    }
  })

  it('removes the orphaned replacement container when the host replaces the stock block', async () => {
    const row = assistantRow('s43')
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-19-4', send), send)
    try {
      await tick()
      expect(row.querySelector('.genui-dom-fence')).not.toBeNull()
      // The host swaps the message node out from under us but our foreign
      // container survives as an orphan: it must be removed immediately.
      block.remove()
      await tick()
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
    } finally {
      dispose()
    }
  })

  it('keeps the stock block visible when the React root fails to mount (issue #19)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    setDomRootFactory(() => {
      throw new Error('synthetic root failure')
    })
    const row = assistantRow('s44')
    const block = stockCodeBlock(VALID_SPEC, 'dsh-ui')
    row.appendChild(block)
    document.body.appendChild(row)
    const send = vi.fn()
    const dispose = installDomFenceRenderer(makeCtx('sess-19-5', send), send)
    try {
      await tick()
      // Mount-then-hide: the takeover failed BEFORE the block was hidden, so
      // the final answer keeps its raw code block instead of going blank.
      expect(block.style.display).toBe('')
      expect(block.hasAttribute('data-genui-rendered')).toBe(false)
      expect(row.querySelector('.genui-dom-fence')).toBeNull()
      const calls = warn.mock.calls.filter(([m]) => String(m).includes('keeping the stock code block'))
      expect(calls).toHaveLength(1)
    } finally {
      dispose()
      setDomRootFactory(createRoot)
      warn.mockRestore()
    }
  })
})
