/**
 * Part model parsing & normalization.
 *
 * Parses a .bbmodel's elements or the current project's selected elements into a PartModel and
 * normalizes: the bottom face is translated to y = 0 and the model's symmetry point to (0,0).
 * Pure functions, Node-testable (pass JSON-structured elements).
 *
 * The symmetry point is decided by the model format (user-defined):
 *  - Java Block/Item (java_block / java_item): canvas 0..16, origin at a corner, symmetry (8,8)
 *  - other formats (generic/free etc.): origin is the canvas center, symmetry (0,0)
 * This lets Java-mode parts grow within the 0..16 canvas without the "symmetric about zero" limit.
 */

import type { CubeFaceDirection, CubeSpec, MeshFaceSpec, MeshSpec, PartModel, SourceTexture, Vec3 } from './types';

/** An element's rotation: Blockbench .bbmodel array form [rx, ry, rz] or legacy object form */
export type ElementRotation =
	| [number, number, number]
	| { angle?: number; axis?: 'x' | 'y' | 'z'; origin?: [number, number, number] };

/** A volume element (type='cube' or default): from/to + six faces */
export interface RawCubeElement {
	name?: string;
	type?: 'cube';
	from: [number, number, number];
	to: [number, number, number];
	rotation?: ElementRotation;
	/** For array-form rotation, origin is a sibling field of rotation (not inside the rotation object) */
	origin?: [number, number, number];
	faces?: Partial<Record<CubeFaceDirection, { uv?: [number, number, number, number]; rotation?: number; texture?: string | number }>>;
}

/** A mesh element (type='mesh'): vertex table + face table. Face texture is the texture-array index (as with cubes) */
export interface RawMeshElement {
	name?: string;
	type: 'mesh';
	vertices?: Record<string, [number, number, number]>;
	/** Mesh face: uv is a per-vertex UV list (array or object, passed through unparsed) */
	faces?: Record<string, { vertices?: string[]; uv?: number[] | Record<string, any>; rotation?: number; texture?: string | number }>;
	origin?: [number, number, number];
	rotation?: [number, number, number];
}

/** The minimal element structure in a .bbmodel file (cube or mesh) */
export type RawElement = RawCubeElement | RawMeshElement;

/** Whether the element is a mesh group */
export function isMeshElement(el: RawElement): el is RawMeshElement {
	return (el as RawMeshElement).type === 'mesh';
}

/** An entry of the .bbmodel textures array */
export interface RawTexture {
	name?: string;
	/** Texture id (referenced from faces via the `texture` field) */
	id?: string | number;
	/** Base64 data URL or desktop file path */
	source?: string;
	uv_width?: number;
	uv_height?: number;
}

export interface RawBbModel {
	meta?: { model_format?: string; texture_size?: [number, number] };
	/** Blockbench 5 model resolution (texture size), written to Project.texture_width/height on load */
	resolution?: { width?: number; height?: number };
	elements?: RawElement[];
	textures?: RawTexture[];
}

/**
 * Returns the symmetry point (xz plane, y=0) for a model format.
 * Java Block/Item → (8,8); other → (0,0).
 */
export function symmetryPointForFormat(format: string | undefined): Vec3 {
	if (format === 'java_block' || format === 'java_item') {
		return [8, 0, 8];
	}
	return [0, 0, 0];
}

/**
 * The translation needed to move origin-centered geometry to the canvas symmetry point when building
 * into a workspace of a given format — the inverse of the import normalization
 * (symmetryPointForFormat):
 *  - Java Block/Item → (8, 8): centers the model in the 0..16 canvas for correct export symmetry
 *  - other formats → (0, 0): origin is already the canvas center, no translation
 */
export function outputOffsetForFormat(format: string | undefined): Vec3 {
	return symmetryPointForFormat(format);
}

/**
 * Whether a model format is the generic / free model. The free model's valid id is 'free'; 'generic'
 * is the legacy name that older versions used (and which resolves to the free model). A workspace of
 * this format keeps origin-centered, non-canvas-aligned geometry — the Java/Bedrock block formats
 * can't express it faithfully, so export is restricted to OBJ.
 */
