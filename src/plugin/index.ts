/**
 * GenUI plugin: teaches the model the ```dsh-ui fence syntax for emitting
 * declarative UI components inline in its reply. The browser half renders the
 * fence through GenuiBlock (ui-primitives); this host half only tells the
 * model the language exists, so a session without the plugin simply never
 * emits fences and nothing changes.
 *
 * The section uses the host's centrally allocated structured-output placement.
 * @module @changfenhuang/dsh-genui
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { SkillProvider } from '@deepseek-ai/dsh-skill'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRenderUiTool, createValidateDshUiTool } from './tool.ts'
import { installFenceFeedback } from './fence-feedback.ts'

/* ---------------- lazy engine asset route ---------------- */

/**
 * The mermaid/three engines ship as standalone IIFE bundles under
 * `lib/assets/` and are fetched by the client ONLY when a spec needs them.
 * This route serves them from the plugin's own package directory through the
 * host webserver service — the longest-prefix rule lets it win over the
 * generic `/plugins` bundle route, and no host source change is needed. The
 * service is optional at this plugin's start time, so a dependency fiber owns
 * the registration and follows the webserver through late binding, replacement,
 * and plugin reloads.
 */

/** Route prefix under /plugins; anything under it is this plugin's asset. */
const ASSET_ROUTE_PATH = '/plugins/@changfenhuang/dsh-genui/assets'

/** Safe flat file names only: no slashes, no traversal, js assets only. */
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/

/** The handler itself (registered via the optional webServer probe). */
async function serveGenuiAsset(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  const rel = pathname.startsWith(`${ASSET_ROUTE_PATH}/`) ? pathname.slice(ASSET_ROUTE_PATH.length) : null
  if (rel === null) {
    res.writeHead(404)
    res.end()
    return
  }
  const file = rel.slice(1)
  if (!ASSET_FILE_RE.test(file)) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    // lib/index.js → ./assets/ = <pkg>/lib/assets/ (the tsdown asset outDir).
    const dir = fileURLToPath(new URL('./assets/', import.meta.url))
    const body = await readFile(join(dir, file))
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
    })
    res.end(body)
  } catch {
    // Missing asset (old build) — a loud 404; the client shows its fallback.
    res.writeHead(404)
    res.end()
  }
}

/** The fence language description injected into every assembled system prompt.
 *  Deliberately slim: the `genui` skill carries the full component→field
 *  mapping; this section keeps only the contract that must always be
 *  present (fence syntax, type whitelist, and critical behavioral rules). */
