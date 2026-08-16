/**
 * Geometric transforms — pure functions operating on CubeSpec[].
 * Decoupled from Blockbench: translation edits from/to/origin directly; rotation returns CubeSpecs
 * carrying a rotation field, which the assembly layer expresses as Cube.rotation.
 */

import { computeBBox, partBBox } from './parts';
import type { CubeFaceDirection, CubeSpec, FaceSpec, MeshSpec, PartModel, Vec3 } from './types';

/** Deep-copies a CubeSpec list, avoiding pollution of the original parts */
export function cloneCubes(cubes: CubeSpec[]): CubeSpec[] {
	return cubes.map((c) => ({
		...c,
		from: [...c.from] as Vec3,
		to: [...c.to] as Vec3,
		origin: c.origin ? ([...c.origin] as Vec3) : undefined,
		rotation: c.rotation ? ([...c.rotation] as Vec3) : undefined,
		faces: c.faces
			? Object.fromEntries(
					Object.entries(c.faces).map(([k, v]) => [
						k,
						{
							...v,
							uv: v.uv ? ([...v.uv] as [number, number, number, number]) : undefined,
						},
					])
				)
			: undefined,
	}));
}

export function translate(cubes: CubeSpec[], offset: Vec3): CubeSpec[] {
	const [dx, dy, dz] = offset;
	return cubes.map((c) => ({
		...c,
		from: [c.from[0] + dx, c.from[1] + dy, c.from[2] + dz] as Vec3,
		to: [c.to[0] + dx, c.to[1] + dy, c.to[2] + dz] as Vec3,
		origin: c.origin ? [c.origin[0] + dx, c.origin[1] + dy, c.origin[2] + dz] as Vec3 : c.origin,
	}));
}

/**
 * Rotates about the Y axis (degrees), producing a "rotation-field cube": it sets the Y component of
 * rotation to angleDeg (ensuring origin exists) and leaves from/to unchanged. Blockbench then
 * expresses the rotation via Cube.rotation rather than recomputed coordinates.
 */
export function rotateY(cubes: CubeSpec[], angleDeg: number, origin: Vec3): CubeSpec[] {
	return cubes.map((c) => ({
		...c,
		origin: origin,
		rotation: [c.rotation?.[0] ?? 0, angleDeg, c.rotation?.[2] ?? 0],
	}));
}

/**
 * Rotates about the X axis (degrees), used for the ascending-track slope.
 * Preserves any existing Y rotation (yaw).
 */
export function rotateX(cubes: CubeSpec[], angleDeg: number, origin: Vec3): CubeSpec[] {
	return cubes.map((c) => ({
		...c,
		origin: origin,
		rotation: [angleDeg, c.rotation?.[1] ?? 0, c.rotation?.[2] ?? 0],
	}));
}

export function lift(cubes: CubeSpec[], dy: number): CubeSpec[] {
	return translate(cubes, [0, dy, 0]);
}

/** Deep-copies a MeshSpec (vertices/faces/origin/rotation), avoiding pollution of the original parts */
export function cloneMesh(mesh: MeshSpec): MeshSpec {
	return {
		...mesh,
		vertices: Object.fromEntries(Object.entries(mesh.vertices).map(([k, v]) => [k, [...v] as Vec3])),
		faces: Object.fromEntries(
			Object.entries(mesh.faces).map(([k, f]) => [
				k,
				{
					...f,
					vertices: f.vertices ? [...f.vertices] : f.vertices,
					uv: f.uv && typeof f.uv === 'object' && !Array.isArray(f.uv) ? Object.fromEntries(Object.entries(f.uv).map(([uk, uv]) => [uk, [...uv]])) : f.uv,
				},
			])
		),
		origin: mesh.origin ? ([...mesh.origin] as Vec3) : undefined,
		rotation: mesh.rotation ? ([...mesh.rotation] as Vec3) : undefined,
	};
}

/** Shifts a mesh's vertices and origin by the given offset (keeps cube↔mesh relative positions) */
export function translateMesh(mesh: MeshSpec, offset: Vec3): MeshSpec {
	const [dx, dy, dz] = offset;
	return {
		...mesh,
		origin: mesh.origin ? [mesh.origin[0] + dx, mesh.origin[1] + dy, mesh.origin[2] + dz] as Vec3 : mesh.origin,
		vertices: Object.fromEntries(
			Object.entries(mesh.vertices).map(([k, v]) => [k, [v[0] + dx, v[1] + dy, v[2] + dz] as Vec3])
		),
	};
}

