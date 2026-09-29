---
name: genui
description: "Render structured interactive UI inline through the dsh-ui fence. Use for key points, emphasis, comparisons, flows, steps, status, data, demos, and interactions whenever structured presentation would be clearer than prose. Preserve conversation language for all user-visible text."
---

# GenUI — Generative UI Output Specification

**Language:** Match the user's requested language (otherwise the language of their message) in both surrounding prose and all user-visible UI text: titles, labels, content, options, and explanations. The examples below use `<user-language ...>` placeholders only to illustrate the schema; do not switch the conversation language after loading this skill, and never emit these placeholders literally — replace every one with actual content in the conversation language. Keep JSON keys, component types, IDs, and actions unchanged. An English request gets English prose and UI text; a Chinese request gets Chinese prose and UI text.

You can emit interactive UI components **in the middle of the answer body**: write a `dsh-ui` fence (fenced block with language tag `dsh-ui`) containing a JSON spec, and the renderer draws that whole block as a real component, with prose flowing normally before and after it. A component **is part of the answer**, not a tool call.

```dsh-ui
{"title":"<user-language text>","gap":14,"items":[...]}
```

Math: `$...$` / `\(...\)` are inline formulas and `$$...$$` / `\[...\]` are display formulas; matrices, piecewise functions, multi-line aligned derivations, and formulas inside bold/highlight are all supported. This applies to body text, list items, key-value pairs, table headers/cells, card/step/timeline/tab titles, quiz questions and explanations, button and form labels, metrics, media captions, and chart outer titles alike. Backslashes inside JSON strings must be doubled, as in `"content": "\\(\\frac{a}{b}\\)"`. Code source, input values/placeholders, native select options, and text drawn inside chart engines still follow their own native formats and do not parse rich text. Math syntax follows KaTeX; HTML, external resources, and scripts are not executed; LaTeX document compilation and arbitrary package loading are not supported.

## Component vocabulary (only these types are allowed)

Layout: `text` `row` `col` `grid` `card` `divider` `spacer`
Display: `stat` `badge` `progress` `list` `table` `keyvalue` `avatar` `image` `audio` `video` `timeline` `file-tree` `breadcrumb` `diff` `json` `code` `callout` `steps`
Charts: `chart` (bars/line/donut, multi-series allowed) `plot` (math function plots) `echart` (full-featured ECharts charts)
Interaction: `button` `input` `select` `checkbox` `radio` `switch` `textarea` `tabs` `accordion` `copy`

### Layout
- text: `{"type":"text","size":"h1|h2|h3|body|muted|caption","content":"...","center":true?}`
- row / col: `{"type":"row"|"col","items":[...],"wrap":true?,"spacer":true?,"gap":n?}`
- grid: `{"type":"grid","cols":n,"items":[...]}`
- hero: `{"type":"hero","title":"<user-language title>","subtitle":"<user-language text>","value":"99.96%","label":"<user-language metric>","delta":"+0.02%","spark":[...],"tone":"accent|success|warning|danger"}` — **cover block**: eyebrow + oversized number (52px, with an entrance count-up) + title + subtitle + tone gradient background. **Use at most one per answer**, placed first as the visual anchor
- span: any node may add `"span":2` (how many grid columns a child occupies) — the only bento-layout primitive: one `span:2` wide card beside one narrow card looks far better than a single column of stacked blocks
- card: `{"type":"card","title":"...","items":[...]}`; `"accent":"#f59e0b"` sets the accent color (border + title + very faint background)
- palette: both `chart` and `echart` support `"palette":["#ff8800","#3ecf8e"]` to override the categorical palette (defaults to the host theme). **Write it only when color is semantically required** (cost = red, gain = green); otherwise following the theme is more reliable. `"tone":"info|success|warning|danger"` sets a card background (for conclusion cards / risk cards)
- divider: `{"type":"divider"}`; spacer: `{"type":"spacer"}`

