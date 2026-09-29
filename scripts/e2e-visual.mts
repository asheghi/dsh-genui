#!/usr/bin/env node
/**
 * dsh-genui visual E2E (no model key needed): real dsh web + a link install of
 * the current plugin → inject the component gallery fence through the DOM
 * channel → real browser render → screenshots + interaction checks.
 * Complements e2e.mjs: e2e.mjs verifies the full "model → fence → action" loop
 * (and needs DEEPSEEK_API_KEY); this script verifies only the render layer
 * (CSS, components, local interaction), needs no quota, and suits a quick
 * visual regression after any style or component change.
 *
 * Usage:
 *   npx tsx scripts/e2e-visual.mts [--port 3098] [--keep] [--out <dir>]
 *
 * Artifacts (default .e2e-artifacts/):
 *   gallery.png        full-page gallery render
 *   interactions.png   state after local interactions such as sorting/quiz
 *   web.log            scratch instance log
 * Exit code 0 = PASS, 1 = FAIL.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'

import { gallerySpec } from '../src/client/gallery.ts'

// Under tsx, import.meta.url is unreliable (it once pointed at the node
// binary), so locate things from argv[1]: the script is expected at
// <repo>/scripts/e2e-visual.mts, making the repo root its parent.
const SCRIPT_PATH = resolve(process.argv[1] ?? '')
const REPO_ROOT = dirname(SCRIPT_PATH).endsWith('scripts')
  ? resolve(dirname(SCRIPT_PATH), '..')
  : resolve(process.cwd())
// Host binary: prefer $DSH_BIN, otherwise resolve `dsh` from PATH. The old
// default ~/node_modules/.bin/dsh no longer exists after rc7 moved to the
// npm/pnpm production slot, and the script then failed silently with 127
// (command not found) — one root cause of the 2026-09 visual regression being
// unrunnable.
function resolveDshBin(): string {
  if (process.env.DSH_BIN !== undefined && process.env.DSH_BIN !== '') return process.env.DSH_BIN
  const found = spawnSync('which', ['dsh'], { encoding: 'utf8' }).stdout?.trim()
  return found !== undefined && found !== '' ? found : 'dsh'
}
const DSH_BIN = resolveDshBin()
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const PORT = Number(arg('--port') ?? 3098)
const KEEP = process.argv.includes('--keep')
const OUT_DIR = resolve(arg('--out') ?? join(REPO_ROOT, '.e2e-artifacts'))
/** Plugin under test: default is a link to the current workspace; pass a published version to get a "before the change" baseline for comparison. */
const PLUGIN_SPEC = process.env.E2E_PLUGIN_SPEC ?? `link:${REPO_ROOT}`

const fail = (msg: string): never => { console.error(`✗ ${msg}`); process.exit(1) }
const log = (msg: string): void => console.log(`· ${msg}`)

/** Token-bearing root URL printed on the startup line (alpha builds); older builds print a bare URL with no token. */
function findDshWebUrl(output: string): string | undefined {
  return output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+(?:\/\?token=[A-Za-z0-9_-]+)?)/u)?.[1]
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fail(`invalid port: ${PORT}`)
await new Promise(res => {
  const probe = createServer()
  probe.once('error', () => fail(`port ${PORT} is already in use, pick another with --port`))
  probe.listen(PORT, '127.0.0.1', () => probe.close(res))
})

// playwright-core resolution order: explicit PLAYWRIGHT_PATH → agent-browser
// global dependency → this repo's node_modules. chromium uses system Chrome
// (channel: 'chrome').
async function loadPlaywright(): Promise<{ chromium: any }> {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    join(homedir(), '.nvm/versions/node', `v${process.versions.node}`, 'lib/node_modules/agent-browser/node_modules/playwright-core/index.mjs'),
    join(REPO_ROOT, 'node_modules/playwright-core/index.mjs'),
    join(REPO_ROOT, 'node_modules/playwright/index.mjs'),
  ].filter((p): p is string => p !== undefined)
  for (const p of candidates) {
    try {
      return await import(p)
    } catch (e) {
      console.error(`· playwright candidate failed ${p} → ${(e as Error).message}`)
    }
  }
  throw new Error('playwright-core not found (set PLAYWRIGHT_PATH to point at index.mjs)')
}

const DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-visual-'))
const env = { ...process.env, DSH_HOME }
const webLog = join(DSH_HOME, 'web.log')
let webChild: ReturnType<typeof spawn> | null = null
// playwright Browser instance: the failure path must close it too, so the
// browser child process is never orphaned.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browser: any = null

const killWeb = (): void => {
  if (webChild === null) return
  try { process.kill(-webChild.pid!, 'SIGTERM') } catch { /* gone */ }
  try { process.kill(webChild.pid!, 'SIGTERM') } catch { /* gone */ }
  webChild = null
}
const cleanup = async (): Promise<void> => {
  killWeb()
  if (!KEEP) await rm(DSH_HOME, { recursive: true, force: true })
  else log(`keeping temporary environment: ${DSH_HOME}`)
}

try {
  await mkdir(OUT_DIR, { recursive: true })

  // ── Install the plugin (link the current workspace = tests this code) ────
  // E2E_PLUGIN_SPEC may point at a published version (e.g.
  // @changfenhuang/dsh-genui@0.10.0) to produce a "before the change"
  // real-binary screenshot from the same gallery on the same host for comparison.
  log(`installing plugin (${PLUGIN_SPEC})...`)
  const add = spawnSync(DSH_BIN, ['plugin', '--profile', 'web', 'add', PLUGIN_SPEC], { env, stdio: 'inherit' })
  if (add.status !== 0) throw new Error('plugin install failed (see output above)')

  // ── Start dsh web ───────────────────────────────────────────────────────
  // `--profile web` explicitly loads the profile holding the plugin just
  // installed; `--no-open` stops every regression run from popping a system
  // browser window.
  log(`starting dsh web (port ${PORT})...`)
  const logStream = createWriteStream(webLog, { flags: 'a' })
  webChild = spawn(DSH_BIN, ['--profile', 'web', '--port', String(PORT), '--no-open'], {
    env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const BASE = `http://127.0.0.1:${PORT}`
  // Collect stdout to parse the token out of the startup line, while still
  // writing the log to disk as usual.
  let webOutput = ''
  webChild.stdout!.on('data', (chunk: Buffer) => { webOutput += String(chunk) })
  webChild.stdout!.pipe(logStream)
  webChild.stderr!.pipe(logStream)
  // On alpha builds the root request must carry the process token
  // (GET /?token=… → 303 + session cookie); a bare fetch of `/` is always 401.
  // Older builds print a bare URL and answer 200 directly.
  let ready = false
  let launchUrl = BASE
  let sessionCookie: string | undefined
  for (let i = 0; i < 120; i++) {
    if (webChild.exitCode !== null) break
    const found = findDshWebUrl(webOutput)
    if (found !== undefined) {
      launchUrl = found
      try {
        const res = await fetch(found, { redirect: 'manual' })
        if (res.status === 303 || res.ok) {
          sessionCookie = res.headers.get('set-cookie')?.split(';')[0]
          ready = true
          break
        }
      } catch { /* booting */ }
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!ready) {
    const tail = await (await import('node:fs/promises')).readFile(webLog, 'utf8').catch(() => '')
    console.error(tail.split('\n').slice(-30).join('\n'))
    throw new Error(`dsh web was not ready within 120s (log: ${webLog})`)
  }
  log('dsh web is ready')

  // The client half is not served separately at `/plugins/<pkg>/client.js`:
  // the host composes the same batch of plugins into one
  // `??…,<pkg>/client.js,…&rev=` asset. So the assertion here is that it
  // "appears in the index boot graph", not that some fixed URL returns 200.
  const indexRes = await fetch(`${BASE}/`, { headers: sessionCookie === undefined ? {} : { cookie: sessionCookie } })
  if (!indexRes.ok) throw new Error(`index returned ${indexRes.status}`)
  const indexHtml = await indexRes.text()
  if (!indexHtml.includes('@changfenhuang/dsh-genui/client.js')) {
    throw new Error('the genui client bundle does not appear in the boot graph (is the plugin client half registered?)')
  }
  log('✓ client bundle is in the boot graph')

  // ── Browser render ──────────────────────────────────────────────────────
  const { chromium } = await loadPlaywright()
  browser = await chromium.launch({ channel: 'chrome', headless: true })
  // This script asserts on Chinese i18n copy (e.g. the stacked-chart tooltip
  // "\u5408\u8ba1" = block.total), so it pins zh-CN explicitly to keep results
  // independent of the runner's system locale. e2e.mjs also uses zh-CN explicitly.
  const page = await browser.newPage({ viewport: { width: 1440, height: 3000 }, locale: 'zh-CN' })
  const pageErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(String(e)))
  // Engine-split evidence: which lazy assets the page actually pulls.
  const assetRequests: string[] = []
  page.on('request', req => {
    const url = req.url()
    const match = /\/assets\/([a-z-]+\.js)/.exec(url)
    if (match !== null) assetRequests.push(match[1]!)
  })
  const consoleLines: string[] = []
  page.on('console', msg => consoleLines.push(`${msg.type()}: ${msg.text()}`))
  // Force the DOM channel: hosts from 0.1.3 on carry a registry extension point
  // and the plugin then defaults to the registry channel, which only renders
  // inside real markdown fences; the empty-profile regression page needs an
  // injectable render surface, so this flag pins the plugin to the DOM channel.
  await page.addInitScript(() => { (globalThis as { __DSH_GENUI_E2E__?: boolean }).__DSH_GENUI_E2E__ = true })
  // Use the token-bearing root URL: the browser completes the 303 → cookie
  // exchange, so later asset requests are already authenticated.
  await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)
  // A first start on an empty profile shows an early-access notice; its mask
  // intercepts all pointer events, so dismiss it first — otherwise the later
  // hover assertions are stolen by the mask (this once made the tooltip
  // regression time out).
  const onboarding = page.getByRole('button', { name: /\u7ee7\u7eed|\u6211\u77e5\u9053\u4e86|\u5f00\u59cb\u4f7f\u7528|\u8fdb\u5165/ })
  if (await onboarding.count() > 0) {
    await onboarding.first().click().catch(() => {})
    await page.waitForTimeout(500)
  }
  // Fallback: if the mask is still there (changed button copy, a second
  // popup), just remove it — this is a scratch instance's throwaway page, not
  // an assertion about product behaviour.
  const masks = await page.evaluate(() => {
    const found = document.querySelectorAll('[class*="_mask_"], [role="presentation"]')
    for (const el of found) el.remove()
    return found.length
  })
  if (masks > 0) log(`removed ${masks} mask nodes`)

  // Inject the gallery fence as a real dsh-ui fence surface (leaf language
  // label + a single <pre> code body); the DOM channel should find it and mount
  // the real components in its own React root.
  const visualSpec = {
    ...gallerySpec,
    items: [...gallerySpec.items, {
      type: 'chart' as const,
      kind: 'bars' as const,
      data: [],
      stacked: true,
      series: [
        { label: 'Issue 206 A', data: [{ label: 'Regression max', value: 30 }, { label: 'Regression half', value: 10 }] },
        { label: 'Issue 206 B', data: [{ label: 'Regression max', value: 10 }, { label: 'Regression half', value: 10 }] },
      ],
    }],
  }
  await page.evaluate((specJson: string) => {
    const host = document.createElement('div')
    host.className = 'md-code-block'
    host.setAttribute('data-visual-inject', '1')
    const label = document.createElement('div')
    label.textContent = 'dsh-ui'
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = specJson
    pre.appendChild(code)
    host.append(label, pre)
    const mount = document.querySelector('[data-chat-flow]') ?? document.body
    mount.appendChild(host)
  }, JSON.stringify(visualSpec))

  let blocks = 0
  for (let i = 0; i < 30; i++) {
    blocks = await page.evaluate(() => document.querySelectorAll('[data-genui]').length)
    if (blocks > 0) break
    await new Promise(r => setTimeout(r, 1000))
  }
  if (blocks === 0) {
    await page.screenshot({ path: join(OUT_DIR, 'visual-fail.png'), fullPage: true })
    const genuiLog = consoleLines.filter(l => l.includes('genui')).slice(0, 6).join(' | ')
    const otherLog = consoleLines.slice(-14).join('\n    ')
    const diag = await page.evaluate(() => ({
      injected: document.querySelectorAll('[data-visual-inject]').length,
      containers: document.querySelectorAll('.genui-dom-fence').length,
      genuiRoots: document.querySelectorAll('[data-genui]').length,
      hidden: document.querySelectorAll('.md-code-block[style*="display: none"]').length,
      containerHtml: document.querySelector('.genui-dom-fence')?.innerHTML.slice(0, 300) ?? 'none',
      processed: document.querySelector('[data-visual-inject]')?.hasAttribute('data-genui-rendered') ?? null,
      codeBlocks: document.querySelectorAll('.md-code-block').length,
    }))
    throw new Error(`the gallery did not render within 30s (pageerrors: ${pageErrors.slice(0, 3).join(' | ') || 'none'}; genui: ${genuiLog || 'none'}; other console: ${otherLog || 'none'}; diag: ${JSON.stringify(diag)})`)
  }
  log(`✓ gallery rendered successfully (${blocks} data-genui blocks)`)

  // Wait for the lazy engines: mermaid rendering, three.js scene ready (WebGL
  // goes through swiftshader in headless).
  await page.waitForTimeout(6000)
  await page.screenshot({ path: join(OUT_DIR, 'gallery.png'), fullPage: true })
  log('✓ screenshot gallery.png')

  // Per-component crops: the gallery is far taller than a viewport, so a
  // single full-page shot is useless for reviewing one component's design.
  const parts: Array<[string, string]> = [
    ['steps', '[class*="steps"]'],
    ['timeline', '[class*="timeline"]'],
    ['mermaid', '[data-genui] svg[id^="mermaid"], [class*="mermaid"] svg'],
    ['diagram', '[class*="diagram"]'],
    ['quiz', '[class*="quiz"]'],
    ['media', '[class*="media"]'],
    ['kv', '[class*="kvRow"]'],
    ['controls', '[class*="input"], [class*="select"], [class*="textarea"]'],
  ]
  for (const [name, selector] of parts) {
    const el = await page.$(selector)
    if (el === null) continue
    await el.scrollIntoViewIfNeeded()
    await page.waitForTimeout(250)
    await el.screenshot({ path: join(OUT_DIR, `part-${name}.png`) }).catch(() => {})
  }
  log(`✓ per-component screenshots: ${parts.map(p => p[0]).join(' / ')}`)

  // ── Streaming skeleton checks ───────────────────────────────────────────
  // A dsh-ui fence holding half-written JSON must show a skeleton, not bare
  // JSON; if it still fails to parse after settle, the original code block must
  // come back (it must never stay hidden forever).
  await page.evaluate(() => {
    const row = document.createElement('div')
    row.setAttribute('data-chat-anchor-key', 'e2e-skeleton:0')
    row.setAttribute('data-chat-flow-kind', 'assistant-step')
    row.setAttribute('data-streaming', '')
    const block = document.createElement('div')
    block.className = 'md-code-block'
    block.setAttribute('data-visual-skeleton', '1')
    const label = document.createElement('div')
    label.textContent = 'dsh-ui'
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = '{"items":[{"type":"stat","label":"CPU","value":"42%'
    pre.appendChild(code)
    block.append(label, pre)
    row.appendChild(block)
    ;(document.querySelector('[data-chat-flow]') ?? document.body).appendChild(row)
  })
  await page.waitForTimeout(2500)
  const skeleton = await page.evaluate(() => ({
    skeleton: document.querySelectorAll('.genui-dom-fence [class*="skeleton"]').length,
    rawVisible: document.querySelector('[data-visual-skeleton]')?.getAttribute('style') ?? '',
  }))
  if (skeleton.skeleton === 0) throw new Error(`the streaming skeleton did not appear (${JSON.stringify(skeleton)})`)
  await page.evaluate(() => { document.querySelector('[data-chat-anchor-key="e2e-skeleton:0"]')?.removeAttribute('data-streaming') })
  await page.waitForTimeout(1800)
  // After settle, tier-2 completion repairs the half-written spec → the
  // skeleton is replaced by the real component (the better outcome; "hand the
  // original code block back when it cannot be repaired" is covered by
  // tests/dom-fence.spec.tsx).
  const restored = await page.evaluate(() => {
    const block = document.querySelector('[data-visual-skeleton]')
    const container = document.querySelector('.genui-dom-fence')
    return {
      skeletons: document.querySelectorAll('.genui-dom-fence [class*="skeleton"]').length,
      hidden: block?.getAttribute('style')?.includes('display: none') ?? false,
      text: container?.textContent ?? '',
    }
  })
  if (restored.skeletons !== 0 || !restored.hidden || !restored.text.includes('CPU')) {
    throw new Error(`the skeleton was not replaced by the real component after settle (${JSON.stringify(restored)})`)
  }
  log('✓ streaming skeleton: appears → replaced by the real component after settle')

  // ── Engine progressive disclosure checks ────────────────────────────────
  // Baseline chart kinds need only the core engine; advanced kinds
  // (radar/sankey/…) or a raw option pull the full bundle.
  if (assetRequests.includes('echarts-core.js')) {
    if (!assetRequests.includes('echarts-full.js')) {
      throw new Error(`the radar/sankey samples are present but the full engine was not fetched (requests: ${assetRequests.join(', ')})`)
    }
    log(`✓ engines on demand: ${[...new Set(assetRequests)].join(' + ')}`)
  }

  // ── Local filter (data binding) checks ──────────────────────────────────
  // Bound filtering is pure client behaviour: the input's value filters the
  // table directly with no request. Assert it really works in a real browser,
  // and that clearing it restores the full table.
  const filterInput = page.getByPlaceholder('\u8f93\u5165\u5173\u952e\u5b57\u5373\u65f6\u8fc7\u6ee4\u4e0b\u8868')
  if (await filterInput.count() > 0) {
    const before = await page.locator('table tbody tr').count()
    await filterInput.fill('\u641c\u7d22')
    await page.waitForTimeout(400)
    const after = await page.locator('table tbody tr').count()
    if (!(after < before)) throw new Error(`bound filtering did not take effect (${before} → ${after} rows)`)
    await filterInput.fill('')
    await page.waitForTimeout(300)
    const restored = await page.locator('table tbody tr').count()
    if (restored !== before) throw new Error(`clearing the filter did not restore the table (expected ${before}, got ${restored})`)
    log(`✓ local filter: ${before} → ${after} → ${restored} rows`)
  }

  // ── File tree layout checks ─────────────────────────────────────────────
  // jsdom has no layout, so only a real browser can prove "a child node sits
  // below its parent" — this assertion pins down a past bug where children were
  // packed into the parent row's flex container and the whole tree laid out in
  // one horizontal line.
  const treeCheck = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[class*="ftRow"]')] as HTMLElement[]
    if (rows.length < 2) return { ok: false, reason: `only ${rows.length} rows` }
    const [first, second] = rows as [HTMLElement, HTMLElement]
    const a = first.getBoundingClientRect()
    const b = second.getBoundingClientRect()
    return {
      ok: b.top >= a.bottom - 1,
      reason: `parent.top=${Math.round(a.top)} parent.bottom=${Math.round(a.bottom)} child.top=${Math.round(b.top)}`,
      rows: rows.length,
      guides: document.querySelectorAll('[class*="ftGuide"]').length,
      glyphs: document.querySelectorAll('[class*="ftGlyph"] svg').length,
    }
  })
  if (!treeCheck.ok) throw new Error(`the file tree does not stack vertically (${treeCheck.reason})`)
  log(`✓ file tree: ${treeCheck.rows} rows stacked vertically · ${treeCheck.guides} hierarchy guide lines · ${treeCheck.glyphs} icons`)

  // ── Accent card surfaces must stay neutral ──────────────────────────────
  // Regression: accent once mixed 7% of its hue into the card background,
  // which turned muddy and drab in dark theme. The hue may appear only on the
  // border and title; the surface must match an ordinary card exactly.
  const accentSurface = await page.evaluate(() => {
    // The accent card is the only one carrying the inline custom property; its
    // siblings in the same grid are the neutral controls.
    const accentEl = document.querySelector('[style*="--dsl-card-accent"]') as HTMLElement | null
    const row = accentEl?.parentElement ?? null
    const plainEl = row === null
      ? null
      : [...row.children].find(child => child !== accentEl
        && !(child.getAttribute('style') ?? '').includes('--dsl-card-accent')) as HTMLElement | undefined
    if (accentEl === null || plainEl === undefined || plainEl === null) return { ok: true, skipped: true }
    const accent = accentEl
    const plain = plainEl
    // No inner named function: esbuild's keepNames helper (__name) is not
    // defined inside the page context and the evaluate call would throw.
    return {
      ok: getComputedStyle(accent).backgroundColor === getComputedStyle(plain).backgroundColor,
      skipped: false,
      accent: getComputedStyle(accent).backgroundColor,
      plain: getComputedStyle(plain).backgroundColor,
      border: getComputedStyle(accent).borderTopColor,
    }
  })
  if (!accentSurface.ok) {
    throw new Error(`the accent card surface is tinted (accent=${accentSurface.accent} / plain=${accentSurface.plain})`)
  }
  if (!accentSurface.skipped) {
    log(`✓ accent card: surface ${accentSurface.accent} (matches an ordinary card) · border ${accentSurface.border}`)
  }

  // ── Surface direction: a light card must not be darker than the page (issue #159) ──
  // Regression: to make light cards "visible", 0.10.0 changed the card surface
  // to a 10% label overlay (page 255 → card 231), so cards became 24 levels
  // darker than the white page — reading as recessed/disabled rather than
  // raised, and light-theme users reported "every card is grey-black". Here we
  // measure the actual rendered colours of the stat card and the page it sits
  // on under both themes in a real browser, and pin the direction down:
  //   light: card >= page (the white surface + 1px border + shadow carry the lift)
  //   dark:  card >  page (layer-2 + 4% overlay; in dark theme shadows are nearly invisible)
  const surfaces = await page.evaluate(() => {
    // The card itself, not a descendant: CSS-module classes are hashed and
    // nested ones share the prefix (…_statDelta matches [class*="_stat"]), so
    // require one class token to END in `_stat`.
    const candidates = [...document.querySelectorAll('[class*="_stat"]')] as HTMLElement[]
    const stat = candidates.find(el => [...el.classList].some(name => name.endsWith('_stat'))) ?? null
    if (stat === null) return { ok: false as const, reason: 'the gallery has no stat card' }
    // Outermost painted ancestor = the page canvas the card sits on (light:
    // white, dark: bg-base); the nearest painted one may be a bubble/card.
    let el: HTMLElement | null = stat.parentElement
    let pageEl: HTMLElement | null = null
    while (el !== null) {
      const bg = getComputedStyle(el).backgroundColor
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') pageEl = el
      el = el.parentElement
    }
    const wasDark = document.body.hasAttribute('data-ds-dark-theme')
    document.body.removeAttribute('data-ds-dark-theme')
    const lightCard = getComputedStyle(stat).backgroundColor
    const lightPage = pageEl === null ? 'rgb(255, 255, 255)' : getComputedStyle(pageEl).backgroundColor
    document.body.setAttribute('data-ds-dark-theme', '')
    const darkCard = getComputedStyle(stat).backgroundColor
    const darkPage = pageEl === null ? 'rgb(21, 21, 23)' : getComputedStyle(pageEl).backgroundColor
    if (!wasDark) document.body.removeAttribute('data-ds-dark-theme')
    return {
      ok: true as const,
      className: stat.className,
      lightCard,
      lightPage,
      darkCard,
      darkPage,
      border: getComputedStyle(stat).borderTopColor,
    }
  })
  if (!surfaces.ok) throw new Error(`the surface direction check could not run: ${surfaces.reason}`)
  /** Mean channel of `rgb(r, g, b)` or `color(srgb r g b / a)` on a 0-255 scale. */
  const meanChannel = (value: string): number => {
    const numbers = (value.match(/[\d.]+/g) ?? []).map(Number)
    const scale = value.startsWith('color(') ? 255 : 1
    return ((numbers[0] ?? 0) + (numbers[1] ?? 0) + (numbers[2] ?? 0)) / 3 * scale
  }
  /** Alpha of the same two formats (1 when the colour is opaque). */
  const alphaOf = (value: string): number => {
    const numbers = (value.match(/[\d.]+/g) ?? []).map(Number)
    return numbers.length >= 4 ? (numbers[3] ?? 1) : 1
  }
  for (const [theme, colour] of [['light', surfaces.lightCard], ['dark', surfaces.darkCard]] as const) {
    if (alphaOf(colour) < 1) {
      throw new Error(`${theme}: measured element is not the card itself (translucent background ${colour}, selected ${surfaces.className}) — the selector matched a nested element`)
    }
  }
  const lightStep = meanChannel(surfaces.lightCard) - meanChannel(surfaces.lightPage)
  const darkStep = meanChannel(surfaces.darkCard) - meanChannel(surfaces.darkPage)
  if (lightStep < 0) {
    throw new Error(`the light card is ${(-lightStep).toFixed(1)} levels darker than the page (card ${surfaces.lightCard} / page ${surfaces.lightPage}) — the lift must come from border and shadow, never by greying the white card (issue #159)`)
  }
  if (darkStep <= 8) {
    throw new Error(`the dark card is not raised enough (card ${surfaces.darkCard} / page ${surfaces.darkPage})`)
  }
  log(`✓ surface direction: light ${lightStep >= 0 ? '+' : ''}${lightStep.toFixed(1)} levels (card ${surfaces.lightCard} / page ${surfaces.lightPage}) · dark +${darkStep.toFixed(1)} levels (card ${surfaces.darkCard} / page ${surfaces.darkPage}) · border ${surfaces.border}`)

  // ── ECharts colour check (reads canvas pixels) ──────────────────────────
  // Regression: the host defines --dsw-static-* on body while the engine read
  // them only from :root → every series fell back to the same accent colour and
  // multi-series charts came out solid blue. This counts pixel colours directly.
  const hueCheck = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('[data-genui-echart] canvas')] as HTMLCanvasElement[]
    const target = canvases[1] ?? canvases[0]
    if (target === undefined) return { ok: false, reason: 'no canvas' }
    const ctx = target.getContext('2d')
    if (ctx === null) return { ok: false, reason: 'no 2d context' }
    const { data } = ctx.getImageData(0, 0, target.width, target.height)
    const hues = new Set<string>()
    let saturated = 0
    for (let i = 0; i < data.length; i += 4 * 37) {
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      if ((data[i + 3] ?? 0) < 200) continue
      // Only count SATURATED pixels: greys are axes/labels/background and would
      // let a single-colour chart pass this check.
      if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue
      saturated += 1
      hues.add(`${r >> 5}-${g >> 5}-${b >> 5}`)
    }
    // The radar preset draws two series: two distinct saturated hues are the
    // minimum proof that the palette did not collapse to one accent colour.
    return { ok: hues.size >= 2 && saturated >= 20, hues: hues.size, saturated, canvases: canvases.length }
  })
  if (!hueCheck.ok) throw new Error(`ECharts colours are wrong (${JSON.stringify(hueCheck)})`)
  log(`✓ ECharts colours: ${hueCheck.canvases} canvases, radar chart ${hueCheck.hues} saturated hues (${hueCheck.saturated} pixels)`)

  // ── Chart tooltip check (real hover) ────────────────────────────────────
  const stackSeg = page.locator('[class*="stackSeg"]').first()
  if (await stackSeg.count() > 0) {
    await stackSeg.hover()
    await page.waitForTimeout(300)
    const tipText = await page.locator('[class*="chartTip"]').first().textContent().catch(() => null)
    if (tipText === null || !tipText.includes('\u5408\u8ba1')) {
      throw new Error(`hovering a stacked segment did not show the detail tooltip (${String(tipText)})`)
    }
    log(`✓ chart tooltip: ${tipText.replace(/\s+/g, ' ').trim()}`)
  }

  const regressionChart = page.locator('[data-genui-chart="bars"]').filter({ hasText: 'Issue 206' }).first()
  const regressionStacks = regressionChart.locator('[class*="barCol"] > [class*="stack"]:not([class*="stackSeg"]):not([class*="stackValue"])')
  if (await regressionStacks.count() !== 2) throw new Error('the issue #206 regression chart did not render two stacked bars')
  const regressionPlot = regressionChart.locator('[class*="chartPlot"]')
  const plotBox = await regressionPlot.boundingBox()
  for (const stack of await regressionStacks.all()) {
    const stackBox = await stack.boundingBox()
    if (stackBox === null || plotBox === null) throw new Error('the issue #206 regression chart is missing plot geometry')
    if (stackBox.y < plotBox.y - 1) {
      throw new Error(`stacked bar escapes the plot area: stack top=${stackBox.y}, plot top=${plotBox.y}`)
    }
    if (stackBox.y + stackBox.height > plotBox.y + plotBox.height + 1) {
      throw new Error('stacked bar escapes the bottom of the plot area')
    }
  }
  log('✓ issue #206 stacked bars all stay inside the plot area')

  // ── Local interaction checks ────────────────────────────────────────────
  // The click happens in the first evaluate; React 18 state updates are async,
  // so the assertion goes into the next evaluate (with a timeout in between) —
  // otherwise it necessarily reads stale DOM.
  const clicked = await page.evaluate(() => {
    const out: string[] = []
    // 1) Table sorting: click the numeric column header "Q1" (the smallest row
    //    under numeric-aware sorting should be the 0.3% error-rate row)
    const ths = [...document.querySelectorAll('[data-genui] thead th button')]
    const q1 = ths.find(b => b.textContent?.includes('Q1'))
    if (q1) { (q1 as HTMLButtonElement).click(); out.push('sort-clicked=Q1') }
    // 2) Quiz: click the correct option "2" (excluding the word "\u4e8c\u8fdb\u5236" in the explanation text)
    const quizBtns = [...document.querySelectorAll('[data-genui-quiz] button')]
    const correct = quizBtns.find(b => b.textContent?.includes('2') && !b.textContent?.includes('\u4e8c\u8fdb\u5236'))
    if (correct) { (correct as HTMLButtonElement).click(); out.push('quiz-clicked=2') }
    // 3) Directory collapse: click the file tree's "src" directory row (the
    //    first aria-expanded=true button is an accordion header, so locate the
    //    file tree by row text)
    const dirBtn = [...document.querySelectorAll<HTMLElement>('[data-genui] button[aria-expanded="true"]')]
      .find(b => b.textContent?.includes('src'))
    if (dirBtn) { dirBtn.click(); out.push('tree-clicked=src') }
    return out
  })
  await page.waitForTimeout(600)
  const interacted = await page.evaluate(() => {
    const out: string[] = []
    // 1) Sort result: after ascending order the first row should hold the
    //    smallest Q1 (the 0.3% error-rate row); the sort marker sits on the Q1 header
    const rows = [...document.querySelectorAll('[data-genui] tbody tr')].map(tr => tr.textContent ?? '')
    const firstRow = rows[0] ?? ''
    out.push(`sort-first=${firstRow.includes('\u9519\u8bef\u7387') ? '\u9519\u8bef\u7387' : '?'}`)
    const q1th = document.querySelectorAll('[data-genui] thead th')[1]
    out.push(`sort-aria=${q1th?.getAttribute('aria-sort') ?? '?'}`)
    // 2) Quiz result
    out.push('quiz-correct=' + String(document.querySelector('[data-genui-quiz]')?.textContent?.includes('\u56de\u7b54\u6b63\u786e')))
    // 3) Directory collapse result: find the same button again by row text
    const srcDir = [...document.querySelectorAll<HTMLElement>('[data-genui] button[aria-expanded]')]
      .find(b => b.textContent?.includes('src'))
    out.push('tree-collapsed=' + String(srcDir?.getAttribute('aria-expanded') === 'false'))
    // 4) The numeric-column right-align class is present
    out.push('tdNum=' + String(document.querySelectorAll('[data-genui] td[class*="tdNum"]').length))
    return out
  })
  log(`interaction checks: ${interacted.join(' · ')}`)
  // Anti-false-pass: local interaction is the render layer's core promise, so
  // any single unmet expectation must fail.
  const mustPass = [
    ['sort-first=\u9519\u8bef\u7387', 'numeric-aware sorting'],
    ['sort-aria=ascending', 'sort aria marker'],
    ['quiz-correct=true', 'local quiz grading'],
    ['tree-collapsed=true', 'directory collapse'],
  ]
  for (const [expectation, label] of mustPass) {
    if (!interacted.includes(expectation)) throw new Error(`interaction assertion failed: ${label} (expected ${expectation}, got ${interacted.join(' · ')})`)
  }
  if (!interacted.some(s => s.startsWith('tdNum=') && Number(s.slice(6)) > 0)) throw new Error('interaction assertion failed: the numeric-column right-align class is missing')
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT_DIR, 'interactions.png'), fullPage: true })
  log('✓ screenshot interactions.png')

  if (pageErrors.length > 0) throw new Error(`page error: ${pageErrors.slice(0, 3).join(' | ')}`)
  await browser.close()
  await cleanup()
  console.log('PASS visual e2e: gallery render + local interaction + no page errors')
  process.exit(0)
} catch (e) {
  console.error('✗ e2e exception:', e)
  await browser?.close().catch(() => {}) // never leave an orphan playwright browser child
  await cleanup()
  process.exit(1)
}