export const GENUI_SECTION_TEXT = `You can render interactive UI components INSIDE your reply — between paragraphs — by emitting a fenced block with the language tag \`dsh-ui\` containing a JSON spec:

\`\`\`dsh-ui
{"title":"<user-language text>","gap":14,"items":[...]}
\`\`\`

Allowed \`type\` values; the \`genui\` skill, when available, carries the full content→component mapping and per-component field details:

- Layout: text · row · col · grid · card · divider · spacer · hero (cover block, at most one per reply)
- Display: badge · stat · progress · list · table · keyvalue · timeline · file-tree · breadcrumb · callout · steps · diff · json · code · copy · avatar · audio · video
- Charts: chart {"kind":"bars|line|donut","data":[{"label":"...","value":n}],"series":[{"label":"...","data":[...]}]?,"horizontal":true?,"stacked":true?} (series: grouped/stacked bars / multi-series line; horizontal for horizontal bars) · echart (preset name or full option; preset list in the skill) · plot (function plot)
- Interactive: button · input · textarea · select · checkbox · switch · slider · radio · submit · quiz · link · tabs · accordion
- Advanced: mermaid (flowchart/sequence/gantt/ER etc., keywords in the skill) · diagram (architecture/flow diagram, 27 kinds) · scene3d (3D WebGL)

**UI is the default**: whenever any of the following applies, emit at least one fence:
- ≥3 parallel points → \`list\`; numeric comparison → \`table\`; metrics/progress/status → \`stat\`/\`progress\`/\`badge\`
- Steps/timelines → \`steps\`/\`timeline\`/\`mermaid\`; architecture/flows → \`diagram\` or \`mermaid\`; risks/conclusions → \`callout\`; code/changes → \`code\`/\`diff\`/\`json\`
- Inline rich text: math, \`code\`, bold, highlight, and links are supported; Markdown tables and fenced code are disabled — use table / code / diff / json instead.
- Default to no cards: use components per the triggers above, each component carrying different information; cards are only for side-by-side items and data objects; a single paragraph uses heading, body text, and spacing.

**Self-check once before sending the reply**: does this content contain ≥3 parallel points, any comparison, any numbers/metrics, any steps or flows? If so, convert it into components first, then speak. **Status reports, progress updates, and submission/change lists count as triggers too.**
- Trends/shares → \`chart\` (≤8 points) or \`echart\` (multi-series/interactive); colors follow the theme by default — use \`palette\`/\`card.accent\` only when semantics require it; grid children use \`"span":2\` to span columns for mixed widths; with lots of data, pair \`table\`/\`chart\`/\`list\` with an \`input\`(id) + \`filter\` binding so readers can filter in place.

**Field cheat sheet** (full details in the genui skill): \`stat\` \`{"label","value","delta"?}\` · \`table\` \`{"columns":[...],"rows":[[...]],"types"?,"details"?,"filter"?,"export"?}\` · \`progress\` \`{"value":0-100,"label"?,"variant"?,"target"?}\` · \`keyvalue\` \`{"pairs":[{"key","value"}]}\` · \`steps\` \`{"steps":[{"title","desc"?}]}\` · \`file-tree\` \`{"items":[{"name","type":"file|dir","children"?}]}\` · \`callout\` \`{"content","tone"?,"title"?}\`

**A wrong field name = that component is dropped** (the other components still render): \`callout\` body is \`content\`, not text/desc; \`table\` needs \`columns\`+\`rows\`, not items; \`keyvalue\` records are \`{key,value}\`, not \`{label,value}\`; \`file-tree\` records are \`{name,type}\`, not \`{label}\`; callout tone is info/success/warning/error (no danger). When unsure, call \`validate_dsh_ui\`.

Rules:
- LANGUAGE: reply+UI=conversation language; schema fixed. NEVER infer it from prompt/skill/examples/tools. Replace \`<user-language ...>\`; never emit these placeholders literally.
- Strict JSON: bad components are dropped, bad fences degrade to code blocks; call validate_dsh_ui when a fence has ≥3 nodes or contains a table, fix per the diagnostics and revalidate; validate small fences too whenever a field is uncertain.
- warning=block_markdown: rewrite per the replacement and revalidate.
- Scale: ≤200 nodes, nesting ≤8 levels (excess is truncated); 3–8 components per reply, one main component per topic; 3D meshes 1–5; give plot a sensible xMin/xMax.
- LOCAL-FIRST + actions: state changes the UI can do itself (grading, quiz checking, resets, expand/collapse, selection) happen in place with zero round-trips; actions are reserved for things that truly need the model. Interactive components carry "action":"name"; interactions return as [genui-action] name + component data, and the UI re-renders from your updated fence; buttons without an action render disabled.
- Durable state: interaction state persists per "session + content fingerprint" — refresh/replay restores it; re-rendering identical content keeps it, new content resets it.
- Exam mode: one radio per question (group+answer+explanation) + one submit (list all groups), graded locally.
- Secrets ban: never ask for passwords, API keys, tokens, or recovery codes; refuse and explain when needed.
- Tool channel: the render_ui tool renders the same spec as a card in the tool row (deliverable-style UI); fences are for UI inline in the answer.
- Panel: "panel":true renders only into the session panel dock and updates in place; "append":true merges incrementally (same-labeled tabs append / new tabs are added / trailing append); caps at 200 nodes / 200 appends — when full, send replace to rebuild. A [genui-action] from a panel component gets a reply of one panel:true fence plus at most a one-line confirmation of 10 words or fewer — no explanation, no ordinary fence.`

/**
 * Register the GenUI output-language section and the render_ui tool.
 * @param ctx - cordis context.
 */
