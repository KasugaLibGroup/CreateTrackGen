/**
 * Export conventions — pure logic that maps the groups under the track parent group into
 * Create/Kuayue model file names and generates the matching blockstates JSON. Zero dependencies,
 * Node-testable.
 *
 * Naming follows assets/tracks/standard/:
 *  - models: models/block/track/{trackId}/{shape}.json (z_ortho / x_ortho / diag / diag_2 /
 *    ascending / teleport / cross_* / tie / segment_left / segment_right)
 *  - blockstates: blockstates/{trackId}_track.json (MC requires them directly under blockstates/)
 *  - textures: textures/block/track/{trackId}/{resourceName}.png, referenced in-model as
 *    {namespace}:block/track/{id}/{resourceName}
 *
 * Conventions:
 *  - ascending exports only the s variant (ascending_south) as ascending.json; other directions are
 *    expressed via blockstate y rotations (an=180 / as=0 / ae=270 / aw=90).
 *  - teleport exports only the z direction (teleport) as teleport.json; teleport_x is not exported
 *    (the blockstates express all directions via y rotations, consistent with Create/Kuayue).
 *
 * Four export modes (see EXPORT_MODES):
 *  - new_java    (1.21.11+): format_version "1.21.11", multi-axis rotation {x,y,z}
 *  - classic_java (1.21.11-): no format_version (matches the assets examples), single-axis rotation only
 *  - bedrock      : minecraft:geometry block geometry
 *  - obj          : everything baked into a single merged OBJ mesh
 * Elements that can't be exported fall back to OBJ (see groupNeedsObj).
 */

import type { CubeFaceDirection, Vec3 } from './types';
import { rotateVec } from './transform';
import { t } from '../i18n';

/** Export mode */
export type ExportMode = 'new_java' | 'classic_java' | 'bedrock' | 'obj';

/** Export-mode metadata: id / label / eligibility description (label and description are i18n-localized) */
export const EXPORT_MODES: { id: ExportMode; label: string; description: string }[] = [
	{
		id: 'new_java',
		label: t('ctg.export.mode.new_java.label'),
		description: t('ctg.export.mode.new_java.desc'),
	},
	{
		id: 'classic_java',
		label: t('ctg.export.mode.classic_java.label'),
		description: t('ctg.export.mode.classic_java.desc'),
	},
	{
		id: 'bedrock',
		label: t('ctg.export.mode.bedrock.label'),
		description: t('ctg.export.mode.bedrock.desc'),
	},
	{
		id: 'obj',
		label: t('ctg.export.mode.obj.label'),
		description: t('ctg.export.mode.obj.desc'),
	},
];

/**
 * Platform-neutral element descriptors: the Blockbench layer extracts them from live Cubes / Meshes
 * and passes them to the pure functions. Face textures use a stable textureKey (the Blockbench layer
 * maps Texture instances to 't0'/'t1'…).
 */
export interface ExportFaceData {
	uv?: [number, number, number, number];
	rotation?: number;
	textureKey?: string;
}
export interface ExportCubeData {
	name?: string;
	from: Vec3;
	to: Vec3;
	rotation?: Vec3;
	origin?: Vec3;
	faces: Partial<Record<CubeFaceDirection, ExportFaceData>>;
}
export interface ExportMeshFaceData {
	vertices: string[];
	/** Per-vertex UV: array (in face.vertices order) or object (by vertex id) */
	uv?: number[] | Record<string, number[]>;
	textureKey?: string;
}
export interface ExportMeshData {
	name?: string;
	vertices: Record<string, Vec3>;
	faces: Record<string, ExportMeshFaceData>;
}
export type ExportElement = ({ type: 'cube' } & ExportCubeData) | ({ type: 'mesh' } & ExportMeshData);

/** A texture referenced by a shape: key / resource name / pixel size / bitmap (data URL) */
export interface ExportTexture {
	key: string;
	resName: string;
	width: number;
	height: number;
	/** Base64 data URL (for writing PNGs; not needed by the pure logic layer) */
	dataUrl?: string;
}

/** The number of non-zero rotation axes */
function rotationAxisCount(rotation?: Vec3): number {
	return rotation ? rotation.filter((v) => v !== 0).length : 0;
}

