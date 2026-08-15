/**
 * Assembly layer — converts the logic layer's ShapeSpec[] into real Blockbench Cube/Group objects.
 * This is the only module in the project that imports Cube / Group (depends on the Blockbench global
 * API).
 */

import { computeBBox, outputOffsetForFormat } from '../logic/parts';
import { bakePartAxisAligned, translate } from '../logic/transform';
import { orientTiePerpendicular } from '../logic/generator';
import type { CubeSpec, MeshSpec, PartModel, ShapeSpec, TrackConfig, Vec3 } from '../logic/types';

/**
 * Single CubeSpec → Blockbench Cube. Faces are passed through (uv / rotation / texture); rotation is
 * expressed with 3-axis angles (degrees) + origin. With textureByKey set, face source texture keys are
 * resolved to the Texture imported into the new workspace.
 */
function specToCube(spec: CubeSpec, textureByKey?: Map<string, Texture>): Cube {
	const options: any = {
		name: spec.name,
		from: [...spec.from],
		to: [...spec.to],
		autouv: 0,
	};
	if (spec.rotation) options.rotation = [...spec.rotation];
	if (spec.origin) options.origin = [...spec.origin];
	if (spec.faces) {
		const faces: any = {};
		for (const [dir, f] of Object.entries(spec.faces)) {
			if (!f) continue;
			const face: any = {};
			if (f.uv) face.uv = [...f.uv];
			if (f.rotation) face.rotation = f.rotation;
			if (f.texture && textureByKey) {
				const tex = textureByKey.get(f.texture);
				if (tex) face.texture = tex;
			}
			faces[dir] = face;
		}
		options.faces = faces;
	}
	return new Cube(options);
}

/**
 * Attaches all of a shape's Cubes to the given Group. When offset is non-zero, the origin-centered
 * geometry is translated to the canvas symmetry point (Java canvas center (8,8)), so the exported
 * model's symmetry axis is correct (inverse of the import normalization).
 */
function appendShape(group: Group, shape: ShapeSpec, offset: Vec3 = [0, 0, 0], textureByKey?: Map<string, Texture>): Cube[] {
	const cubes: Cube[] = [];
	for (const spec of shape.cubes) {
		const s = offset[0] === 0 && offset[2] === 0 ? spec : translate([spec], offset)[0];
		const cube = specToCube(s, textureByKey).init();
		cube.addTo(group);
		cubes.push(cube);
	}
	return cubes;
}

/** Translates a mesh: vertices and origin shifted together by the given offset */
function translateMesh(mesh: MeshSpec, offset: Vec3): MeshSpec {
	const [dx, dy, dz] = offset;
	return {
		...mesh,
		origin: mesh.origin ? [mesh.origin[0] + dx, mesh.origin[1] + dy, mesh.origin[2] + dz] as Vec3 : mesh.origin,
		vertices: Object.fromEntries(
			Object.entries(mesh.vertices).map(([k, v]) => [k, [v[0] + dx, v[1] + dy, v[2] + dz] as Vec3])
		),
	};
}

/**
 * Single MeshSpec → Blockbench Mesh. Faces are passed through (vertices / uv / rotation); face source
 * texture keys are resolved to the Texture imported into the new workspace. Used to move the input
 * parts' mesh groups into the new workspace's base groups (tie / segment_left / segment_right).
 */
function specToMesh(spec: MeshSpec, textureByKey?: Map<string, Texture>): Mesh {
	const faces: any = {};
	for (const [id, f] of Object.entries(spec.faces)) {
		if (!f) continue;
		const face: any = {};
		if (f.vertices?.length) face.vertices = [...f.vertices];
		if (f.uv) face.uv = f.uv;
		if (f.rotation) face.rotation = f.rotation;
		if (f.texture && textureByKey) {
			const tex = textureByKey.get(f.texture);
			if (tex) face.texture = tex;
		}
		faces[id] = face;
	}
	const options: any = {
		name: spec.name,
		type: 'mesh',
		vertices: spec.vertices,
		faces,
	};
	if (spec.origin) options.origin = [...spec.origin];
	if (spec.rotation) options.rotation = [...spec.rotation];
	return new Mesh(options);
}

