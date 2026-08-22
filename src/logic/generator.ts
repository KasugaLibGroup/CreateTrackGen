/**
 * Track shape assembly — the core pure logic.
 *
 * Takes a TrackConfig (three parts + gauge + height) and outputs the CubeSpec sets for every
 * TrackShape.
 * Assembly rules:
 *  - Straight track is laid along Z on the xz plane by default, with the left/right rail centers at
 *    x = ±gauge/2, lifted by the height.
 *  - A track is generated as one full block (16 px) by default; if a rail part is shorter it is tiled
 *    along Z to fill the length (Create's rail segments are 8 px half-blocks, two per block).
 *  - The other shapes are derived from the straight track by rotation (following Kuayue's
 *    diag_template/ascending_template, expressed via Cube.rotation + origin rather than recomputed
 *    coordinates).
 * Pure functions, Node-testable.
 */

import { computeBBox, partBBox } from './parts';
import {
	bakePartAxisAligned,
	bakeRotateY90,
	cloneCubes,
	cloneMesh,
	lift,
	liftMesh,
	rotateMesh,
	rotateVec,
	rotateX,
	rotateY,
	translate,
	translateMesh,
} from './transform';
import { t } from '../i18n';
import type { CubeFaceDirection, CubeSpec, FaceSpec, MeshSpec, PartModel, ShapeSpec, TrackConfig, Vec3 } from './types';

/** Shape display name: id + localized parenthesis suffix (cleanGroupName strips the suffix to get the id back) */
function shapeDisplay(id: string, descKey: string, vars?: string | number): string {
	return `${id}${t(descKey, vars)}`;
}

/** Generation options: track length and tie interval */
export interface GeneratorOptions {
	/** Total track length along the laying direction (px), default 16 (one full block) */
	length?: number;
	/** Tie spacing (px) */
	tieInterval?: number;
}

const DEFAULT_TIE_INTERVAL = 8;
/** Default track length: one full block (16px) */
const DEFAULT_TRACK_LENGTH = 16;
/** Tie / rail-segment count needed for the diagonal (Create's diagonal track uses 3 × 8px segments + 3 ties to span the block diagonal) */
const DIAGONAL_TIE_COUNT = 3;

/** Diagonal length: 3 segments / 3 ties to span the block diagonal (default 3×8=24px, 1.5× the 16px straight) */
function diagonalLength(opts: GeneratorOptions): number {
	return DIAGONAL_TIE_COUNT * (opts.tieInterval ?? DEFAULT_TIE_INTERVAL);
}

/** Track laying direction */
export type TrackAxis = 'x' | 'z';

/**
 * The track's span along the laying direction. The default length is 16 (one full block) and the track
 * is centered on the origin (z from −length/2 to +length/2), so rotated shapes stay centered on the
 * origin too.
 */
function trackSpan(opts: GeneratorOptions = {}): { start: number; length: number } {
	const length = opts.length ?? DEFAULT_TRACK_LENGTH;
	return { start: -length / 2, length };
}

/**
 * Tiles a part along Z to cover [start, start+length]. A part shorter than one track length (e.g.
 * Create's 8px half-block rail segments) is tiled automatically to fill. Alignment uses the part
 * bbox's minimum z, so an off-center part tiles correctly.
 */
function tileAlongZ(part: PartModel, start: number, length: number): CubeSpec[] {
	const partLen = part.bbox.max[2] - part.bbox.min[2];
	if (partLen <= 0 || length <= 0) return [];
	const z0 = part.bbox.min[2];
	const out: CubeSpec[] = [];
	for (let z = start; z < start + length; z += partLen) {
		out.push(...translate(cloneCubes(part.cubes), [0, 0, z - z0]));
	}
	return out;
}

/**
 * Places the left/right rails: left center x=-g/2, right center x=+g/2, lifted by heightPx. Aligned to
 * the part's normalized lateral center (xMid), so an imperfectly centered part lands correctly. Rails
 * are tiled along Z over the full track length. The part's axis-aligned rotation (e.g. [0,-90,0]) is
 * baked first so the rails become plain Z-aligned boxes — otherwise derived shapes would overwrite the
 * rails' own rotation when composing group rotations, leaving the rails parallel to the ties.
 */
export function placeRails(cfg: TrackConfig, opts: GeneratorOptions = {}): CubeSpec[] {
	const { gaugePx, heightPx, parts } = cfg;
	const half = gaugePx / 2;
	const { start, length } = trackSpan(opts);
	const left = bakePartAxisAligned(parts.left);
	const right = bakePartAxisAligned(parts.right);
	return [
		...lift(translate(tileAlongZ(left, start, length), [-half - left.xMid, 0, 0]), heightPx),
		...lift(translate(tileAlongZ(right, start, length), [half - right.xMid, 0, 0]), heightPx),
	];
}