/**
 * Decides whether a group "cannot be exported" in the given mode and must fall back to OBJ:
 *  - obj mode: everything falls back
 *  - any mesh element → fall back (neither Java JSON / Bedrock cubes can express triangle faces)
 *  - classic_java with any multi-axis-rotated cube → fall back (classic format allows single-axis only)
 *  - bedrock with >1 texture referenced → fall back (Bedrock: one geometry, one texture)
 */
export function groupNeedsObj(elements: ExportElement[], mode: ExportMode): boolean {
	if (mode === 'obj') return true;
	const textureKeys = new Set<string>();
	let hasMesh = false;
	let hasMultiAxis = false;
	for (const el of elements) {
		if (el.type === 'mesh') {
			hasMesh = true;
			for (const f of Object.values(el.faces)) {
				if (f?.textureKey) textureKeys.add(f.textureKey);
			}
		} else {
			if (rotationAxisCount(el.rotation) >= 2) hasMultiAxis = true;
			for (const f of Object.values(el.faces)) {
				if (f?.textureKey) textureKeys.add(f.textureKey);
			}
		}
	}
	if (hasMesh) return true;
	if (mode === 'classic_java' && hasMultiAxis) return true;
	if (mode === 'bedrock' && textureKeys.size > 1) return true;
	return false;
}

/**
 * Element rotation → Java model JSON rotation field.
 *  - no rotation → undefined (omitted)
 *  - new_java with (multi-axis or any angle >45°) → {x,y,z,origin} (1.21.11+ multi-axis rotation)
 *  - otherwise single-axis → {angle,axis,origin} (axis = the only non-zero axis)
 */
export function rotationToJava(
	rotation: Vec3 | undefined,
	origin: Vec3 | undefined,
	mode: ExportMode
): { angle?: number; axis?: 'x' | 'y' | 'z'; x?: number; y?: number; z?: number; origin: Vec3 } | undefined {
	if (rotationAxisCount(rotation) === 0) return undefined;
	const o: Vec3 = origin ? [...origin] : [0, 0, 0];
	const axisIdx = rotation!.findIndex((v) => v !== 0);
	if (mode === 'new_java' && (rotationAxisCount(rotation) > 1 || rotation!.some((v) => Math.abs(v) > 45))) {
		return { x: rotation![0], y: rotation![1], z: rotation![2], origin: o };
	}
	return {
		angle: rotation![axisIdx],
		axis: (axisIdx === 0 ? 'x' : axisIdx === 1 ? 'y' : 'z') as 'x' | 'y' | 'z',
		origin: o,
	};
}

/** Track-shape group id → exported model file name; null means the group is not exported separately */
export const TRACK_MODEL_FILES: Record<string, string | null> = {
	// z_ortho is not exported: blockstates express shape=zo by rotating x_ortho 90°
	z_ortho: null,
	x_ortho: 'x_ortho.json',
	diag: 'diag.json',
	diag_2: 'diag_2.json',
	ascending_south: 'ascending.json',
	ascending_north: null,
	ascending_east: null,
	ascending_west: null,
	teleport: 'teleport.json',
	teleport_x: null,
	cross_ortho: 'cross_ortho.json',
	cross_diag: 'cross_diag.json',
	// cross_d1_xo / cross_d2_xo are both "diagonal + Z straight"; zo directions are blockstate 90° rotations
	cross_d1_xo: 'cross_d1_xo.json',
	cross_d1_zo: null,
	cross_d2_xo: 'cross_d2_xo.json',
	cross_d2_zo: null,
	tie: 'tie.json',
	segment_left: 'segment_left.json',
	segment_right: 'segment_right.json',
};

/**
 * Strips the 「（…）」/「(…)」 display suffix from a group name to get the shape id
 * (z_ortho (Z straight track) → z_ortho).
 */
