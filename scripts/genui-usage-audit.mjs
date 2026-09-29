#!/usr/bin/env node
/**
 * GenUI adoption audit — reads the local DSH session logs and reports how
 * often the model actually emits ```dsh-ui fences, which components it uses,
 * and how many fence bodies fail to parse.
 *
 * Why: adoption was measured once by hand (391 sessions, 8586 assistant text
 * blocks, 796 fences). This script makes that repeatable, so a prompt change
 * (or a model change) can be judged on data instead of impressions.
 *
 * Usage:
 *   node scripts/genui-usage-audit.mjs [--dir ~/.dsh/sessions] [--days 14] [--json]
 *
 * Notes:
 * - Session logs are multi-frame zstd JSONL. The `zstd` CLI decodes all
 *   frames; the node:zlib fallback reads only the first frame, so install
 *   zstd for a complete scan (the script says so when it falls back).
 * - "Long answer" = one assistant text block longer than 600 characters —
 *   the population where structured output is expected.
 * - Parse failures are an UPPER BOUND: the plugin's tier-1/tier-2 repair
 *   (src/shared/fence-repair.ts) heals most of them at render time.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? fallback : process.argv[i + 1]
}
const AS_JSON = process.argv.includes('--json')
const DAYS = Number(arg('--days', '14'))
const DIR = resolve(arg('--dir', join(homedir(), '.dsh', 'sessions')))
const FENCE = /```dsh-ui\s*\n([\s\S]*?)```/g

function decode(file) {
  try {
    return execFileSync('zstd', ['-dc', '--quiet', file], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8')
  } catch {
    return null
  }
}

const files = []
;(function walk(dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name.endsWith('.jsonl.zstd')) files.push(path)
  }
})(DIR)

const stats = {
  dir: DIR,
  sessions: 0,
  assistantBlocks: 0,
  assistantChars: 0,
  fences: 0,
  blocksWithFence: 0,
  longBlocks: 0,
  longWithFence: 0,
  unparseable: 0,
  unparseableAfterCommaFix: 0,
  components: {},
  daily: {},
  /** Layout signatures: distinct component sets per answer. */
  signatures: new Map(),
  signatureTotal: 0,
  heroAnswers: 0,
  answersWithMultipleHeroes: 0,
  /** Per-answer card counts: the "default cardless" rule's measurable proxy. */
  echartPresets: {},
  echartRawOption: 0,
  echartUnspecified: 0,
  cardAnswers: 0,
  cardTotal: 0,
  cardHistogram: {},
  undecodable: 0,
}

/** Count echart node styles: named preset vs raw option. */
function collectEchart(node) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const item of node) collectEchart(item); return }
  if (node.type === 'echart') {
    if (typeof node.preset === 'string') stats.echartPresets[node.preset] = (stats.echartPresets[node.preset] ?? 0) + 1
    else if (node.option !== undefined) stats.echartRawOption += 1
    else stats.echartUnspecified += 1
  }
  for (const value of Object.values(node)) if (value !== null && typeof value === 'object') collectEchart(value)
}

function walkTypes(node, bag) {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const item of node) walkTypes(item, bag); return }
  if (typeof node.type === 'string') bag[node.type] = (bag[node.type] ?? 0) + 1
  for (const value of Object.values(node)) if (value !== null && typeof value === 'object') walkTypes(value, bag)
}

for (const file of files) {
  const text = decode(file)
  if (text === null) { stats.undecodable += 1; continue }
  stats.sessions += 1
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let record
    try { record = JSON.parse(line) } catch { continue }
    if (record.type !== 'assistant/message') continue
    const content = record.data?.message?.content
    if (!Array.isArray(content)) continue
    const day = typeof record.time === 'number' ? new Date(record.time).toISOString().slice(0, 10) : 'unknown'
    for (const block of content) {
      if (block?.type !== 'text' || typeof block.text !== 'string') continue
      const body = block.text
      stats.assistantBlocks += 1
      stats.assistantChars += body.length
      const isLong = body.length > 600
      const matches = [...body.matchAll(FENCE)]
      const daily = stats.daily[day] ?? (stats.daily[day] = { long: 0, longWithFence: 0, fences: 0 })
      if (isLong) { stats.longBlocks += 1; daily.long += 1 }
      if (matches.length === 0) continue
      stats.blocksWithFence += 1
      if (isLong) { stats.longWithFence += 1; daily.longWithFence += 1 }
      stats.fences += matches.length
      daily.fences += matches.length
      // Layout signature per ANSWER (all its fences): the anti-templating
      // metric — if a prompt change made every answer the same shape, the
      // number of distinct signatures drops and the top share climbs.
      const answerTypes = new Set()
      const answerBag = {}
      const bagFor = key => answerBag[key] ?? 0
      let heroCount = 0
      for (const match of matches) {
        let spec = null
        try { spec = JSON.parse(match[1]) } catch {
          stats.unparseable += 1
          try { spec = JSON.parse(match[1].replace(/,\s*([}\]])/g, '$1')) } catch { spec = null }
          if (spec === null) stats.unparseableAfterCommaFix += 1
        }
        if (spec === null) continue
        const bag = {}
        walkTypes(spec, bag)
        // ECharts preset adoption: preset mode (one line) vs a hand-written
        // `option` (the 500-byte path the presets exist to replace).
        collectEchart(spec)
        for (const [type, count] of Object.entries(bag)) {
          answerTypes.add(type)
          answerBag[type] = (answerBag[type] ?? 0) + count
          if (type === 'hero') heroCount += count
        }
        walkTypes(spec, stats.components)
      }
      if (answerTypes.size > 0) {
        const signature = [...answerTypes].sort().join('+')
        stats.signatures.set(signature, (stats.signatures.get(signature) ?? 0) + 1)
        stats.signatureTotal += 1
        if (heroCount > 1) stats.answersWithMultipleHeroes += 1
        stats.heroAnswers += heroCount > 0 ? 1 : 0
        const cards = answerTypes.has('card') ? (bagFor('card')) : 0
        stats.cardAnswers += cards > 0 ? 1 : 0
        stats.cardTotal += cards
        stats.cardHistogram[Math.min(cards, 5)] = (stats.cardHistogram[Math.min(cards, 5)] ?? 0) + 1
      }
    }
  }
}

