# dsh-genui `diagram` component design document (porting diagram-design)

> Goal: port the 27 editorial-grade visual types plus the design system
> (semantic tokens, orthogonal connectors, anti-pattern checklist) of
> [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design)
> into dsh-genui as a first-class component `diagram`, so the model can emit
> branded, accessible, editorial-grade SVG diagrams directly inside a
> ```dsh-ui fence.
>
> Status: design finalized (baseline before implementation). Upstream version:
> diagram-design v2.4 / dsh-genui 0.8.3.

---

## 1. Design goals and principles

| Principle | Meaning |
|---|---|
| **First-class** | `diagram` joins the spec.ts allowlist + the render-node switch, on a par with `mermaid`/`plot`, and automatically gets guard, streaming, persistence and self-healing |
| **Declarative spec** | The model emits **data** (nodes/edges/layout intent) and the renderer owns layout and styling — the model never hand-writes SVG paths |
| **Editorial-grade defaults** | Orthogonal connectors, a 4px grid, semantic tokens and the anti-pattern checklist are all encoded in the renderer, so the model cannot produce "AI slop" |
| **Accessible** | Every diagram gets `role="img"` + `aria-label`/`aria-describedby`; no interaction is introduced |
| **Hard-coded limits** | Node count, edge count, accent count and the rest follow diagram-design's complexity budgets and are clamped by the guard layer |
| **Light dependencies** | Pure React + SVG, with no mermaid/three runtime dependency; no new asset route |

### Relationship to mermaid (no overlap)

`mermaid` already covers the **automatic-layout** general-purpose diagrams of
flowchart/sequence/class/gantt/pie/er/state/journey.
`diagram` has a different focus: **editorial-grade layout** — the model supplies
coordinate intent (or the type rules lay it out automatically) and the renderer
composes it precisely to the diagram-design spec. The two coexist: use mermaid
for "quick automatic layout", use diagram for "editorial-grade branded diagrams".

---

## 2. Spec shape

### Top level

```json
{
  "type": "diagram",
  "kind": "architecture | flowchart | sequence | state | er | timeline | swimlane | quadrant | radar | loop | nested | tree | org-chart | layers | venn | pyramid | bar | line | gantt | scatter | high-level | process | medallion | data-flow | dp-integration | dp-security-matrix | it-state",
  "title": "optional title (Instrument Serif)",
  "variant": "light | dark | editorial",
  "nodes": [ ... ],
  "edges": [ ... ],
  "meta": { "focal": 2, "density": 4 }
}
```

- `kind` decides the layout grammar and the complexity budget (see §4).
- `variant` follows the host theme by default (`light` or `dark`); `editorial`
  forces the editorial skin.
- Brand tokens default to the built-in style guide; an optional `theme` field
  overrides them (see §5).

### Node

```json
{
  "id": "n1",
  "label": "user-visible name (Geist sans)",
  "sub": "optional technical sublabel (Geist mono)",
  "type": "focal | backend | store | external | input | optional | security",
  "x": 40, "y": 40, "w": 120, "h": 48,
  "tag": "optional type corner badge, e.g. API"
}
```

### Edge

```json
{
  "from": "n1", "to": "n2",
  "label": "optional edge label (≤14 characters, all caps)",
  "kind": "solid | dashed | accent | link",
  "route": "auto | orthogonal | straight"
}
```

### Layout model

**Two modes, decided by `kind`:**

1. **Coordinate mode** (the free-layout kinds: architecture / it-state / high-level /
   process / data-flow / dp-* and so on): the model supplies `x/y/w/h` and the
   renderer handles orthogonal routing, port selection, bridging and edge-label masks.
2. **Rule-layout mode** (flowchart / sequence / state / er / timeline / swimlane /
   quadrant / radar / loop / nested / tree / org-chart / layers / venn / pyramid /
   bar / line / gantt / scatter): the model supplies data only and the renderer
   lays it out automatically by type rule (consistent with the layout conventions
   in diagram-design's per-type type-*.md files).

Both modes run the **spec enforcement layer** (§6): 4px grid, complexity budgets,
anti-pattern checks.

---

## 3. Component inventory (27 kinds → render strategy)

| kind | Layout mode | Data shape | Complexity budget |
|---|---|---|---|
| `architecture` | coordinate | nodes+edges+optional zones | ≤9 nodes, ≤12 edges, ≤3 zones |
| `it-state` | coordinate | phase-grouped nodes | ≤9 nodes, ≤3 phases |
| `flowchart` | rule | nodes + branch edges | ≤9 nodes |
| `sequence` | rule | lifelines+messages | ≤5 lifelines, ≤1 fragment |
| `state` | rule | states+transitions+guards | ≤9 states |
| `er` | rule | entities+fields+relations | ≤8 entities |
| `timeline` | rule | events on axis | ≤12 events |
| `swimlane` | rule | lanes+steps+handoffs | ≤5 lanes |
| `quadrant` | rule | 2 axes + items | ≤12 items |
| `radar` | rule | axes+series | ≤5 axes, ≤5 series |
| `loop` | rule | hub+stations | ≤8 stations |
| `nested` | rule | containment tree | ≤6 levels |
| `tree` | rule | parent/child tree | ≤4 deep |
| `org-chart` | rule | ownership/reporting tree | ≤12 nodes, ≤4 deep |
| `layers` | rule | layer list | ≤6 layers |
| `venn` | rule | sets | ≤3 circles |
| `pyramid` | rule | tier values | ≤6 levels |
| `bar` | rule | category values | ≤8 bars |
| `line` | rule | series points | ≤5 series |
| `gantt` | rule | tasks+phases | ≤12 tasks |
| `scatter` | rule | points | ≤30 points |
| `high-level` | coordinate | stacks + clusters | ≤9 nodes |
| `process` | coordinate | multi-role steps + data handoffs | ≤9 nodes |
| `medallion` | coordinate | layered data storage | ≤9 nodes |
| `data-flow` | coordinate | roles + steps | ≤9 nodes |
| `dp-integration` | coordinate | source → core → consumers | ≤9 nodes |
| `dp-security-matrix` | rule | role × permission matrix | ≤9×9 |
| `it-state` | coordinate | phase grouping | ≤9 nodes |

> The spec fields and layout rules of each individual kind are in
> `docs/diagram-kinds.md` (generated alongside the implementation).

---

## 4. Design system (built-in style guide, semantic tokens)

The renderer embeds diagram-design's default skin, expressed as CSS variables or
SVG constants:

| Role | Light | Dark |
|---|---|---|
| `paper` | `#f5f5f5` | `#2d3142` |
| `paper-2` | `#ececec` | `#393e53` |
| `ink` | `#2d3142` | `#f5f5f5` |
| `muted` | `#4f5d75` | `#bfc0c0` |
| `soft` | `#7a8399` | `#8e98ac` |
| `rule` | `rgba(45,49,66,0.12)` | `rgba(245,245,245,0.12)` |
| `accent` | `#eb6c36` | `#f08a59` |
| `accent-tint` | `rgba(235,108,54,0.08)` | `rgba(240,138,89,0.10)` |
| `link` | `#2e5aa8` | `#6a95d8` |