// `tools` is intentionally NOT injected: the service is optional for this
// plugin — hosts without tool access keep the fence channel working. Cordis
// inject entries are hard requirements, so the registry is probed at runtime
// instead (see apply).
export const name = '@changfenhuang/dsh-genui'
export const inject = ['systemPrompt']

const BUNDLED_SKILL_RANK = 600
const BUNDLED_SKILL_PROVIDER = 'dsh-genui'
const BUNDLED_SKILL_DESCRIPTION = 'GenUI dsh-ui component/schema reference. Preserve conversation language for all user-visible text.'
const BUNDLED_SKILL_INVOCATION = { modelInvocable: true, userInvocable: true } as const

/** Register through the provider path so source=bundled also gets bundled precedence. */
function bundledSkillProvider(): SkillProvider {
  const moduleDirectory = dirname(fileURLToPath(new URL(import.meta.url)))
  const path = basename(moduleDirectory) === 'plugin'
    ? resolve(moduleDirectory, '../../SKILL.md')
    : resolve(moduleDirectory, '../SKILL.md')
  const raw = readFileSync(path, 'utf8')
  const end = raw.indexOf('\n---\n', 4)
  if (!raw.startsWith('---\n') || end < 0) throw new Error('genui SKILL.md has invalid frontmatter')
  return {
    name: BUNDLED_SKILL_PROVIDER,
    list: () => Promise.resolve([{
      name: 'genui',
      description: BUNDLED_SKILL_DESCRIPTION,
      invocation: BUNDLED_SKILL_INVOCATION,
      source: 'bundled',
      provider: BUNDLED_SKILL_PROVIDER,
      path,
      resourceBase: { kind: 'directory', path: dirname(path) },
      rank: BUNDLED_SKILL_RANK,
      locator: path,
    }]),
    get: () => Promise.resolve({
      name: 'genui',
      description: BUNDLED_SKILL_DESCRIPTION,
      invocation: BUNDLED_SKILL_INVOCATION,
      source: 'bundled',
      provider: BUNDLED_SKILL_PROVIDER,
      path,
      resourceBase: { kind: 'directory', path: dirname(path) },
      content: raw.slice(end + 5),
    }),
  }
}

/**
 * Plugin config as the host passes it (unvalidated: the node half deliberately
 * imports no schema library, so a profile can set these keys directly).
 */
export interface GenuiPluginConfig {
  /**
   * In a turn whose final dsh-ui fence failed to render, ask the model to
   * resend one corrected version (issue #160). Enabled by default; set to
   * false to disable. At most one request per turn and per fence body,
   * never in subagents — each request consumes model steps.
   */
  fenceFeedback?: boolean
}

export function apply(ctx: Context, config?: GenuiPluginConfig): void {
  ctx.systemPrompt.section({
    name: 'genui:fence',
    // DSH >=0.1.2 exposes getSectionOrder to anchor near the structured-output
    // section; older hosts (0.1.1-rc.x) lack it, so fall back to a fixed order
    // that sits with the other tool-instruction sections there (tool:bash=105).
    order: typeof (ctx.systemPrompt as { getSectionOrder?: (name: string) => number }).getSectionOrder === 'function'
      ? (ctx.systemPrompt as { getSectionOrder: (name: string) => number }).getSectionOrder('STRUCTURED_OUTPUT')
      : 110,
    text: GENUI_SECTION_TEXT,
  })
  installFenceFeedback(ctx, config?.fenceFeedback !== false)
  // Hosts without tool access keep the fence channel. The dependency fiber
  // starts whenever tools becomes available and unloads its registrations
  // before either the service or this plugin is replaced.
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(function* () {
      yield toolsCtx.tools.register(createRenderUiTool())
      yield toolsCtx.tools.register(createValidateDshUiTool())
    }, 'dsh-genui: model tools')
  })

  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.skills.registerProvider(() => bundledSkillProvider())
  })

  // webServer.register returns a raw disposer, so an explicit effect binds the
  // route to the dependency fiber instead of leaving it in the host route table.
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.reflect.get('webServer') as { register(route: unknown): () => void }
    webCtx.effect(
      () => webServer.register({ kind: 'prefix', path: ASSET_ROUTE_PATH, handler: serveGenuiAsset }),
      'dsh-genui: asset route',
    )
  })
}