/**
 * Base-group rail geometry: the cube part is axis-aligned-baked first (rails along Z, ties across X),
 * the mesh part is kept as-is (cannot be baked). Returns the xMid and z bounds needed for positioning.
 */
function baseRailGeometry(part: PartModel): { cubes: CubeSpec[]; meshes: MeshSpec[]; xMid: number; zMin: number } {
	if (part.cubes.length) {
		const baked = bakePartAxisAligned(part);
		return { cubes: baked.cubes, meshes: part.meshes ?? [], xMid: baked.xMid, zMin: baked.bbox.min[2] };
	}
	return { cubes: [], meshes: part.meshes ?? [], xMid: part.xMid, zMin: part.bbox.min[2] };
}

/** Base-group tie geometry: cube part baked + turned across X (same as placeTies); mesh kept as-is */
function baseTieGeometry(part: PartModel): { cubes: CubeSpec[]; meshes: MeshSpec[]; xMid: number; zCenter: number } {
	if (part.cubes.length) {
		const oriented = orientTiePerpendicular(bakePartAxisAligned(part));
		const bbox = computeBBox(oriented);
		return {
			cubes: oriented,
			meshes: part.meshes ?? [],
			xMid: (bbox.min[0] + bbox.max[0]) / 2,
			zCenter: (bbox.min[2] + bbox.max[2]) / 2,
		};
	}
	return { cubes: [], meshes: part.meshes ?? [], xMid: part.xMid, zCenter: (part.bbox.min[2] + part.bbox.max[2]) / 2 };
}

/**
 * Moves the three track parts into the new workspace as base groups: segment_left / segment_right /
 * tie. Create's curve rendering uses these three models (tie.obj / segment_left.obj /
 * segment_right.obj); each group holds all of its part's elements (cube volumes + mesh groups) and is
 * attached under the track parent group parent, alongside the directional shapes, for standalone
 * export.
 *
 * Layout = the "near-the-x-axis half" track unit of the z_ortho straight track (no output-format
 * offset):
 *  - segment_left / segment_right: the rail model's own center (xz(8,8) for Java, (0,0) for other
 *    formats) is zeroed on x (offset.x = -xMid), the near z end rests on the xy plane (z from 0, an
 *    8px segment's center z=4), and the rail bottom is lifted to rail height + whole-model Y offset.
 *    Each rail is pivoted at its own center (Create's segment_left.obj / segment_right.obj likewise
 *    center at x=0; the game positions them at ±gauge/2 when rendering).
 *  - tie: moved to the first tie position near the x axis of z_ortho (z=4 = tie interval / 2),
 *    centered at x=0, bottom face only offset by the whole-model Y offset (not lifted).
 */
export function buildBaseParts(
	parent: Group,
	parts: { left: PartModel; right: PartModel; tie: PartModel },
	config: TrackConfig,
	textureByKey?: Map<string, Texture>
): Group[] {
	const height = config.heightPx;
	const yoff = config.wholeModelYOffset ?? 0;
	/** z of the first tie near the x axis of z_ortho (= tie interval / 2, default 4) */
	const TIE_Z = 4;

	const left = baseRailGeometry(parts.left);
	const right = baseRailGeometry(parts.right);
	const tie = baseTieGeometry(parts.tie);

	const defs: { name: string; cubes: CubeSpec[]; meshes: MeshSpec[]; offset: Vec3 }[] = [
		{
			name: 'segment_left',
			cubes: left.cubes,
			meshes: left.meshes,
			offset: [-left.xMid, height + yoff, -left.zMin],
		},
		{
			name: 'segment_right',
			cubes: right.cubes,
			meshes: right.meshes,
			offset: [-right.xMid, height + yoff, -right.zMin],
		},
		{
			name: 'tie',
			cubes: tie.cubes,
			meshes: tie.meshes,
			offset: [-tie.xMid, yoff, TIE_Z - tie.zCenter],
		},
	];
	return defs.map(({ name, cubes, meshes, offset }) => {
		const group = new Group({ name }).init();
		group.addTo(parent);
		for (const spec of cubes) {
			const s = offset[0] === 0 && offset[1] === 0 && offset[2] === 0 ? spec : translate([spec], offset)[0];
			specToCube(s, textureByKey).init().addTo(group);
		}
		for (const mesh of meshes) {
			const m = offset[0] === 0 && offset[1] === 0 && offset[2] === 0 ? mesh : translateMesh(mesh, offset);
			specToMesh(m, textureByKey).init().addTo(group);
		}
		return group;
	});
}

