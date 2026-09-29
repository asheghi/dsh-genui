#!/usr/bin/env node
/**
 * dsh-genui real-binary e2e: real dsh web + plugin → model emits a dsh-ui fence
 * → the browser renders it → click an action button → the model receives
 * [genui-action] and answers with an update. The whole path is real, nothing is
 * mocked.
 *
 * Anti-false-pass: after a click, a "response" only counts as
 * "a new assistant-step key appears (and the new node is no longer streaming)
 * or the panel/block count is driven by the new operation" — a local chip text
 * change on the button does not count as a response.
 * Readable failure logs: web stdout/stderr really goes into dsh-web.log, the
 * log tail is printed on failure, screenshots are kept in the current directory;
 * cleanup happens in finally and only kills the process group it started.
 *
 * Usage:
 *   node scripts/e2e.mjs [--port 3088] [--keep] [--install link|npm|tarball]
 *                        [--tarball <path> --tarball-sha256 <sha>] [--smoke]
 *
 *   --install link    (default) install the current workspace — tests this code
 *   --install npm     install from the public npm package
 *   --install tarball requires an absolute --tarball path and --tarball-sha256
 *                     (guards against a fake install)
 *   --smoke           no model key required: install → start → home/client.js 200
 *                     → no page errors → plugin boot → Diff/Code/JSON render and
 *                     copy; the model path is not exercised
 * Exit code 0 = PASS, 1 = FAIL.
 */

import { spawn, spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream, rmSync } from 'node:fs'
import { mkdtemp, mkdir, copyFile, rm, writeFile, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DSH_ROOT = process.env.DSH_ROOT ?? resolve(process.env.HOME ?? '', '.dsh/source/current')
// Exact host binary: must be an absolute path built inside DSH_ROOT; dsh is
// deliberately not looked up on PATH by default.
const DSH_BIN = process.env.DSH_BIN ?? join(DSH_ROOT, 'apps/cli/lib/bin.js')
if (!resolve(DSH_BIN).startsWith('/')) fail('DSH_BIN must be an absolute path')
if (!existsSync(DSH_BIN)) fail(`DSH_BIN does not exist: ${DSH_BIN} (run pnpm run build inside DSH_ROOT first)`)
const arg = (name) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
function findDshWebUrl(output) {
  return output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+(?:\/\?token=[A-Za-z0-9_-]+)?)/u)?.[1]
}
const PORT = Number(arg('--port') ?? 3088)
const KEEP = process.argv.includes('--keep')
const SMOKE = process.argv.includes('--smoke')
const INSTALL = arg('--install') ?? 'link'
const TARBALL = arg('--tarball')
const TARBALL_SHA = arg('--tarball-sha256')
const PROMPT = 'Copy exactly the following three lines of Markdown, adding or removing no characters. The first line is only the fence tag, and the JSON starts on the second line:\n```dsh-ui\n{"items":[{"type":"text","content":"Compatibility acceptance"},{"type":"radio","label":"Mode","group":"mode","options":["A","B"]},{"type":"checkbox","label":"Enable","group":"flags"},{"type":"input","id":"note","label":"Notes"},{"type":"button","label":"Send action","action":"compat_ping"}]}\n```'

const fail = (msg) => { console.error(`✗ ${msg}`); process.exit(1) }
const log = (msg) => console.log(`· ${msg}`)