export function isFreeModelFormat(format: string | undefined): boolean {
	return format === 'free' || format === 'generic';
}

/**
 * Whether a model format gives each texture its own UV size — Blockbench's `Format.per_texture_uv_size`.
 * Only the free/generic model actually sets it true; java block/item, modded entity, bedrock, … keep UVs
 * in the shared resolution canvas (the flag defaults to false — see `js/io/format.ts`). The optional
 * `perTextureUv` override lets callers pass the real flag read from a live format object
 * (`Format.per_texture_uv_size` / `Formats[id].per_texture_uv_size`) instead of trusting the id heuristic.
 */
export function formatUsesPerTextureUv(format: string | undefined, perTextureUv?: boolean): boolean {
	if (perTextureUv !== undefined) return perTextureUv;
	return format === 'free' || format === 'generic';
}

/**
 * A texture's UV size, mirroring Blockbench's `Texture.getUVWidth()`: when per-texture UV is on the
 * texture's `uv_width` wins; otherwise the shared canvas (resolution) wins — so a texture whose
 * `uv_width` disagrees with the canvas can't mis-size the part (the "both tabs show 64×64 but the rail
 * exports as 16×16" bug). Both fall back to the other, then 16.
 */
export function textureUvSize(
	perTextureUv: boolean,
	tex: { uv_width?: number; uv_height?: number },
	canvas: [number, number] | undefined
): [number, number] {
	const cw = canvas?.[0];
	const ch = canvas?.[1];
	return perTextureUv
		? [tex.uv_width || cw || 16, tex.uv_height || ch || 16]
		: [cw || tex.uv_width || 16, ch || tex.uv_height || 16];
}

/**
 * The example rail / tie part geometry — a plain box sized after test/sample_parts
 * (test_rail: 2.4 wide × 2.8 tall × 8 long; test_tie: ~32 wide × ~4 tall × ~3.5 deep), centered at
 * the format's symmetry point (Java (8,8), others (0,0)), bottom face at y=0. Used by the
 * "Generate Example Rail/Tie" tools to drop a reference cube into the current workspace.
 */
export function examplePartBox(kind: 'rail' | 'tie', format?: string): { from: Vec3; to: Vec3 } {
	const [cx, , cz] = symmetryPointForFormat(format);
	if (kind === 'rail') {
		return { from: [cx - 1.2, 0, cz - 4], to: [cx + 1.2, 2.8, cz + 4] };
	}
	return { from: [cx - 16, 0, cz - 1.75], to: [cx + 16, 4, cz + 1.75] };
}

/**
 * Converts a single element to a CubeSpec.
 * .bbmodel rotation has two forms, both supported:
 *  - array form [rx, ry, rz] (Blockbench's standard export format), origin as a sibling field of rotation;
 *  - object form { angle, axis, origin } (legacy / Java model JSON format).
 * Previously only the object form was parsed, so parts with array rotations (e.g. rails with
 * [0,-90,0]) lost their orientation on import.
 */
export function elementToCubeSpec(el: RawElement): CubeSpec {
	const cube = el as RawCubeElement;
	const spec: CubeSpec = {
		name: cube.name,
		from: [...cube.from] as Vec3,
		to: [...cube.to] as Vec3,
	};
	const rot = cube.rotation;
	if (Array.isArray(rot)) {
		const r: Vec3 = [rot[0] ?? 0, rot[1] ?? 0, rot[2] ?? 0];
		if (r.some((v) => v !== 0)) {
			spec.rotation = r;
			if (cube.origin) spec.origin = [...cube.origin] as Vec3;
		}
	} else if (rot) {
		const { angle = 0, axis, origin } = rot;
		const r: Vec3 = [0, 0, 0];
		if (axis === 'x') r[0] = angle;
		else if (axis === 'y') r[1] = angle;
		else if (axis === 'z') r[2] = angle;
		if (r.some((v) => v !== 0)) {
			spec.rotation = r;
			if (origin) spec.origin = [...origin] as Vec3;
		}
	}
	if (cube.faces) {
		const faces: NonNullable<CubeSpec['faces']> = {};
		for (const [dir, f] of Object.entries(cube.faces)) {
			if (!f) continue;
			faces[dir as CubeFaceDirection] = {
				uv: f.uv ? [...f.uv] : undefined,
				rotation: f.rotation,
				// The face's source texture id is normalized to a string key for the assembly layer to map to the imported Texture
				texture: f.texture !== undefined && f.texture !== null ? String(f.texture) : undefined,
			};
		}
		spec.faces = faces;
	}
	return spec;
}