export function liftMesh(mesh: MeshSpec, dy: number): MeshSpec {
	return translateMesh(mesh, [0, dy, 0]);
}

/**
 * Rotates a mesh's vertices about a pivot, baking the rotation into the vertex positions (origin cleared).
 *
 * Blockbench renders a mesh as `position = origin` + `R(rotation)·vertices`, which differs from the
 * cube convention (Minecraft rotates a cube about its origin with an implicit `−origin`). So the shape
 * rotation (e.g. diagonal's +45° about the group center) cannot be expressed via the mesh's rotation
 * field with world-space vertices — it must be baked: `world' = pivot + R(rot)·(world − pivot)`.
 * A proper rotation preserves face winding (normals stay outward) and keeps per-vertex UV glued.
 */
export function rotateMesh(mesh: MeshSpec, rot: Vec3, pivot: Vec3): MeshSpec {
	const vertices: Record<string, Vec3> = {};
	for (const [k, v] of Object.entries(mesh.vertices)) {
		const rel: Vec3 = [v[0] - pivot[0], v[1] - pivot[1], v[2] - pivot[2]];
		const r = rotateVec(rel, rot);
		vertices[k] = [r[0] + pivot[0], r[1] + pivot[1], r[2] + pivot[2]] as Vec3;
	}
	return { ...mesh, vertices, origin: undefined, rotation: undefined };
}

/**
 * Per-axis vector rotation (degrees). X and Z match the standard right-hand rule AND the
 * Minecraft/Blockbench Cube.rotation convention; Y is the REVERSE of Cube.rotation's Y direction.
 *
 * Concretely: this rotY(+90) maps +Z → −X, while Blockbench/Minecraft render a Cube.rotation [0,+90,0]
 * as +Z → +X (standard R_y). The discrepancy is invisible for 90°-multiple Y rotations (they differ by
 * R_y(180), and an axis-aligned box is unchanged) — which is why the bake path and the tie-turning
 * (bakeRotateY90 / orientTieMeshPerpendicular) look right — but it FLIPS the ±45° diagonals.
 *
 * Shape mesh placement therefore NEGATES the Y angle when baking the same rotation the cubes express
 * via their rotation field (see straight/diagonal/cross/ascending in generator.ts). Do NOT "fix" rotY
 * to the standard direction: it would silently break the bakes/tests that depend on this convention.
 * The Y rotation was verified against test_rail's [0,-90,0] (-90 turns an X-spanning box along Z).
 */
