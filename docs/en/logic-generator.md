# `src/logic/generator.ts` — Track shape assembly

The core pure logic. Takes a `TrackConfig` (three parts + gauge + height) and outputs the `CubeSpec`
sets for every `TrackShape`.

Assembly rules:

- Straight track is laid along Z on the xz plane by default, with the left/right rail centers at
  x = ±gauge/2, lifted by the height.
- A track is generated as one full block (16 px) by default; if a rail part is shorter it is tiled
  along Z to fill the length (Create's rail segments are 8 px half-blocks, two per block).
- The other shapes are derived from the straight track by rotation (following Kuayue's
  diag_template/ascending_template, expressed via `Cube.rotation` + origin rather than recomputed
  coordinates).

Pure functions, Node-testable.

## Configuration

### `GeneratorOptions`

Generation options: track length and tie interval.

```ts
export interface GeneratorOptions {
	length?: number;       // total track length along the laying direction (px), default 16 (one block)
	tieInterval?: number;  // tie spacing (px)
}
```

### `TrackAxis`

The track laying direction.

```ts
export type TrackAxis = 'x' | 'z';
```

## Laying

### `placeRails(cfg, opts?)`

Places the left/right rails: left center x=-g/2, right center x=+g/2, lifted by `heightPx`. Aligned to
the part's normalized lateral center (xMid), so an imperfectly centered part still lands correctly.
Rails are tiled along Z over the full track length. The part's axis-aligned rotation (e.g. `[0,-90,0]`)
is baked first so the rails become plain Z-aligned boxes — otherwise derived shapes would overwrite the
rails' own rotation when composing group rotations, leaving the rails parallel to the ties.

```ts
export function placeRails(cfg: TrackConfig, opts?: GeneratorOptions): CubeSpec[];
```

### `orientTiePerpendicular(tie)`

Ensures the tie's long axis crosses X (perpendicular to the Z-laid rails). If the tie part's long axis
is along Z (parallel to the track), it is baked-rotated 90° about Y; parts carrying their own rotation
are trusted (already preserved by the parser) and not auto-rotated. Shared by placeTies and
buildBaseParts.

```ts
export function orientTiePerpendicular(tie: PartModel): CubeSpec[];
```

### `placeTies(cfg, opts?)`

Places ties: looped along the track direction (Z) from start to end every `tieInterval`. Ties are
centered laterally (x=0), aligned lengthwise to their own center, and their long axis is auto-oriented
to cross X (perpendicular to the rails). Note: `heightPx` is the "rail height above the bottom face"
and applies to the rails only — ties are not lifted and sit directly on the xz plane.

```ts
export function placeTies(cfg: TrackConfig, opts?: GeneratorOptions): CubeSpec[];
```

## Shapes

### `straight(cfg, axis?, opts?)`

Straight shape (`x_ortho` / `z_ortho`). `axis` defaults to `'z'`.

```ts
export function straight(cfg: TrackConfig, axis?: TrackAxis, opts?: GeneratorOptions): ShapeSpec;
```

### `straightZ(cfg, opts?)` / `straightX(cfg, opts?)`

Straight track (along Z): left/right rails + ties. `straightX` rotates the Z track 90° (Y axis) about
the whole group's center.

```ts
export function straightZ(cfg: TrackConfig, opts?: GeneratorOptions): CubeSpec[];
export function straightX(cfg: TrackConfig, opts?: GeneratorOptions): CubeSpec[];
```

### `diagonal(cfg, mirror, opts?)`

45° diagonal: rotates the Z track ±45° about the group center (Y axis). `diag` = +45° (PD positive
diagonal), `diag_2` = −45° (ND negative diagonal). A diagonal spans the block's diagonal, needing 3
rail segments / 3 ties (length = 3 × tie interval, default 24 px) instead of the straight track's
2 segments / 2 ties (16 px).

```ts
export function diagonal(cfg: TrackConfig, mirror: boolean, opts?: GeneratorOptions): ShapeSpec;
```

### `ascending(cfg, dir, opts?)`

Ascending track: rotates the Z track −45° about the X axis, pivot at the track center (the block center
(8,8) on the xz plane in Java models), tilting the whole track about the block center. `yaw` decides the
facing (blockstate: south=0 / north=180 / east=270 / west=90).

The tilt and the turn must share the same pivot (the track's z-center, Java canvas xz (8,8)), not the
front edge (8,0). An ascending track covers a longer span like the diagonal (length = 3 × tie interval,
default 24 px).

After the −45° tilt about the center, the lower end dips below the xz plane. The track is lifted so the
lowest point lands exactly on the xz plane (y≥0) **after the whole-model Y offset takes effect**:
offset ≥0 → lift to 0 (the whole model then rises with the offset like other shapes); offset <0 → lift
extra `−wholeY` to push the sunken ascending track back to the plane. `lift` shifts from/to and origin
together, so the tilt shape is preserved.

```ts
export function ascending(
	cfg: TrackConfig,
	dir: 'south' | 'north' | 'east' | 'west',
	opts?: GeneratorOptions
): ShapeSpec;
```

### `teleport(cfg, axis?, opts?)`

Portal track: two independently optional textures —

- when `portal_track` is set, track/tie faces are remapped to it (UV kept); otherwise the parts' own
  default textures are used.
- when `portal_track_mip` is set, two overlay cubes (`teleport_left` / `teleport_right`) textured with
  the mip are generated; otherwise no overlays.

The overlays wrap the left/right halves of the ties (each half), excluding the rails (the rails are
generated independently above the ties and are not covered); their size is the tie bounding box plus the
wrap margin, filling the whole track segment. When neither is set, the shape degrades to a plain
straight track identical to `z_ortho` / `x_ortho`.

```ts
export function teleport(cfg: TrackConfig, axis?: TrackAxis, opts?: GeneratorOptions): ShapeSpec;
```

### `cross(cfg, kind, opts?)`

Crossing track. `kind` corresponds to a `TrackShape`:

- `ortho`: Z straight + X straight
- `diag`: positive diagonal + negative diagonal
- `pd_zo`: positive diagonal + Z straight / `nd_zo`: negative diagonal + Z straight

Only the two xo-named files (`cross_d1_xo` / `cross_d2_xo`) are generated, but their geometry is always
"diagonal + Z straight": the blockstates express both xo and zo directions via 90° rotations of them.
Naming is the opposite of Create's: `cross_d1_xo` = negative diagonal + Z straight, `cross_d2_xo` =
positive diagonal + Z straight.

```ts
export function cross(
	cfg: TrackConfig,
	kind: 'ortho' | 'diag' | 'pd_zo' | 'nd_zo',
	opts?: GeneratorOptions
): ShapeSpec;
```

## Shape table & entry point

### `ShapeDef`

The shape definition table: builders for every `TrackShape`.

```ts
export interface ShapeDef {
	id: string;
	name: string;
	build: (cfg: TrackConfig, opts?: GeneratorOptions) => ShapeSpec;
}
```

### `allShapes(cfg, opts?)`

Generates all 9 track shapes — only the models the blockstates actually reference; the rest are
expressed via rotation:

- no `z_ortho`: shape=zo is expressed by rotating `x_ortho` 90°
- no `ascending_north/east/west`: directions come from `ascending_south` via blockstate y rotations
- no `teleport_x`: all four portal directions come from `teleport` (Z) via y rotations
- no `cross_d1_zo` / `cross_d2_zo`: cross xo/zo directions come from `cross_d1_xo` / `cross_d2_xo`
  (both "diagonal + Z straight") via 90° rotations

The curve-rendering base groups `tie` / `segment_left` / `segment_right` are created separately by
buildBaseParts. The whole-model Y offset (`wholeModelYOffset`) is applied here uniformly (translating
rotation pivots too), keeping all shapes consistent.

```ts
export function allShapes(cfg: TrackConfig, opts?: GeneratorOptions): ShapeSpec[];
```
