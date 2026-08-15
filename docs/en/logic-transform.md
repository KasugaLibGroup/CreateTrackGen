# `src/logic/transform.ts` — Geometric transforms

Pure functions operating on `CubeSpec[]`, decoupled from Blockbench: translation edits from/to/origin
directly; rotation returns CubeSpecs carrying a `rotation` field that the assembly layer expresses as
`Cube.rotation`.

## Rotation

### `rotateY(cubes, angleDeg, origin)`

Rotates about the Y axis (degrees), producing a "rotation-field cube": it sets the Y component of
`rotation` to `angleDeg` (ensuring origin exists) and leaves from/to unchanged. Blockbench then
expresses the rotation via `Cube.rotation` rather than recomputed coordinates.

```ts
export function rotateY(cubes: CubeSpec[], angleDeg: number, origin: Vec3): CubeSpec[];
```

### `rotateX(cubes, angleDeg, origin)`

Rotates about the X axis (degrees), used for the ascending-track slope. Preserves any existing Y
rotation (yaw).

```ts
export function rotateX(cubes: CubeSpec[], angleDeg: number, origin: Vec3): CubeSpec[];
```

### `rotateVec(v, rot)`

Rotates a vector by `[rx, ry, rz]` applied in X→Y→Z order (Minecraft's `Cube.rotation` order, matching
the Blockbench convention).

```ts
export function rotateVec(v: Vec3, rot: Vec3): Vec3;
```

## Face UV transforms

### `transformFaceUV(dir, face, rot)`

Transforms a face's UV sampling under a cube rotation `rot`, yielding the new face direction and
(uv box, rotation).

Textures are "glued" to the volume: after the volume rotates, the same texture region stays on the same
physical face, but the face's normal / local UV axes change. For 90°-multiple axis rotations:

- pure rotation (det>0): uv box unchanged, only the rotation angle is added to `face.rotation`;
- reflection (det<0, can occur in 90° rotations, e.g. side faces when rotating about Z): the uv box's v
  is reversed (swap v0/v1) to express the mirror — Minecraft's `face.rotation` only supports 0/90/180/270.

The rotation order follows Minecraft/Blockbench's `Cube.rotation` (X→Y→Z).

```ts
export function transformFaceUV(
	dir: CubeFaceDirection,
	face: FaceSpec,
	rot: Vec3
): { dir: CubeFaceDirection; face: FaceSpec };
```

## Mirroring

### `mirrorPartYz(part)`

Mirrors a part about the YZ plane through its lateral center (xMid), producing the left/right symmetric
part. Used for "right rail = mirror of left rail" (Create's segment_left / segment_right are mirrors of
each other about the track centerline):

- geometry: from/to/origin x → `2·xMid − x` (from/to swapped to keep from<to)
- rotation: ry and rz negated (rx unchanged), i.e. `[rx, −ry, −rz]`
- faces: east↔west swap + u-axis reversed + rotation negated
- mesh: vertex x reflected + face vertex order reversed

Textures (textures / textureSize) are unchanged — the mirrored part still references the same source
texture. Returns a new `PartModel` (input not mutated). Mirroring about one's own center is an
involution (`mirror(mirror(x)) === x`).

```ts
export function mirrorPartYz(part: PartModel): PartModel;
```

## Rotation baking

### `bakePartAxisAligned(part)`

Bakes the part's "90°-multiple, axis-aligned" rotations into from/to, producing plain boxes without a
`rotation` field. Derived shapes (straightX / diag / ascending / teleport_x / cross_*) can then add
their own group rotation (rotateY / rotateX) without overwriting the part's own orientation —
otherwise a rail's built-in `[0,-90,0]` would be overwritten and the rails would end up parallel to
the ties.

Rotation happens about each cube's own origin; non-90° rotations cannot be baked and keep their
`rotation` field. Returns a new `PartModel` with recomputed bbox / xMid (input not mutated).

```ts
export function bakePartAxisAligned(part: PartModel): PartModel;
```

### `bakeRotateY90(cubes, center)`

"Bakes" a −90° Y rotation into every unrotated cube (about the given center) by recomputing from/to
directly, and transforms each face's UV sampling to the new direction. The result is plain boxes
without a `rotation` field, so later rotateY/rotateX composition can't overwrite each other. Cubes
carrying their own rotation are returned unchanged.

Direction mapping (−90° about Y): north→east, south→west, east→south, west→north; up/down unchanged.

```ts
export function bakeRotateY90(cubes: CubeSpec[], center: Vec3): CubeSpec[];
```