function rotX(v: Vec3, deg: number): Vec3 {
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}
function rotY(v: Vec3, deg: number): Vec3 {
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c];
}
function rotZ(v: Vec3, deg: number): Vec3 {
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

/** Rotates a vector by [rx, ry, rz] in X→Y→Z order (Minecraft's Cube.rotation order) */
export function rotateVec(v: Vec3, rot: Vec3): Vec3 {
	return rotZ(rotY(rotX(v, rot[0]), rot[1]), rot[2]);
}

/** Face direction → its normal vector */
const FACE_NORMAL: Record<CubeFaceDirection, Vec3> = {
	north: [0, 0, -1],
	south: [0, 0, 1],
	east: [1, 0, 0],
	west: [-1, 0, 0],
	up: [0, 1, 0],
	down: [0, -1, 0],
};

/** Normal vector → face direction (after 90°-multiple rotation the normal stays a ±1 axis vector) */
const NORMAL_TO_FACE: Record<string, CubeFaceDirection> = Object.fromEntries(
	(Object.keys(FACE_NORMAL) as CubeFaceDirection[]).map((k) => [FACE_NORMAL[k].join(','), k])
);

/**
 * Local UV axes per face direction (world directions), matching Blockbench's CubeFace.UVToLocal
 * convention: side v faces −y, u runs along each face's lateral; up/down u faces +x, v faces ±z.
 */
const FACE_UV_AXES: Record<CubeFaceDirection, { u: Vec3; v: Vec3; n: Vec3 }> = {
	north: { u: [-1, 0, 0], v: [0, -1, 0], n: [0, 0, -1] },
	south: { u: [1, 0, 0], v: [0, -1, 0], n: [0, 0, 1] },
	east: { u: [0, 0, -1], v: [0, -1, 0], n: [1, 0, 0] },
	west: { u: [0, 0, 1], v: [0, -1, 0], n: [-1, 0, 0] },
	up: { u: [1, 0, 0], v: [0, 0, 1], n: [0, 1, 0] },
	down: { u: [1, 0, 0], v: [0, 0, -1], n: [0, -1, 0] },
};

function dot3(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Rounds a (±1 axis) vector to integers, removing floating-point error */
function roundAxis(v: Vec3): Vec3 {
	return [Math.round(v[0]), Math.round(v[1]), Math.round(v[2])] as Vec3;
}

/**
 * Transforms a face's UV sampling under a cube rotation rot, yielding the new face direction and
 * (uv box, rotation).
 *
 * Textures are "glued" to the volume: after the volume rotates, the same texture region stays on the
 * same physical face, only the face's normal / local UV axes change. For 90°-multiple axis rotations:
 *  - pure rotation (det>0): uv box unchanged, only the rotation angle is added to face.rotation;
 *  - reflection (det<0, can occur in 90° rotations, e.g. side faces when rotating about Z): the uv
 *    box's v is reversed (swap v0/v1) to express the mirror — Minecraft's face.rotation only supports
 *    0/90/180/270 and cannot express a mirror.
 * The rotation order follows Minecraft/Blockbench's Cube.rotation (X→Y→Z).
 */
export function transformFaceUV(
	dir: CubeFaceDirection,
	face: FaceSpec,
	rot: Vec3
): { dir: CubeFaceDirection; face: FaceSpec } {
	const src = FACE_UV_AXES[dir];
	const newDir = NORMAL_TO_FACE[roundAxis(rotateVec(src.n, rot)).join(',')] ?? dir;
	const dst = FACE_UV_AXES[newDir];
	// The old u/v axes after rotation, in the new face's local UV basis
	const Ru = roundAxis(rotateVec(src.u, rot));
	const Rv = roundAxis(rotateVec(src.v, rot));
	const a = dot3(Ru, dst.u);
	const b = dot3(Ru, dst.v);
	const c = dot3(Rv, dst.u);
	const d = dot3(Rv, dst.v);
	const det = a * d - b * c;
	// The old u axis's rotation angle in the new face (90° multiples), valid for either det sign
	const theta = Math.round(Math.atan2(b, a) / (Math.PI / 2)) * 90;
	let newRot = (face.rotation ?? 0) + theta;
	let uv = face.uv;
	if (det < 0) {
		// Reflection: mirror about the u axis → v sampling reversed (swap v0/v1)
		if (uv) uv = [uv[0], uv[3], uv[2], uv[1]] as [number, number, number, number];
	}
	newRot = ((newRot % 360) + 360) % 360;
	// Canonical form: for rotation 90/270, use the equivalent "swap uv box + 180°" encoding instead.
	// box-rot270 and uv-swap-rot90 are two encodings of the same mapping (render-invariant check: err=0).
	// The uv-swap form is chosen so baked top/bottom rotations match unbaked tie sources (up=90/down=270).
	if (newRot === 90 || newRot === 270) {
		if (uv) uv = [uv[2], uv[3], uv[0], uv[1]] as [number, number, number, number];
		newRot = (newRot + 180) % 360;
	}
	return { dir: newDir, face: { ...face, uv, rotation: newRot } };
}

/** Face direction mapping under an X-axis mirror (YZ-plane reflection): east↔west, others unchanged */
const MIRROR_FACE: Record<CubeFaceDirection, CubeFaceDirection> = {
	north: 'north',
	south: 'south',
	east: 'west',
	west: 'east',
	up: 'up',
	down: 'down',
};

/**
 * Transforms a cube's faces under a YZ-plane reflection:
 *  - face direction: east↔west (the normal flips with the reflection, otherwise faces point inward);
 *  - UV: u axis reversed (uv box swaps u0/u1, v unchanged) — reflection is a handedness flip (det=-1),
 *    and face.rotation only supports 0/90/180/270, so Blockbench expresses the mirror by flipping the uv box;
 *  - face.rotation negated (-0=0, -90=270, -180=180, -270=90).
 * The texture reference (texture key) is unchanged: the mirrored part still references the same source
 * texture, only the sampling direction is flipped.
 */
function mirrorFaces(faces: NonNullable<CubeSpec['faces']>): NonNullable<CubeSpec['faces']> {
	const out: NonNullable<CubeSpec['faces']> = {};
	for (const [dir, face] of Object.entries(faces)) {
		if (!face) continue;
		const outFace: FaceSpec = { ...face };
		if (face.uv) {
			outFace.uv = [face.uv[2], face.uv[1], face.uv[0], face.uv[3]] as [number, number, number, number];
		}
		if (face.rotation !== undefined) {
			outFace.rotation = ((-face.rotation % 360) + 360) % 360;
		}
		out[MIRROR_FACE[dir as CubeFaceDirection]] = outFace;
	}
	return out;
}

/**
 * Reflects a mesh across the YZ plane (x → 2·cx − x):
 *  - vertex and origin x reflected, y/z unchanged
 *  - rotation ry/rz negated (rx unchanged), matching the cube convention
 *  - face vertex order reversed (reflection flips the winding; reversing keeps normals outward),
 *    UV/texture unchanged
 */
function mirrorMeshYz(mesh: MeshSpec, cx: number): MeshSpec {
	return {
		...mesh,
		origin: mesh.origin ? [2 * cx - mesh.origin[0], mesh.origin[1], mesh.origin[2]] as Vec3 : mesh.origin,
		rotation: mesh.rotation ? [mesh.rotation[0], -mesh.rotation[1], -mesh.rotation[2]] as Vec3 : mesh.rotation,
		vertices: Object.fromEntries(
			Object.entries(mesh.vertices).map(([k, v]) => [k, [2 * cx - v[0], v[1], v[2]] as Vec3])
		),
		faces: Object.fromEntries(
			Object.entries(mesh.faces).map(([k, f]) => [k, { ...f, vertices: f.vertices ? [...f.vertices].reverse() : f.vertices }])
		),
	};
}

/**
 * Mirrors a part about the YZ plane through its lateral center (xMid), producing the left/right
 * symmetric part. Used for "right rail = mirror of left rail" (Create's segment_left / segment_right
 * are mirrors of each other about the track centerline):
 *  - geometry: from/to/origin x → 2·xMid − x (from/to swapped to keep from<to)
 *  - rotation: ry and rz negated (rx unchanged), i.e. [rx, −ry, −rz] (conjugation of rotation by the YZ reflection)
 *  - faces: east↔west swap + u-axis reversed + rotation negated (see mirrorFaces)
 *  - mesh: vertex x reflected + face vertex order reversed (see mirrorMeshYz)
 * Textures (textures / textureSize) are unchanged — the mirrored part still references the same source
 * texture. Returns a new PartModel (input not mutated). Mirroring about one's own center is an
 * involution (mirror(mirror(x)) === x).
 */
export function mirrorPartYz(part: PartModel): PartModel {
	const cx = part.xMid;
	const cubes = part.cubes.map((c) => {
		const fx = 2 * cx - c.from[0];
		const tx = 2 * cx - c.to[0];
		const out: CubeSpec = {
			...c,
			from: [Math.min(fx, tx), c.from[1], c.from[2]] as Vec3,
			to: [Math.max(fx, tx), c.to[1], c.to[2]] as Vec3,
		};
		if (c.origin) out.origin = [2 * cx - c.origin[0], c.origin[1], c.origin[2]] as Vec3;
		if (c.rotation) out.rotation = [c.rotation[0], -c.rotation[1], -c.rotation[2]] as Vec3;
		if (c.faces) out.faces = mirrorFaces(c.faces);
		return out;
	});
	const meshes = (part.meshes ?? []).map((m) => mirrorMeshYz(m, cx));
	const bbox = partBBox(cubes, meshes);
	return {
		cubes,
		meshes,
		hasMesh: part.hasMesh,
		bbox,
		xMid: (bbox.min[0] + bbox.max[0]) / 2,
		textureSize: part.textureSize,
		textures: part.textures,
	};
}

/**
 * After a rotation, transforms each face's UV sampling (uv box + face.rotation) to the new direction
 * as well — not just the direction — otherwise the face texture would be rotated wrong (e.g. top/bottom
 * faces need +90/270° after a Y rotation).
 */
function remapFaces(faces: NonNullable<CubeSpec['faces']>, rot: Vec3): NonNullable<CubeSpec['faces']> {
	const out: NonNullable<CubeSpec['faces']> = {};
	for (const [dir, face] of Object.entries(faces)) {
		if (!face) continue;
		const t = transformFaceUV(dir as CubeFaceDirection, face, rot);
		out[t.dir] = t.face;
	}
	return out;
}

/** Whether every rotation component is a 90° multiple (stays axis-aligned, so it can bake into from/to) */
function isAxisAlignedRot(rot: Vec3): boolean {
	return rot.some((v) => v !== 0) && rot.every((v) => v % 90 === 0);
}

/**
 * Bakes the part's "90°-multiple, axis-aligned" rotations into from/to, producing plain boxes without
 * a rotation field. Derived shapes (straightX / diag / ascending / teleport_x / cross_*) can then add
 * their own group rotation (rotateY / rotateX) without overwriting the part's own orientation —
 * otherwise a rail's built-in [0,-90,0] would be overwritten and the rails would end up parallel to
 * the ties.
 *
 * Rotation happens about each cube's own origin; non-90° rotations cannot be baked and keep their
 * rotation field. Returns a new PartModel with recomputed bbox / xMid (input not mutated).
 */
export function bakePartAxisAligned(part: PartModel): PartModel {
	const cubes = part.cubes.map((c) => {
		const rot = c.rotation;
		if (!rot || !isAxisAlignedRot(rot)) return c;
		const origin = c.origin ?? ([0, 0, 0] as Vec3);
		// Rotate the 8 corners and take the axis-aligned bounding box
		const pts: Vec3[] = [];
		for (const x of [c.from[0], c.to[0]])
			for (const y of [c.from[1], c.to[1]])
				for (const z of [c.from[2], c.to[2]]) {
					const rel: Vec3 = [x - origin[0], y - origin[1], z - origin[2]];
					const r = rotateVec(rel, rot);
					pts.push([r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]]);
				}
		const from: Vec3 = [
			Math.min(...pts.map((p) => p[0])),
			Math.min(...pts.map((p) => p[1])),
			Math.min(...pts.map((p) => p[2])),
		];
		const to: Vec3 = [
			Math.max(...pts.map((p) => p[0])),
			Math.max(...pts.map((p) => p[1])),
			Math.max(...pts.map((p) => p[2])),
		];
		const out: CubeSpec = { ...c, from, to, rotation: undefined, origin: undefined };
		if (c.faces) out.faces = remapFaces(c.faces, rot);
		return out;
	});
	const bbox = computeBBox(cubes);
	return { cubes, bbox, xMid: (bbox.min[0] + bbox.max[0]) / 2 };
}

/**
 * "Bakes" a −90° Y rotation into every unrotated cube (about the given center) by recomputing from/to
 * directly, and transforms each face's UV sampling (uv box + face.rotation) to the new direction. The
 * result is plain boxes without a rotation field, so later rotateY/rotateX composition can't overwrite
 * each other (otherwise a tie's own rotation would be overwritten by derived shapes' group rotation,
 * losing perpendicularity).
 *
 * Cubes carrying their own rotation are returned unchanged: their orientation is expressed by the
 * rotation and preserved by the parser; it must not be overwritten by the bake.
 * Direction mapping (−90° about Y): north→east, south→west, east→south, west→north; up/down unchanged.
 */
export function bakeRotateY90(cubes: CubeSpec[], center: Vec3): CubeSpec[] {
	const [cx, , cz] = center;
	return cubes.map((c) => {
		if (c.rotation) return c;
		const a: Vec3 = [cx - (c.from[2] - cz), c.from[1], cz + (c.from[0] - cx)];
		const b: Vec3 = [cx - (c.to[2] - cz), c.to[1], cz + (c.to[0] - cx)];
		const from: Vec3 = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
		const to: Vec3 = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
		const out: CubeSpec = { ...c, from, to };
		if (c.faces) {
			const faces: Partial<Record<CubeFaceDirection, FaceSpec>> = {};
			for (const dir of Object.keys(c.faces) as CubeFaceDirection[]) {
				const face = c.faces[dir];
				if (!face) continue;
				const t = transformFaceUV(dir, face, [0, 90, 0]);
				faces[t.dir] = t.face;
			}
			out.faces = faces;
		}
		return out;
	});
}
