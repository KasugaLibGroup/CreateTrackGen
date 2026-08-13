/**
 * 零件模型解析与归一化。
 *
 * 把 .bbmodel 的 elements 或当前项目的选中元素统一解析成 PartModel，
 * 并做归一化：底面 y 平移到 0，模型的对称点平移到 (0,0)。
 * 纯函数，可在 Node 中单测（传入 JSON 结构的 elements）。
 *
 * 对称点的确定依据模型格式（用户规定）：
 *  - Java Block/Item（java_block / java_item）：画布 0..16，原点在角上，对称点 (8,8)
 *  - 其他格式（generic/free 等）：原点即画布中心，对称点 (0,0)
 * 这样 Java 模式下零件可以在 0..16 画布内做大，而不必受"关于零点对称"的尺寸限制。
 */

import type { CubeFaceDirection, CubeSpec, MeshFaceSpec, MeshSpec, PartModel, SourceTexture, Vec3 } from './types';

/** element 的旋转：Blockbench .bbmodel 的数组形式 [rx, ry, rz] 或旧式对象形式 */
export type ElementRotation =
	| [number, number, number]
	| { angle?: number; axis?: 'x' | 'y' | 'z'; origin?: [number, number, number] };

/** 体块元素（type='cube' 或缺省）：from/to + 六面 */
export interface RawCubeElement {
	name?: string;
	type?: 'cube';
	from: [number, number, number];
	to: [number, number, number];
	rotation?: ElementRotation;
	/** 数组形式旋转时，origin 是 rotation 的同级字段（不是旋转对象内部的字段） */
	origin?: [number, number, number];
	faces?: Partial<Record<CubeFaceDirection, { uv?: [number, number, number, number]; rotation?: number; texture?: string | number }>>;
}

/** 网格元素（type='mesh'）：顶点表 + 面表。面的 texture 是纹理数组下标（同 cube） */
export interface RawMeshElement {
	name?: string;
	type: 'mesh';
	vertices?: Record<string, [number, number, number]>;
	/** mesh 面：uv 是顶点 UV 列表（数组或对象均可，透传不解析） */
	faces?: Record<string, { vertices?: string[]; uv?: number[] | Record<string, any>; rotation?: number; texture?: string | number }>;
	origin?: [number, number, number];
	rotation?: [number, number, number];
}

/** .bbmodel 文件中最小的 element 结构（cube 或 mesh） */
export type RawElement = RawCubeElement | RawMeshElement;

/** 判断 element 是否为 mesh 组 */
export function isMeshElement(el: RawElement): el is RawMeshElement {
	return (el as RawMeshElement).type === 'mesh';
}

/** .bbmodel 的 textures 数组元素 */
export interface RawTexture {
	name?: string;
	/** 纹理 id（面里用 texture 字段引用它） */
	id?: string | number;
	/** base64 data URL 或桌面文件路径 */
	source?: string;
	uv_width?: number;
	uv_height?: number;
}

export interface RawBbModel {
	meta?: { model_format?: string; texture_size?: [number, number] };
	/** Blockbench 5 的模型分辨率（纹理尺寸），加载时写入 Project.texture_width/height */
	resolution?: { width?: number; height?: number };
	elements?: RawElement[];
	textures?: RawTexture[];
}

/**
 * 根据模型格式返回对称点（xz 平面，y 记 0）。
 * Java Block/Item → (8,8)；其他 → (0,0)。
 */
export function symmetryPointForFormat(format: string | undefined): Vec3 {
	if (format === 'java_block' || format === 'java_item') {
		return [8, 0, 8];
	}
	return [0, 0, 0];
}

/**
 * 生成到某格式工作区时，把「居中于原点」的几何平移到画布对称点所需的偏移，
 * 是导入归一化（symmetryPointForFormat）的逆操作：
 *  - Java Block/Item → (8, 8)：模型在 0..16 画布内以 (8,8) 为对称轴，保证导出对称正确
 *  - 其他格式 → (0, 0)：原点即画布中心，无需平移
 */
export function outputOffsetForFormat(format: string | undefined): Vec3 {
	return symmetryPointForFormat(format);
}