/**
 * Ensures the tie's long axis crosses X (perpendicular to the Z-laid rails). If the tie part's long
 * axis is along Z (parallel to the track), it is baked-rotated 90° about Y; parts carrying their own
 * rotation are trusted (already preserved by the parser) and not auto-rotated. Shared by placeTies
 * (track shapes) and buildBaseParts (curve base groups).
 */
export function orientTiePerpendicular(tie: PartModel): CubeSpec[] {
	if (tie.cubes.some((c) => c.rotation)) return tie.cubes;
	const xSpan = tie.bbox.max[0] - tie.bbox.min[0];
	const zSpan = tie.bbox.max[2] - tie.bbox.min[2];
	if (zSpan <= xSpan) return tie.cubes;
	const center: Vec3 = [
		(tie.bbox.min[0] + tie.bbox.max[0]) / 2,
		(tie.bbox.min[1] + tie.bbox.max[1]) / 2,
		(tie.bbox.min[2] + tie.bbox.max[2]) / 2,
	];
	return bakeRotateY90(tie.cubes, center);
}

/**
 * Places ties: looped along the track direction (Z) from start to end every tieInterval. Ties are
 * centered laterally (x=0), aligned lengthwise to their own center, and their long axis is
 * auto-oriented to cross X (perpendicular to the rails). Note: heightPx is the "rail height above the
 * bottom face" and applies to the rails only — ties are not lifted and sit directly on the xz plane.
 */
export function placeTies(cfg: TrackConfig, opts: GeneratorOptions = {}): CubeSpec[] {
	const { parts } = cfg;
	const tieInterval = opts.tieInterval ?? DEFAULT_TIE_INTERVAL;
	const { start, length } = trackSpan(opts);
	// Bake the tie's own axis-aligned rotation first, then decide by visual geometry whether to turn it across X
	const baked = bakePartAxisAligned(parts.tie);
	const tieBase = orientTiePerpendicular(baked);
	const tieCenterZ = (baked.bbox.min[2] + baked.bbox.max[2]) / 2;

	const ties: CubeSpec[] = [];
	for (let z = start + tieInterval / 2; z <= start + length; z += tieInterval) {
		ties.push(...translate(cloneCubes(tieBase), [0, 0, z - tieCenterZ]));
	}
	return ties;
}

// ── Mesh placement (mirrors placeRails / placeTies for the parts' mesh groups) ──

/**
 * Tiles a part's mesh groups along Z over [start, start+length] (a short mesh segment — e.g.
 * Create's 8px half-block rail — is repeated to fill the track). Mesh vertices can't be baked like
 * cubes, so each tile is a translated clone of the mesh.
 */
function tileMeshZ(part: PartModel, start: number, length: number): MeshSpec[] {
	const partLen = part.bbox.max[2] - part.bbox.min[2];
	if (partLen <= 0 || length <= 0) return [];
	const z0 = part.bbox.min[2];
	const out: MeshSpec[] = [];
	for (let z = start; z < start + length; z += partLen) {
		for (const m of part.meshes ?? []) {
			out.push(translateMesh(cloneMesh(m), [0, 0, z - z0]));
		}
	}
	return out;
}

/** Left/right rail meshes: left center x=−g/2, right x=+g/2, lifted by heightPx, tiled along Z. */
function placeRailsMesh(cfg: TrackConfig, opts: GeneratorOptions = {}): MeshSpec[] {
	const { gaugePx, heightPx, parts } = cfg;
	const half = gaugePx / 2;
	const { start, length } = trackSpan(opts);
	const left = tileMeshZ(parts.left, start, length).map((m) => translateMesh(m, [-half - parts.left.xMid, 0, 0]));
	const right = tileMeshZ(parts.right, start, length).map((m) => translateMesh(m, [half - parts.right.xMid, 0, 0]));
	return [...left.map((m) => liftMesh(m, heightPx)), ...right.map((m) => liftMesh(m, heightPx))];
}

/**
 * Turns the tie's mesh groups across X (perpendicular to the Z-laid rails) when their long axis is
 * along Z — the mesh equivalent of orientTiePerpendicular. The 90° Y rotation is baked into the
 * vertices (rotateMesh), keeping the mesh origin-less like the parts' baked meshes.
 */
function orientTieMeshPerpendicular(meshes: MeshSpec[], bbox: { min: Vec3; max: Vec3 }): MeshSpec[] {
	const xSpan = bbox.max[0] - bbox.min[0];
	const zSpan = bbox.max[2] - bbox.min[2];
	if (zSpan <= xSpan) return meshes;
	const center: Vec3 = [
		(bbox.min[0] + bbox.max[0]) / 2,
		(bbox.min[1] + bbox.max[1]) / 2,
		(bbox.min[2] + bbox.max[2]) / 2,
	];
	return meshes.map((m) => rotateMesh(cloneMesh(m), [0, 90, 0], center));
}