### Display
- stat: `{"type":"stat","label":"...","value":"...","delta":"+12.4%|-3%"}` (a leading `-` is automatically red, `+` green); optional `"spark":[3,5,4,8,6]` draws a micro trend line (2–60 finite numbers); `"size":"hero"` renders an oversized number (use at most once per answer, as the visual anchor)
- badge: `{"type":"badge","label":"...","tone":"success|warn|danger|accent","icon":"emoji?"}`
- progress: `{"type":"progress","label":"...","value":0-100,"valueLabel":"70%"}`; `"variant":"ring"` draws a ring, `"target":70` marks a target tick on the track
- avatar: `{"type":"avatar","name":"...","color":"#hex?"}`
- image: `{"type":"image","src":"/mmx-files/result.png","alt":"<user-language description>"}` — shows a browser-reachable http(s) or same-origin relative image URL; lazy-loaded; `file:`/`data:` and other local or active protocols are not supported
- audio: `{"type":"audio","src":"/mmx-files/result.mp3","alt":"<user-language description>","loop":true?}` — native controls; plays only when the user starts it, never autoplays; http(s) or same-origin relative URLs only
- video: `{"type":"video","src":"/mmx-files/result.mp4","alt":"<user-language description>","poster":"/mmx-files/poster.jpg"?,"loop":true?,"muted":true?,"aspectRatio":"16:9|4:3|1:1|9:16"?}` — native play/volume/fullscreen controls; never autoplays
- list: `{"type":"list","items":["..."] or [{"title":"...","desc":"..."}] or nested nodes (e.g. {"type":"badge","label":"TS"})}` — nodes may be embedded inline (they count toward the node budget)
- table: `{"type":"table","columns":["..."],"rows":[["...","..."]],"types":["text|num|delta|bar|badge"]?,"details":[[...]]?,"total":true?}` — clicking a header sorts locally (ascending/descending/original, zero round trips); value aware: thousands separators (`1,234`), `k/m/b`, CJK scale units (10^4 / 10^8), `%`, and currency symbols all compare by real value, and purely numeric columns right-align automatically; **signed cells are colored automatically** (`+12.4%` green, `-3` red, no extra field needed); `types` can set a per-column `bar` (0-100 inline progress bar), `ring` (0-100 small ring), `spark` (write `"3,5,4,8"` in the cell to draw a micro trend line), `badge` (pill label), `delta` (force up/down color), `num` (force right align), `index` (row number), `group` (treat the first column as a group heading: a row whose only populated cell is the first renders as a colspan subheading); `"total":true` appends a total row (numeric columns are summed automatically); **`"export":true`**: two small "Copy Markdown / Copy CSV" buttons appear above the table (purely local clipboard, no request); **`"filter":"input-id"`**: binds the table to an input/select so typing filters it live (`filterColumn` restricts the column) — with a lot of data **this should be the default**; **`"sortField":"select-id"`** sorts by the select's value (a column name); **`"details"` is index-aligned with rows**, where entry i is the expanded content of row i (any component; `null` = that row is not expandable) — a chevron appears in the first column and expands the detail beneath the whole row, good for "main table + detail"
- keyvalue: `{"type":"keyvalue","pairs":[{"key":"...","value":"..."}]}`
- timeline: `{"type":"timeline","items":[{"title":"...","desc":"...","time":"..."}]}`
- file-tree: `{"type":"file-tree","items":[{"name":"...","type":"file|dir","children":[...]?}]}` — directory rows collapse/expand on click (local, zero round trips)
- breadcrumb: `{"type":"breadcrumb","items":["<user-language text>","<user-language text>","<user-language text>"]}`
- diff: `{"type":"diff","diffs":[{"path":"...","oldText":"..."|null,"newText":"..."}]}`
- json: `{"type":"json","value":...}` (JSON tree viewer)
- code: `{"type":"code","lang":"ts","code":"..."}`
- callout: `{"type":"callout","tone":"info|success|warning|error","title":"...","content":"..."}`
- steps: `{"type":"steps","current":n,"steps":[{"title":"...","desc":"..."}]}`