/** Parses .bbmodel elements → CubeSpec[] (cube elements only; meshes skipped) */
export function elementsToCubeSpecs(elements: RawElement[]): CubeSpec[] {
	return elements.filter((el) => !isMeshElement(el)).map((el) => elementToCubeSpec(el));
}

/**
 * Per-axis vector rotation (degrees), applied in X→Y→Z order (matching Minecraft/Blockbench
 * Cube.rotation). Identical to transform.ts's rotateVec; inlined here to avoid a parts↔transform
 * circular dependency.
 */
function rotatePointX(v: Vec3, deg: number): Vec3 {
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}
function rotatePointY(v: Vec3, deg: number): Vec3 {
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c];
}
function rotatePointZ(v: Vec3, deg: number): Vec3 {
	const a = (deg * Math.PI) / 180;
	const c = Math.cos(a);
	const s = Math.sin(a);
	return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}
function rotatePoint(v: Vec3, rot: Vec3): Vec3 {
	return rotatePointZ(rotatePointY(rotatePointX(v, rot[0]), rot[1]), rot[2]);
}

/**
 * Bakes a mesh's origin (world anchor) and rotation into its vertices, clearing origin/rotation.
 *
 * Blockbench renders a mesh as `position.set(origin)`, i.e. world = origin + R(rotation)·vertices,
 * so the vertices' origin is a local offset. Without baking, a later normalize / translateMesh that
 * shifts both origin and vertices would **double-shift** meshes with a non-zero origin (e.g. a Java
 * model's origin (8,8,8)). After baking, origin is cleared and vertices become world coordinates,
 * matching cube behavior (from/to are world coordinates).
 */
function bakeMeshTransform(mesh: MeshSpec): MeshSpec {
	const ox = mesh.origin?.[0] ?? 0;
	const oy = mesh.origin?.[1] ?? 0;
	const oz = mesh.origin?.[2] ?? 0;
	const rot = mesh.rotation;
	const hasOrigin = ox !== 0 || oy !== 0 || oz !== 0;
	const hasRot = !!rot && rot.some((n) => n !== 0);
	if (!hasOrigin && !hasRot) return mesh;
	const vertices: Record<string, Vec3> = {};
	for (const [k, v] of Object.entries(mesh.vertices)) {
		// world = origin + R(rotation)·vertices: rotate first, then add origin
		const r = hasRot ? rotatePoint([v[0], v[1], v[2]], rot!) : ([v[0], v[1], v[2]] as Vec3);
		vertices[k] = [r[0] + ox, r[1] + oy, r[2] + oz] as Vec3;
	}
	return { ...mesh, vertices, origin: undefined, rotation: undefined };
}

/**
 * Extracts mesh groups (type='mesh') from elements as MeshSpec[].
 * Face texture references (array index / uuid) are normalized to string keys, consistent with the
 * cube-face convention, so scopeTextureKeys and the assembly layer can map them to imported Textures.
 */