export function cleanGroupName(name: string): string {
	return name.split(/[（(]/)[0].trim();
}

/** Export file name for a shape id; null for unknown ids / non-exported shapes */
export function modelFileName(id: string): string | null {
	return TRACK_MODEL_FILES[id] ?? null;
}

export function blockstatesFileName(trackId: string): string {
	return `${trackId}_track.json`;
}

/**
 * Texture resource name: strips the extension, lowercases, replaces non-[a-z0-9_] with `_`, and ensures
 * uniqueness within `used` (appending _1 / _2 … on collision).
 */
export function textureResourceName(name: string, used: Set<string>): string {
	const raw = String(name || 'texture')
		.replace(/\.[a-z0-9]+$/i, '')
		.toLowerCase()
		.replace(/[^a-z0-9_]/g, '_');
	const base = raw || 'texture';
	let out = base;
	let i = 1;
	while (used.has(out)) out = `${base}_${i++}`;
	used.add(out);
	return out;
}

/**
 * In-model texture resource path: {namespace}:{texture resource path}/{resName}.
 * The texture resource path (e.g. block/track/{trackId}) defaults to block/track/{trackId}
 * (Create/Kuayue convention).
 */
export function textureResourcePath(namespace: string, trackId: string, resName: string, texturePath?: string): string {
	return `${namespace}:${texturePath ?? `block/track/${trackId}`}/${resName}`;
}

/**
 * Track-shape blockstate shape key → model file name (+ y rotation).
 * Follows the Create/Kuayue track block convention (see assets/tracks/meter blockstates):
 *  - zo (Z straight) → x_ortho rotated 90° (z_ortho model not generated separately)
 *  - cross xo / zo directions are expressed via 90° rotations of cross_d1_xo / cross_d2_xo
 *    (both geometries are "diagonal + Z straight": cross_d1_xo = negative diagonal, cross_d2_xo = positive)
 *    cr_pdx→cross_d1_xo y:90, cr_pdz→cross_d2_xo y:180,
 *    cr_ndx→cross_d2_xo y:270, cr_ndz→cross_d1_xo y:0
 */
const BLOCKSTATE_SHAPES: { shape: string; model: string; y?: number }[] = [
	{ shape: 'zo', model: 'x_ortho', y: 90 },
	{ shape: 'xo', model: 'x_ortho' },
	{ shape: 'pd', model: 'diag' },
	{ shape: 'nd', model: 'diag_2' },
	{ shape: 'an', model: 'ascending', y: 180 },
	{ shape: 'as', model: 'ascending', y: 0 },
	{ shape: 'ae', model: 'ascending', y: 270 },
	{ shape: 'aw', model: 'ascending', y: 90 },
	{ shape: 'tn', model: 'teleport', y: 180 },
	{ shape: 'ts', model: 'teleport', y: 0 },
	{ shape: 'te', model: 'teleport', y: 270 },
	{ shape: 'tw', model: 'teleport', y: 90 },
	{ shape: 'cr_o', model: 'cross_ortho' },
	{ shape: 'cr_d', model: 'cross_diag' },
	{ shape: 'cr_pdx', model: 'cross_d1_xo', y: 90 },
	{ shape: 'cr_pdz', model: 'cross_d2_xo', y: 180 },
	{ shape: 'cr_ndx', model: 'cross_d2_xo', y: 270 },
	{ shape: 'cr_ndz', model: 'cross_d1_xo' },
];

/**
 * Builds the track's blockstates JSON object. Variants combine shape × turn × waterlogged (matching
 * Create's track block states); shape=none points at the air model, the rest point at
 * {namespace}:{model resource path}/{model} (default block/track/{trackId}). modelPath is the model
 * resource path (pass it for custom model export paths) so references follow.
 */
export function buildBlockstates(
	namespace: string,
	trackId: string,
	modelPath?: string
): { variants: Record<string, { model: string; y?: number }> } {
	const variants: Record<string, { model: string; y?: number }> = {};
	const dir = modelPath ?? `block/track/${trackId}`;
	for (const turn of [false, true]) {
		for (const waterlogged of [false, true]) {
			const suffix = `,turn=${turn},waterlogged=${waterlogged}`;
			variants[`shape=none${suffix}`] = { model: 'minecraft:block/air' };
			for (const s of BLOCKSTATE_SHAPES) {
				const v: { model: string; y?: number } = { model: `${namespace}:${dir}/${s.model}` };
				if (s.y) v.y = s.y;
				variants[`shape=${s.shape}${suffix}`] = v;
			}
		}
	}
	return { variants };
}

// ── Java model JSON (classic / 1.21.11+ new format) ──────────────────────────

/** Single cube → Java JSON element (UV converted from pixels to the 16-unit system) */
function cubeToJavaElement(
	cube: ExportCubeData,
	texIndex: Record<string, string>,
	sizeOf: Record<string, [number, number]>,
	fallbackSize: [number, number],
	mode: ExportMode
): Record<string, unknown> {
	const el: Record<string, any> = { from: [...cube.from], to: [...cube.to] };
	const rot = rotationToJava(cube.rotation, cube.origin, mode);
	if (rot) el.rotation = rot;
	const faces: Record<string, any> = {};
	for (const [dir, f] of Object.entries(cube.faces)) {
		if (!f) continue;
		const out: Record<string, any> = {};
		if (f.uv) {
			const size = f.textureKey && sizeOf[f.textureKey] ? sizeOf[f.textureKey] : fallbackSize;
			out.uv = [f.uv[0] * (16 / size[0]), f.uv[1] * (16 / size[1]), f.uv[2] * (16 / size[0]), f.uv[3] * (16 / size[1])];
		}
		if (f.rotation) out.rotation = f.rotation;
		if (f.textureKey && texIndex[f.textureKey] !== undefined) out.texture = `#${texIndex[f.textureKey]}`;
		faces[dir] = out;
	}
	el.faces = faces;
	return el;
}

/**
 * Builds the Java model JSON:
 *  - new_java: adds format_version "1.21.11", multi-axis rotation {x,y,z}
 *  - classic_java: no format_version (matching Create/Kuayue examples), single-axis rotation only
 * The passed elements must already be eligible cubes (meshes fell back to OBJ).
 */
export function buildJavaModelJson(opts: {
	mode: ExportMode;
	elements: ExportElement[];
	textures: ExportTexture[];
	textureSize: [number, number];
	namespace: string;
	trackId: string;
	/** texture key → resource directory (default block/track/{trackId}) */
	texturePathOf?: Record<string, string>;
}): Record<string, unknown> {
	const texIndex: Record<string, string> = {};
	const texMap: Record<string, string> = {};
	opts.textures.forEach((t, i) => {
		texIndex[t.key] = String(i);
		texMap[String(i)] = textureResourcePath(opts.namespace, opts.trackId, t.resName, opts.texturePathOf?.[t.key]);
	});
	const sizeOf: Record<string, [number, number]> = Object.fromEntries(opts.textures.map((t) => [t.key, [t.width, t.height]]));
	const elements = opts.elements
		.filter((el): el is ExportCubeData & { type: 'cube' } => el.type === 'cube')
		.map((el) => cubeToJavaElement(el, texIndex, sizeOf, opts.textureSize, opts.mode));
	const json: Record<string, any> = {};
	if (opts.mode === 'new_java') json.format_version = '1.21.11';
	json.credit = 'Made with Blockbench';
	json.ambientocclusion = false;
	json.texture_size = [opts.textureSize[0], opts.textureSize[1]];
	json.render_type = 'cutout_mipped';
	json.textures = texMap;
	json.elements = elements;
	const first = Object.values(texMap)[0];
	if (first) json.textures.particle = first;
	return json;
}

// ── OBJ (single merged mesh, at the root) ───────────────────────────────────

/** Cube's 8 corners (0-7): whether each coord takes from(0) or to(1) — matching Blockbench's getGlobalVertexPositions order */
const OBJ_CUBE_VERTEX_PICK: [number, number, number][] = [
	[1, 1, 1], [1, 1, 0], [1, 0, 1], [1, 0, 0],
	[0, 1, 0], [0, 1, 1], [0, 0, 0], [0, 0, 1],
];

/** Face direction → the 4 corners forming it (1-based, indexing OBJ_CUBE_VERTEX_PICK) */
const OBJ_FACE_CORNERS: Record<CubeFaceDirection, number[]> = {
	north: [2, 5, 7, 4],
	east: [1, 2, 4, 3],
	south: [6, 1, 3, 8],
	west: [5, 6, 8, 7],
	up: [5, 2, 1, 6],
	down: [8, 3, 4, 7],
};

/** The world coordinate of a cube's idx-th corner (px; includes the rotation about origin) */
function objCorner(cube: ExportCubeData, idx: number): Vec3 {
	const pick = OBJ_CUBE_VERTEX_PICK[idx];
	const v: Vec3 = [pick[0] ? cube.to[0] : cube.from[0], pick[1] ? cube.to[1] : cube.from[1], pick[2] ? cube.to[2] : cube.from[2]];
	if (!cube.rotation || cube.rotation.every((r) => r === 0)) return v;
	const origin = cube.origin ?? [0, 0, 0];
	const rel: Vec3 = [v[0] - origin[0], v[1] - origin[1], v[2] - origin[2]];
	const r = rotateVec(rel, cube.rotation);
	return [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]];
}