- **Focal rule**: `accent` goes on only 1–2 elements; the spec's `meta.focal`
  counts them, and anything beyond degrades to `ink`.
- **Node type → fill/stroke**: focal→accent-tint/accent; backend→white/ink;
  store→ink@5%/muted; external→ink@3%/ink@30%; input→muted@10%/soft;
  optional→ink@2%/ink@20% dashed; security→accent@5%/accent@50% dashed.
- **Font stack**: titles Instrument Serif; node names Geist sans 600;
  sublabels/edge labels Geist Mono.
  (CSS stacks inside the renderer, with no forced Google Fonts link — when the
  host already provides a font environment, it is inherited directly.)

### Theme override (optional)

```json
"theme": { "paper": "#fffdf7", "ink": "#2a2416", "accent": "#c94f1e" }
```

The renderer merges these into the semantic tokens; fields left out fall back to
the built-in defaults. The PR stage supports whole-group token overrides only;
brand scraping (onboarding) belongs to a later iteration (see §9).

---

## 5. Renderer structure

Add `src/client/blocks/diagram.tsx` (+ a `diagram/` submodule when needed):

```
src/client/blocks/diagram/
  index.tsx          # DiagramNode entry: variant/theme resolution, complexity guard, a11y shell
  layout.ts          # kind → layouter (coordinate pass-through or rule layout)
  geometry.ts        # orthogonal connectors (elbow path r=8), port selection, bridging, edge-label masks
  theme.ts           # semantic token table + theme merge
  kinds/             # one layouter per rule-layout kind (~27 in total, may be grouped)
```

**Integration points:**
- `src/client/spec.ts` — add the `GenuiDiagram` / `GenuiDiagramNode` /
  `GenuiDiagramEdge` interfaces and fold them into the `GenuiNode` union.