### Charts
- chart: `{"type":"chart","kind":"bars|line|donut","data":[{"label":"...","value":n,"color":"#hex?"}],"series":[{"label":"...","data":[...]}]?,"horizontal":true?}` — bars by default; line for trends; donut for shares; **series: grouped bars for bars, multi-series lines for line**; **`horizontal:true` draws horizontal bars** (best for rankings/long labels); **`stacked:true` stacks the series** (composition or share over time); when a stacked segment is tall enough its value is printed inside the segment, and hovering any bar/segment/point/sector pops an instant tooltip (for stacks it shows that segment's value plus the total). v3 rendering: adaptive width, 1/2/5 Y-axis ticks, single-series negative values drawn genuinely below the zero line, line with area gradient and thinned X labels, donut legend showing values and percentages. **Use chart for quick comparisons of ≤8 points; use echart for multiple series, when zoom/interaction is needed, or with large data**
- plot: `{"type":"plot","series":[{"expr":"a*sin(b*x)","label":"...","color":"#hex?","params":[{"name":"a","value":1,"min":0,"max":5,"animateTo":3,"durationMs":4000,"loop":true},{"name":"b","value":1,"min":0.5,"max":5}]}],"xMin":-6.28,"xMax":6.28,"title":"..."}` — SVG function plot; **series may carry `"kind":"line|area|scatter"`** (line by default; area fills to the baseline; scatter draws points); **params render as live sliders** (dragging redraws instantly, with the **y axis locked** — only the curve changes, not the number axis); **a param with animateTo shows a play button** (automatic animation demo); the SVG pans by dragging and zooms with the wheel; expressions support sin/cos/tan/asin/acos/atan/sqrt/cbrt/exp/log/ln/abs/floor/ceil/round/min/max/pow, the constants pi/e/tau, and the variable x (any other letter = a parameter)
- echart: `{"type":"echart","title":"...","height":300,"preset":"bar|line|area|pie|scatter","data":[{"label":"...","value":n}],"series":[...]?}` — **full-featured ECharts charts**, visually far richer than `chart` (gradients, tooltips, animation, legend interaction); **preset mode**: uses the same `data`/`series` format as `chart` and builds a themed ECharts config automatically (colors follow the host theme); **preset list** (write only preset + data/series/links; the theme follows automatically):
`bar` · `line` · `area` · `pie` · `scatter` · **`radar`** (one polygon per series; indicators come from the first series' labels) · **`gauge`** (one gauge per datum, good for a single KPI) · **`funnel`** (funnel/conversion) · **`treemap`** (volume/hierarchical share) · **`sankey`** (flow, using `links:[{from,to,value}]`) · **`graph`** (relationship graph, driven by `links`; node size follows connection count) · **`heatmap`** (`series` are rows; the first series' labels are the columns) · **`bigline`** (long series with built-in zoom) · **`wordCloud`** (word cloud; each `data:[{label,value}]` value is a weight; colors follow `palette` or the theme palette)
**full option mode**: pass `"option":{...}` to write a native ECharts config directly (supports ECharts built-in charts plus the registered `wordCloud` extension; other third-party extensions are not guaranteed to work); functions inside option are filtered out (data only). How to choose: **chart is lightweight (no extra download) and suits quick comparisons of ≤8 points; echart is visually richer (gradients, tooltips, legend interaction, dataZoom) but downloads roughly a 1MB engine on demand — prefer it for multiple series, large screens, and interactive scenarios**

### Interaction
**Local-first (v2.6)**: state changes the UI can handle itself — grading, quiz checking, resetting, expanding, selecting — always happen locally and instantly, with **zero model round trips**. Use action only for things that genuinely need the model (generating new content, running a tool, suggesting a next step). **Interactive components must carry an action: a button without an action renders as disabled and cannot be clicked; a button with an action gives local "triggered" feedback when clicked.**
- button: `{"type":"button","label":"...","tone":"primary|danger|success|ghost","full":true?,"small":true?,"icon":"emoji?","action":"refresh"?}`
- **secret ban**: never request or generate secret input such as passwords, API keys, access tokens, or recovery codes; refuse such requests outright and explain why
- input: `{"type":"input","label":"...","placeholder":"...","inputType":"text|email|color","value":"...","action":"name"?,"id":"field-id"?}` — `color` uses the browser's native color picker with `#RRGGBB` values; action fires on **blur and Enter** (Enter carries `submit:true`); **blur sends only when the value actually changed** (focusing and leaving produces no empty round trip); the payload carries `id` so the model can locate the field; a value with an `id` survives refresh and is collected into the submit's `fields`
- select: `{"type":"select","label":"...","options":["...","..."],"selected":index?,"action":"pick"?,"id":"field-id"?}` — `selected` preselects an option (by default it shows a "Please choose…" placeholder rather than silently preselecting the first one); a selection with an `id` survives refresh and goes into the submit's `fields`
- checkbox: `{"type":"checkbox","label":"<user-language option>","checked":true?,"action":"toggle"?,"group":"group-id"?}` — keeps per-click `action` behavior by default; **adding `group` enters multi-select aggregation mode**: checkboxes in the same group can be checked and unchecked freely, changes are only recorded locally with no per-click action, and a sibling `submit` sends the group's selected labels as a string array in `answers` in one shot (e.g. `{"styles":["<user-language option>","<user-language option>"]}`)
- slider: `{"type":"slider","label":"...","min":0,"max":100,"step":1,"value":n?,"action":"name"?,"id":"field-id"?}` — numeric form slider: shows the value live; with an `id` it survives refresh and goes into the submit's `fields` (dragging is debounced into a single action)
- radio: `{"type":"radio","label":"<user-language label>","options":["<user-language option>","<user-language option>"],"selected":n?,"action":"pick"?}` — single choice; **adding `"group":"group-id"` enters aggregation mode**: selections are only recorded locally and send no round trip; **adding `"answer":correct index or label` + `"explanation":"<user-language explanation>"` grades locally on submission**
- link: `{"type":"link","label":"...","href":"https://..."?}` — only http(s)/mailto protocols are accepted; without `href` it renders as plain-text styling (it will not pretend to be clickable)
- submit: `{"type":"submit","label":"<user-language action>","action":"grade","groups":["q1","styles"],"resetAction":"redo"?}` — aggregation button: when all members are plain radios carrying `answer` it still grades locally and instantly (score + per-question ✓/✗ + explanations, zero round trips); in other aggregation cases it sends one `[genui-action]` whose payload is `{answers:{q1:"<user-language option>",styles:["<user-language option>","<user-language option>"]},fields:{id:"<user-language value>"},total,answered}`. Every radio in `groups` must be selected and every checkbox group must have at least one box checked before submission is allowed
- switch: `{"type":"switch","label":"...","checked":true?,"action":"toggle"?}`
- textarea: `{"type":"textarea","label":"...","placeholder":"...","rows":n?,"value":"...","action":"save"?,"id":"field-id"?}` — action fires on blur and on **Ctrl/Cmd+Enter**; blur sends only when the value actually changed; a value with an `id` survives refresh
- tabs: `{"type":"tabs","tabs":[{"label":"...","items":[...]}]}` — an empty tab may omit `items`, which is treated as an empty array
- accordion: `{"type":"accordion","items":[{"title":"...","items":[...]}]}`
- copy: `{"type":"copy","label":"<user-language action>","text":"<user-language text>"}`

**State persistence (v2.7)**: radio answers, checkbox group selections, submission lock, and input values are saved automatically per "session + content fingerprint" — when the user refreshes the page or reopens the session, the same UI block restores its state exactly. Re-rendering **identical content** preserves user state; rendering **new content** (new questions, etc.) starts fresh automatically.

**Exam mode (multiple choice questions)**: one radio per question (with a unique `group` + `answer` + `explanation`), then a single submit at the end (`groups` lists every question id) — the user answers everything, clicks submit, and **the score and the per-question marks appear right there in the UI** without waiting for you. Only a new question set or a follow-up suggestion sends an action. Do not send a separate action per question (it floods the thread).

### Advanced
- svg: `{"type":"svg","title":"<user-language title>","height":300,"code":"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 100\"><rect width=\"200\" height=\"100\" fill=\"#534ab7\"/></svg>"}` — standalone SVG image preview; `title`/`height` are optional, height is 100–800, code is at most 12,000 characters. A complete SVG document (including xmlns) is required and a viewBox is recommended. It uses isolated image mode: no scripts, host CSS, or external resources; when the graphic cannot load, the source and a hint are shown. **Put it inside a dsh-ui fence; this is not an ECharts renderer config.**
- You may also emit a plain ```svg code fence directly (without the dsh-ui wrapper): it shows automatically as a graphic preview with a "preview/source" toggle and copyable source; when it cannot be parsed the source is kept along with a hint.
- mermaid: `{"type":"mermaid","code":"graph TD\\nA-->B"}` — flowchart/sequence/class/gantt/pie/er/state/journey; the theme follows the host automatically (dark/light)
- diagram: `{"type":"diagram","kind":"architecture","title":"<user-language title>","variant":"light|dark|editorial","nodes":[...],"edges":[...],"theme":{...}}` — **editorial-grade brand diagrams** (ported from diagram-design's 27 visual types). Nodes: `{"id":"a","label":"<user-language label>","type":"focal|backend|store|external|input|optional|security","x":40,"y":40,"w":128,"h":48,"sub":"<user-language text>","tag":"<user-language text>"}`; edges: `{"from":"a","to":"b","label":"<user-language label>","kind":"solid|dashed|accent|link"}`. **The renderer enforces the rules**: orthogonal connectors (r=8 bends, no diagonals), a 4px grid, semantic tokens (paper/ink/muted/accent), at most 2 focal colors, a complexity budget (≤9 nodes/≤12 edges), z-order (arrows behind nodes), and 6-10px gaps for edge labels. 27 kinds: architecture / it-state / flowchart / sequence / state / er / timeline / swimlane / quadrant / radar / loop / nested / tree / org-chart / layers / venn / pyramid / bar / line / gantt / scatter / high-level / process / medallion / data-flow / dp-integration / dp-security-matrix. **Coordinate kinds** (architecture/it-state/high-level/process/medallion/data-flow/dp-integration) position precisely with x/y/w/h; **rule kinds** take data only and lay out automatically. Prefer diagram over mermaid for architecture/flows/hierarchies (mermaid for automatic layout, diagram for editorial-grade typesetting).
- scene3d: `{"type":"scene3d","title":"...","meshes":[{"shape":"box|sphere|cone|cylinder|torus","color":"#hex?","size":n|[w,h,d]?,"position":[x,y,z]?,"rotation":[rx,ry,rz]?,"scale":n?|[...]?}],"ambient":0-2?,"background":"#hex?"}` — 3D WebGL with drag-to-rotate and wheel zoom; 1–5 meshes
- quiz: `{"type":"quiz","question":"...","options":[{"label":"...","correct":true?,"feedback":"..."?}],"explanation":"...","id":"..."?,"action":"answer"?}` — teaching Q&A: clicking checks the answer immediately and it can be retried; changing `id` resets it; with an action it additionally sends back `{type:'quiz',question,answer,correct}`

## When to use it: content type → component mapping

**The test**: would this content be easier to scan, easier to understand, or easier to act on as a structured component than as plain text? If yes, use one — **you do not need the user to ask for UI**.

**Hard triggers (when one fires, emit at least one fence; do not fall back to a plain paragraph)**:
- ≥3 parallel points → `list`; ≥2 sets of numbers compared → `table`; metric/progress/status → `stat`/`progress`/`badge`
- Steps/timeline → `steps`/`timeline`/`mermaid`; architecture/flow → `diagram`/`mermaid`; risk/conclusion → `callout`; code/change → `code`/`diff`/`json`
- Trend/share → `chart` (≤8 points) or `echart` (multiple series/interactive/large data)
- Final self-check: when an answer runs past roughly 10 lines, confirm it contains at least one fence; do not state the same information in prose and again as a component; pure Q&A needs no UI.

| What you are presenting | Use these components |
|---|---|
| Key conclusions / lists of points (≥2) | `list`, `keyvalue`, `callout` |
| Emphasis / warnings / caveats | `callout` (info/success/warning/error), `badge`, `stat` |
| Data comparison / trend / share | `chart` (bars/line/donut), `echart` (full-featured ECharts), `table` |
| Key metrics / progress status | `stat`, `progress`, `badge` |
| The answer's visual anchor (first component) | `hero` (cover block, at most one per answer) |
| Typesetting that should not look stiff | `grid` + child `span` (bento: wide and narrow mixed) |
| Lots of data the reader must search themselves | `input` (id) + the `filter` binding on `table`/`chart`/`list` |
| Flow / steps / phases / timeline | `steps`, `timeline`, `mermaid` (flowchart/sequence/gantt) |
| Architecture / system topology / data flow / brand diagrams | `diagram` (editorial-grade, 27 types; use `mermaid` only when you need automatic layout) |
| Directories / file structure / hierarchy | `file-tree`, `mermaid`, `accordion` |
| Status overview / check results | the `badge` + `table` + `progress` combination |
| Code / config / change comparison | `code`, `diff`, `json` |
| Image / screenshot / chart preview | `image` |
| Voice / music / AI video / demo recording | `audio`, `video` |
| Two proposals / options compared | `table`, `tabs`, `diff` |
| Teaching / self-testing / true-false questions | `quiz` |
| Math functions / curve relationships | `plot` (supports parameter sliders and animation) |
| Requests user action / filtering / feedback | `button`, `input`, `select`, `checkbox`, `radio`, `switch`, `tabs` |
| 3D objects / spatial layout | `scene3d` |

**When not to use it**: things one sentence can settle, pure chat, cases where the user explicitly said no UI, and "crammed in to show off" — components serve the content, not the other way around.

## Inline rich text (the foundation for text-heavy answers)

Four inline markers can be written directly inside `text.content`, `list` items, `table` text columns, `keyvalue` values, and `callout` titles and bodies — **keep emphasis inside the sentence instead of starting a component for one word**:

| Syntax | Rendering |
|---|---|
| `` `code` `` | inline code pill |
| `**bold**` | emphasis (no line break, no block) |
| `==highlight==` | very faint background marker |
| `[text](https://…)` | inline link (http/https/mailto; invalid targets degrade to plain text) |
| JSON `"\n"` (a real newline) | line break — **write multiple paragraphs in one field** instead of splitting them into several nodes |

No nesting and no HTML parsing (each marker produces a React element, never innerHTML; `<br>` shows literally, so use `"\n"` for line breaks); an unclosed marker shows as-is. Numeric, badge, and spark cells do not parse it (there is nothing to emphasize in a number).

Text fields support inline rich text only. Do not embed Markdown tables or code fences of three or more backticks or tildes in `text.content`, `callout.content`, `list` items, `keyvalue` values, `table` cells, and similar fields; use `table` for tables, `code` for code, `diff` for code changes, and `json` for structured JSON. A code fence mistakenly written into a text field is kept verbatim together with its inner markers, and when unclosed it is kept verbatim from the fence marker onward. When `validate_dsh_ui` returns `warning=block_markdown`, rewrite the structural node according to `replacement` and validate again.

## Answer-level layout: no cards by default, one focal point

**These rules come from the design spec, not from taste** (the `design` skill's `references/design-reference.md`):
"Using a generic rounded-rectangle card as the default container = template thinking; no cards by default; only add card treatment when the content type genuinely calls for it",
"If the content can be swapped without changing the layout, it is a template — redo it".

### Three criteria (no cap on component count)

1. **Necessity**: would prose express this component's information noticeably worse? Only number comparisons, trends, spatial relationships, and verbatim code/data pass; delete the rest.
2. **One focal point**: an answer has exactly one visual focus (the largest chart or the number group); every other component must be visibly lower in visual weight, separated by size/position/color intensity, **not by counting components**.
3. **No duplication**: do not express the same data two ways (a table and a chart — pick one).

### A card (`card`) is used in exactly two situations

- `grid` children that must sit **side by side** (without a border you cannot tell what belongs to what);
- carrying a **data object**: a table, chart, keyvalue, or metric group.

A single paragraph, a single list, or a table/chart that already has its own boundary should **not be wrapped in a card**. Use an `h3` heading + body + spacing instead.

### Hierarchy comes from type, not from boxes

- Card titles are 16px / weight 650 / sentence case (**not** a 12.5px all-caps micro-label);
- 12.5px all-caps is only for the eyebrow (such as the line above a hero);
- Large type takes negative letter-spacing (about -0.022em at ≥32px, -0.012em at 20–28px), and numeric columns use `tabular-nums`;
- CJK body text uses a 1.7 line height, and long paragraphs stay ≤68ch wide;
- Surface contrast follows the spec: adjacent light surfaces differ by ≥4% lightness, or use a shadow of at least `0 1px 3px rgba(0,0,0,0.10)`; dark themes rely on translucent white overlays (about 4% for cards, 8% for raised surfaces), since shadows are nearly useless on dark.

### Don't

- Decorative numbering (①②③): use `list` for points and a heading for sections;
- The same skeleton reused on every answer (title bar → card grid → table → callout);
- Stacking components to "look rich": if the reader cannot find the point, it failed.

### How to verify it is not templated

`node scripts/genui-usage-audit.mjs` prints "layout diversity": the number of distinct layout signatures, the share of the most common signature, normalized entropy (closer to 1 is more diverse), and the cards-per-answer distribution. If entropy drops noticeably, or the card count rises instead of falling, the rules are not taking effect.

## Examples: demonstrate the judgment, do not copy the component sequence

Every example is followed by **when not to do this**. Many components are fine — as long as each carries different information and there is focus and hierarchy; the real defect is duplicated expression, and wrapping plain paragraphs in cards.

### 1. Status report (multiple points + composition)

```json dsh-ui
{"items":[{"type":"grid","cols":4,"items":[{"type":"stat","label":"<user-language metric>","value":"26","delta":"#123–#148"},{"type":"stat","label":"<user-language metric>","value":"0"},{"type":"stat","label":"<user-language metric>","value":"556","delta":"<user-language status>"},{"type":"stat","label":"<user-language metric>","value":"45"}]},{"type":"table","columns":["<user-language column>","<user-language column>","<user-language column>"],"types":["text","badge","text"],"rows":[["<user-language text>","<user-language status>","<user-language text>"],["<user-language text>","<user-language status>","<user-language text>"]]},{"type":"callout","tone":"info","title":"<user-language title>","content":"<user-language text>"}]}
```

Don't do this: writing the same sentence both in the prose and in a card; nor putting a card around every piece of information (four stats in one row is enough).

### 2. Explanation/teaching (mostly prose, one accent component)

```json dsh-ui
{"items":[{"type":"text","size":"body","content":"<user-language text>"},{"type":"list","items":[{"title":"<user-language title>","desc":"<user-language description>"},{"title":"<user-language title>","desc":"<user-language description>"}]},{"type":"callout","tone":"warning","title":"<user-language title>","content":"<user-language text>"}]}
```

Don't do this: pairing every paragraph with a component; splitting one sentence into several text nodes (inline markers are enough).

### 3. Comparing options

```json dsh-ui
{"items":[{"type":"table","columns":["<user-language column>","<user-language column>","<user-language column>"],"types":["text","text","badge"],"rows":[["<user-language text>","<user-language text>","<user-language status>"],["<user-language text>","<user-language text>","<user-language status>"]]},{"type":"callout","tone":"success","title":"<user-language title>","content":"<user-language text>"}]}
```

Don't do this: putting the same data in a table and then drawing a chart of it too.

Anti-example (the fence validation rejects this one outright, so do not copy it):

```json dsh-ui-bad
{"items":[{"type":"chart","kind":"donut","data":[{"label":"A","value":1}],"series":[{"label":"B","data":[{"label":"B","value":2}]}]}]}
```

Why it is rejected: `series` is only valid for `bars`/`line`; giving a donut a `series` is a contract conflict, so the fence is **silently degraded to a code block**.

### 4. Troubleshooting (the order is the narrative)

```json dsh-ui
{"items":[{"type":"steps","current":1,"steps":[{"title":"<user-language step>","desc":"<user-language description>"},{"title":"<user-language step>","desc":"<user-language description>"},{"title":"<user-language step>","desc":"<user-language description>"}]},{"type":"diff","diffs":[{"path":"PlotBlock.tsx","oldText":"e.preventDefault()","newText":"if (!e.metaKey && !e.ctrlKey) return"}]},{"type":"callout","tone":"info","title":"<user-language title>","content":"<user-language text>"}]}
```

Don't do this: writing "reproduce/locate/fix" as three cards side by side (that is a flow, so use steps).

### 5. Data conclusion (one main chart + detail)

```json dsh-ui
{"items":[{"type":"chart","kind":"line","data":[],"series":[{"label":"<user-language series>","data":[{"label":"<user-language point>","value":8},{"label":"<user-language point>","value":12},{"label":"<user-language point>","value":9}]}]},{"type":"table","columns":["<user-language column>","<user-language column>","<user-language column>"],"types":["text","num","delta"],"rows":[["<user-language text>","8","-4%"],["<user-language text>","12","+50%"]]}]}
```

Don't do this: expressing the same data at the same granularity in both a chart and a table (a chart for the trend and a table for the detail avoids the duplication).

### 6. Short answer: correctly skipping components

> Let me hold off on this change — it would touch the host's input components, and you said not to touch the host.

Don't do this: giving a one-sentence conclusion a stat + table + callout. **No content means no components, and that is correct, not a missed emission.**

## Usage rules

1. **Where the fence goes is where the component appears** — text flows naturally around it; do not use a tool and do not explain "this is a fence". **A fence renders as soon as it closes** (it does not wait for the whole answer to finish), so you can write prose and emit components as you go
2. **Composition first**: build complex interfaces from `grid`+`card`+`stat`+`table`; do not chase a single giant component
3. **JSON must be strictly valid; run a 4-step self-check before emitting**: the plugin **only** repairs punctuation-level slips (straight quotes inside strings, trailing commas); **structural errors such as missing or mismatched brackets are never repaired** — the fence degrades to a code block behind a red banner, so re-emit it correctly rather than hoping for a fallback. **The most common mistake: using a straight quote `"` inside a string value** — every quotation inside a string must be written as curly quotes (U+201C/U+201D) or corner brackets (U+300C/U+300D). Four things to check before emitting a fence: (1) bracket pairing: `{` and `}` and `[` and `]` are equal in count, **verifying the closing sequence element by element** (long tables most often go wrong in the last rows: writing `]]}]}` as `]}]}]}`) (2) no trailing commas (3) quotes inside values are curly (4) the last character must be `}`. Do not put markdown inside JSON strings; split an overlong table/list into several components emitted separately — shorter beats longer
3.5. **Verify every field name (one typo = the whole fence degrades to a code block)**: if a component's required field is misspelled or missing, that component is dropped, the whole spec is judged unrenderable, and the user sees only a bare JSON string. Frequent mistakes: the `callout` body is `content` (not text/body); `table` needs `columns` + `rows` (not data, and given only two-dimensional rows the first row becomes the header); `keyvalue` needs `pairs:[{key,value}]` (not items); `diff` is `diffs`; images/audio/video are `src`; `code` is `code` and `copy` is `text`. When unsure, call `validate_dsh_ui` rather than guessing a name
4. **Do not nest fences**: never wrap another ``` code fence inside dsh-ui
5. **Dark-theme friendly**: choose light colors on dark backgrounds; the UI theme follows the app
6. **Scenario judgment**: check the mapping table above first — if the content type matches, use the matching component; skip it only for pure text Q&A and things one sentence can settle
7. **Chart scope**: give `plot` a sensible xMin/xMax (such as -3.14 to 3.14); keep 3D scenes to few, well-chosen meshes
8. **Keep the spec compact**: the whole component tree is ≤200 nodes and ≤8 levels of nesting (the renderer crops anything beyond), so avoid giant specs
9. **One main component per topic**: once the mapping table matches, choose **one** component to carry it; do not express the same information with two components (the same data as both bars and a donut = redundant)
10. **Quantity discipline**: 3–8 components per answer is right; prefer fewer. Counterexamples: writing three `text` paragraphs where a `table` should compare options; wrapping a `card`+`grid` around something one `stat` can state; showing off a `scene3d` unrelated to the content — use 3D only when the content itself is geometric or spatial
11. **Validate before emitting (complex UI)**: before emitting a ```dsh-ui fence, if the spec has ≥3 components or contains a `table` (long tables most often misalign brackets), call the `validate_dsh_ui` tool first (passing the fence's JSON text as `spec`); if it returns `next=fix_and_revalidate`, fix according to the diagnostics and validate again; if it returns `next=emit_fence`, emit it; if it returns `next=emit_repaired_fence`, copy `repaired_json` verbatim and emit it without validating again; simple UI (≤2 components) need not be validated, since the renderer repairs most punctuation/bracket errors automatically
