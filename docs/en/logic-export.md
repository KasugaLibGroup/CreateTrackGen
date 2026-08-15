# `src/logic/export.ts` — Export conventions & serialization

Pure logic mapping the groups under the track parent group into Create/Kuayue model file names and
generating the matching blockstates JSON. Zero dependencies, Node-testable.

**Export modes** (see `EXPORT_MODES`):

- `new_java` (1.21.11+): `format_version` "1.21.11", multi-axis rotation `{x,y,z}`
- `classic_java` (1.21.11-): no format_version (matches the assets examples), single-axis rotation only
- `bedrock`: `minecraft:geometry` block geometry
- `obj`: everything baked into a single merged OBJ mesh

Elements that can't be exported fall back to OBJ (see `groupNeedsObj`).

## Export modes

### `ExportMode`

```ts
export type ExportMode = 'new_java' | 'classic_java' | 'bedrock' | 'obj';
```

### `EXPORT_MODES`

Export-mode metadata: id / label / eligibility description (label and description are i18n-localized).

```ts
export const EXPORT_MODES: { id: ExportMode; label: string; description: string }[];
```

## Platform-neutral element descriptors

Extracted by the Blockbench layer from live Cubes/Meshes and handed to the pure functions. Face
textures use a stable `textureKey` (the Blockbench layer maps Texture instances to `'t0'`/`'t1'`…).

### `ExportCubeData`

```ts
export interface ExportCubeData {
	name?: string;
	from: Vec3;
	to: Vec3;
	rotation?: Vec3;
	origin?: Vec3;
	faces: Partial<Record<CubeFaceDirection, ExportFaceData>>;
}
```

### `ExportFaceData`

```ts
export interface ExportFaceData {
	uv?: [number, number, number, number];
	rotation?: number;
	textureKey?: string;
}
```

### `ExportMeshFaceData`

```ts
export interface ExportMeshFaceData {
	vertices: string[];
	uv?: number[] | Record<string, number[]>;  // per-vertex UV: array (in face.vertices order) or object (by vertex id)
	textureKey?: string;
}
```

### `ExportMeshData`

```ts
export interface ExportMeshData {
	name?: string;
	vertices: Record<string, Vec3>;
	faces: Record<string, ExportMeshFaceData>;
}
```

### `ExportElement`

```ts
export type ExportElement = ({ type: 'cube' } & ExportCubeData) | ({ type: 'mesh' } & ExportMeshData);
```

### `ExportTexture`

A texture referenced by a shape: key / resource name / pixel size / bitmap (data URL).

```ts
export interface ExportTexture {
	key: string;
	resName: string;
	width: number;
	height: number;
	dataUrl?: string;  // base64 data URL (for writing PNGs; not needed by the pure layer)
}
```

## Eligibility & rotation serialization

### `groupNeedsObj(elements, mode)`

Decides whether a group "cannot be exported" in the given mode and must fall back to OBJ:

- `obj` mode: everything falls back
- any mesh element → fall back (neither Java JSON nor Bedrock cubes can express triangle faces)
- `classic_java` with any multi-axis-rotated cube → fall back (classic format allows single-axis only)
- `bedrock` with >1 texture referenced → fall back (Bedrock: one geometry, one texture)

```ts
export function groupNeedsObj(elements: ExportElement[], mode: ExportMode): boolean;
```

### `rotationToJava(rotation, origin, mode)`

Element rotation → Java model JSON `rotation` field:

- no rotation → `undefined` (omitted)
- `new_java` with (multi-axis or any angle >45°) → `{x,y,z,origin}` (1.21.11+ multi-axis rotation)
- otherwise single-axis → `{angle,axis,origin}` (axis = the only non-zero axis)

```ts
export function rotationToJava(
	rotation: Vec3 | undefined,
	origin: Vec3 | undefined,
	mode: ExportMode
): { angle?: number; axis?: 'x' | 'y' | 'z'; x?: number; y?: number; z?: number; origin: Vec3 } | undefined;
```

## Naming

### `TRACK_MODEL_FILES`

Track-shape group id → exported model file name; `null` means the group is not exported separately.
`z_ortho` is not exported (blockstates express shape=zo by rotating `x_ortho` 90°); `ascending_*` only
exports the south variant `ascending.json`; `teleport_x` / `cross_*_zo` are not exported.

```ts
export const TRACK_MODEL_FILES: Record<string, string | null>;
```

### `cleanGroupName(name)`

Strips the `（…）`/`(…)` display suffix from a group name to get the shape id (`z_ortho（Z 直轨）` →
`z_ortho`).

```ts
export function cleanGroupName(name: string): string;
```

### `modelFileName(id)`

Export file name for a shape id; `null` for unknown ids / non-exported shapes.

```ts
export function modelFileName(id: string): string | null;
```

### `textureResourceName(name, used)`