/** Tie meshes: looped along Z every tieInterval, centered laterally (x=0), long axis across X. */
function placeTiesMesh(cfg: TrackConfig, opts: GeneratorOptions = {}): MeshSpec[] {
	const { parts } = cfg;
	const tieInterval = opts.tieInterval ?? DEFAULT_TIE_INTERVAL;
	const { start, length } = trackSpan(opts);
	const tie = parts.tie;
	const tieCenterZ = (tie.bbox.min[2] + tie.bbox.max[2]) / 2;
	const oriented = orientTieMeshPerpendicular(tie.meshes ?? [], tie.bbox);
	const out: MeshSpec[] = [];
	for (let z = start + tieInterval / 2; z <= start + length; z += tieInterval) {
		for (const m of oriented) {
			out.push(translateMesh(cloneMesh(m), [0, 0, z - tieCenterZ]));
		}
	}
	return out;
}

/** Straight-track (along Z) meshes: rails + ties. */
function straightZMeshes(cfg: TrackConfig, opts: GeneratorOptions = {}): MeshSpec[] {
	return [...placeRailsMesh(cfg, opts), ...placeTiesMesh(cfg, opts)];
}

export function centerOf(cubes: CubeSpec[]): Vec3 {
	const bbox = computeBBox(cubes);
	return [
		(bbox.min[0] + bbox.max[0]) / 2,
		(bbox.min[1] + bbox.max[1]) / 2,
		(bbox.min[2] + bbox.max[2]) / 2,
	];
}

/**
 * The lowest rendered y of CubeSpec[] (applying each cube's own rotation). computeBBox only reads
 * from/to and ignores rotation; the true lowest point of a rotated cube (e.g. ascending's −45°X) needs
 * the 8 corners transformed to world coordinates via origin + R·(local−origin).
 */
function renderedMinY(cubes: CubeSpec[]): number {
	let minY = Infinity;
	for (const c of cubes) {
		const origin = c.origin ?? ([0, 0, 0] as Vec3);
		const rot = c.rotation ?? ([0, 0, 0] as Vec3);
		for (const x of [c.from[0], c.to[0]])
			for (const y of [c.from[1], c.to[1]])
				for (const z of [c.from[2], c.to[2]]) {
					const rel: Vec3 = [x - origin[0], y - origin[1], z - origin[2]];
					const r = rotateVec(rel, rot);
					minY = Math.min(minY, r[1] + origin[1]);
				}
	}
	return minY;
}

/** Lowest vertex y across a mesh list (baked world-space vertices — no per-vertex rotation to apply) */
function meshMinY(meshes: MeshSpec[]): number {
	let minY = Infinity;
	for (const m of meshes) {
		for (const v of Object.values(m.vertices)) minY = Math.min(minY, v[1]);
	}
	return minY;
}

/** The lowest rendered y of cubes + meshes (used by the ascending lift) */
function combinedMinY(cubes: CubeSpec[], meshes: MeshSpec[]): number {
	return Math.min(renderedMinY(cubes), meshes.length ? meshMinY(meshes) : Infinity);
}

/** Center of the combined cube + mesh geometry (safe when either side is empty) */
function combinedCenter(cubes: CubeSpec[], meshes: MeshSpec[]): Vec3 {
	const bbox = partBBox(cubes, meshes);
	return [
		(bbox.min[0] + bbox.max[0]) / 2,
		(bbox.min[1] + bbox.max[1]) / 2,
		(bbox.min[2] + bbox.max[2]) / 2,
	];
}

/** Straight track (along Z): left/right rails + ties. */
export function straightZ(cfg: TrackConfig, opts: GeneratorOptions = {}): CubeSpec[] {
	return [...placeRails(cfg, opts), ...placeTies(cfg, opts)];
}

/** Straight track (along X): rotates the Z track 90° (Y axis) about the whole group's center. */
export function straightX(cfg: TrackConfig, opts: GeneratorOptions = {}): CubeSpec[] {
	const zs = straightZ(cfg, opts);
	return rotateY(zs, 90, centerOf(zs));
}

