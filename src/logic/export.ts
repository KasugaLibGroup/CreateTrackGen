/**
 * 导出约定 —— 纯逻辑，把轨道大组下的分组映射成 Create/Kuayue 的模型文件命名，
 * 并生成对应的 blockstates JSON。零依赖，可在 Node 中单测。
 *
 * 命名参考 assets/tracks/standard/：
 *  - 模型：models/block/track/{轨道id}/{形状}.json（z_ortho / x_ortho / diag / diag_2 /
 *    ascending / teleport / cross_* / tie / segment_left / segment_right）
 *  - blockstates：blockstates/track_and_bogey/{轨道id}_track.json
 *  - 纹理：textures/block/track/{轨道id}/{资源名}.png，模型内引用 {命名空间}:block/track/{id}/{资源名}
 *
 * 约定：
 *  - ascending 只有 s 变体（ascending_south）导出为 ascending.json，其余方向由
 *    blockstates 的 y 旋转表达（an=180 / as=0 / ae=270 / aw=90）。
 *  - teleport 只有 z 方向（teleport）导出为 teleport.json，teleport_x 不导出
 *    （blockstates 用 y 旋转表达所有方向，与 Create/Kuayue 一致）。
 *
 * 四种导出模式（见 EXPORT_MODES）：
 *  - new_java   （1.21.11+）：format_version "1.21.11"，支持多轴旋转 {x,y,z}
 *  - classic_java（1.21.11-）：不加 format_version（匹配 assets 示例），仅单轴旋转
 *  - bedrock     ：minecraft:geometry 方块几何
 *  - obj         ：全部烘焙为单一合并网格的 OBJ
 * 无法导出的元素回退 OBJ（判定见 groupNeedsObj）。
 */

import type { CubeFaceDirection, Vec3 } from './types';
import { rotateVec } from './transform';
import { t } from '../i18n';

/** 导出模式 */
export type ExportMode = 'new_java' | 'classic_java' | 'bedrock' | 'obj';

/** 导出模式元数据：id / 标签 / 判定说明（标签与说明经 i18n 本地化） */
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
 * 平台无关的元素描述符：Blockbench 层从 live Cube / Mesh 抽取后传给纯函数。
 * 面纹理用稳定的 textureKey（Blockbench 层把 Texture 实例映射成 't0'/'t1'…）。
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
	/** 逐顶点 UV：数组（按 face.vertices 顺序）或对象（按顶点 id） */
	uv?: number[] | Record<string, number[]>;
	textureKey?: string;
}
export interface ExportMeshData {
	name?: string;
	vertices: Record<string, Vec3>;
	faces: Record<string, ExportMeshFaceData>;
}
export type ExportElement = ({ type: 'cube' } & ExportCubeData) | ({ type: 'mesh' } & ExportMeshData);

/** 一形状引用的纹理：key / 资源名 / 像素尺寸 / 位图（data URL） */
export interface ExportTexture {
	key: string;
	resName: string;
	width: number;
	height: number;
	/** base64 data URL（写 PNG 用；纯逻辑层不依赖） */
	dataUrl?: string;
}

/** 非零旋转轴的数量 */
function rotationAxisCount(rotation?: Vec3): number {
	return rotation ? rotation.filter((v) => v !== 0).length : 0;
}

/**
 * 判定一个分组在给定模式下是否「无法导出」而回退 OBJ：
 *  - obj 模式：全部回退
 *  - 任一 mesh 元素 → 回退（Java JSON / Bedrock cube 都无法表达三角面）
 *  - classic_java 且任一立方体多轴旋转 → 回退（经典格式元素只能单轴）
 *  - bedrock 且形状引用 >1 张纹理 → 回退（基岩版单几何体单纹理）
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
 * 元素旋转 → Java 模型 JSON 的 rotation 字段。
 *  - 无旋转 → undefined（不写）
 *  - new_java 且（多轴 或 任一角 >45°）→ {x,y,z,origin}（1.21.11+ 多轴旋转）
 *  - 否则单轴 → {angle,axis,origin}（axis = 唯一非零轴）
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

/** 轨道形状分组 id → 导出的模型文件名；null 表示该分组不单独导出 */
export const TRACK_MODEL_FILES: Record<string, string | null> = {
	// z_ortho 不导出：shape=zo 由 blockstates 用 x_ortho 旋转 90° 表达
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
	// cross_d1_xo / cross_d2_xo 都是「斜轨 + Z 直轨」，zo 方向由 blockstates 90° 旋转表达
	cross_d1_xo: 'cross_d1_xo.json',
	cross_d1_zo: null,
	cross_d2_xo: 'cross_d2_xo.json',
	cross_d2_zo: null,
	tie: 'tie.json',
	segment_left: 'segment_left.json',
	segment_right: 'segment_right.json',
};

