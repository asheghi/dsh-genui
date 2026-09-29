# hub listing proposal (for hub maintainers to copy during triage)

Under the dsh-external rules the hub does not accept PRs: plugin repositories are listed by the hub's Agent Loop (synced every 2 hours) plus maintainer triage.
This file is a **listing proposal** for maintainers — when the sync loop marks dsh-genui as "uncategorized", just copy the two blocks below.

## catalog.source.json (append one row to the repos array)

```json
    { "name": "dsh-genui", "category": "plugin", "tags": ["web-ui", "generative-ui", "visualization", "interactive"], "note": "In-conversation generative UI: dsh-ui fences render as interactive components (layout/charts/function plots/quiz/3D/event loop); the renderer registers through the main repo's fence-registry extension point, and the plugin plus its companion skill ship independently" }
```

## README.md (plugin table, inserted before dsh-gomoku in name order)

```
| [dsh-genui](https://github.com/omdsh-dev/dsh-genui) | bundle · cordis | In-conversation generative UI: the model draws interactive components straight into the answer stream with `dsh-ui` fences (layout/charts/function plots/quiz/3D/event loop) — a DSH in-conversation generative UI plugin: dsh-ui fences render as interactive components, the renderer registers through the main repo's fence-registry extension point, and the plugin plus its companion skill ship independently | TS | 2026-08-09 |
```

Manager note: package.json declares `dsh.bundle.patch` (`cordis.patch.yml`) → `bundle · cordis` is inferred automatically, no manual override needed.
Topics already set: `dsh`, `dsh-plugin`, `marisa-plugin` (enters the plugins.json channel automatically), `web-ui`, `generative-ui`.

> The repository lives in the `omdsh-dev` organization (public), so the hub sync loop can read it directly.

> A ready-made full commit is available locally at `/tmp/dsh-hub` (`b79eb2a catalog: add dsh-genui`); a maintainer can cherry-pick it or copy it verbatim.
