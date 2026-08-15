# `src/ui/import.ts` — Part acquisition

Imports `.bbmodel` files from disk or extracts parts from the current project.

## Types

### `ImportedFile`

A lightweight structure for an imported file's result (compatible with `Filesystem.FileResult`).

```ts
export interface ImportedFile {
	name: string;
	content: string | ArrayBuffer;
}
```

## File import

### `pickBbModels()`

Opens the disk file picker to import `.bbmodel` file contents. Resolves to `ImportedFile[]`, or `null`
when the user cancels.

```ts
export function pickBbModels(): Promise<ImportedFile[] | null>;
```

### `parseImportedBbModel(file)`

Parses a single `.bbmodel` file content into a part. The symmetry point is decided by the file's
`meta.model_format` (`java_block`/`java_item` → (8,8), others → (0,0)). Throws on failure (the caller
surfaces the message).

```ts
export function parseImportedBbModel(file: ImportedFile): PartModel;
```

## Portal texture import

### `pickPortalTrackTexture()`

Imports `portal_track.png` from disk (optional; covers the track/ties). Returns a `SourceTexture`
(key `'track'`), or `null` when cancelled / no file could be read.

```ts
export function pickPortalTrackTexture(): Promise<SourceTexture | null>;
```

### `pickPortalMipTexture()`

Imports `portal_track_mip.png` from disk (optional; textures the overlay cubes). Returns a
`SourceTexture` (key `'mip'`), or `null` when cancelled / no file could be read.

```ts
export function pickPortalMipTexture(): Promise<SourceTexture | null>;
```

## Tab extraction

### `extractSelectedPart(project?)`

Extracts a part from the elements selected in a tab (project). The symmetry point is decided by that
project's model format (`java_block`/`java_item` → (8,8), others → (0,0)). `project` defaults to the
current project (`Project`). The player must first select, in the target tab, the set of elements that
form the part. Also collects the textures referenced by those elements' faces (cube faces + mesh faces,
deduplicated by UUID) as the part's source textures and resolution.

```ts
export function extractSelectedPart(project?: ModelProject): PartModel;
```

### `pickTabProject()`

Lets the user pick one of the currently open tabs (projects), returning the chosen `ModelProject`.
After the user picks a tab, the plugin calls `extractSelectedPart(proj)` to extract the tab's selected
elements. Returns `null` when cancelled / no tabs are open.

```ts
export function pickTabProject(): Promise<ModelProject | null>;
```
