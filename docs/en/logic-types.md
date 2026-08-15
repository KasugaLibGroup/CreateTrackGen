# `src/logic/types.ts` — Pure type definitions

The decoupling hub between the logic layer and Blockbench. Zero dependencies — Node-testable.

## Primitive types

### `Vec3`

A 3D vector.

```ts
export type Vec3 = [number, number, number];
```

### `CubeFaceDirection`

A block-face direction.

```ts
export type CubeFaceDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
```

## Textures & faces

### `SourceTexture`

A source texture extracted from a `.bbmodel` or the current project, to be imported into the new
workspace and applied to the corresponding faces. `key` is a unique id inside the source model
(the `.bbmodel` texture id, or the current project's texture UUID); face `texture` references in
`CubeSpec` use this key, which the assembly layer maps to the imported `Texture`.

```ts
export interface SourceTexture {
	key: string;
	name: string;
	source: string;   // bitmap data: base64 data URL or desktop file path
	width: number;
	height: number;
}
```

### `FaceSpec`

Face UV description (passed through to the Blockbench `CubeFace`).

```ts
export interface FaceSpec {
	uv?: [number, number, number, number];
	rotation?: number;
	texture?: string;   // source texture key (see SourceTexture); resolved by the assembly layer
}
```

### `MeshFaceSpec`

A mesh-group face: a list of vertex ids plus UV and the source texture key. `uv` is passed straight
through from the `.bbmodel` / Blockbench raw structure (vertex UV list, array or object) and handed
back to Blockbench unchanged when the Mesh is created.

```ts
export interface MeshFaceSpec {
	vertices: string[];                 // vertex ids forming the face (counter-clockwise)
	uv?: number[] | Record<string, any>; // per-vertex UV (passthrough, unmodified)
	rotation?: number;
	texture?: string;                   // source texture key (see SourceTexture)
}
```

## Cubes & meshes

### `CubeSpec`

A platform-independent cube description, mirroring Blockbench's `ICubeOptions`
from/to/rotation/origin/faces. `from`/`to` are the box's two opposite corners (px); `rotation` is the
3-axis rotation about `origin` (degrees).

```ts
export interface CubeSpec {
	name?: string;
	from: Vec3;
	to: Vec3;
	rotation?: Vec3;
	origin?: Vec3;
	faces?: Partial<Record<CubeFaceDirection, FaceSpec>>;
}
```

### `MeshSpec`

A mesh-group element: vertex id → position, face id → face. `.bbmodel` elements with
`type: 'mesh'` (as opposed to `'cube'` volume groups).

```ts
export interface MeshSpec {
	name?: string;
	vertices: Record<string, Vec3>;
	faces: Record<string, MeshFaceSpec>;
	origin?: Vec3;
	rotation?: Vec3;
}
```

## Part model

### `PartModel`

A part model: the element collection parsed from a `.bbmodel` or the current project.
Normalization contract: bottom face y = 0, track lateral centerline x = 0.
`cubes` are the volume elements (used to build track shapes); `meshes` are mesh-group elements
(used only for the workspace base groups, not for track shapes).

```ts
export interface PartModel {
	cubes: CubeSpec[];
	meshes?: MeshSpec[];          // mesh elements (type='mesh'); present ⇔ part contains mesh groups
	hasMesh?: boolean;            // whether the part has mesh groups (decides free-model workspace)
	bbox: { min: Vec3; max: Vec3 }; // normalized bounding box (cubes + mesh vertices)
	xMid: number;                 // lateral centerline x (≈0 after normalization)
	textureSize?: [number, number]; // texture resolution [w, h] (px). Must match across all 3 parts
	textures?: SourceTexture[];   // all source textures referenced by the part
}
```

## Configuration

### `PortalConfig`

Optional portal configuration; the two textures are independently optional.

- When `trackTexture` (portal_track) is set, the teleport shape applies it to the track/tie;
  otherwise the parts' own default textures are used.
- When `mipTexture` (portal_track_mip) is set, two overlay cubes (`teleport_left` / `teleport_right`)
  wrap the left/right halves of the ties (excluding the rails) and are textured with it; otherwise no
  overlay cubes are generated.

Structure follows Create's original teleport.json — the whole model uses portal_track, the two
overlays (left cube5 / right cube6) use the mip.

```ts
export interface PortalConfig {
	trackTexture?: string;          // portal_track source key (prefixed, e.g. 'P/track')
	mipTexture?: string;            // portal_track_mip source key (prefixed, e.g. 'P/mip')
	mipTextureSize?: [number, number]; // overlay (mip) texture size [w, h] (px), default 32×32
	margin?: number;                // overlay wrap margin beyond the tie's outer edge (px, avoids z-fighting), default 0.1
}
```

### `TrackConfig`

All inputs needed to generate the track.

```ts
export interface TrackConfig {
	gaugePx: number;            // gauge (px, 1/16 block) = center distance between the left/right rails
	heightPx: number;           // rail height above the model's bottom face (px, 1/16 block)
	wholeModelYOffset?: number; // whole-model (tie + track) Y offset (px), default 0
	parts: {
		left: PartModel;
		right: PartModel;
		tie: PartModel;
	};
	portal?: PortalConfig;      // optional portal config; the two textures are independently optional
}
```

## Shape result

### `ShapeSpec`

The generated result for one track shape.

```ts
export interface ShapeSpec {
	id: string;     // TrackShape id, e.g. 'x_ortho', 'diag', 'ascending_south'
	name: string;   // display name (Group name)
	cubes: CubeSpec[];
}
```