Texture resource name: strips the extension, lowercases, replaces non-`[a-z0-9_]` with `_`, and ensures
uniqueness within `used` (appending `_1` / `_2` … on collision).

```ts
export function textureResourceName(name: string, used: Set<string>): string;
```

### `textureResourcePath(namespace, trackId, resName, texturePath?)`

In-model texture resource path: `{namespace}:{texture resource path}/{resName}`. The texture resource
path defaults to `block/track/{trackId}` (Create/Kuayue convention).

```ts
export function textureResourcePath(namespace: string, trackId: string, resName: string, texturePath?: string): string;
```

## blockstates

### `buildBlockstates(namespace, trackId, modelPath?)`

Builds the track's blockstates JSON object. Variants combine shape × turn × waterlogged (matching
Create's track block states); shape=none points at the air model, the rest point at
`{namespace}:{model resource path}/{model}` (default `block/track/{trackId}`). `modelPath` is the model
resource path (pass it for custom model export paths) so references follow.

The shape → model file (+y rotation) mapping follows Create/Kuayue's track block convention: `zo` →
`x_ortho` rotated 90°; cross xo/zo directions come from `cross_d1_xo` / `cross_d2_xo` via 90° rotations
(`cr_pdx→cross_d1_xo y:90`, `cr_pdz→cross_d2_xo y:180`, `cr_ndx→cross_d2_xo y:270`, `cr_ndz→cross_d1_xo`).

```ts
export function buildBlockstates(
	namespace: string,
	trackId: string,
	modelPath?: string
): { variants: Record<string, { model: string; y?: number }> };
```

## Java model JSON

### `buildJavaModelJson(opts)`

Builds the Java model JSON:

- `new_java`: adds `format_version` "1.21.11", multi-axis rotation `{x,y,z}`
- `classic_java`: no format_version (matching Create/Kuayue examples), single-axis rotation only

The passed elements must already be eligible cubes (meshes fell back to OBJ). UVs are converted from
pixels to the 16-unit system.

```ts
export function buildJavaModelJson(opts: {
	mode: ExportMode;
	elements: ExportElement[];
	textures: ExportTexture[];
	textureSize: [number, number];
	namespace: string;
	trackId: string;
	texturePathOf?: Record<string, string>;  // texture key → resource directory (default block/track/{trackId})
}): Record<string, unknown>;
```

## OBJ

### `buildObj(opts)`

Bakes a group's elements into a single merged OBJ + MTL mesh:

- vertex coords in px/16 (block units); vt pixel/size with v flipped; vn from triangle outward normals
- a single `o` object for the whole file (no per-element `o`, no `g` groups) at the root — the Forge
  loader can read it as one mesh
- textures distinguished via `usemtl m_<key>`, MTL with one `newmtl` + `map_Kd {ns}:block/track/{id}/{res}`
  per texture

```ts
export function buildObj(opts: {
	elements: ExportElement[];
	textures: ExportTexture[];
	sizeOf: Record<string, [number, number]>;
	namespace: string;
	trackId: string;
	mtlName?: string;                          // MTL file name (for the mtllib line), default materials.mtl
	texturePathOf?: Record<string, string>;    // texture key → resource directory
}): { obj: string; mtl: string };
```

### `buildObjReferenceJson(opts)`

forge:obj reference JSON (.obj model + flip_v + textures), matching the Create/Kuayue examples.

```ts
export function buildObjReferenceJson(opts: {
	namespace: string;
	trackId: string;
	shape: string;
	textures: ExportTexture[];
	texturePathOf?: Record<string, string>;
	modelPath?: string;   // model resource path (for blockstate references), default block/track/{trackId}
}): Record<string, unknown>;
```

## Bedrock

### `buildBedrockGeometry(opts)`

Builds a group's cubes into a `minecraft:geometry` block model. Following Blockbench o6/r6: cube
origin[0] negated (X mirror), pivot = rotation origin (X-mirrored) with rx/ry of the rotation negated
when rotated; per-face uv (uv + uv_size + uv_rotation), with up/down faces uv+=size and size negated.
The passed elements must already be eligible cubes (meshes / multi-texture shapes fell back to OBJ).

```ts
export function buildBedrockGeometry(opts: {
	identifier: string;
	elements: ExportElement[];
	textureSize: [number, number];
}): Record<string, unknown>;
```

### `buildBedrockBlocksJson(opts)`

Bedrock block definitions (blocks.json, at the behavior pack root; legacy aggregated format). One block
per shape: identifier `{ns}:{trackId}_{shape}`, geometry + material_instances pointing at that shape's
texture. `texturePath` is the resource path relative to the `textures/` directory (written to
`textures/{texturePath}.png` → `"{texturePath}"`).

```ts
export function buildBedrockBlocksJson(opts: {
	namespace: string;
	trackId: string;
	shapes: { id: string; texturePath: string }[];
}): Record<string, unknown>;
```