export function extractMeshes(elements: RawElement[]): MeshSpec[] {
	const out: MeshSpec[] = [];
	for (const el of elements) {
		if (!isMeshElement(el)) continue;
		const faces: Record<string, MeshFaceSpec> = {};
		for (const [id, f] of Object.entries(el.faces ?? {})) {
			if (!f) continue;
			faces[id] = {
				vertices: f.vertices ? [...f.vertices] : [],
				// uv is passed through (array or object); not expanded here, handed back to Blockbench unchanged on Mesh creation
				uv: f.uv !== undefined ? (f.uv as any) : undefined,
				rotation: f.rotation,
				texture: f.texture !== undefined && f.texture !== null ? String(f.texture) : undefined,
			};
		}
		out.push(
			bakeMeshTransform({
				name: el.name,
				vertices: el.vertices ?? {},
				faces,
				origin: el.origin ? [...el.origin] as Vec3 : undefined,
				rotation: el.rotation ? [...el.rotation] as Vec3 : undefined,
			})
		);
	}
	return out;
}

export function computeBBox(cubes: CubeSpec[]): { min: Vec3; max: Vec3 } {
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const c of cubes) {
		for (let i = 0; i < 3; i++) {
			min[i] = Math.min(min[i], c.from[i], c.to[i]);
			max[i] = Math.max(max[i], c.from[i], c.to[i]);
		}
	}
	return { min, max };
}

export function computeMeshBBox(meshes: MeshSpec[]): { min: Vec3; max: Vec3 } {
	const min: Vec3 = [Infinity, Infinity, Infinity];
	const max: Vec3 = [-Infinity, -Infinity, -Infinity];
	for (const m of meshes) {
		for (const v of Object.values(m.vertices)) {
			for (let i = 0; i < 3; i++) {
				min[i] = Math.min(min[i], v[i]);
				max[i] = Math.max(max[i], v[i]);
			}
		}
	}
	return { min, max };
}

export function partBBox(cubes: CubeSpec[], meshes: MeshSpec[] = []): { min: Vec3; max: Vec3 } {
	const cb = cubes.length ? computeBBox(cubes) : null;
	const mb = meshes.length ? computeMeshBBox(meshes) : null;
	if (cb && mb) {
		return {
			min: [Math.min(cb.min[0], mb.min[0]), Math.min(cb.min[1], mb.min[1]), Math.min(cb.min[2], mb.min[2])],
			max: [Math.max(cb.max[0], mb.max[0]), Math.max(cb.max[1], mb.max[1]), Math.max(cb.max[2], mb.max[2])],
		};
	}
	return cb ?? mb ?? { min: [0, 0, 0], max: [0, 0, 0] };
}

/** Shifts all mesh vertices and the origin */
function shiftMesh(mesh: MeshSpec, dx: number, dy: number, dz: number): MeshSpec {
	return {
		...mesh,
		origin: mesh.origin ? [mesh.origin[0] + dx, mesh.origin[1] + dy, mesh.origin[2] + dz] as Vec3 : mesh.origin,
		vertices: Object.fromEntries(
			Object.entries(mesh.vertices).map(([k, v]) => [k, [v[0] + dx, v[1] + dy, v[2] + dz] as Vec3])
		),
	};
}

/**
 * Normalizes CubeSpec[] (+ optional meshes) into a PartModel.
 * - bottom face to y = 0: all y minus bbox.min.y
 * - symmetry point to (0,0): all x minus symmetry[0], z minus symmetry[2]
 *   (falls back to automatic horizontal centering when symmetry is omitted, for backward compat)
 * - mesh vertices and origin shifted by the same offset (keeps cube↔mesh relative positions)
 * Returns new CubeSpecs (input is not mutated).
 */