/** Straight shape (x_ortho / z_ortho): cubes + the parts' mesh groups placed/rotated the same way. */
export function straight(cfg: TrackConfig, axis: TrackAxis = 'z', opts: GeneratorOptions = {}): ShapeSpec {
	const zc = straightZ(cfg, opts);
	const zm = straightZMeshes(cfg, opts);
	if (axis === 'z') {
		return {
			id: 'z_ortho',
			name: shapeDisplay('z_ortho', 'ctg.shape.desc.z_ortho'),
			cubes: zc,
			meshes: zm,
		};
	}
	// x_ortho = Z track rotated 90° about the combined center (mesh rotation is baked into vertices)
	const pivot = combinedCenter(zc, zm);
	return {
		id: 'x_ortho',
		name: shapeDisplay('x_ortho', 'ctg.shape.desc.x_ortho'),
		cubes: rotateY(zc, 90, pivot),
		// Mesh Y rotation is negated vs the cube: rotateMesh/rotateVec applies the opposite Y direction
		// to Cube.rotation (Blockbench renders a [0,+,0] field with the standard R_y), so the baked
		// vertices must use −90° to land on the same diagonal the cube shows.
		meshes: zm.map((m) => rotateMesh(m, [0, -90, 0], pivot)),
	};
}

/**
 * 45° diagonal: rotates the Z track ±45° about the group center (Y axis).
 * diag = +45° (PD positive diagonal), diag_2 = −45° (ND negative diagonal).
 * A diagonal spans the block's diagonal, needing 3 rail segments / 3 ties
 * (length = 3 × tie interval, default 24 px) instead of the straight track's 2 segments / 2 ties
 * (16 px).
 */
export function diagonal(cfg: TrackConfig, mirror: boolean, opts: GeneratorOptions = {}): ShapeSpec {
	const zs = straightZ(cfg, { ...opts, length: opts.length ?? diagonalLength(opts) });
	const zm = straightZMeshes(cfg, { ...opts, length: opts.length ?? diagonalLength(opts) });
	const angle = mirror ? -45 : 45;
	const pivot = combinedCenter(zs, zm);
	return {
		id: mirror ? 'diag_2' : 'diag',
		name: mirror ? shapeDisplay('diag_2', 'ctg.shape.desc.diag_2') : shapeDisplay('diag', 'ctg.shape.desc.diag'),
		cubes: rotateY(zs, angle, pivot),
		// Mesh Y rotation is negated vs the cube (see straight/rotateMesh note): baking +45 here would
		// land the mesh on the OPPOSITE diagonal from the cube's [0,+45,0], so diag's mesh must be
		// baked −45 to match. This keeps rail/tie meshes on the same diagonal as the cube rails/ties.
		meshes: zm.map((m) => rotateMesh(m, [0, -angle, 0], pivot)),
	};
}

/**
 * Ascending track: rotates the Z track −45° about the X axis, pivot at the track center (the block
 * center (8,8) on the xz plane in Java models), tilting the whole track about the block center. yaw
 * decides the facing (blockstate: south=0 / north=180 / east=270 / west=90).
 *
 * Note: the tilt and the turn must share the same pivot. Using centerOf as the turn pivot would
 * overwrite the tilt pivot, tilting the track about the whole segment's center (front end sinks, only
 * the back rises) — a rotation bug. Blockbench's Cube.rotation composes Ry(yaw)·Rx(−45) about the same
 * origin, semantically "tilt along the laying direction, then turn the whole thing".
 * The pivot is the track's z-center (Java canvas xz (8,8)), not the front edge (8,0): this puts the
 * ascending track's rotation axis at the block center, matching Create/Kuayue's ascending_template.
 *
 * An ascending track covers a longer span than the straight like the diagonal: length = 3 × tie
 * interval (default 24 px, 3 rail segments / 3 ties), not the straight's 16 px (2/2).
 *
 * After the −45° tilt about the center, the lower end dips below the xz plane (lowest tie point y<0).
 * There are two user-definable Y offsets: heightPx (rail height, applied inside straightZ) and
 * wholeModelYOffset (whole-model Y offset, applied uniformly by allShapes' applyWholeOffset after the
 * shape returns). Here the track is lifted so the lowest point lands exactly on the xz plane (y≥0)
 * **after the whole-model Y offset takes effect**:
 *  - offset ≥0: lift to 0, the whole model then rises with wholeY (consistent with other shapes);
 *  - offset <0: lift extra −wholeY, pushing the sunken ascending track back to the plane.
 * lift shifts from/to and origin together, so the tilted shape is preserved.
 */