/** Face UV → 4 vt lines (pixels / texture size, v flipped to bottom; rotated 90° steps per face.rotation) */
function objFaceVt(face: ExportFaceData, size: [number, number]): string[] {
	const W = size[0] || 16;
	const H = size[1] || 16;
	const uv = face.uv ?? [0, 0, W, H];
	const J = [
		`vt ${uv[0] / W} ${1 - uv[1] / H}`,
		`vt ${uv[2] / W} ${1 - uv[1] / H}`,
		`vt ${uv[2] / W} ${1 - uv[3] / H}`,
		`vt ${uv[0] / W} ${1 - uv[3] / H}`,
	];
	let a = face.rotation || 0;
	while (a > 0) {
		J.splice(0, 0, J.pop()!);
		a -= 90;
	}
	return J;
}

/** Outward normal from three triangle points (f row order) */
function triNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
	const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
	return [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
}

/**
 * Bakes a group's elements into a single merged OBJ + MTL:
 *  - vertex coords in px/16 (block units); vt pixel/size with v flipped; vn from triangle outward normals
 *  - a single `o` object for the whole file (no per-element o / no g groups) at the root — the Forge
 *    loader can read it as one mesh
 *  - textures distinguished via usemtl m_<key>; MTL with one newmtl + map_Kd {ns}:block/track/{id}/{res}
 *    per texture
 */