const pct = (a, b) => (b === 0 ? '0%' : `${((100 * a) / b).toFixed(1)}%`)
const top = Object.entries(stats.components).sort((a, b) => b[1] - a[1])
const recentDays = Object.entries(stats.daily).sort().slice(-Math.max(DAYS, 1))

if (AS_JSON) {
  console.log(JSON.stringify({ ...stats, signatures: Object.fromEntries([...stats.signatures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)), components: top.slice(0, 30), daily: Object.fromEntries(recentDays) }, null, 2))
} else {
  console.log(`GenUI adoption audit · ${stats.dir}`)
  console.log(`sessions ${stats.sessions} · assistant text blocks ${stats.assistantBlocks} (${stats.assistantChars.toLocaleString()} chars) · fences ${stats.fences}`)
  console.log(`blocks with a fence ${stats.blocksWithFence} (${pct(stats.blocksWithFence, stats.assistantBlocks)} of all / ${pct(stats.longWithFence, stats.longBlocks)} of long answers)`)
  console.log(`long answers (>600 chars) ${stats.longBlocks}, of which with a fence ${stats.longWithFence}`)
  console.log(`raw JSON parse failures ${stats.unparseable} (${pct(stats.unparseable, stats.fences)} of all fences); still failing after trailing-comma repair only ${stats.unparseableAfterCommaFix} (the plugin's two-tier repair heals most of the rest)`)
  if (stats.undecodable > 0) console.log(`⚠ ${stats.undecodable} session files could not be decoded (install the zstd CLI for a complete scan)`)
  // Layout diversity: distinct signatures + share of the most common one +
  // normalised Shannon entropy (1 = every answer a different shape).
  const sigs = [...stats.signatures.entries()].sort((a, b) => b[1] - a[1])
  const total = stats.signatureTotal
  if (total > 0) {
    const top = sigs[0]
    let entropy = 0
    for (const [, count] of sigs) {
      const p = count / total
      entropy -= p * Math.log2(p)
    }
    const maxEntropy = Math.log2(sigs.length) || 1
    console.log(`\nLayout diversity: ${total} fenced answers / ${sigs.length} layout signatures; most common ${pct(top[1], total)}; normalised entropy ${(entropy / maxEntropy).toFixed(2)}`)
    console.log(`  hero: used by ${stats.heroAnswers} answers (${pct(stats.heroAnswers, total)}); violating "one per answer": ${stats.answersWithMultipleHeroes}`)
    console.log(`  card: used by ${stats.cardAnswers} answers (${pct(stats.cardAnswers, total)}), average ${(stats.cardTotal / total).toFixed(2)} each; distribution 0/1/2/3/4/5+ = ${[0, 1, 2, 3, 4, 5].map(k => stats.cardHistogram[k] ?? 0).join('/')}`)
    console.log('  three most common:')
    for (const [signature, count] of sigs.slice(0, 3)) console.log(`    ${String(count).padStart(4)}  ${signature || '(no components)'}`)
  }
  const presetTotal = Object.values(stats.echartPresets).reduce((a, b) => a + b, 0)
  const echartTotal = presetTotal + stats.echartRawOption + stats.echartUnspecified
  if (echartTotal > 0) {
    console.log(`\nechart: ${echartTotal} nodes · preset ${presetTotal} (${pct(presetTotal, echartTotal)}) · hand-written option ${stats.echartRawOption} · unspecified ${stats.echartUnspecified}`)
    const top = Object.entries(stats.echartPresets).sort((a, b) => b[1] - a[1]).slice(0, 6)
    if (top.length > 0) console.log('  ' + top.map(([k, v]) => `${k}:${v}`).join('  '))
  }
  console.log('\nComponent usage (Top 15):')
  for (const [name, count] of top.slice(0, 15)) console.log(`  ${String(count).padStart(5)}  ${name}`)
  console.log(`\nLast ${recentDays.length} days:`)
  for (const [day, value] of recentDays) {
    console.log(`  ${day}  long answers ${String(value.long).padStart(4)} · with fence ${String(value.longWithFence).padStart(4)} (${pct(value.longWithFence, value.long)}) · fences ${value.fences}`)
  }
}
