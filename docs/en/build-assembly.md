# `src/build/assembly.ts` — CubeSpec → Cube/Group

The assembly layer: converts the logic layer's `ShapeSpec[]` into real Blockbench Cube/Group objects.
This is the only module in the project that imports `Cube` / `Group` (depends on the Blockbench global
API).

## `buildBaseParts(parent, parts, config, textureByKey?)`

Moves the three track parts into the new workspace as base groups: `segment_left` / `segment_right` /
`tie`. Create's curve rendering uses these three models (tie.obj / segment_left.obj /
segment_right.obj); each group holds all of its part's elements (cube volumes + mesh groups) and is
attached under the track parent group `parent`, alongside the directional shapes, for standalone export.

Layout = the "near-the-x-axis half" track unit of the z_ortho straight track (no output-format offset):

- `segment_left` / `segment_right`: the rail model's own center (xz(8,8) for Java, (0,0) for other
  formats) is zeroed on x (offset.x = −xMid), the near z end rests on the xy plane, and the rail bottom
  is lifted to rail height + whole-model Y offset. Each rail is pivoted at its own center (Create's
  segment_left.obj / segment_right.obj likewise center at x=0; the game positions them at ±gauge/2
  when rendering).
- `tie`: moved to the first tie position near the x axis of z_ortho (z=4 = tie interval / 2),
  centered at x=0, bottom face only offset by the whole-model Y offset (not lifted).

Returns the three created groups.

```ts
export function buildBaseParts(
	parent: Group,
	parts: { left: PartModel; right: PartModel; tie: PartModel },
	config: TrackConfig,
	textureByKey?: Map<string, Texture>
): Group[];
```

## `buildAllShapes(shapes, textureByKey?)`

Generates all shapes under a parent Group (named after the current workspace, default `'track'`). Each
shape is one child Group (named by `TrackShape` id). When the output workspace is a Java Block/Item
model, the whole geometry is translated to xz (8,8) so the model stays symmetric about the canvas
center (inverse of the import normalization). With `textureByKey` set, the parts' source textures are
applied to the corresponding cube faces (left/right/tie each get their own texture). Returns the parent
Group.

```ts
export function buildAllShapes(shapes: ShapeSpec[], textureByKey?: Map<string, Texture>): Group;
```

## `elementsToRaw(elements)`

Converts Blockbench elements (Cube/Group/Mesh) into the logic layer's `RawElement[]` for part parsing.
Used when extracting a part from the current project. Groups are expanded recursively; mesh elements are
serialized via `getSaveCopy()` (vertices/faces/origin/rotation), with face textures as uuids (not
indices).

```ts
export function elementsToRaw(elements: (Cube | Group | Mesh)[]): RawElement[];
```