export function buildObj(opts: {
	elements: ExportElement[];
	textures: ExportTexture[];
	sizeOf: Record<string, [number, number]>;
	namespace: string;
	trackId: string;
	/** MTL file name (for the mtllib line), default materials.mtl */
	mtlName?: string;
	/** texture key → resource directory (default block/track/{trackId}) */
	texturePathOf?: Record<string, string>;
}): { obj: string; mtl: string } {
	const resOf: Record<string, string> = Object.fromEntries(opts.textures.map((t) => [t.key, t.resName]));
	const objLines: string[] = [`# Made in Blockbench`, `mtllib ${opts.mtlName ?? 'materials.mtl'}`];
	const mtlLines: string[] = ['# Made in Blockbench'];
	const mtlKeys = new Set<string>();
	let vIdx = 0;
	let vtIdx = 0;
	let vnIdx = 0;
	let currentMtl: string | null = null;

	const pushV = (p: Vec3) => {
		objLines.push(`v ${p[0] / 16} ${p[1] / 16} ${p[2] / 16}`);
		return ++vIdx;
	};
	const pushVn = (a: Vec3, b: Vec3, c: Vec3) => {
		const n = triNormal(a, b, c);
		const len = Math.hypot(n[0], n[1], n[2]) || 1;
		objLines.push(`vn ${n[0] / len} ${n[1] / len} ${n[2] / len}`);
		return ++vnIdx;
	};
	const useMtl = (key: string) => {
		if (key !== currentMtl) {
			objLines.push(`usemtl m_${key}`);
			currentMtl = key;
		}
		mtlKeys.add(key);
	};
	const fmt = (n: number) => String(n);

	for (const el of opts.elements) {
		if (el.type === 'cube') {
			const baseV = vIdx;
			const corners: Vec3[] = [];
			for (let c = 0; c < 8; c++) {
				const p = objCorner(el, c);
				corners.push(p);
				pushV(p);
			}
			for (const [dir, face] of Object.entries(el.faces)) {
				if (!face || !face.textureKey) continue;
				const O = OBJ_FACE_CORNERS[dir as CubeFaceDirection];
				const size = opts.sizeOf[face.textureKey] ?? [16, 16];
				const baseVt = vtIdx;
				for (const t of objFaceVt(face, size)) {
					objLines.push(t);
					vtIdx++;
				}
				// The two triangles share the same normal (coplanar)
				const vn = pushVn(corners[O[2] - 1], corners[O[1] - 1], corners[O[0] - 1]);
				useMtl(face.textureKey);
				objLines.push(`f ${fmt(baseV + O[2] - 1)}/${fmt(baseVt + 3)}/${fmt(vn)} ${fmt(baseV + O[1] - 1)}/${fmt(baseVt + 2)}/${fmt(vn)} ${fmt(baseV + O[0] - 1)}/${fmt(baseVt + 1)}/${fmt(vn)}`);
				objLines.push(`f ${fmt(baseV + O[3] - 1)}/${fmt(baseVt + 4)}/${fmt(vn)} ${fmt(baseV + O[2] - 1)}/${fmt(baseVt + 3)}/${fmt(vn)} ${fmt(baseV + O[0] - 1)}/${fmt(baseVt + 1)}/${fmt(vn)}`);
			}
		} else {
			// mesh: vertices + faces merged into the same root object
			const vertGlobal: Record<string, number> = {};
			for (const [id, pos] of Object.entries(el.vertices)) vertGlobal[id] = pushV(pos);
			for (const face of Object.values(el.faces)) {
				if (!face || !face.textureKey || face.vertices.length < 3) continue;
				const size = opts.sizeOf[face.textureKey] ?? [16, 16];
				const vtLocal: number[] = [];
				face.vertices.forEach((vId, i) => {
					let u = 0;
					let v = 0;
					const raw = face.uv as unknown;
					if (Array.isArray(raw)) {
						const first = raw[0];
						if (Array.isArray(first)) {
							const p = first[i];
							u = p?.[0] ?? 0;
							v = p?.[1] ?? 0;
						} else {
							u = (raw as number[])[i * 2] ?? 0;
							v = (raw as number[])[i * 2 + 1] ?? 0;
						}
					} else if (raw) {
						const p = (raw as Record<string, number[]>)[vId];
						u = p?.[0] ?? 0;
						v = p?.[1] ?? 0;
					}
					objLines.push(`vt ${u / (size[0] || 16)} ${1 - v / (size[1] || 16)}`);
					vtLocal.push(++vtIdx);
				});
				const pts = face.vertices.map((vId) => el.vertices[vId]);
				const vn = pushVn(pts[0], pts[1], pts[2]);
				useMtl(face.textureKey);
				for (let k = 1; k + 1 < face.vertices.length; k++) {
					objLines.push(`f ${fmt(vertGlobal[face.vertices[0]])}/${fmt(vtLocal[0])}/${fmt(vn)} ${fmt(vertGlobal[face.vertices[k]])}/${fmt(vtLocal[k])}/${fmt(vn)} ${fmt(vertGlobal[face.vertices[k + 1]])}/${fmt(vtLocal[k + 1])}/${fmt(vn)}`);
				}
			}
		}
	}

	for (const key of mtlKeys) {
		mtlLines.push(`newmtl m_${key}`, `map_Kd ${textureResourcePath(opts.namespace, opts.trackId, resOf[key] ?? key, opts.texturePathOf?.[key])}`);
	}
	mtlLines.push('newmtl none');
	return { obj: objLines.join('\n'), mtl: mtlLines.join('\n') };
}

