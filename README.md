# Create Track Gen — Create Track Generator Plugin

[![Title](/plugin_title.png)]()

[![Wiki](https://img.shields.io/badge/CTG-Wiki-red)](https://github.com/KasugaLibGroup/CreateTrackGen/wiki)
[![MIT License](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)
[![README ZH-CN](https://img.shields.io/badge/Readme-中文-green)](./README.zh-cn.md)
[![BlockBench](https://img.shields.io/badge/Blockbench-Model-yellow)](https://www.blockbench.net/wiki/docs/plugin/)

A Blockbench plugin that generates Create Mod track model sets from **left rail / right rail / tie**
part models plus track gauge, track height and whole-model Y offset: the **11 track shapes**
(`x_ortho / diag / diag_2 / ascending_south / teleport / cross_ortho / cross_diag / cross_d1_xo /
cross_d2_xo / cross_d1_zo / cross_d2_zo`; the other directions are expressed via blockstate `y`
rotations) plus the curve-rendering base groups `tie` / `segment_left` / `segment_right`, and converts
the gauge into Create's curve scale constant (quadratic fit). Two portal textures are optionally
supported: `portal_track` covers the teleport track/ties, `portal_track_mip` generates the left/right
overlay cubes `teleport_left` / `teleport_right`.

## Features

- **Generate Create Tracks** (`Tools → Generate Create Tracks`): pick the three parts (import a
  `.bbmodel` or extract the elements selected in an open tab; the right rail can also be mirrored from
  the left), the gauge (px; Create default 1600mm ≈ 25.6px, with mm/inch conversion), track height,
  whole-model Y offset and a new workspace name, then generates everything into a **new standalone
  workspace** (track parent group named after the workspace). All three parts must share the same
  texture resolution; any part with mesh groups produces a **free model** workspace, otherwise a Java
  block/item model.
- **Export Track Models** (`Tools → Export Track Models`): exports the current workspace's track group
  as models + blockstates + texture PNGs in **4 modes** — 1.21.11+ new Java / 1.21.11- classic Java /
  Bedrock block / **all OBJ** (single merged mesh). Shapes that can't be expressed in a mode fall back
  to OBJ; a free-model workspace is locked to OBJ.
- **Track Gauge Converter** (`Tools → Track Gauge Converter`): linked inch / mm / px conversion plus
  the Create curve scale constant (anchors: 1435mm→0.755, 1600mm→0.965, 1000mm→0.525).
- **Generate Example Rail / Tie** (`Tools → …`): drops an example rail (2.4×2.8×8) or tie (32×4×3.5)
  box into the current workspace — usable as a generation part or a size reference.

## Install & test in Blockbench

1. `npm run build`, then drag `create_track_gen.js` into Blockbench (or `File → Open → Plugin`).
2. A `Tools` menu appears with **Generate Create Tracks** and **Track Gauge Converter**.
3. Use the sample parts under `test/sample_parts/` (`test_rail.bbmodel` / `test_tie.bbmodel`) or your
   own parts (Java Block format, bottom face on the xz plane, y=0).
4. Run `Tools → Generate Create Tracks`, fill in the parts + gauge (25.6 for the samples) + a new
   workspace name; the result appears in that new workspace.

> After rebuilding, reload the plugin in Blockbench with **Ctrl/Cmd + J**.

## Tech stack

| Component | Description |
| --- | --- |
| TypeScript | Source language, `src/` directory |
| esbuild | Bundles the multi-module source into one plugin `.js` + a CJS artifact for unit tests |
| blockbench-types | Official Blockbench API types (autocomplete + type checking) |

## Directory structure

```
create_track_gen/
├── src/
│   ├── index.ts           # Plugin entry: Plugin.register + menu + Undo + onunload
│   ├── plugin_api.ts      # Type-safe Plugin.register wrapper
│   ├── i18n.ts            # t() + registerTranslations + loadTranslationsFromDisk
│   ├── logic/             # ★ Pure logic (no Blockbench dependency, Node-testable)
│   │   ├── types.ts       # Pure types: CubeSpec / ShapeSpec / TrackConfig
│   │   ├── gauge.ts       # Gauge quadratic fit + mm↔px↔inch conversion
│   │   ├── parts.ts       # .bbmodel parsing + normalization (bottom y=0, center x=0)
│   │   ├── transform.ts   # translate / lift / rotate / mirror (pure)
│   │   ├── generator.ts   # 11-shape assembly (core)
│   │   └── export.ts      # Export conventions (Create naming + blockstates)
│   ├── build/             # Logic output → real Blockbench objects
│   │   ├── assembly.ts    # CubeSpec[] → Cube/Group
│   │   ├── workspace.ts   # New workspace + part texture import
│   │   └── export.ts      # Track model export (JSON + blockstates + PNGs)
│   └── ui/                # Dialogs
│       ├── import.ts      # .bbmodel import / tab element extraction
│       ├── dialog.ts      # Generate configuration dialog
│       └── gauge.ts       # Gauge converter dialog
├── build.mjs              # esbuild bundling
├── create_track_gen.js    # Build artifact (drag into Blockbench)
├── lang/                  # en.json / zh.json — i18n, editable without rebuild
├── test/                  # logic tests + smoke test + sample parts
├── README.md / README.zh-cn.md
└── package.json
```

## Development

```bash
npm install          # first-time dependency install
npm run dev          # typecheck + build
npm run typecheck    # typecheck only
npm run build        # build
npm run watch        # watch src/, auto-rebuild create_track_gen.js
npm test             # typecheck + build + unit tests + smoke test
```

## Documentation

- [Wiki](https://github.com/KasugaLibGroup/CreateTrackGen/wiki) — tool guides + source API reference (English / 中文)
- [Blockbench plugin development guide](https://www.blockbench.net/wiki/docs/plugin/)
- [Blockbench API reference](https://web.blockbench.net/docs)