export function ascending(
	cfg: TrackConfig,
	dir: 'south' | 'north' | 'east' | 'west',
	opts: GeneratorOptions = {}
): ShapeSpec {
	const zs = straightZ(cfg, { ...opts, length: opts.length ?? diagonalLength(opts) });
	const zm = straightZMeshes(cfg, { ...opts, length: opts.length ?? diagonalLength(opts) });
	const bbox = partBBox(zs, zm);
	// Pivot = the track's xz center (the block center (8,8) in Java mode), Y at rail height
	const pivot: Vec3 = [
		(bbox.min[0] + bbox.max[0]) / 2,
		cfg.heightPx,
		(bbox.min[2] + bbox.max[2]) / 2,
	];
	const yaw: Record<string, number> = { south: 0, north: 180, east: 270, west: 90 };
	// Cubes: rotation field (origin=pivot); meshes: baked (pivot + R·(v−pivot)), same X-then-Y order.
	// The mesh yaw is negated vs the cube field (see straight/rotateMesh note): the X tilt shares the
	// same direction (both R_x), only the Y yaw flips, so the baked mesh matches the cube's [-45,yaw,0].
	const tiltedCubes = rotateY(rotateX(zs, -45, pivot), yaw[dir], pivot);
	const tiltedMeshes = zm.map((m) => rotateMesh(m, [-45, 0, 0], pivot)).map((m) => rotateMesh(m, [0, -yaw[dir], 0], pivot));
	const wholeY = cfg.wholeModelYOffset ?? 0;
	let cubes = tiltedCubes;
	let meshes = tiltedMeshes;
	// Lift amount covers the whole-model Y offset: with a negative offset, lift extra to guarantee the
	// lowest point (after the offset) is ≥ 0
	const need = -(combinedMinY(cubes, meshes) + Math.min(0, wholeY));
	if (need > 0) {
		cubes = lift(cubes, need);
		meshes = meshes.map((m) => liftMesh(m, need));
	}
	// Fallback: if the final lowest point (including the whole offset) is still <0 under float error, lift again
	const finalMin = combinedMinY(cubes, meshes) + wholeY;
	if (finalMin < 0) {
		cubes = lift(cubes, -finalMin);
		meshes = meshes.map((m) => liftMesh(m, -finalMin));
	}
	return {
		id: `ascending_${dir}`,
		name: `ascending_${dir}${t('ctg.shape.desc.ascending', t('ctg.dir.' + dir))}`,
		cubes,
		meshes,
	};
}

/**
 * The tie's lateral half-width and top height (after baking its own rotation and, if needed, turning it
 * across X). The portal overlays use this extent to wrap each half of the ties (excluding the rails).
 */
function tieWrapExtent(cfg: TrackConfig): { halfW: number; top: number } {
	const baked = bakePartAxisAligned(cfg.parts.tie);
	const tieCross = orientTiePerpendicular(baked);
	const bbox = computeBBox(tieCross);
	return {
		halfW: Math.max(-bbox.min[0], bbox.max[0]),
		top: bbox.max[1],
	};
}

/**
 * Remaps all faces of a cube set to the given source key (keeping the original UV),
 * used by the teleport shape: track/tie uniformly covered with portal_track.
 */
function remapAllFaces(cubes: CubeSpec[], textureKey: string): CubeSpec[] {
	return cubes.map((c) => {
		if (!c.faces) return c;
		const faces: Partial<Record<CubeFaceDirection, FaceSpec>> = {};
		for (const [dir, f] of Object.entries(c.faces)) {
			if (!f) continue;
			faces[dir as CubeFaceDirection] = { ...f, texture: textureKey };
		}
		return { ...c, faces };
	});
}

/** Mesh equivalent of remapAllFaces: every mesh face is re-textured with textureKey (UV kept) */
function remapAllMeshFaces(meshes: MeshSpec[], textureKey: string): MeshSpec[] {
	return meshes.map((m) => ({
		...m,
		faces: Object.fromEntries(
			Object.entries(m.faces).map(([id, f]) => [id, f ? { ...f, texture: textureKey } : f])
		),
	}));
}

/**
 * Builds the two portal overlay cubes (teleport_left / teleport_right).
 *
 * Structure follows Create's original teleport.json (assets/teleport.json): the whole model uses
 * portal_track, the two overlays (original cube5 / cube6) use portal_track_mip. Each overlay wraps one
 * half of the ties (each wraps a half), excluding the rails (the rails are generated independently
 * above the ties and are not covered), textured with the mip (full texture across each face). The
 * overlays fill the whole track segment along the laying direction; size = tie bounding box + wrap
 * margin. Returns null when no portal overlay is configured (cfg.portal missing), and teleport()
 * degrades to a plain straight track.
 */
