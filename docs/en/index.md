# create_track_gen API Reference (English)

A Blockbench plugin that generates Create Mod track model sets from three part models
(**left rail / right rail / tie**) plus track gauge, height, and whole-model Y offset,
producing the 9 track shapes and exporting them in 4 modes.

This document covers only the **exported API** of the source (types, constants, functions).
For usage instructions see `../../README.zh-cn.md`.

> **Note on this English reference:** entries whose behavior is fully inferable from the
> symbol name alone are omitted for brevity (e.g. unit-conversion helpers). The complete
> per-symbol reference is available in the [Chinese version](../zh/index.md).

## Layered structure

| Layer | Directory | Purpose |
| --- | --- | --- |
| Pure logic | `src/logic/` | Zero-Blockbench pure functions & types, Node-testable |
| Assembly | `src/build/` | Turns logic output into real Blockbench Cube / Group / files |
| UI | `src/ui/` | Dialogs and part importing (depends on Blockbench globals) |
| Infra | `src/plugin_api.ts`, `src/i18n.ts`, `src/index.ts` | Plugin registration, i18n, entry |

## Index

### Pure logic layer `src/logic/`

- [types.ts — Pure type definitions](logic-types.md)
- [gauge.ts — Gauge conversion](logic-gauge.md)
- [parts.ts — Part parsing & normalization](logic-parts.md)
- [transform.ts — Geometric transforms](logic-transform.md)
- [generator.ts — Track shape assembly](logic-generator.md)
- [export.ts — Export conventions & serialization](logic-export.md)

### Assembly layer `src/build/`

- [assembly.ts — CubeSpec → Cube/Group](build-assembly.md)
- [workspace.ts — Workspace creation & texture import](build-workspace.md)
- [export.ts — Track model export](build-export.md)

### UI layer `src/ui/`

- [import.ts — Part acquisition](ui-import.md)
- [dialog.ts — Generate configuration dialog](ui-dialog.md)
- [gauge.ts — Gauge converter dialog](ui-gauge.md)

### Infrastructure

- [plugin_api.ts — Type-safe plugin registration](plugin-api.md)
- [i18n.ts — Internationalization](i18n.md)

## Data flow

```
Parts (.bbmodel / selected tab elements)
      │  ui/import.ts
      ▼
PartModel ──(normalized)──► src/logic/parts.ts
      │
      │  src/logic/transform.ts (translate/rotate/mirror/bake)
      │  src/logic/generator.ts (9 shape assembly)
      ▼
ShapeSpec[] / TrackConfig
      │  src/logic/export.ts (name mapping + blockstates + serialization)
      │  src/build/export.ts (write to disk)
      ▼
Minecraft model JSON / OBJ / Bedrock geometry + blockstates + texture PNGs
```