/**
 * Generates all shapes under a parent Group (named after the current workspace, default 'track'). Each
 * shape is one child Group (named by TrackShape id). When the output workspace is a Java Block/Item
 * model, the whole geometry is translated to xz (8,8) so the model stays symmetric about the canvas
 * center (same normalization convention as import). With textureByKey set, the parts' source textures
 * are applied to the corresponding cube faces (left/right/tie each get their own texture). Returns
 * the parent Group.
 */
export function buildAllShapes(shapes: ShapeSpec[], textureByKey?: Map<string, Texture>): Group {
	const format = (Project as any).format?.id as string | undefined;
	const offset = outputOffsetForFormat(format);
	// Parent group name = current workspace name (consistent with export lookup by workspace name),
	// default 'track'
	const parentName = String((Project as any).name || '').trim() || 'track';
	const parent = new Group({ name: parentName }).init();
	for (const shape of shapes) {
		const sub = new Group({ name: shape.name, origin: [0, 0, 0] }).init();
		sub.addTo(parent);
		appendShape(sub, shape, offset, textureByKey);
	}
	return parent;
}

/**
 * Converts Blockbench elements (Cube/Group/Mesh) into the logic layer's RawElement[], for part
 * parsing. Used when extracting a part from the current project.
 */
export function elementsToRaw(elements: (Cube | Group | Mesh)[]): import('../logic/parts').RawElement[] {
	const raws: import('../logic/parts').RawElement[] = [];
	for (const el of elements) {
		if (el instanceof Cube) {
			const raw: import('../logic/parts').RawElement = {
				name: el.name,
				from: [...el.from] as [number, number, number],
				to: [...el.to] as [number, number, number],
			};
			const rot = el.rotation as [number, number, number] | undefined;
			if (rot && rot.some((v) => v !== 0)) {
				// Keep the full 3-axis rotation (array form) + sibling origin, corresponding to
				// parts.elementToCubeSpec's parsing
				raw.rotation = [...rot] as [number, number, number];
				if (el.origin) raw.origin = [...el.origin] as [number, number, number];
			}
			const faces: any = {};
			for (const [dir, face] of Object.entries(el.faces)) {
				if (!face) continue;
				const f: any = {};
				if (face.uv) f.uv = [...face.uv];
				if (face.rotation) f.rotation = face.rotation;
				// Face texture UUID, for part-texture extraction and import mapping
				if (face.texture) f.texture = face.texture;
				faces[dir] = f;
			}
			if (Object.keys(faces).length) raw.faces = faces;
			raws.push(raw);
		} else if (el instanceof Mesh) {
			// Mesh element: serialize via Blockbench's getSaveCopy (vertices/faces/origin/rotation);
			// face textures are uuids (not indices), collected as source textures by extractSelectedPart
			const save = el.getSaveCopy();
			const faces: any = {};
			for (const [id, f] of Object.entries((save.faces ?? {}) as Record<string, any>)) {
				if (!f) continue;
				const out: any = {};
				if (f.vertices) out.vertices = [...f.vertices];
				if (f.uv) out.uv = f.uv;
				if (f.rotation) out.rotation = f.rotation;
				if (f.texture != null && f.texture !== false) out.texture = String(f.texture);
				faces[id] = out;
			}
			raws.push({
				name: el.name,
				type: 'mesh',
				vertices: save.vertices ?? {},
				faces,
				origin: save.origin ? [...save.origin] as [number, number, number] : undefined,
				rotation: save.rotation ? [...save.rotation] as [number, number, number] : undefined,
			});
		} else if (el instanceof Group) {
			// Recurse into the Group's children
			raws.push(...elementsToRaw(el.children as (Cube | Group | Mesh)[]));
		}
	}
	return raws;
}