- `src/client/blocks/render-node.tsx` — `case 'diagram': return <DiagramNode .../>`.
- `src/client/guard.ts` — add limits such as `maxDiagramNodes`(9) /
  `maxDiagramEdges`(12) / `maxDiagramZones`(3), and clamp by kind inside
  `repairGenuiSpec` (an unknown kind degrades to `architecture` or is dropped).
- `src/client/GenuiBlock.module.css` — diagram container styling (size, border,
  accessible focus).
- `src/plugin/index.ts`'s `GENUI_SECTION_TEXT` + `SKILL.md` — teach the model
  the `diagram` grammar.

**Accessibility:** root `<svg role="img" aria-label={title ?? kind} aria-describedby=...>`; title/desc as the first children.

---

## 6. Spec enforcement layer (hard-coded at render time)

Aligned with diagram-design SKILL.md §5–7, all implemented in the renderer so the
model cannot bypass them:

1. **4px grid**: every coordinate/size/font size aligns to 4 (the layouter rounds
   its output; coordinate mode rounds the model's input to 4).
2. **Orthogonal connectors enforced**: any connection between non-shared axes uses
   an elbow path (`r=8`); diagonal connections are re-routed automatically.
3. **Port selection**: predominantly vertical edges use the top/bottom ports,
   predominantly horizontal ones use the left/right ports; multiple ports on the
   same side fan out (≥12px).
4. **Edge-label mask + a 6–10px gap**: a label never sits on a line, and the mask
   never covers a node (nodes are drawn after it).
5. **Bridging/hops**: on a crossing, the secondary edge gets a hop arc; two edges
   never share a path.
6. **z-order**: bg → zones → arrows → labels → nodes.
7. **Focal budget**: when accents exceed `meta.focal`, degrade.
8. **Complexity budget**: clamp nodes/edges/depth by kind and truncate overflow
   (guard layer).
9. **Anti-patterns built in**: no shadows, no glow, no `rounded-2xl` (rx ≤ 8), no
   three-equal-width cards, legend in a bottom strip.

---

## 7. Teaching (SKILL.md + GENUI_SECTION_TEXT)

- Add one line to `GENUI_SECTION_TEXT`:
  `- diagram: {"type":"diagram","kind":"architecture","nodes":[...],"edges":[...]} — editorial-grade branded diagrams (27 types, orthogonal connectors, semantic tokens; replaces mermaid's automatic layout)`.
- Add a `diagram` section to `SKILL.md`: the kind selection table, node/edge
  fields, layout modes, focal rules, complexity budgets, "when to use diagram
  instead of mermaid", and an example spec.
- Add a new skill teaching file `SKILL.diagram.md` (optional, as a companion
  reference for the genui skill).

---

## 8. Tests

- `tests/genui-diagram.spec.tsx` — render smoke: at least one minimal spec per kind renders `<svg role="img">`.
- `tests/genui-diagram-guard.spec.ts` — unknown kind degradation; over-budget truncation; 4px rounding; accent degradation.
- `tests/genui-diagram-connector.spec.ts` — orthogonal paths, port selection, edge-label masks, bridging.
- `tests/genui-diagram-a11y.spec.tsx` — aria-label/describedby, no duplicate ids.
- Regression: the existing `genui.spec.tsx` stays fully green (the allowlist extension must not break older components).

---

## 9. Scope and iteration order

**v1 (this PR):**
- Core renderer + a **minimally viable layouter** for all 27 kinds (coordinate
  kinds complete; rule kinds share one unified auto-layouter parameterized by
  kind, guaranteeing every kind renders).
- Built-in default skin (light/dark following the host), semantic tokens, focal
  rules, complexity budgets, orthogonal connectors.
- spec.ts / guard / render-node / SKILL.md / GENUI_SECTION_TEXT / tests.

**v2 (later):**
- Fine-grained layout per kind (swimlane columns, sequence lifeline activation
  bars, radar grids, and so on).
- Brand scraping (onboarding), polishing the editorial `editorial` variant, and
  the `sketchy`/`terminal` skins.
- drawio/mermaid import redraw (mirroring diagram-design's scripts/*.py).

**PR merge criteria:** all of v1 complete; every kind has a minimal spec render +
tests; documentation complete; zero regression in existing 0.8.3 functionality.

---

## 10. References

- diagram-design: [README](https://github.com/cathrynlavery/diagram-design),
  `skills/diagram-design/SKILL.md` (v2.4), `references/style-guide.md`, and the
  per-type `type-*.md` files.
- dsh-genui: currently 0.8.3, `src/client/spec.ts`, `blocks/render-node.tsx`, `guard.ts`.
- Porting baseline: this repository's fork, branch `feat/diagram-component`.