export function normalize(cubes: CubeSpec[], symmetry?: Vec3, meshes: MeshSpec[] = []): PartModel {
	const bbox = partBBox(cubes, meshes);
	const sx = symmetry ? symmetry[0] : (bbox.min[0] + bbox.max[0]) / 2;
	const sz = symmetry ? symmetry[2] : 0;
	const dx = -sx;
	const dz = -sz;
	const dy = -bbox.min[1];

	const shifted = cubes.map((c) => ({
		...c,
		from: [c.from[0] + dx, c.from[1] + dy, c.from[2] + dz] as Vec3,
		to: [c.to[0] + dx, c.to[1] + dy, c.to[2] + dz] as Vec3,
		origin: c.origin ? [c.origin[0] + dx, c.origin[1] + dy, c.origin[2] + dz] as Vec3 : c.origin,
	}));
	const shiftedMeshes = meshes.map((m) => shiftMesh(m, dx, dy, dz));
	const outBBox = partBBox(shifted, shiftedMeshes);

	return {
		cubes: shifted,
		meshes: shiftedMeshes,
		hasMesh: meshes.length > 0,
		bbox: outBBox,
		xMid: (outBBox.min[0] + outBBox.max[0]) / 2,
	};
}

/**
 * Extracts source textures and the texture resolution from a .bbmodel textures array.
 *
 * Key point: in .bbmodel, faces reference textures via the `texture` field as an **array index**, not
 * the texture id (Blockbench loader: `Texture.all[face.texture]`). So source texture keys are set to
 * the array index (String(index)), aligning with the face-texture references produced by
 * elementToCubeSpec, so the assembly layer can resolve face textures to imported Textures.
 *
 * Canvas priority: resolution → meta.texture_size → undefined.
 * Each texture's UV size (width/height) is derived via textureUvSize (non-per-texture-UV formats → the
 * shared resolution canvas; free/mesh formats → per-texture uv_width) — never a hardcoded 16, otherwise
 * a java_block model whose textures carry no (or a disagreeing) uv_width collapses to 16×16 while the
 * model is 64×64, and the exported texture_size / UV conversion comes out wrong.
 * The part resolution mirrors that rule: for non-per-texture-UV formats it is the model resolution (the
 * canvas IS the UV size); for per-texture-UV formats it is the UV size shared by the textures — a free
 * model can have a 16×16 resolution yet 64×64 textures (what the UV editor / getUVWidth() reports), and
 * using the canvas there would mis-size the workspace and sample only a corner of the image.
 * Models with no textures (or missing sources) return an empty array and an undefined size.
 */
export function parseBbTextures(
	json: RawBbModel,
	perTextureUv?: boolean,
	format?: string
): { textureSize?: [number, number]; textures: SourceTexture[] } {
	const resolution: [number, number] | undefined =
		json.resolution?.width && json.resolution?.height
			? [json.resolution.width, json.resolution.height]
			: json.meta?.texture_size && json.meta.texture_size.length === 2
				? [json.meta.texture_size[0], json.meta.texture_size[1]]
				: undefined;
	const perUv = formatUsesPerTextureUv(format ?? json.meta?.model_format, perTextureUv);
	const raws = json.textures ?? [];
	const textures: SourceTexture[] = [];
	raws.forEach((t, i) => {
		if (!t.source) return;
		const [w, h] = textureUvSize(perUv, t, resolution);
		textures.push({
			key: String(i),
			name: t.name ?? `texture_${i}`,
			source: t.source,
			width: w,
			height: h,
		});
	});
	// The size shared by every texture, when they all agree; undefined otherwise / when none.
	const sharedSize = (): [number, number] | undefined => {
		if (textures.length === 0) return undefined;
		const w = textures[0].width;
		const h = textures[0].height;
		return textures.every((t) => t.width === w && t.height === h) ? [w, h] : undefined;
	};
	// Per-texture-UV: the canvas/resolution is NOT the UV size — the per-texture UV size wins.
	// Non-per-texture-UV: the canvas (resolution) IS the UV size. Either may fall back to the other.
	const textureSize: [number, number] | undefined = perUv ? sharedSize() ?? resolution : resolution ?? sharedSize();
	return { textureSize, textures };
}

/**
 * Checks whether all parts (left / right / tie) share the same texture resolution.
 * Returns that size when all are defined and equal, otherwise null (generation should be rejected).
 */
export function consistentTextureSize(parts: { textureSize?: [number, number] }[]): [number, number] | null {
	const size = parts[0]?.textureSize;
	if (!size) return null;
	for (const p of parts) {
		if (!p.textureSize || p.textureSize[0] !== size[0] || p.textureSize[1] !== size[1]) return null;
	}
	return size;
}