/**
 * 分组名去掉「（…）」/「(…)」展示后缀，得到形状 id（z_ortho（Z 直轨）→ z_ortho、
 * z_ortho (Z straight track) → z_ortho）。
 */
export function cleanGroupName(name: string): string {
	return name.split(/[（(]/)[0].trim();
}

/** 由形状 id 取导出文件名；未知 id / 不导出返回 null */
export function modelFileName(id: string): string | null {
	return TRACK_MODEL_FILES[id] ?? null;
}

/** blockstates 文件名：{轨道id}_track.json */
export function blockstatesFileName(trackId: string): string {
	return `${trackId}_track.json`;
}

/**
 * 纹理资源名：去掉扩展名、小写、非 [a-z0-9_] 替换为 _，并保证在 used 内唯一
 * （重名时追加 _1 / _2 …）。
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
 * 模型内纹理资源路径：{命名空间}:{纹理资源路径}/{资源名}。
 * 纹理资源路径（如 block/track/{轨道id}）缺省为 block/track/{轨道id}（Create/Kuayue 惯例）。
 */
export function textureResourcePath(namespace: string, trackId: string, resName: string, texturePath?: string): string {
	return `${namespace}:${texturePath ?? `block/track/${trackId}`}/${resName}`;
}

/** 模型内纹理资源路径：{命名空间}:block/track/{轨道id}/{资源名}（保持旧签名，缺省资源路径） */
export function modelTexturePath(namespace: string, trackId: string, resName: string): string {
	return textureResourcePath(namespace, trackId, resName);
}

/**
 * 轨道形状在 blockstates 里的 shape 键 → 模型文件名（+ y 旋转）。
 * 与 Create/Kuayue 的 track 块约定一致（参考 assets/tracks/standard blockstates）。
 */
/**
 * 轨道形状在 blockstates 里的 shape 键 → 模型文件名（+ y 旋转）。
 * 与 Create/Kuayue 的 track 块约定一致（参考 assets/tracks/meter blockstates）：
 *  - zo（Z 直轨）→ x_ortho 旋转 90°（不单独生成 z_ortho 模型）
 *  - cross 的 xo / zo 方向都由 cross_d1_xo / cross_d2_xo 经 90° 旋转表达
 *    （模型几何都是「斜轨 + Z 直轨」：cross_d1_xo=负对角、cross_d2_xo=正对角）
 *    cr_pdx→cross_d1_xo y:90、cr_pdz→cross_d2_xo y:180、
 *    cr_ndx→cross_d2_xo y:270、cr_ndz→cross_d1_xo y:0
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
 * 生成轨道对应的 blockstates JSON 对象。
 * 变体组合 = shape × turn × waterlogged（与 Create 轨道块的状态一致），
 * shape=none 指向空气模型，其余指向 {命名空间}:{模型资源路径}/{模型}（缺省 block/track/{轨道id}）。
 * modelPath 为模型资源路径（如自定义模型导出路径时传入），保证引用跟随。
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

// ── Java 模型 JSON（经典 / 1.21.11+ 新格式）──────────────────────────

/** 单个立方体 → Java JSON element（UV 从像素换算为 16 单位制） */
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
 * 构建 Java 模型 JSON：
 *  - new_java：加 format_version "1.21.11"，多轴旋转 {x,y,z}
 *  - classic_java：不加 format_version（匹配 Create/Kuayue 示例），仅单轴旋转
 * 传入 elements 应为已判定可导出的立方体（mesh 已回退 OBJ）。
 */
export function buildJavaModelJson(opts: {
	mode: ExportMode;
	elements: ExportElement[];
	textures: ExportTexture[];
	textureSize: [number, number];
	namespace: string;
	trackId: string;
	/** texture key → 资源目录（缺省 block/track/{trackId}） */
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

// ── OBJ（单一合并网格，位于根下）─────────────────────────────────────

/** 立方体 8 个角（0-7）各坐标取 from(0) 还是 to(1) —— 与 Blockbench getGlobalVertexPositions 顺序一致 */
const OBJ_CUBE_VERTEX_PICK: [number, number, number][] = [
	[1, 1, 1], [1, 1, 0], [1, 0, 1], [1, 0, 0],
	[0, 1, 0], [0, 1, 1], [0, 0, 0], [0, 0, 1],
];

/** 面方向 → 组成该面的 4 个角（1 基，索引对应 OBJ_CUBE_VERTEX_PICK） */
const OBJ_FACE_CORNERS: Record<CubeFaceDirection, number[]> = {
	north: [2, 5, 7, 4],
	east: [1, 2, 4, 3],
	south: [6, 1, 3, 8],
	west: [5, 6, 8, 7],
	up: [5, 2, 1, 6],
	down: [8, 3, 4, 7],
};

/** 立方体第 idx 个角的世界坐标（px；含绕 origin 的旋转） */
function objCorner(cube: ExportCubeData, idx: number): Vec3 {
	const pick = OBJ_CUBE_VERTEX_PICK[idx];
	const v: Vec3 = [pick[0] ? cube.to[0] : cube.from[0], pick[1] ? cube.to[1] : cube.from[1], pick[2] ? cube.to[2] : cube.from[2]];
	if (!cube.rotation || cube.rotation.every((r) => r === 0)) return v;
	const origin = cube.origin ?? [0, 0, 0];
	const rel: Vec3 = [v[0] - origin[0], v[1] - origin[1], v[2] - origin[2]];
	const r = rotateVec(rel, cube.rotation);
	return [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]];
}

/** 面 UV → 4 条 vt（像素 / 纹理尺寸，v 翻到底部；按 face.rotation 90° 步进轮转） */
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

/** 由三角形三点（f 行顺序）算外法向 */
function triNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
	const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
	const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
	return [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
}

/**
 * 把一组的全部元素烘焙成单一合并网格的 OBJ + MTL：
 *  - 顶点坐标 px/16（方块单位）；vt 像素/尺寸且 v 翻底；vn 由三角形外法向计算
 *  - 整个文件只有一根 o 对象（无每元素 o / 无 g 分组），位于根下 —— Forge 加载器可整体读取
 *  - 纹理通过 usemtl m_<key> 区分，MTL 每张纹理一个 newmtl + map_Kd {ns}:block/track/{id}/{res}
 */
export function buildObj(opts: {
	elements: ExportElement[];
	textures: ExportTexture[];
	sizeOf: Record<string, [number, number]>;
	namespace: string;
	trackId: string;
	/** MTL 文件名（用于 mtllib 行），缺省 materials.mtl */
	mtlName?: string;
	/** texture key → 资源目录（缺省 block/track/{trackId}） */
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
				// 两个三角共用同一法线（共面）
				const vn = pushVn(corners[O[2] - 1], corners[O[1] - 1], corners[O[0] - 1]);
				useMtl(face.textureKey);
				objLines.push(`f ${fmt(baseV + O[2] - 1)}/${fmt(baseVt + 3)}/${fmt(vn)} ${fmt(baseV + O[1] - 1)}/${fmt(baseVt + 2)}/${fmt(vn)} ${fmt(baseV + O[0] - 1)}/${fmt(baseVt + 1)}/${fmt(vn)}`);
				objLines.push(`f ${fmt(baseV + O[3] - 1)}/${fmt(baseVt + 4)}/${fmt(vn)} ${fmt(baseV + O[2] - 1)}/${fmt(baseVt + 3)}/${fmt(vn)} ${fmt(baseV + O[0] - 1)}/${fmt(baseVt + 1)}/${fmt(vn)}`);
			}
		} else {
			// mesh：顶点 + 面并入同一根对象
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

/** forge:obj 引用 JSON（.obj 模型 + flip_v + textures），与 Create/Kuayue 示例一致 */
export function buildObjReferenceJson(opts: {
	namespace: string;
	trackId: string;
	shape: string;
	textures: ExportTexture[];
	/** texture key → 资源目录（缺省 block/track/{trackId}） */
	texturePathOf?: Record<string, string>;
	/** 模型资源路径（blockstates 引用用 {命名空间}:path/file 的 path；缺省 block/track/{trackId}） */
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

// ── 基岩版几何 ────────────────────────────────────────────────────────

/**
 * 把一组的立方体构建成 minecraft:geometry 方块模型。
 * 参考 Blockbench o6/r6：立方体 origin[0] 取反（X 镜像）、带旋转时 pivot=旋转原点（X 镜像）+
 * rotation 的 rx/ry 取反；per-face uv（uv + uv_size + uv_rotation），up/down 面 uv+=size、size 取反。
 * 传参 elements 应为已判定可导出的立方体（mesh / 多纹理形状已回退 OBJ）。
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
 * 基岩版方块定义（blocks.json，行为包根目录；legacy 聚合格式）。
 * 每形状一个块：identifier {ns}:{trackId}_{shape}，geometry + material_instances 指向该形状的纹理。
 * texturePath 是相对 textures/ 目录的资源路径（写入 textures/{texturePath}.png → "{texturePath}"）。
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
