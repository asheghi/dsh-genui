# GenUI screen-recording demo — four-act prompts + operating guide

> Purpose: record a demo video for the genui plugin README.
> Flow: restart 3080 → hard-refresh the browser → send the four act prompts below in order (one message per act) → record the whole run → cut it according to the "editing notes".

---

## Preparation (before every recording)

1. Restart dsh web (loads the genui plugin and the latest renderer), then hard-refresh the browser with Cmd+Shift+R
2. Start a new session
3. Start recording: macOS `Cmd+Shift+5` (area recording) or ScreenFlow / OBS
4. Recommended window width 1280–1440, dark theme

---

## Act one: layout and data visualization (about 60–90 seconds)

> Shows: components interleaved between paragraphs, the typography system, data panels.

```
Now produce the first act of content for my plugin's README demo video: the topic is "GenUI layout and data".

Rules:
1. Output through a dsh-ui fence, and interleave the components between short paragraphs (1-2 sentences each), so the UI reads as part of the answer rather than a tool card
2. Use "GenUI · Layout and Data" as the top-level title
3. Emit the following in full and in this order, none of them missing:
   - text: one each of h1 / h2 / h3 / body / muted / caption (to show the typography hierarchy)
   - one row of badges (one each of the success / warn / danger / accent tones) + two avatars (different names) + one link
   - one grid (3 columns): four stats, two with a positive delta, one with a negative delta, one without
   - one progress (value 72, valueLabel "72%")
   - one card (title "Performance metrics"): inside it a table (5 rows, 4 columns, realistic-looking numbers) + a keyvalue (4 pairs)
   - one list (3 items, each with title+desc)
   - a divider interleaved in the middle
4. Close with a single closing sentence
```

---

## Act two: tour of interactive components (about 90–120 seconds)

> Shows: forms, toggles, tabs, accordions — the recorder clicks through them.

```
Continue with the second act of content: the topic is "GenUI interactive components". Let viewers click things themselves.

Rules:
1. Use a dsh-ui fence, with the components interleaved between paragraphs
2. Use "GenUI · Interactive Components" as the top-level title
3. Emit in order:
   - tabs: 3 tabs whose contents are a form, a list, and a chart (bars) respectively
   - accordion: 3 items (the expanded item shows a json viewer + a code block)
   - a "Preferences" card: switch (auto-save, checked true) + radio (3 theme options) + checkbox (2) + select (4 options) + input (placeholder hint) + textarea (2 rows) + primary button (label "Save settings") + ghost button + a copy component
   - steps (current 2, 3 steps) + a callout (info tone)
4. Next to the tabs and the preferences card, prompt viewers in the text: "click the tabs to switch" and "try flipping these switches"
5. Close with a single closing sentence
```

---

## Act three: visualization and teaching (about 120–180 seconds) — the highlight of the show

> Shows: plot parameter sliders + playback animation, quiz grading, mermaid, a 3D scene.

```
Continue with the third act of content: the topic is "GenUI visualization and teaching". This is the most impressive act.

Rules:
1. Use a dsh-ui fence, with the components interleaved between paragraphs
2. Use "GenUI · Visualization and Teaching" as the top-level title
3. Emit in order:
   - plot one: two curves a*sin(b*x) and 0.8*cos(c*x), xMin -6.28 xMax 6.28, with the first curve's a parameter carrying animateTo 3 and durationMs 4000 (so a play button appears), b and c as ordinary slider parameters, title "Wave superposition" — tell viewers in the text "drag the sliders, or hit play to watch the animation"
   - quiz: two questions (4 options + explanation each). For the first, put the correct answer on option B and prompt in the text beforehand "try B"; for the second, have viewers deliberately pick a wrong option so the wrong-answer state and "Try again" are shown
   - mermaid: a flowchart (showing the GenUI render pipeline: model → dsh-ui fence → parser → component render), then a gantt (showing the plugin development plan)
   - scene3d: one scene (title "Geometry demo") containing 4 meshes: a rotating cube, a sphere, a torus, a cone, each a different colour — prompt in the text "drag to rotate, scroll to zoom"
   - timeline (4 items) + file-tree (2 levels of directories + 3 files) + breadcrumb
4. Close with a single closing sentence
```

---

## Act four: the event loop (about 60–90 seconds) — the closing highlight

> Shows: component action → model response → UI update. After a click the model automatically replies with a new dsh-ui.

```
Continue with the fourth act of content: the topic is "GenUI event loop" — the two-way interaction between components and the model.

Rules:
1. Use a dsh-ui fence, with "GenUI · Event Loop" as the top-level title
2. Emit a "Server monitoring panel" card:
   - four stats: CPU 42% / memory 6.8 GB / requests 128.4k / latency 87 ms
   - a switch (label "Auto-refresh", checked true, with action "toggle-refresh")
   - a button (label "Refresh data", tone primary, with action "refresh")
   - a select (label "Environment", options staging/production/dev, with action "env-switch")
   - a callout (info, content "Click the controls below and I will respond live and update the panel")
3. Tell viewers in the text: "Click 'Refresh data', or switch the environment, and I will regenerate the whole panel"
4. After receiving my [genui-action]: always reply with a new dsh-ui (for example, after a refresh CPU becomes 63% and latency 112ms; after an environment switch the stat values change and a success badge "Switched to production" is added), explain the state change in one or two sentences, and output nothing unrelated
```

---

## Editing notes (README demo, targeting a 60–90 second highlight cut)

| Shot | Footage | Duration |
|---|---|---|
| Opening | first half of act one (streaming render: components appearing as they generate) | 0:00–0:10 |
| Data | act one stat/table/chart | 0:10–0:20 |
| Interaction | act two tab switching + toggles/form clicks | 0:20–0:35 |
| Highlight | act three plot slider drag + playback animation + quiz grading | 0:35–0:55 |
| Advanced | scene3d drag-to-rotate + mermaid | 0:55–1:10 |
| Closing | act four clicking "Refresh data" → model updates the panel | 1:10–1:30 |

Pacing notes:
- **Slow down** while dragging the plot slider (1–2 steps per second) — this is the shot that lands best
- Wait for each component to finish rendering and for animations to settle before interacting, to avoid a jittery picture
- In the event-loop act, wait for the model's reply after clicking the button (10–30 seconds) and do not touch anything meanwhile; in the edit, compress the wait into a 1-second transition
- If an act generates too long, you can stop it midway and resend — the model will continue