// ── Preflight: arguments, port, tools ─────────────────────────────────────
if (!['link', 'npm', 'tarball'].includes(INSTALL)) fail(`--install allows only link | npm | tarball, got "${INSTALL}"`)
if (INSTALL === 'tarball') {
  if (!TARBALL || !TARBALL_SHA) fail('tarball mode requires --tarball <absolute path> and --tarball-sha256 <sha256>')
  if (!resolve(TARBALL).startsWith('/')) fail('--tarball must be an absolute path')
  if (!existsSync(TARBALL)) fail(`tarball does not exist: ${TARBALL}`)
  const actual = createHash('sha256').update(await (await import('node:fs/promises')).readFile(TARBALL)).digest('hex')
  if (actual !== TARBALL_SHA.toLowerCase()) fail(`tarball SHA256 mismatch: expected ${TARBALL_SHA}, got ${actual}`)
  log(`✓ tarball SHA256 matches (${actual.slice(0, 12)}…)`)
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fail(`invalid port: ${PORT}`)
await new Promise((res) => {
  const probe = createServer()
  probe.once('error', () => { fail(`port ${PORT} is already in use, pick another with --port`) })
  probe.listen(PORT, '127.0.0.1', () => probe.close(res))
})
if (!SMOKE && !process.env.DEEPSEEK_API_KEY) fail('DEEPSEEK_API_KEY is missing (the model needs a real key; --smoke mode does not)')
{
  const r = spawnSync('sh', ['-c', 'command -v pnpm'], { encoding: 'utf8' })
  if (r.status !== 0) fail('pnpm not found; install it and make sure it is on PATH')
}
log(`DSH_BIN: ${DSH_BIN}`)
log(`pnpm: ${spawnSync('pnpm', ['--version'], { encoding: 'utf8' }).stdout.trim()}`)

// ── Temporary environment ─────────────────────────────────────────────────
const DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-genui-e2e-host-'))
const env = { ...process.env, DSH_HOME }
const webLog = join(DSH_HOME, 'dsh-web.log')
const artifactsDir = process.cwd()
let webChild = null

const killWeb = () => {
  if (webChild === null) return
  // Kill only the process group this script started (negative pid of a
  // detached spawn); never a broad pkill
  try { process.kill(-webChild.pid, 'SIGTERM') } catch { /* already gone */ }
  try { process.kill(webChild.pid, 'SIGTERM') } catch { /* already gone */ }
  webChild = null
}

// fail() exits directly; the exit hook guarantees the failure path also cleans
// up only the temporary environment this script created.
process.on('exit', () => {
  killWeb()
  if (!KEEP) rmSync(DSH_HOME, { recursive: true, force: true })
})

const cleanup = async () => {
  killWeb()
  if (!KEEP) await rm(DSH_HOME, { recursive: true, force: true })
  else log(`keeping temporary environment: ${DSH_HOME} (log: ${webLog})`)
}

const logTail = async (n = 30) => {
  try {
    const content = await (await import('node:fs/promises')).readFile(webLog, 'utf8')
    const lines = content.split('\n').filter(Boolean).slice(-n)
    console.error('── tail of dsh-web.log ──')
    console.error(lines.join('\n') || '(empty)')
  } catch { /* no log yet */ }
}

try {
  // ── Install the plugin ──────────────────────────────────────────────────
  if (INSTALL === 'npm') {
    log('installing plugin (public npm package)...')
    const r = spawnSync(DSH_BIN, ['plugin', '--profile', 'web', 'add', '@changfenhuang/dsh-genui'], { env, stdio: 'inherit' })
    if (r.status !== 0) fail('npm install failed (see output above)')
  } else if (INSTALL === 'tarball') {
    log(`installing plugin (tarball ${TARBALL})...`)
    const r = spawnSync(DSH_BIN, ['plugin', '--profile', 'web', 'add', TARBALL], { env, stdio: 'inherit' })
    if (r.status !== 0) fail('tarball install failed (see output above)')
  } else {
    log('installing plugin (link to current workspace)...')
    const r = spawnSync(DSH_BIN, ['plugin', '--profile', 'web', 'add', `link:${REPO_ROOT}`], { env, stdio: 'inherit' })
    if (r.status !== 0) fail('link install failed (see output above)')
  }

  // ── Start dsh web (stdout/stderr really goes into webLog) ───────────────
  log('seeding the workspace registry...')
  const workspaceId = randomUUID()
  const now = new Date().toISOString()
  const workspaceReg = {
    unit: { name: 'workspace', version: 2 },
    global: { initialized: true, workspaceIds: [workspaceId], archivedSessionIds: [] },
    tables: { workspaces: { [workspaceId]: {
      path: REPO_ROOT, title: 'dsh-genui-e2e', sessionIds: [], createdAt: now, updatedAt: now,
    } } },
  }
  await mkdir(join(DSH_HOME, 'storages'), { recursive: true })
  await writeFile(join(DSH_HOME, 'storages/workspace.json'), JSON.stringify(workspaceReg, null, 2))

  const hostSettings = join(homedir(), '.dsh/settings.yaml')
  if (!SMOKE && existsSync(hostSettings)) {
    await copyFile(hostSettings, join(DSH_HOME, 'settings.yaml'))
    log('copied the model configuration settings.yaml')
  } else if (!SMOKE) {
    log('warning: ~/.dsh/settings.yaml not found, the model may be unavailable')
  }

  log(`starting dsh web (port ${PORT}, DSH_HOME=${DSH_HOME})...`)
  const logStream = createWriteStream(webLog, { flags: 'a' })
  webChild = spawn(DSH_BIN, ['web', '--no-open', '--port', String(PORT)], {
    env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let webOutput = ''
  const captureWebOutput = (chunk) => {
    logStream.write(chunk)
    webOutput += chunk.toString()
  }
  webChild.stdout.on('data', captureWebOutput)
  webChild.stderr.on('data', captureWebOutput)
  let readyUrl
  for (let i = 0; i < 120; i++) {
    if (webChild.exitCode !== null) break
    readyUrl = findDshWebUrl(webOutput)
    if (readyUrl !== undefined) break
    await new Promise(r => setTimeout(r, 1000))
  }
  if (readyUrl === undefined) {
    await logTail()
    fail(`dsh web was not ready within 120s (log: ${webLog})`)
  }
  log('dsh web is ready')

  // ── Browser path ────────────────────────────────────────────────────────
  const { chromium } = await import(pathToFileURL(join(DSH_ROOT, 'apps/web/node_modules/playwright/index.mjs')).href)
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, locale: 'zh-CN', permissions: ['clipboard-read', 'clipboard-write'] })
  const pageErrors = []
  const pageMessages = []
  page.on('console', message => pageMessages.push(message.text()))
  page.on('pageerror', e => pageErrors.push(String(e)))
  await page.goto(readyUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)

  // Since 0.1.2 the boot manifest advertises an immutable bundle URL; earlier
  // supported hosts use the bare plugin path.
  const boot = await page.evaluate(() => {
    const boot = window.__DSH_BOOT__
    if (boot === null || typeof boot !== 'object' || !Array.isArray(boot.entries)) return undefined
    return { entries: boot.entries.length, clientUrl: boot.entries.find(entry => entry.id === '@changfenhuang/dsh-genui')?.url }
  })
  if (boot?.entries === 0) {
    await page.screenshot({ path: join(artifactsDir, 'e2e-fail-empty-host-boot.png') })
    fail('the dsh host boot manifest is empty (not even the built-in browser plugin registered)')
  }
  const clientUrl = boot?.clientUrl ?? '/plugins/@changfenhuang/dsh-genui/client.js'
  const clientRes = await fetch(new URL(clientUrl, readyUrl))
  if (!clientRes.ok) {
    await page.screenshot({ path: join(artifactsDir, 'e2e-fail-client404.png') })
    await logTail()
    fail(`GenUI bundle returned ${clientRes.status}`)
  }
  log(`✓ GenUI bundle ${clientRes.status}`)

  if (pageErrors.length > 0) {
    await page.screenshot({ path: join(artifactsDir, 'e2e-fail-pageerror.png') })
    fail(`page error: ${pageErrors.slice(0, 3).join(' | ')}`)
  }
  if (!pageMessages.some(message => message.includes('[genui] client active; fence-channel='))) {
    fail('the GenUI bundle downloaded, but the client entry never activated')
  }

  if (SMOKE) {
    // Fresh keyless profiles follow the host's normal two-step onboarding.
    await page.getByRole('button', { name: '\u7ee7\u7eed', exact: true }).click()
    await page.getByRole('button', { name: '\u7a0d\u540e\u914d\u7f6e', exact: true }).click()
    // Reuse the visual smoke's DOM fence channel with a deterministic primitive fixture.
    // This exercises the installed tarball against the actual host, without a model call.
    await page.evaluate(() => {
      const fixture = document.createElement('div')
      fixture.setAttribute('data-primitives-smoke', '')
      const host = document.createElement('div')
      host.className = 'md-code-block'
      const label = document.createElement('div')
      label.textContent = 'dsh-ui'
      const pre = document.createElement('pre')
      const code = document.createElement('code')
      code.textContent = JSON.stringify({ items: [
        { type: 'diff', diffs: [{ path: 'smoke.txt', oldText: 'before', newText: 'after' }] },
        { type: 'code', lang: 'text', code: 'primitive smoke' },
        { type: 'json', value: { answer: 42 } },
        { type: 'table', columns: ['Version check'], rows: [['103'], [86], ['25']] },
        { type: 'text', content: 'Text after the table' },
        { type: 'badge', label: 'Color check', tone: 'success' },
        { type: 'progress', value: 70 },
        { type: 'callout', title: 'Callout color check', tone: 'success', content: 'The color should display normally' },
      ] })
      pre.appendChild(code)
      host.append(label, pre)
      fixture.appendChild(host)
      document.body.appendChild(fixture)
    })
    const rendered = page.locator('[data-primitives-smoke] [data-genui]')
    await rendered.locator('[data-diff]').waitFor({ state: 'visible' })
    await rendered.locator('[data-json-root-row]').waitFor({ state: 'visible' })
    if (await rendered.locator('[data-diff]').getByRole('button', { name: '\u590d\u5236' }).count() === 0) {
      throw new Error('DiffBlock is missing its copy label')
    }
    await rendered.locator('.md-code-block button').click()
    await page.waitForFunction(async () => await navigator.clipboard.readText() === 'primitive smoke')
    const table = rendered.locator('table').filter({ has: page.getByRole('button', { name: 'Version check' }) })
    await table.getByRole('button', { name: 'Version check' }).click()
    assert.deepEqual(await table.locator('tbody td').allTextContents(), ['25', '86', '103'])
    await table.getByRole('button', { name: 'Version check' }).click()
    assert.deepEqual(await table.locator('tbody td').allTextContents(), ['103', '86', '25'])
    await page.waitForFunction(() => [...document.querySelectorAll('[data-primitives-smoke] [class*="reveal"]')]
      .every(element => getComputedStyle(element).animationName === 'none'))
    await table.scrollIntoViewIfNeeded()
    const beforeHover = await table.boundingBox()
    await table.hover()
    assert.deepEqual(await table.boundingBox(), beforeHover, 'hover must not move the table')
    const position = await table.evaluate(element => {
      const reveal = element.closest('[class*="reveal"]')
      const following = reveal.nextElementSibling
      const before = [element.getBoundingClientRect().y, following.getBoundingClientRect().y]
      reveal.remove()
      following.before(reveal)
      return { before, after: [element.getBoundingClientRect().y, following.getBoundingClientRect().y], animations: reveal.getAnimations().length }
    })
    assert.deepEqual(position.after, position.before, 're-inserting a revealed table must not replay the translation animation')
    assert.equal(position.animations, 0)
    const colors = await rendered.evaluate(element => {
      const background = selector => getComputedStyle(element.querySelector(selector)).backgroundColor
      const fill = element.querySelector('[class*="track"] > [class*="fill"]')
      return { badge: background('[class*="badge"]'), callout: background('[class*="calloutSuccess"]'), fill: getComputedStyle(fill).backgroundImage, width: fill.style.width }
    })
    for (const color of [colors.badge, colors.callout]) {
      assert.ok(color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)', `invalid semantic color: ${color}`)
    }
    assert.notEqual(colors.fill, 'none')
    assert.equal(colors.width, '70%')
    log(`sorting, color, hover and node re-insertion checks passed: ${JSON.stringify({ position, colors })}`)
    if (pageErrors.length > 0) throw new Error(`component render error: ${pageErrors.join(' | ')}`)
    // Exercise the installed SVG without remounting it when the host changes theme.
    await page.emulateMedia({ colorScheme: 'light' })
    await page.evaluate(() => {
      const fixture = document.createElement('div')
      fixture.setAttribute('data-diagram-smoke', '')
      fixture.style.width = '320px'
      const host = document.createElement('div')
      host.className = 'md-code-block'
      const label = document.createElement('div')
      label.textContent = 'dsh-ui'
      const pre = document.createElement('pre')
      pre.textContent = JSON.stringify({ items: [{ type: 'diagram', kind: 'architecture', title: 'Theme check', nodes: [
        { id: 'a', label: 'Entry', type: 'focal', x: 40, y: 40, w: 128, h: 64 },
        { id: 'b', label: 'Service', type: 'backend', x: 40, y: 144, w: 128, h: 64 },
        { id: 'c', label: 'Storage', type: 'store', x: 40, y: 248, w: 128, h: 64 },
      ], edges: [] }] })
      host.append(label, pre)
      fixture.append(host)
      document.body.prepend(fixture)
    })
    const diagram = page.locator('[data-diagram-smoke] [data-genui-diagram]')
    await diagram.waitFor({ state: 'visible' })
    const originalSvg = await diagram.locator('svg').elementHandle()
    for (const mode of ['light', 'dark', 'light']) {
      await page.emulateMedia({ colorScheme: mode })
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, mode === 'dark')
      const result = await diagram.evaluate(element => {
        const svg = element.querySelector('svg')
        const text = [...svg.querySelectorAll('text')].find(t => t.textContent === 'Service')
        const probe = document.createElement('span')
        probe.style.backgroundColor = 'var(--dsw-alias-bg-layer-2)'
        probe.style.color = 'var(--dsw-alias-label-primary)'
        element.append(probe)
        const expected = { paper: getComputedStyle(probe).backgroundColor, ink: getComputedStyle(probe).color }
        probe.remove()
        const rect = svg.getBoundingClientRect()
        return {
          expected, paper: getComputedStyle(svg).backgroundColor, ink: getComputedStyle(text).fill,
          node: getComputedStyle(text.parentElement.querySelectorAll('rect')[1]).fill,
          clipped: [...svg.querySelectorAll('text')].filter(t => {
            const box = t.getBoundingClientRect()
            return box.left < rect.left - 1 || box.right > rect.right + 1 || box.bottom > rect.bottom + 1
          }).map(t => t.textContent),
        }
      })
      assert.equal(result.paper, result.expected.paper, `${mode}: diagram follows host background`)
      assert.equal(result.ink, result.expected.ink, `${mode}: diagram follows host text`)
      assert.equal(result.node, result.expected.paper, `${mode}: backend node follows theme`)
      assert.deepEqual(result.clipped, [], `${mode}: narrow diagram legend remains visible`)
      assert.ok(await originalSvg.evaluate(el => el.isConnected), 'theme changes must not remount the diagram')
      await diagram.screenshot({ path: join(artifactsDir, `diagram-${mode}.png`) })
    }
    log('diagram light/dark round-trip, node colors and narrow legend checks passed')

    // Exercise every math-bearing field against the installed host and fonts.
    await page.evaluate(() => {
      const fixture = document.createElement('div')
      fixture.setAttribute('data-math-smoke', '')
      fixture.style.width = '320px'
      const host = document.createElement('div')
      host.className = 'md-code-block'
      const label = document.createElement('div')
      label.textContent = '  dsh-ui\n'
      const pre = document.createElement('pre')
      pre.textContent = JSON.stringify({ title: '\\(x^2\\)', items: [
        { type: 'text', content: 'Energy **\\(E=mc^2\\)**; $$\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$$' },
        { type: 'list', items: ['Value ==\\(x^2\\)==', { title: '$a+b$', desc: '$c+d$' }] },
        { type: 'table', columns: ['\\(x\\)'], rows: [['$x+y$']] },
        { type: 'keyvalue', pairs: [{ key: 'Result', value: '$z^2$' }] },
        { type: 'callout', title: '$a^2$', content: '$b^2$' },
        { type: 'steps', steps: [{ title: '\\(a=b\\)', desc: '\\[\\begin{aligned}a&=b+c\\\\&=d\\end{aligned}\\]' }] },
        { type: 'timeline', items: [{ title: '\\(x\\)', desc: '\\[f(x)=\\begin{cases}x&x>0\\\\-x&x<0\\end{cases}\\]' }] },
        { type: 'card', title: '\\(a+b\\)', items: [] },
        { type: 'quiz', question: '\\(x^2\\)', options: [{ label: '\\(4\\)', correct: true }] },
        { type: 'tabs', tabs: [{ label: '\\(x\\)', items: [] }] },
        { type: 'input', label: '\\(y\\)' },
        { type: 'button', label: '\\(z\\)' },
      ] })
      host.append(label, pre)
      fixture.append(host)
      document.body.prepend(fixture)
    })
    const math = page.locator('[data-math-smoke] [data-genui]')
    await math.waitFor({ state: 'visible' })
    assert.equal(await math.locator('.katex').count(), 21, 'every covered text field renders its formula')
    assert.equal(await math.locator('.katex-display').count(), 3, 'matrix, piecewise function and multi-line derivation display independently')
    assert.equal(await math.locator('.katex-error').count(), 0, 'no formula parse errors')
    await page.evaluate(() => document.fonts.ready)
    for (const mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode })
      await page.waitForFunction(dark => document.body.hasAttribute('data-ds-dark-theme') === dark, mode === 'dark')
      const geometry = await math.evaluate(element => {
        const formula = element.querySelector('.katex')
        const parent = formula.closest('[class*="inlineMath"]')
        const box = formula.getBoundingClientRect()
        return { width: box.width, height: box.height, color: getComputedStyle(formula).color,
          inheritedColor: getComputedStyle(parent).color, overflow: element.scrollWidth > element.clientWidth + 1 }
      })
      assert.ok(geometry.width > 10 && geometry.height > 10)
      assert.equal(geometry.color, geometry.inheritedColor)
      assert.equal(geometry.overflow, false, 'a formula in a 320px narrow card must not break the layout')
      await math.screenshot({ path: join(artifactsDir, `math-${mode}.png`) })
    }
    if (pageErrors.length > 0) throw new Error(`formula render error: ${pageErrors.join(' | ')}`)
    log('formula across fields, light/dark themes, narrow-card layout and blank-label detection checks passed')

    // Regression fixture for issue #172: two legal fence bodies the guard used
    // to reject wholesale — the fence silently degraded to a raw JSON code
    // block. Both must now render as UI, while a genuinely broken body must
    // still stay a code block (all-or-nothing policy unchanged).
    await page.evaluate(() => {
      const fence = (marker, body) => {
        const fixture = document.createElement('div')
        fixture.setAttribute(marker, '')
        const host = document.createElement('div')
        host.className = 'md-code-block'
        const label = document.createElement('div')
        label.textContent = 'dsh-ui'
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = JSON.stringify(body)
        pre.appendChild(code)
        host.append(label, pre)
        fixture.appendChild(host)
        document.body.prepend(fixture)
      }
      // A: one stat carrying a metric list, next to a legal sibling node.
      fence('data-genui-172-stat', { title: 'Progress snapshot', gap: 12, items: [
        { type: 'stat', items: [{ label: 'Quality gate progress', value: '1/5 in progress' }, { label: 'Blockers', value: '0' }] },
        { type: 'callout', tone: 'info', title: 'Progress notes', content: 'Content' },
      ] })
      // B: bare data-component root whose `items` is its record list.
      fence('data-genui-172-steps', { type: 'steps', title: 'Repair strategy', items: [
        { title: 'Tier one', desc: 'a' }, { title: 'Tier two', desc: 'b' }, { title: 'Tier three', desc: 'c' },
      ] })
      // Control: missing required fields stays a code block (no silent green).
      fence('data-genui-172-bad', { items: [{ type: 'stat' }] })
    })
    const statRow = page.locator('[data-genui-172-stat] [data-genui]')
    await statRow.waitFor({ state: 'visible' })
    const statText = await statRow.textContent()
    for (const fragment of ['Quality gate progress', 'in progress', 'Blockers', 'Progress notes']) {
      assert.ok(statText.includes(fragment), `#172 A: rendered result is missing ${fragment}`)
    }
    assert.equal(await page.locator('[data-genui-172-stat] [data-genui] [data-genui]').count(), 0, '#172 A: no extra col wrapper should appear')
    const stepsBlock = page.locator('[data-genui-172-steps] [data-genui]')
    await stepsBlock.waitFor({ state: 'visible' })
    const stepsText = await stepsBlock.textContent()
    for (const fragment of ['Repair strategy', 'Tier one', 'Tier two', 'Tier three']) {
      assert.ok(stepsText.includes(fragment), `#172 B: rendered result is missing ${fragment}`)
    }
    // The stock code block is hidden only after a replacement mounted.
    for (const marker of ['data-genui-172-stat', 'data-genui-172-steps']) {
      const hidden = await page.locator(`[${marker}] > .md-code-block`).evaluate(block =>
        block.style.display === 'none' && block.hasAttribute('data-genui-rendered'))
      assert.ok(hidden, `${marker}: the original code block must be replaced and hidden`)
    }
    assert.equal(await page.locator('[data-genui-172-bad] [data-genui]').count(), 0, '#172 control: an invalid fence must not render UI')
    const badKept = await page.locator('[data-genui-172-bad] > .md-code-block').evaluate(block =>
      getComputedStyle(block).display !== 'none' && block.textContent.includes('"stat"'))
    assert.ok(badKept, '#172 control: an invalid fence must keep its original code block')
    // Issue #158: the rejected fence explains itself instead of failing silently.
    const badAlert = page.locator('[data-genui-172-bad] .genui-dom-fence-diagnostic [role="alert"]')
    await badAlert.waitFor({ state: 'visible' })
    const badAlertText = await badAlert.textContent()
    assert.ok(badAlertText.includes("type 'stat' requires label"), `#158 the diagnostic should report the field error, actual: ${badAlertText}`)
    assert.ok(badAlertText.includes('stays a code block'), '#158 the diagnostic should state that the fence stays a code block')
    log('issue #172 fences (stat metric list, bare steps root, invalid control + visible diagnostic) verified')

    // Verifies the packed artifact's final source-unavailable fallback in a
    // real host; this fixture does not represent real model-message acceptance.
    await page.evaluate(() => {
      const assistantRow = document.createElement('div')
      assistantRow.setAttribute('data-chat-flow-kind', 'assistant-step')
      const cases = [
        ['valid', 'Code block', '{"items":[{"type":"text","content":"Generic code block acceptance"}]}'],
        ['ordinary', 'Code block', '{"message":"ordinary JSON"}'],
        ['incomplete', 'Code block', '{"items":[{"type":"text","content":'],
        ['explicit', 'json', '{"items":[{"type":"text","content":"Keep as JSON"}]}'],
      ]
      for (const [name, language, raw] of cases) {
        const fixture = document.createElement('div')
        fixture.setAttribute(`data-generic-${name}`, '')
        const block = document.createElement('div')
        block.className = 'md-code-block'
        const banner = document.createElement('div')
        banner.setAttribute('data-code-block-banner', '')
        const label = document.createElement('span')
        label.textContent = language
        banner.appendChild(label)
        const content = document.createElement('div')
        content.setAttribute('data-code-block-content', '')
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = raw
        pre.appendChild(code)
        content.appendChild(pre)
        block.append(banner, content)
        fixture.appendChild(block)
        assistantRow.appendChild(fixture)
      }
      document.body.appendChild(assistantRow)
    })
    await page.locator('[data-generic-valid] [data-genui]').waitFor({ state: 'visible' })
    assert.ok((await page.locator('[data-generic-valid] [data-genui]').textContent()).includes('Generic code block acceptance'))
    for (const name of ['ordinary', 'incomplete', 'explicit']) {
      assert.equal(await page.locator(`[data-generic-${name}] [data-genui]`).count(), 0, `${name} must stay an ordinary code block`)
      assert.equal(await page.locator(`[data-generic-${name}] .md-code-block`).isVisible(), true)
    }
    log('packed client source-unavailable strict CodeBlock fallback verified')

    log('smoke mode: install, activation, real Diff/Code/JSON rendering and copy all passed')
    await browser.close()
    await cleanup()
    console.log('PASS smoke e2e (consumes no model quota)')
    process.exit(0)
  }

  // New session (the workspace is already seeded); a failed click is not
  // tolerated — fail outright and keep the evidence
  const newSession = page.getByText('\u65b0\u4f1a\u8bdd', { exact: false }).first()
  await newSession.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {})
  const clickedNew = await newSession.click().then(() => true).catch(() => false)
  if (!clickedNew) {
    await page.screenshot({ path: join(artifactsDir, 'e2e-fail-newsession.png') })
    await logTail()
    fail('no clickable "new session" entry point found')
  }
  await page.getByText('dsh-genui-e2e', { exact: true }).first().click()

  // Use the host's public markers to locate the editable input area, then wait
  // for session initialisation to finish.
  await page.waitForFunction(() => {
    const input = document.querySelector('[data-composer-input]')
    return input instanceof HTMLElement && input.isContentEditable && !input.closest('[inert]')
  }, undefined, { timeout: 30000 })
  const composer = page.locator('[data-composer-input]')
  await composer.fill(PROMPT)
  await composer.press('Enter')
  log('prompt sent, waiting for the model to emit a dsh-ui fence...')

  const genuiCount = () => page.evaluate(() => document.querySelectorAll('[data-genui]').length)
  /** Stable key of the last assistant-step (stable once streaming ends; a new key means a new reply) */
  const lastStepKey = () => page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')
    return nodes.length ? nodes[nodes.length - 1].getAttribute('data-chat-flow-key') : null
  })
  const stepSettled = async () => page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-chat-flow-kind="assistant-step"]')
    if (nodes.length === 0) return false
    return nodes[nodes.length - 1].querySelector('[data-streaming]') === null
  })

  // Wait for the first fence to render
  let blocks = 0
  for (let i = 0; i < 180; i++) {
    blocks = await genuiCount()
    if (blocks > 0) break
    await new Promise(r => setTimeout(r, 1000))
  }
  if (blocks === 0) {
    console.error('last model reply:', ((await page.locator('[data-chat-flow-kind="assistant-step"]').last().textContent().catch(() => null)) ?? 'none').slice(-2000))
    console.error('dsh-ui code block count:', await page.locator('.md-code-block').count())
    await page.screenshot({ path: join(artifactsDir, 'e2e-fail-timeout.png') })
    await logTail()
    fail(`the model emitted no renderable dsh-ui fence within 180s (pageerrors: ${pageErrors.slice(0, 3).join(' | ') || 'none'})`)
  }
  log(`✓ fence rendered successfully (${blocks} data-genui blocks)`)

  const radio = page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'B' })
  const checkbox = page.getByRole('checkbox', { name: 'Enable' })
  const input = page.getByRole('textbox', { name: 'Notes' })
  await radio.check()
  await checkbox.check()
  await input.fill('Preserved state')
  await page.waitForTimeout(500)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-genui]').first().waitFor({ state: 'visible' })
  assert.equal(await radio.isChecked(), true, 'the radio selection survives a re-render')
  assert.equal(await checkbox.isChecked(), true, 'the checkbox selection survives a re-render')
  assert.equal(await input.inputValue(), 'Preserved state', 'the input value survives a re-render')
  log('✓ radio, checkbox and input state survive a re-render')

  // Click the action button declared by the fence
  const beforeKey = await lastStepKey()
  await page.getByRole('button', { name: 'Send action' }).click()
  log('action button clicked, waiting for the model response...')
  await page.locator('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]')
    .filter({ hasText: '[genui-action]' }).first().waitFor({ state: 'attached', timeout: 30000 })
  log('✓ [genui-action] entered the host session messages')

  // Response criteria: a new assistant-step key appears and the new node stops
  // streaming; or the genui block count changes (a panel / a new fence). A local
  // change to the button chip text does not count.
  let responded = false
  for (let i = 0; i < 180; i++) {
    const key = await lastStepKey()
    const b2 = await genuiCount()
    if (b2 !== blocks) { responded = true; blocks = b2; break }
    if (key !== null && key !== beforeKey) {
      const settled = await stepSettled()
      if (settled) { responded = true; break }
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!responded) {
    await page.screenshot({ path: join(artifactsDir, 'e2e-fail-action-timeout.png') })
    await logTail()
    fail('no real model response within 180s of clicking the action (the event loop never closed; a local chip change does not count)')
  }
  await page.waitForTimeout(2500)
  await page.screenshot({ path: join(artifactsDir, 'e2e-final.png') })
  log(`✓ event loop closed (${blocks} blocks, screenshot e2e-final.png)`)
  console.log('PASS real-binary e2e: install → render → action round-trip → real model response')
  await browser.close()
  await cleanup()
  process.exit(0)
} catch (e) {
  console.error('✗ e2e exception:', e)
  await logTail()
  await cleanup()
  process.exit(1)
}