/**
 * Prefixes a part's source-texture keys so the three parts (left / right / tie) have globally unique
 * keys.
 *
 * Background: .bbmodel face texture references are array indices (0, 1…), and every part starts at 0.
 * Using the raw index as the key would make the three parts overwrite each other in the "source key →
 * imported Texture" map, so every volume would get the last-imported texture. Prefixing (L/0, R/0,
 * T/0) keeps them unique.
 *
 * Cube-face and mesh-face textures are rewritten together. Returns the same PartModel (mutated in place).
 */
export function scopeTextureKeys(part: PartModel, prefix: string): PartModel {
	const texKeys = new Map<string, string>();
	part.textures = (part.textures ?? []).map((t) => {
		const scoped = `${prefix}/${t.key}`;
		texKeys.set(t.key, scoped);
		return { ...t, key: scoped };
	});
	if (texKeys.size && part.cubes.length) {
		part.cubes = part.cubes.map((c) => {
			if (!c.faces) return c;
			const faces: NonNullable<CubeSpec['faces']> = {};
			for (const [dir, f] of Object.entries(c.faces)) {
				if (!f) continue;
				if (f.texture === undefined) {
					faces[dir as CubeFaceDirection] = f;
					continue;
				}
				const scoped = texKeys.get(f.texture);
				faces[dir as CubeFaceDirection] = scoped !== undefined ? { ...f, texture: scoped } : { ...f, texture: undefined };
			}
			return { ...c, faces };
		});
	}
	if (texKeys.size && part.meshes?.length) {
		part.meshes = part.meshes.map((m) => {
			const faces: Record<string, MeshFaceSpec> = {};
			for (const [id, f] of Object.entries(m.faces)) {
				if (f.texture === undefined) {
					faces[id] = f;
					continue;
				}
				const scoped = texKeys.get(f.texture);
				faces[id] = scoped !== undefined ? { ...f, texture: scoped } : { ...f, texture: undefined };
			}
			return { ...m, faces };
		});
	}
	return part;
}

/**
 * Decides the new workspace's model format from whether any input part contains mesh groups:
 *  - any part has mesh → 'free' (the free model, the only Blockbench format that can hold mesh groups)
 *  - all cubes → Java block/item model (java_item if the current project is java_item, else java_block)
 *
 * Note: the free model's format id is 'free' (not 'generic'). createTrackWorkspace resolves the id
 * against the runtime Formats registry anyway, so any stale 'generic' id is still mapped to the free
 * model.
 */
export function targetFormatForParts(parts: { hasMesh?: boolean }[], currentFormat?: string): string {
	if (parts.some((p) => p.hasMesh)) return 'free';
	return currentFormat === 'java_item' ? 'java_item' : 'java_block';
}

/** Parses .bbmodel JSON → PartModel (auto-normalized; symmetry point from meta.model_format), with texture info attached */
export function parseBbModel(json: RawBbModel, format?: string, perTextureUv?: boolean): PartModel {
	const fmt = format ?? json.meta?.model_format;
	const elements = json.elements ?? [];
	const part = normalize(elementsToCubeSpecs(elements), symmetryPointForFormat(fmt), extractMeshes(elements));
	const tex = parseBbTextures(json, perTextureUv, fmt);
	part.textureSize = tex.textureSize;
	part.textures = tex.textures;
	return part;
}

/**
 * Extracts a part from an element list (a .bbmodel's elements or a tab's selected elements).
 * format is the source model format (e.g. Project.format.id / tab format) and decides the symmetry
 * point; defaults to (0,0) for other formats. The passed elements must already be the minimal element
 * structure (converted by the UI layer from OutlinerElements).
 */
export function extractFromElements(elements: RawElement[], format?: string): PartModel {
	return normalize(elementsToCubeSpecs(elements), symmetryPointForFormat(format), extractMeshes(elements));
}