function buildPortalOverlays(cfg: TrackConfig, opts: GeneratorOptions = {}): CubeSpec[] | null {
	const portal = cfg.portal;
	if (!portal?.mipTexture) return null;
	const { halfW, top } = tieWrapExtent(cfg);
	if (!(halfW > 0)) return null;
	const m = portal.margin ?? 0.1;
	const { start, length } = trackSpan(opts);
	const z0 = start;
	const z1 = start + length;
	// Overlay top = tie top + margin, but no higher than the rail bottom (heightPx), so the rails are not covered
	const y0 = -m;
	const y1 = Math.min(top + m, cfg.heightPx);
	const uv: [number, number, number, number] = [0, 0, portal.mipTextureSize?.[0] ?? 32, portal.mipTextureSize?.[1] ?? 32];
	const tex = portal.mipTexture;
	const allFaces = (): Partial<Record<CubeFaceDirection, FaceSpec>> => ({
		north: { uv, texture: tex },
		south: { uv, texture: tex },
		east: { uv, texture: tex },
		west: { uv, texture: tex },
		up: { uv, texture: tex },
		down: { uv, texture: tex },
	});

	const left: CubeSpec = {
		name: 'teleport_left',
		from: [-halfW - m, y0, z0],
		to: [0, y1, z1],
		faces: allFaces(),
	};
	const right: CubeSpec = {
		name: 'teleport_right',
		from: [0, y0, z0],
		to: [halfW + m, y1, z1],
		faces: allFaces(),
	};
	return [left, right];
}

/**
 * Portal track: two independently optional textures —
 *  - when portal_track is set, track/tie faces are remapped to it (UV kept); otherwise the parts' own
 *    default textures are used.
 *  - when portal_track_mip is set, two overlay cubes (teleport_left / teleport_right) textured with the
 *    mip are generated; otherwise no overlays.
 * When neither is set, degrades to a plain straight track identical to z_ortho / x_ortho.
 */
export function teleport(cfg: TrackConfig, axis: TrackAxis = 'z', opts: GeneratorOptions = {}): ShapeSpec {
	const zc = straightZ(cfg, opts);
	const zm = straightZMeshes(cfg, opts);
	const portal = cfg.portal;
	let all = zc;
	let meshes = zm;
	// portal_track optional: when set, cover track/tie with it; otherwise use the parts' default textures
	if (portal?.trackTexture) {
		all = remapAllFaces(all, portal.trackTexture);
		meshes = remapAllMeshFaces(meshes, portal.trackTexture);
	}
	// portal_track_mip optional: when set, generate the left/right overlays; otherwise none
	const overlays = buildPortalOverlays(cfg, opts) ?? [];
	all = [...all, ...overlays];
	if (axis === 'x') {
		const pivot = combinedCenter(all, meshes);
		return {
			id: 'teleport_x',
			name: shapeDisplay('teleport_x', 'ctg.shape.desc.teleport_x'),
			cubes: rotateY(all, 90, pivot),
			// Mesh Y rotation negated vs the cube field (see straight/rotateMesh note)
			meshes: meshes.map((m) => rotateMesh(m, [0, -90, 0], pivot)),
		};
	}
	return {
		id: 'teleport',
		name: shapeDisplay('teleport', 'ctg.shape.desc.teleport'),
		cubes: all,
		meshes,
	};
}

/**
 * Crossing track. kind corresponds to a TrackShape:
 *  - ortho: Z straight + X straight
 *  - diag: positive diagonal + negative diagonal
 *  - pd_zo: positive diagonal + Z straight  /  nd_zo: negative diagonal + Z straight
 *
 * Only the two xo-named files (cross_d1_xo / cross_d2_xo) are generated, but their geometry is always
 * "diagonal + Z straight": the blockstates express both xo and zo directions via 90° rotations of them
 * (following Kuayue meter / guard blockstates). Naming is the opposite of Create's:
 *   cross_d1_xo = negative diagonal + Z straight, cross_d2_xo = positive diagonal + Z straight
 * (in Create/Kuayue reference models cross_d1 is the negative diagonal and cross_d2 the positive).
 */