/**
 * 把单个 element 转成 CubeSpec。
 * .bbmodel 里的 rotation 有两种形式，都要支持：
 *  - 数组形式 [rx, ry, rz]（Blockbench 标准导出格式），origin 为 rotation 的同级字段；
 *  - 对象形式 { angle, axis, origin }（旧式 / Java 模型 JSON 格式）。
 * 此前只解析对象形式，导致带数组旋转的零件（如 [0,-90,0] 的钢轨）导入时方向被丢弃。
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
				// 面引用的源纹理 id 统一为字符串 key，供 assembly 层映射到导入的 Texture
				texture: f.texture !== undefined && f.texture !== null ? String(f.texture) : undefined,
			};
		}
		spec.faces = faces;
	}
	return spec;
}

/** 解析 .bbmodel JSON 的 elements → CubeSpec[]（只保留 cube 元素，mesh 跳过） */
export function elementsToCubeSpecs(elements: RawElement[]): CubeSpec[] {
	return elements.filter((el) => !isMeshElement(el)).map((el) => elementToCubeSpec(el));
}

/**
 * 从 elements 提取 mesh 组（type='mesh'），转成 MeshSpec[]。
 * 面的 texture 引用（数组下标 / uuid）统一为字符串 key，与 cube 面约定一致，
 * 供 scopeTextureKeys 与 assembly 层映射到导入的 Texture。
 */
/** 绕 X/Y/Z 轴的向量旋转（角度制），顺序 X→Y→Z（与 Minecraft/Blockbench Cube.rotation 一致）。
 * 与 transform.ts 的 rotateVec 相同；为避免 parts↔transform 循环依赖，此处内联。 */
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
 * 把 mesh 的 origin（世界锚点）与 rotation 烘焙进顶点，origin/rotation 置空。
 *
 * Blockbench 渲染 mesh 时 `position.set(origin)`，即世界坐标 = origin + R(rotation)·vertices，
 * 顶点的 origin 是局部偏移。若不烘焙，后续 normalize / translateMesh 同时平移 origin 和 vertices
 * 会对含非零 origin 的 mesh（如 java 模型的 origin (8,8,8)）造成**双重位移**。
 * 烘焙后 origin 置空、vertices 成为世界坐标，mesh 与 cube（from/to 即世界坐标）行为一致。
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
		// 世界坐标 = origin + R(rotation)·vertices：先转 rotation，再加 origin
		const r = hasRot ? rotatePoint([v[0], v[1], v[2]], rot!) : ([v[0], v[1], v[2]] as Vec3);
		vertices[k] = [r[0] + ox, r[1] + oy, r[2] + oz] as Vec3;
	}
	return { ...mesh, vertices, origin: undefined, rotation: undefined };
}