/** forge:obj reference JSON (.obj model + flip_v + textures), matching the Create/Kuayue examples */
export function buildObjReferenceJson(opts: {
	namespace: string;
	trackId: string;
	shape: string;
	textures: ExportTexture[];
	/** texture key → resource directory (default block/track/{trackId}) */
	texturePathOf?: Record<string, string>;
	/** Model resource path (the path part of {namespace}:path/file used by blockstate references; default block/track/{trackId}) */
	modelPath?: string;
}): Record<string, unknown> {
	const texMap: Record<string, string> = {};
	opts.textures.forEach((t, i) => {
		texMap[String(i)] = textureResourcePath(opts.namespace, opts.trackId, t.resName, opts.texturePathOf?.[t.key]);
	});
	const json: Record<string, any> = {
		loader: 'forge:obj',
		ambientocclusion: false,
		flip_v: true,
		render_type: 'cutout_mipped',
		model: `${opts.namespace}:models/${opts.modelPath ?? `block/track/${opts.trackId}`}/${opts.shape}.obj`,
		textures: texMap,
	};
	const first = Object.values(texMap)[0];
	if (first) json.textures.particle = first;
	return json;
}

// ── Bedrock geometry ────────────────────────────────────────────────────────

/**
 * Builds a group's cubes into a minecraft:geometry block model.
 * Following Blockbench o6/r6: cube origin[0] negated (X mirror), pivot = rotation origin (X-mirrored)
 * with rx/ry of the rotation negated when rotated; per-face uv (uv + uv_size + uv_rotation), with
 * up/down faces uv+=size and size negated. The passed elements must already be eligible cubes
 * (mesh / multi-texture shapes fell back to OBJ).
 */
