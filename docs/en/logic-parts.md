# `src/logic/parts.ts` — Part parsing & normalization

Parses `.bbmodel` elements or the current project's selected elements into a `PartModel`, and
normalizes: the bottom face is translated to y = 0 and the model's symmetry point to (0,0).
Pure functions, Node-testable (pass JSON-structured elements).

**Symmetry point by model format** (user-defined):

- Java Block/Item (`java_block` / `java_item`): canvas 0..16, origin at a corner → (8,8)
- Other formats (generic/free etc.): origin is the canvas center → (0,0)

This lets Java-mode parts grow within the 0..16 canvas without being limited to "symmetric about zero".

## Raw element structures

### `ElementRotation`

An element's rotation: Blockbench `.bbmodel` array form `[rx, ry, rz]` or legacy object form.

```ts
export type ElementRotation =
	| [number, number, number]
	| { angle?: number; axis?: 'x' | 'y' | 'z'; origin?: [number, number, number] };
```

### `RawCubeElement`

A volume element (`type='cube'` or default): from/to + six faces.

```ts
export interface RawCubeElement {
	name?: string;
	type?: 'cube';
	from: [number, number, number];
	to: [number, number, number];
	rotation?: ElementRotation;
	origin?: [number, number, number]; // for array-form rotation, origin is a sibling field of rotation
	faces?: Partial<Record<CubeFaceDirection, { uv?: [number, number, number, number]; rotation?: number; texture?: string | number }>>;
}
```

### `RawMeshElement`

A mesh element (`type='mesh'`): vertex table + face table. Face `texture` is the texture-array index
(as with cubes).

```ts
export interface RawMeshElement {
	name?: string;
	type: 'mesh';
	vertices?: Record<string, [number, number, number]>;
	faces?: Record<string, { vertices?: string[]; uv?: number[] | Record<string, any>; rotation?: number; texture?: string | number }>;
	origin?: [number, number, number];
	rotation?: [number, number, number];
}
```

### `RawElement`

The minimal element structure in a `.bbmodel` file (cube or mesh).

```ts
export type RawElement = RawCubeElement | RawMeshElement;
```

### `RawTexture`

An entry of the `.bbmodel` textures array.

```ts
export interface RawTexture {
	name?: string;
	id?: string | number;   // texture id (referenced from faces via the `texture` field)
	source?: string;        // base64 data URL or desktop file path
	uv_width?: number;
	uv_height?: number;
}
```

### `RawBbModel`

The top-level JSON structure of a `.bbmodel` file.

```ts
export interface RawBbModel {
	meta?: { model_format?: string; texture_size?: [number, number] };
	resolution?: { width?: number; height?: number }; // Blockbench 5 model resolution (texture size)
	elements?: RawElement[];
	textures?: RawTexture[];
}
```

## Symmetry

### `symmetryPointForFormat(format?)`

Returns the symmetry point (xz plane, y=0) for a model format: Java Block/Item → (8,8), else (0,0).

```ts
export function symmetryPointForFormat(format: string | undefined): Vec3;
```

### `outputOffsetForFormat(format?)`

The translation needed to move origin-centered geometry to the canvas symmetry point when building
into a workspace of a given format — the inverse of the import normalization
(`symmetryPointForFormat`):

- Java Block/Item → (8, 8): centers the model in the 0..16 canvas for correct export symmetry
- Other formats → (0, 0): origin is already the canvas center

```ts
export function outputOffsetForFormat(format: string | undefined): Vec3;
```

## Elements → CubeSpec / MeshSpec

### `elementToCubeSpec(el)`

Converts a single element to `CubeSpec`. Both `.bbmodel` rotation forms are supported:

- array form `[rx, ry, rz]` (Blockbench's standard export format), with origin as a sibling field;
- object form `{ angle, axis, origin }` (legacy / Java model JSON format).

Previously only the object form was parsed, so parts with array rotations (e.g. rails with
`[0,-90,0]`) lost their orientation on import.

```ts
export function elementToCubeSpec(el: RawElement): CubeSpec;
```

### `elementsToCubeSpecs(elements)`

Parses `.bbmodel` elements → `CubeSpec[]` (cube elements only; meshes skipped).

```ts
export function elementsToCubeSpecs(elements: RawElement[]): CubeSpec[];
```

### `extractMeshes(elements)`

Extracts mesh groups (`type='mesh'`) from elements as `MeshSpec[]`. Face `texture` references
(array index / uuid) are normalized to string keys, consistent with the cube-face convention.
A mesh's origin (world anchor) and rotation are baked into the vertices, and `origin`/`rotation` are
cleared — otherwise a later normalize/translate that shifts both origin and vertices would
**double-shift** meshes with a non-zero origin (e.g. a Java model's origin (8,8,8)).

```ts
export function extractMeshes(elements: RawElement[]): MeshSpec[];
```

## Normalization

### `normalize(cubes, symmetry?, meshes?)`

Normalizes `CubeSpec[]` (+ optional meshes) into a `PartModel`:

- bottom face to y=0: all y minus `bbox.min.y`
- symmetry point to (0,0): all x minus `symmetry[0]`, z minus `symmetry[2]` (falls back to automatic
  horizontal centering when symmetry is omitted, for backward compatibility)
- mesh vertices and origin shifted by the same offset (keeps cube↔mesh relative positions)

Returns new CubeSpecs (input is not mutated).

```ts
export function normalize(cubes: CubeSpec[], symmetry?: Vec3, meshes?: MeshSpec[]): PartModel;
```

## Textures

### `parseBbTextures(json)`

Extracts source textures and the texture resolution from a `.bbmodel` textures array.

Key point: in `.bbmodel`, faces reference textures via the `texture` field as an **array index**, not
the texture id (Blockbench loader: `Texture.all[face.texture]`). So source texture keys are set to the
array index (`String(index)`), aligning with the face-texture references produced by
`elementToCubeSpec`.

Resolution priority: `resolution` → `meta.texture_size` → the uv size shared by all textures →
undefined. Models with no textures (or missing sources) return an empty array and undefined size.

```ts
export function parseBbTextures(json: RawBbModel): { textureSize?: [number, number]; textures: SourceTexture[] };
```

### `consistentTextureSize(parts)`

Checks that all parts (left / right / tie) share the same texture resolution. Returns that size when
all are defined and equal; otherwise `null` (generation should be rejected).

```ts
export function consistentTextureSize(parts: { textureSize?: [number, number] }[]): [number, number] | null;
```

### `scopeTextureKeys(part, prefix)`

Prefixes a part's source-texture keys so the three parts (left / right / tie) have globally unique keys.

Why: `.bbmodel` face texture references are array indices (0, 1…), and every part starts at 0. Using the
raw index as the key would make the three parts overwrite each other in the "source key → imported
Texture" map. Prefixing (`L/0`, `R/0`, `T/0`) keeps them unique. Cube-face and mesh-face textures are
rewritten together. Mutates and returns the same `PartModel`.

```ts
export function scopeTextureKeys(part: PartModel, prefix: string): PartModel;
```

## Format selection & parse entry points

### `targetFormatForParts(parts, currentFormat?)`

Decides the new workspace's model format from whether any part contains mesh groups:

- any part has mesh → `'generic'` (free model, the only one that can hold mesh groups)
- all cubes → Java block/item model (`java_item` if the current project is `java_item`, else `java_block`)

```ts
export function targetFormatForParts(parts: { hasMesh?: boolean }[], currentFormat?: string): string;
```

### `parseBbModel(json, format?)`

Parses `.bbmodel` JSON → `PartModel` (auto-normalized; symmetry point from `meta.model_format`),
with texture info attached.

```ts
export function parseBbModel(json: RawBbModel, format?: string): PartModel;
```

### `extractFromElements(elements, format?)`

Extracts a part from an element list (a `.bbmodel`'s elements or a tab's selected elements).
`format` is the source model format (e.g. `Project.format.id` / tab format) and decides the symmetry
point; defaults to (0,0) for other formats.

```ts
export function extractFromElements(elements: RawElement[], format?: string): PartModel;
```