export function extractMeshes(elements: RawElement[]): MeshSpec[] {
	const out: MeshSpec[] = [];
	for (const el of elements) {
		if (!isMeshElement(el)) continue;
		const faces: Record<string, MeshFaceSpec> = {};
		for (const [id, f] of Object.entries(el.faces ?? {})) {
			if (!f) continue;
			faces[id] = {
				vertices: f.vertices ? [...f.vertices] : [],
				// uv 透传（数组或对象均可），不在这里展开，创建 Mesh 时原样交还 Blockbench
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

/** 计算 CubeSpec[] 的包围盒（考虑 from/to，不含 rotation） */
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

/** 计算 MeshSpec[] 的包围盒（遍历全部顶点；顶点已烘焙为世界坐标，origin 已置空） */
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

/** 零件（cube + mesh）的合并包围盒 */
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

/** 平移 mesh 的所有顶点与 origin */
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
 * 把 CubeSpec[]（+ 可选 mesh）归一化为 PartModel。
 * - 底面 y 平移到 0：所有 y 减 bbox.min.y
 * - 对称点平移到 (0,0)：所有 x 减 symmetry[0]、z 减 symmetry[2]
 *   （symmetry 未提供时，回退为按包围盒横向中心自动居中，保持向后兼容）
 * - mesh 顶点与 origin 用同一偏移平移（保证 cube 与 mesh 相对位置不变）
 * 返回新的 CubeSpec（不污染入参）。
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
 * 从 .bbmodel 的 textures 数组提取源纹理与纹理分辨率。
 *
 * 关键：.bbmodel 里 element 的面用 `texture` 字段引用的是**纹理数组的下标**，
 * 不是纹理的 id（Blockbench 加载器 `Texture.all[face.texture]`）。因此这里把
 * 源纹理的 key 设为数组下标（String(index)），与 `elementToCubeSpec` 归一化出的
 * 面纹理引用对齐，assembly 层才能把面纹理解析到导入的 Texture。
 *
 * 分辨率优先级：resolution → meta.texture_size → 全部纹理共享的 uv 尺寸 → undefined。
 * 无纹理（或 source 缺失）的模型返回空数组、尺寸 undefined。
 */
export function parseBbTextures(json: RawBbModel): { textureSize?: [number, number]; textures: SourceTexture[] } {
	const raws = json.textures ?? [];
	const textures: SourceTexture[] = [];
	raws.forEach((t, i) => {
		if (!t.source) return;
		textures.push({
			key: String(i),
			name: t.name ?? `texture_${i}`,
			source: t.source,
			width: t.uv_width ?? 16,
			height: t.uv_height ?? 16,
		});
	});
	let textureSize: [number, number] | undefined;
	if (json.resolution?.width && json.resolution?.height) {
		textureSize = [json.resolution.width, json.resolution.height];
	} else if (json.meta?.texture_size && json.meta.texture_size.length === 2) {
		textureSize = [json.meta.texture_size[0], json.meta.texture_size[1]];
	} else if (textures.length > 0) {
		const w = textures[0].width;
		const h = textures[0].height;
		if (textures.every((t) => t.width === w && t.height === h)) {
			textureSize = [w, h];
		}
	}
	return { textureSize, textures };
}

/**
 * 检查多个零件（左轨 / 右轨 / 枕木）的纹理分辨率是否一致。
 * 全部零件都有定义且相同的 [w, h] 时返回该尺寸，否则返回 null（应拒绝生成）。
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
 * 给零件的源纹理 key 加前缀，使三个零件（左轨 / 右轨 / 枕木）的纹理 key 全局唯一。
 *
 * 背景：.bbmodel 面的 texture 引用是纹理数组下标（0、1…），每个零件都从 0 开始，
 * 若直接用下标当 key，三份零件会在「源 key → 导入 Texture」映射里互相覆盖，
 * 导致所有体块都贴到最后导入的那张纹理。加前缀（如 L/0、R/0、T/0）后各自唯一。
 *
 * cube 面的 texture 与 mesh 面的 texture 一并同步改写。返回同一个 PartModel（就地改写）。
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
 * 根据输入零件是否含 mesh 组决定新工作区的模型格式：
 *  - 任一零件含 mesh → 'generic'（自由模型，只有它能容纳 mesh 组）
 *  - 全为 cube → Java 方块/物品模型（当前项目为 java_item 则用 java_item，否则 java_block）
 */
export function targetFormatForParts(parts: { hasMesh?: boolean }[], currentFormat?: string): string {
	if (parts.some((p) => p.hasMesh)) return 'generic';
	return currentFormat === 'java_item' ? 'java_item' : 'java_block';
}

/** 解析 .bbmodel JSON → PartModel（自动归一化，对称点由 meta.model_format 决定），附带纹理信息 */
export function parseBbModel(json: RawBbModel, format?: string): PartModel {
	const fmt = format ?? json.meta?.model_format;
	const elements = json.elements ?? [];
	const part = normalize(elementsToCubeSpecs(elements), symmetryPointForFormat(fmt), extractMeshes(elements));
	const tex = parseBbTextures(json);
	part.textureSize = tex.textureSize;
	part.textures = tex.textures;
	return part;
}

/**
 * 从元素列表提取零件（.bbmodel 的 elements 或某个标签页选中的元素）。
 * format 为来源模型格式（如 Project.format.id / 标签页格式），决定对称点；缺省按其他格式 (0,0)。
 * 传入的 elements 已是最小 element 结构（由 UI 层从 OutlinerElement 转换而来）。
 */
export function extractFromElements(elements: RawElement[], format?: string): PartModel {
	return normalize(elementsToCubeSpecs(elements), symmetryPointForFormat(format), extractMeshes(elements));
}