export function buildBedrockGeometry(opts: {
	identifier: string;
	elements: ExportElement[];
	textureSize: [number, number];
}): Record<string, unknown> {
	const cubes: any[] = [];
	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;
	for (const el of opts.elements) {
		if (el.type !== 'cube') continue;
		const size: [number, number, number] = [el.to[0] - el.from[0], el.to[1] - el.from[1], el.to[2] - el.from[2]];
		const bcube: any = { origin: [-(el.from[0] + size[0]), el.from[1], el.from[2]], size };
		if (el.rotation && el.rotation.some((v) => v !== 0)) {
			bcube.pivot = el.origin ? [-(el.origin[0] as number), el.origin[1], el.origin[2]] : [0, 0, 0];
			bcube.rotation = [-(el.rotation[0] ?? 0), -(el.rotation[1] ?? 0), el.rotation[2] ?? 0];
		}
		const uv: Record<string, any> = {};
		for (const [dir, f] of Object.entries(el.faces)) {
			if (!f || !f.textureKey) continue;
			const u1 = f.uv?.[0] ?? 0;
			const v1 = f.uv?.[1] ?? 0;
			const u2 = f.uv?.[2] ?? 0;
			const v2 = f.uv?.[3] ?? 0;
			const entry: any = { uv: [u1, v1], uv_size: [u2 - u1, v2 - v1] };
			if (f.rotation) entry.uv_rotation = f.rotation;
			if (dir === 'up' || dir === 'down') {
				entry.uv[0] += entry.uv_size[0];
				entry.uv[1] += entry.uv_size[1];
				entry.uv_size[0] *= -1;
				entry.uv_size[1] *= -1;
			}
			uv[dir] = entry;
		}
		if (Object.keys(uv).length) bcube.uv = uv;
		cubes.push(bcube);
		minX = Math.min(minX, el.from[0]);
		minY = Math.min(minY, el.from[1]);
		minZ = Math.min(minZ, el.from[2]);
		maxX = Math.max(maxX, el.to[0]);
		maxY = Math.max(maxY, el.to[1]);
		maxZ = Math.max(maxZ, el.to[2]);
	}
	const w = Math.max(maxX - minX, maxZ - minZ, 1);
	const h = Math.max(maxY - minY, 1);
	const geometry = {
		description: {
			identifier: opts.identifier,
			texture_width: opts.textureSize[0],
			texture_height: opts.textureSize[1],
			visible_bounds_width: w,
			visible_bounds_height: h,
			visible_bounds_offset: [0, (minY + maxY) / 2, 0],
		},
		bones: [{ name: opts.identifier.replace(/^geometry\./, ''), pivot: [0, 0, 0], cubes }],
	};
	return { format_version: '1.21.0', 'minecraft:geometry': [geometry] };
}

/**
 * Bedrock block definitions (blocks.json, at the behavior pack root; legacy aggregated format).
 * One block per shape: identifier {ns}:{trackId}_{shape}, geometry + material_instances pointing at
 * that shape's texture. texturePath is the resource path relative to the textures/ directory (written
 * to textures/{texturePath}.png → "{texturePath}").
 */
export function buildBedrockBlocksJson(opts: {
	namespace: string;
	trackId: string;
	shapes: { id: string; texturePath: string }[];
}): Record<string, unknown> {
	const blocks: Record<string, unknown> = {};
	for (const s of opts.shapes) {
		const id = `${opts.namespace}:${opts.trackId}_${s.id}`;
		blocks[id] = {
			sound: 'metal',
			textures: s.texturePath,
			geometry: `geometry.${opts.trackId}_${s.id}`,
		};
	}
	return { format_version: '1.21.0', blocks };
}