export function cross(
	cfg: TrackConfig,
	kind: 'ortho' | 'diag' | 'pd_zo' | 'nd_zo',
	opts: GeneratorOptions = {}
): ShapeSpec {
	let cubes: CubeSpec[] = [];
	let meshes: MeshSpec[] = [];
	switch (kind) {
		case 'ortho': {
			// Z straight + X straight (X = Z rotated 90° about the combined center)
			const zc = straightZ(cfg, opts);
			const zm = straightZMeshes(cfg, opts);
			const pivot = combinedCenter(zc, zm);
			cubes = [...zc, ...rotateY(zc, 90, pivot)];
			// Mesh Y rotation negated vs the cube field (see straight/rotateMesh note)
			meshes = [...zm, ...zm.map((m) => rotateMesh(m, [0, -90, 0], pivot))];
			break;
		}
		case 'diag': {
			// Diagonal crossing uses the diagonal length (3 segments / 3 ties)
			const zs = straightZ(cfg, { ...opts, length: opts.length ?? diagonalLength(opts) });
			const zm = straightZMeshes(cfg, { ...opts, length: opts.length ?? diagonalLength(opts) });
			const pivot = combinedCenter(zs, zm);
			cubes = [...rotateY(zs, 45, pivot), ...rotateY(zs, -45, pivot)];
			// Mesh Y rotations negated vs the cube fields (see straight/rotateMesh note): +45 cube ↔
			// −45 mesh bake, −45 cube ↔ +45 mesh bake, so each mesh diagonal matches its cube diagonal
			meshes = [...zm.map((m) => rotateMesh(m, [0, -45, 0], pivot)), ...zm.map((m) => rotateMesh(m, [0, 45, 0], pivot))];
			break;
		}
		case 'pd_zo': {
			const diag = diagonal(cfg, false, opts);
			cubes = [...diag.cubes, ...straightZ(cfg, opts)];
			meshes = [...(diag.meshes ?? []), ...straightZMeshes(cfg, opts)];
			break;
		}
		case 'nd_zo': {
			const diag = diagonal(cfg, true, opts);
			cubes = [...diag.cubes, ...straightZ(cfg, opts)];
			meshes = [...(diag.meshes ?? []), ...straightZMeshes(cfg, opts)];
			break;
		}
	}
	const idMap: Record<string, string> = {
		ortho: 'cross_ortho',
		diag: 'cross_diag',
		// The pd_zo / nd_zo kinds are the "diagonal + Z straight" BASES that crossZo / crossXo derive
		// the four crossing models from: cross_d1_zo = pd_zo, cross_d2_zo = nd_zo (unrotated);
		// cross_d1_xo = nd_zo rotated 90° clockwise, cross_d2_xo = pd_zo rotated 90° clockwise.
		pd_zo: 'cross_d1_zo',
		nd_zo: 'cross_d2_zo',
	};
	const nameMap: Record<string, string> = {
		ortho: shapeDisplay('cross_ortho', 'ctg.shape.desc.cross_ortho'),
		diag: shapeDisplay('cross_diag', 'ctg.shape.desc.cross_diag'),
		pd_zo: shapeDisplay('cross_d1_zo', 'ctg.shape.desc.cross_pd_zo'),
		nd_zo: shapeDisplay('cross_d2_zo', 'ctg.shape.desc.cross_nd_zo'),
	};
	return { id: idMap[kind], name: nameMap[kind], cubes, meshes };
}

/**
 * Rotates a whole crossing −90° (clockwise, viewed from above) about the crossing center. The 90° Y
 * rotation is COMPOSED onto each cube's existing rotation rather than overwritten: the crossing's
 * diagonal cubes already carry [0,±45,0] about the pivot and must become [0,±45−90,0], while the plain
 * straight cubes get [0,270,0] (= −90) — overwriting with rotateY would collapse the diagonal into a
 * straight. The direction is CLOCKWISE (standard R_y −90: +X → +Z); counterclockwise would land on
 * the opposite diagonal. Mesh Y rotation is negated vs the cube field (see straight/rotateMesh note),
 * so the baked mesh lands on the same diagonal as the rotated cube.
 */
function rotateCross90(cubes: CubeSpec[], meshes: MeshSpec[]): { cubes: CubeSpec[]; meshes: MeshSpec[] } {
	const pivot = combinedCenter(cubes, meshes);
	const rotated = cubes.map((c) => ({
		...c,
		origin: pivot,
		rotation: [
			c.rotation?.[0] ?? 0,
			((c.rotation?.[1] ?? 0) + 270) % 360,
			c.rotation?.[2] ?? 0,
		] as Vec3,
	}));
	const rotatedMeshes = meshes.map((m) => rotateMesh(m, [0, 90, 0], pivot));
	return { cubes: rotated, meshes: rotatedMeshes };
}

/**
 * cross_dN_zo = the base "diagonal + Z straight" crossing, NOT rotated. Naming follows the reference
 * Kuayue standard assets directly: `cross_d1_zo` = positive diagonal + Z straight (from `pd_zo`),
 * `cross_d2_zo` = negative diagonal + Z straight (from `nd_zo`). All four crossing models are
 * generated and exported; the blockstates reference each directly (see src/logic/export.ts
 * BLOCKSTATE_SHAPES).
 */
function crossZo(cfg: TrackConfig, baseKind: 'nd_zo' | 'pd_zo', id: string, opts: GeneratorOptions): ShapeSpec {
	const base = cross(cfg, baseKind, opts);
	return { id, name: id, cubes: base.cubes, meshes: base.meshes ?? [] };
}

/**
 * cross_dN_xo = the OTHER crossing's "diagonal + Z straight" base rotated 90° clockwise about the
 * crossing center, producing the X-straight crossing (rotating flips the diagonal sign, so
 * `cross_d1_xo` = positive diagonal + X straight comes from `nd_zo`, `cross_d2_xo` = negative
 * diagonal + X straight from `pd_zo`), matching the reference Kuayue standard assets.
 */
