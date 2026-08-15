# `src/build/export.ts` — Track model export

The export layer: exports the groups under the current workspace's track parent group (named after the
workspace) in four modes (`new_java` / `classic_java` / `bedrock` / `obj`) to a user-chosen folder.

Export configuration is collected in a single large dialog similar to generation (config on the left /
per-texture resource paths on the right):

- export mode / namespace / track id are filled in by the user;
- the export root is the directory holding the resource pack's `assets/{namespace}` — everything is
  written there, organized into `models/` textures/ blockstates/;
- the model resource path is the `{namespace}:path/file` path used for the written model files (what
  blockstates reference), default `block/track/{trackId}`; models are written to
  root/models/{path}/;
- each texture has its own resource path (what models reference), also defaulting to
  `block/track/{trackId}`; textures are written to root/textures/{texturePath}/.

All path fields are editable and pre-filled with default-generated paths; in-file references use these
resource paths directly.

File writing uses Blockbench's scoped `require('fs', { scope })` (desktop; requests "folder access" the
first time). Node smoke tests substitute a `global.require` stub. Eligibility checks and per-format
serialization live in the pure logic layer `src/logic/export.ts` (unit-testable).

## Constants

### `TRACK_PARENT_NAME`

The track parent group's name, matching the one created in `buildAllShapes`.

```ts
export const TRACK_PARENT_NAME = '机械动力轨道';
```

## Export config types

### `ExportOptions`

Export configuration (collected by the dialog, passed to `writeTrackExport`).

```ts
export interface ExportOptions {
	mode: ExportMode;
	namespace: string;
	trackId: string;
	root: string;         // export root (directory holding the resource pack's assets/{namespace})
	modelPath: string;    // model resource path ({namespace}:path/file used by blockstate references)
	texturePaths: Record<string, string>;  // texture key → texture resource path
}
```

### `ExportDriver`

Smoke-test driver hook for the export dialog (not used by real Blockbench).

```ts
export interface ExportDriver {
	setMode(mode: ExportMode): void;
	setNamespace(v: string): void;
	setTrackId(v: string): void;
	setRoot(v: string): void;
	setModelPath(v: string): void;
	setTexturePath(key: string, v: string): void;
	confirm(): boolean;
	getState(): ExportFormState;
}
```

## Styles

### `injectExportStyles()`

Injects the export dialog styles (when a document exists; safely skipped in Node smoke tests).

```ts
export function injectExportStyles(): void;
```

## Export dialog

### `promptExportOptions(defaultTrackId, textures)`

Export configuration dialog (single large frame, two columns: export config on the left + per-texture
export paths on the right). All path fields are editable text boxes with "Browse…" / "Reset" buttons,
pre-filled with default-generated paths. Returns `null` when cancelled.

```ts
export function promptExportOptions(
	defaultTrackId: string,
	textures: ExportTexture[]
): Promise<ExportOptions | null>;
```

## Export flow

### `writeTrackExport(opts)`

Exports the groups under the track parent group according to `mode` into the configured directory:

- Java (`new_java` / `classic_java`): element model JSON + textures; groups that can't be exported fall
  back to OBJ
- `obj`: every group baked into a single merged OBJ mesh (.obj + .mtl + forge:obj reference JSON)
- `bedrock`: `minecraft:geometry` + blocks.json + textures; groups that can't be exported fall back to OBJ
- Java / OBJ modes write blockstates to root; Bedrock writes blocks.json to root

Write locations are derived from the resource paths: models → root/models/{modelPath}/, textures →
root/textures/{texturePath}/ (each texture its own path); in-file references use these resource paths
directly. Returns statistics (files written, skipped groups, warnings).

```ts
export function writeTrackExport(opts: ExportOptions & {
	subgroups: Group[];
	texInfos: ExportTexture[];
	keyOf: Map<Texture, string>;
}): { files: number; skipped: string[]; warnings: string[] };
```

### `runTrackExport()`

The export entry flow: find the track group → collect textures → large dialog
(mode/namespace/id/paths) → write files → summary.

```ts
export async function runTrackExport(): Promise<void>;
```