function crossXo(cfg: TrackConfig, baseKind: 'nd_zo' | 'pd_zo', id: string, opts: GeneratorOptions): ShapeSpec {
	const base = cross(cfg, baseKind, opts);
	const { cubes, meshes } = rotateCross90(base.cubes, base.meshes ?? []);
	return { id, name: id, cubes, meshes };
}

/** Shape definition table: the builder for every TrackShape */
export interface ShapeDef {
	id: string;
	name: string;
	build: (cfg: TrackConfig, opts?: GeneratorOptions) => ShapeSpec;
}

/**
 * Applies the whole-model Y offset (wholeModelYOffset) to a shape: lifts the whole model (ties, rails,
 * portal frame) and translates the rotation pivots (origin) along with it. Applied uniformly in
 * allShapes so all 16 shapes behave the same; each shape builder keeps "centered on origin" pure
 * geometry output.
 */
function applyWholeOffset(cfg: TrackConfig, shape: ShapeSpec): ShapeSpec {
	const dy = cfg.wholeModelYOffset ?? 0;
	if (dy === 0) return shape;
	return {
		...shape,
		cubes: lift(shape.cubes, dy),
		meshes: shape.meshes ? shape.meshes.map((m) => liftMesh(m, dy)) : shape.meshes,
	};
}

/**
 * Generates all 11 track shapes — the models the blockstates actually reference; the rest are
 * expressed via rotation:
 *  - no z_ortho: shape=zo is expressed by rotating x_ortho 90°
 *  - no ascending_north/east/west: directions come from ascending_south via blockstate y rotations
 *  - no teleport_x: all four portal directions come from teleport (Z) via y rotations
 * All four crossing models are generated and exported, matching the reference Kuayue standard assets
 * directly: cross_d1_* = positive diagonal, cross_d2_* = negative diagonal; the zo variants are the
 * base "diagonal + Z straight" crossings (unrotated), the xo variants are them turned 90° clockwise
 * (diagonal + X straight). The blockstates reference each directly (see src/logic/export.ts
 * BLOCKSTATE_SHAPES).
 * The curve-rendering base groups tie / segment_left / segment_right are created separately by
 * buildBaseParts.
 */
export function allShapes(cfg: TrackConfig, opts: GeneratorOptions = {}): ShapeSpec[] {
	const defs: ShapeDef[] = [
		{ id: 'x_ortho', name: shapeDisplay('x_ortho', 'ctg.shape.desc.x_ortho'), build: (c) => straight(c, 'x', opts) },
		{ id: 'diag', name: shapeDisplay('diag', 'ctg.shape.desc.diag'), build: (c) => diagonal(c, false, opts) },
		{ id: 'diag_2', name: shapeDisplay('diag_2', 'ctg.shape.desc.diag_2'), build: (c) => diagonal(c, true, opts) },
		{ id: 'ascending_south', name: shapeDisplay('ascending_south', 'ctg.shape.desc.ascending', t('ctg.dir.south')), build: (c) => ascending(c, 'south', opts) },
		{ id: 'teleport', name: shapeDisplay('teleport', 'ctg.shape.desc.teleport'), build: (c) => teleport(c, 'z', opts) },
		{ id: 'cross_ortho', name: shapeDisplay('cross_ortho', 'ctg.shape.desc.cross_ortho'), build: (c) => cross(c, 'ortho', opts) },
		{ id: 'cross_diag', name: shapeDisplay('cross_diag', 'ctg.shape.desc.cross_diag'), build: (c) => cross(c, 'diag', opts) },
		// d1 = positive diagonal, d2 = negative diagonal; zo = base "diagonal + Z straight" (no
		// rotation), xo = the opposite base rotated 90° clockwise (diagonal + X straight) — matching
		// the reference Kuayue standard assets
		{ id: 'cross_d1_xo', name: 'cross_d1_xo', build: (c) => crossXo(c, 'nd_zo', 'cross_d1_xo', opts) },
		{ id: 'cross_d2_xo', name: 'cross_d2_xo', build: (c) => crossXo(c, 'pd_zo', 'cross_d2_xo', opts) },
		{ id: 'cross_d1_zo', name: 'cross_d1_zo', build: (c) => crossZo(c, 'pd_zo', 'cross_d1_zo', opts) },
		{ id: 'cross_d2_zo', name: 'cross_d2_zo', build: (c) => crossZo(c, 'nd_zo', 'cross_d2_zo', opts) },
	];
	return defs.map((d) => applyWholeOffset(cfg, d.build(cfg)));
}
