/**
 * 轨道形状组装 —— 核心纯逻辑。
 *
 * 输入 TrackConfig（三零件 + 轨距 + 高度），输出全部 TrackShape 的 CubeSpec 集合。
 * 组装规则：
 *  - 直轨默认沿 Z 方向铺设在 xz 平面，左右钢轨中心在 x = ±轨距/2，整体抬升高度。
 *  - 轨道默认生成一个完整方块（16px）的长度，钢轨零件不足时沿 Z 平铺补足（Create
 *    的钢轨段是 8px 的半块段，一个方块需要两块）。
 *  - 其余形状由直轨经 rotation 派生（参考 Kuayue 的 diag_template/ascending_template，
 *    用 Cube.rotation + origin 表达，而非重算旋转后坐标）。
 * 纯函数，可在 Node 中单测。
 */

import { computeBBox } from './parts';
import { bakePartAxisAligned, bakeRotateY90, cloneCubes, lift, rotateVec, rotateX, rotateY, translate } from './transform';
import { t } from '../i18n';
import type { CubeFaceDirection, CubeSpec, FaceSpec, PartModel, ShapeSpec, TrackConfig, Vec3 } from './types';

/** 形状展示名：id + 本地化括号后缀（cleanGroupName 会去掉后缀取回 id） */
function shapeDisplay(id: string, descKey: string, vars?: string | number): string {
	return `${id}${t(descKey, vars)}`;
}

/** 生成配置：轨道长度与枕木间距 */
export interface GeneratorOptions {
	/** 轨道沿铺设方向的总长度（px），缺省为 16（一个完整方块） */
	length?: number;
	/** 枕木间距（px） */
	tieInterval?: number;
}

const DEFAULT_TIE_INTERVAL = 8;
/** 默认轨道长度：一个完整方块（16px） */
const DEFAULT_TRACK_LENGTH = 16;
/** 斜轨需要的枕木数 / 钢轨段数（Create 对角轨道用 3 段 8px 钢轨 + 3 根枕木覆盖方块对角） */
const DIAGONAL_TIE_COUNT = 3;

/** 斜轨长度：覆盖方块对角需要 3 段 / 3 枕木（默认 3×8=24px，直轨 16px 的 1.5 倍） */
function diagonalLength(opts: GeneratorOptions): number {
	return DIAGONAL_TIE_COUNT * (opts.tieInterval ?? DEFAULT_TIE_INTERVAL);
}

/** 轨道铺设方向 */
export type TrackAxis = 'x' | 'z';

/**
 * 计算轨道沿铺设方向的跨度。缺省长度取 16（一个完整方块），并把轨道居中于原点
 * （z 从 -length/2 到 +length/2），保证旋转后的形状也以原点为中心。
 */
function trackSpan(cfg: TrackConfig, opts: GeneratorOptions = {}): { start: number; length: number } {
	const length = opts.length ?? DEFAULT_TRACK_LENGTH;
	return { start: -length / 2, length };
}

/**
 * 把零件沿 Z 轴平铺，覆盖 [start, start+length]。
 * 若零件本身不足一个轨道长度（如 Create 的 8px 半块钢轨段），会自动平铺补齐。
 * 用零件 bbox 的 z 最小值做对齐，因此零件是否居中不影响平铺结果。
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
 * 放置左右钢轨：左轨中心 x=-g/2、右轨 x=+g/2，整体抬升 heightPx。
 * 以零件归一化后的实际横向中心（xMid）为基准对齐，零件未精确居中时也不会错位。
 * 钢轨沿 Z 平铺覆盖整个轨道长度。
 * 先烘焙零件的轴对齐旋转（如 [0,-90,0]），使钢轨成为沿 Z 的普通盒子——否则派生形状
 * 叠加组旋转时会覆盖钢轨自身旋转，导致钢轨与枕木平行。
 */
export function placeRails(cfg: TrackConfig, opts: GeneratorOptions = {}): CubeSpec[] {
	const { gaugePx, heightPx, parts } = cfg;
	const half = gaugePx / 2;
	const { start, length } = trackSpan(cfg, opts);
	const left = bakePartAxisAligned(parts.left);
	const right = bakePartAxisAligned(parts.right);
	return [
		...lift(translate(tileAlongZ(left, start, length), [-half - left.xMid, 0, 0]), heightPx),
		...lift(translate(tileAlongZ(right, start, length), [half - right.xMid, 0, 0]), heightPx),
	];
}

/**
 * 确保枕木长轴跨 X（与沿 Z 铺设的钢轨垂直）。若枕木零件长轴沿 Z（与轨道平行），
 * 绕 Y 烘焙旋转 90° 使其跨 X；带自身旋转的零件信任其朝向（解析器已保留），不自动旋转。
 * 供 placeTies（轨道形状）与 buildBaseParts（弯道基础分组）共用。
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
 * 放置枕木：沿轨道方向（Z）从起点到终点按 tieInterval 循环铺。
 * 枕木横向居中（x=0）、纵向按自身中心对齐到铺设位置，长轴自动调整为跨 X（垂直钢轨）。
 * 注意：heightPx 是「钢轨距底面的高度」，只作用于钢轨，枕木不抬升、底部直接落在 xz 平面。
 */
export function placeTies(cfg: TrackConfig, opts: GeneratorOptions = {}): CubeSpec[] {
	const { parts } = cfg;
	const tieInterval = opts.tieInterval ?? DEFAULT_TIE_INTERVAL;
	const { start, length } = trackSpan(cfg, opts);
	// 先烘焙枕木自身的轴对齐旋转，再按视觉几何判断是否需要转成跨 X（垂直钢轨）
	const baked = bakePartAxisAligned(parts.tie);
	const tieBase = orientTiePerpendicular(baked);
	const tieCenterZ = (baked.bbox.min[2] + baked.bbox.max[2]) / 2;

	const ties: CubeSpec[] = [];
	for (let z = start + tieInterval / 2; z <= start + length; z += tieInterval) {
		ties.push(...translate(cloneCubes(tieBase), [0, 0, z - tieCenterZ]));
	}
	return ties;
}

/** 计算 CubeSpec[] 的包围盒中心 */
export function centerOf(cubes: CubeSpec[]): Vec3 {
	const bbox = computeBBox(cubes);
	return [
		(bbox.min[0] + bbox.max[0]) / 2,
		(bbox.min[1] + bbox.max[1]) / 2,
		(bbox.min[2] + bbox.max[2]) / 2,
	];
}

/**
 * 计算 CubeSpec[] 渲染（应用各自 rotation 后）的最低 y 坐标。
 * computeBBox 只读 from/to，忽略 rotation；带旋转的 cube（如 ascending 的 -45°X）
 * 的实际最低点需要把 8 个角点经 origin + R·(局部−origin) 换算到世界坐标。
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

/**
 * 直轨（沿 Z）：左右钢轨 + 枕木。
 */
export function straightZ(cfg: TrackConfig, opts: GeneratorOptions = {}): CubeSpec[] {
	return [...placeRails(cfg, opts), ...placeTies(cfg, opts)];
}

/**
 * 直轨（沿 X）：把 Z 直轨绕整组中心旋转 90°（Y 轴）。
 */
export function straightX(cfg: TrackConfig, opts: GeneratorOptions = {}): CubeSpec[] {
	const zs = straightZ(cfg, opts);
	return rotateY(zs, 90, centerOf(zs));
}

/** 直轨形状（x_ortho / z_ortho） */
export function straight(cfg: TrackConfig, axis: TrackAxis = 'z', opts: GeneratorOptions = {}): ShapeSpec {
	const cubes = axis === 'z' ? straightZ(cfg, opts) : straightX(cfg, opts);
	return {
		id: axis === 'z' ? 'z_ortho' : 'x_ortho',
		name: axis === 'z' ? shapeDisplay('z_ortho', 'ctg.shape.desc.z_ortho') : shapeDisplay('x_ortho', 'ctg.shape.desc.x_ortho'),
		cubes,
	};
}

/**
 * 45° 斜轨：把 Z 直轨绕整组中心绕 Y 旋转 ±45°。
 * diag = +45°（PD 正对角），diag_2 = -45°（ND 负对角）。
 * 斜轨覆盖方块对角，需要 3 段钢轨 / 3 根枕木（长度 = 3 × 枕木间距，默认 24px），
 * 而非直轨的 2 段 / 2 根（16px）。
 */
export function diagonal(cfg: TrackConfig, mirror: boolean, opts: GeneratorOptions = {}): ShapeSpec {
	const zs = straightZ(cfg, { ...opts, length: opts.length ?? diagonalLength(opts) });
	const angle = mirror ? -45 : 45;
	const rotated = rotateY(zs, angle, centerOf(zs));
	return {
		id: mirror ? 'diag_2' : 'diag',
		name: mirror ? shapeDisplay('diag_2', 'ctg.shape.desc.diag_2') : shapeDisplay('diag', 'ctg.shape.desc.diag'),
		cubes: rotated,
	};
}

/**
 * 上升轨道：把 Z 直轨绕 X 轴旋转 -45°，枢轴在轨道中心（xz 平面即 Java 模型的
 * 方块中心 (8,8)），轨道绕方块中心整体倾斜。yaw 决定朝向（blockstate：
 * south=0 / north=180 / east=270 / west=90）。
 *
 * 注意：倾斜与转向必须共用同一个枢轴。若用 centerOf 作为转向枢轴，会覆盖
 * 倾斜的枢轴，导致轨道绕整段中心倾斜（前段下沉、后段才抬升）——旋转错误。
 * Blockbench 的 Cube.rotation 按 Ry(yaw)·Rx(-45) 围绕同一 origin 合成，语义上即
 * 「先沿铺设方向倾斜，再整体转向」。
 * 枢轴取轨道 z 方向的中心（Java 画布 xz (8,8)），而非前缘 (8,0)：这样上升轨的
 * 旋转轴落在方块中心，与 Create/Kuayue 的 ascending_template 约定一致。
 *
 * 上升轨与斜轨一样覆盖更长的铺设距离：长度 = 3 × 枕木间距（默认 24px，3 段钢轨
 * / 3 根枕木），而非直轨的 16px（2 段 / 2 根）。
 *
 * 绕中心 -45° 倾斜后，轨道下端会沉入 xz 平面以下（下方枕木最低点 y<0）。
 * 用户可定义两个 y 方向偏移：heightPx（钢轨高度，straightZ 内已施加）与
 * wholeModelYOffset（整体 Y 偏移，allShapes 的 applyWholeOffset 在形状返回后统一施加）。
 * 这里抬升到「整体 Y 偏移生效之后」最低点恰好落在 xz 平面上（y≥0）：
 *  - 整体偏移 ≥0：抬到 0，随后整体再上升 wholeY（与其他形状一致）；
 *  - 整体偏移 <0：多抬 -wholeY，把整体下沉的 ascending 顶回平面。
 * lift 同时平移 from/to 与 origin，渲染几何整体均匀上移，倾斜形状保持不变。
 */
export function ascending(
	cfg: TrackConfig,
	dir: 'south' | 'north' | 'east' | 'west',
	opts: GeneratorOptions = {}
): ShapeSpec {
	const zs = straightZ(cfg, { ...opts, length: opts.length ?? diagonalLength(opts) });
	const bbox = computeBBox(zs);
	// 枢轴取轨道 xz 中心（Java 模式下即方块中心 (8,8)），Y 在轨道高度处
	const pivot: Vec3 = [
		(bbox.min[0] + bbox.max[0]) / 2,
		cfg.heightPx,
		(bbox.min[2] + bbox.max[2]) / 2,
	];
	const yaw: Record<string, number> = { south: 0, north: 180, east: 270, west: 90 };
	const tilted = rotateY(rotateX(zs, -45, pivot), yaw[dir], pivot);
	const wholeY = cfg.wholeModelYOffset ?? 0;
	let cubes = tilted;
	// 抬升量覆盖整体 Y 偏移：整体偏移为负时多抬，保证「整体偏移生效后」最低点 ≥ 0
	const need = -(renderedMinY(cubes) + Math.min(0, wholeY));
	if (need > 0) cubes = lift(cubes, need);
	// 兜底：浮点误差下最终最低点（含整体偏移）仍 <0 再补抬升
	const finalMin = renderedMinY(cubes) + wholeY;
	if (finalMin < 0) cubes = lift(cubes, -finalMin);
	return {
		id: `ascending_${dir}`,
		name: `ascending_${dir}${t('ctg.shape.desc.ascending', t('ctg.dir.' + dir))}`,
		cubes,
	};
}

/**
 * 计算枕木的横向半宽与顶部高度（烘焙自身旋转 + 必要时转成跨 X 后）。
 * 传送门覆层按这个范围把枕木左/右半边包住（不包含钢轨）。
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
 * 把一组 Cube 的所有面纹理替换为指定源 key（保留原 UV），
 * 用于 teleport 形状：轨道/枕木统一铺 portal_track。
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

/**
 * 生成两个传送门覆层块（teleport_left / teleport_right）。
 *
 * 结构参考 Create 原版 teleport.json（assets/teleport.json）：整个模型铺 portal_track，
 * 两个覆层（原模型 cube5 / cube6）贴 portal_track_mip。覆层把枕木左/右半边包住
 * （各包半边），不包含钢轨（钢轨在枕木上方独立生成，覆层不覆盖它），贴 mip 纹理
 * （全纹理铺满各面）。覆层沿铺设方向铺满整段轨道，尺寸取枕木包围盒 + 包覆余量。
 * 返回 null 表示未配置传送门覆层（cfg.portal 未提供），teleport() 退化为纯直轨。
 */
function buildPortalOverlays(cfg: TrackConfig, opts: GeneratorOptions = {}): CubeSpec[] | null {
	const portal = cfg.portal;
	if (!portal?.mipTexture) return null;
	const { halfW, top } = tieWrapExtent(cfg);
	if (!(halfW > 0)) return null;
	const m = portal.margin ?? 0.1;
	const { start, length } = trackSpan(cfg, opts);
	const z0 = start;
	const z1 = start + length;
	// 覆层顶 = 枕木顶 + 余量，但不高于钢轨底面（heightPx），保证不包含钢轨
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
 * 传送门轨道：两张纹理独立可选——
 *  - portal_track 提供时把轨道/枕木铺 portal_track（面纹理重映射，保留 UV）；
 *    缺省用零件自身默认纹理。
 *  - portal_track_mip 提供时生成两个覆层块（teleport_left / teleport_right）贴 mip；
 *    缺省不生成覆层块。
 * 两者都缺省时退化为纯直轨，与 z_ortho / x_ortho 完全一致。
 */
export function teleport(cfg: TrackConfig, axis: TrackAxis = 'z', opts: GeneratorOptions = {}): ShapeSpec {
	const zs = straightZ(cfg, opts);
	const portal = cfg.portal;
	let all = zs;
	// portal_track 可选：提供则轨道/枕木统一铺它，否则用零件默认纹理
	if (portal?.trackTexture) {
		all = remapAllFaces(all, portal.trackTexture);
	}
	// portal_track_mip 可选：提供则生成左右覆层块，否则不生成
	const overlays = buildPortalOverlays(cfg, opts) ?? [];
	all = [...all, ...overlays];
	const cubes = axis === 'x' ? rotateY(all, 90, centerOf(all)) : all;
	return {
		id: axis === 'x' ? 'teleport_x' : 'teleport',
		name: axis === 'x' ? shapeDisplay('teleport_x', 'ctg.shape.desc.teleport_x') : shapeDisplay('teleport', 'ctg.shape.desc.teleport'),
		cubes,
	};
}

/**
 * 十字交叉轨道。kind 对应 TrackShape：
 *  - ortho：Z 直轨 + X 直轨
 *  - diag：正斜轨 + 负斜轨
 *  - pd_zo：正斜轨 + Z 直轨  /  nd_zo：负斜轨 + Z 直轨
 *
 * 交叉模型只生成 xo 名字的两个文件（cross_d1_xo / cross_d2_xo），但几何都是
 * 「斜轨 + Z 直轨」：blockstates 里 xo / zo 方向都由它们经 90° 旋转表达（参考
 * Kuayue meter / guard 的 blockstates）。命名与 Create 相反：
 *   cross_d1_xo = 负对角 + Z 直轨，cross_d2_xo = 正对角 + Z 直轨
 * （Create/Kuayue 参考模型里 cross_d1 是负对角、cross_d2 是正对角）。
 */
export function cross(
	cfg: TrackConfig,
	kind: 'ortho' | 'diag' | 'pd_zo' | 'nd_zo',
	opts: GeneratorOptions = {}
): ShapeSpec {
	let cubes: CubeSpec[] = [];
	switch (kind) {
		case 'ortho':
			cubes = [...straightZ(cfg, opts), ...straightX(cfg, opts)];
			break;
		case 'diag': {
			// 对角交叉用斜轨长度（3 段 / 3 枕木）
			const zs = straightZ(cfg, { ...opts, length: opts.length ?? diagonalLength(opts) });
			const pos = rotateY(zs, 45, centerOf(zs));
			const neg = rotateY(zs, -45, centerOf(zs));
			cubes = [...pos, ...neg];
			break;
		}
		case 'pd_zo':
			cubes = [...diagonal(cfg, false, opts).cubes, ...straightZ(cfg, opts)];
			break;
		case 'nd_zo':
			cubes = [...diagonal(cfg, true, opts).cubes, ...straightZ(cfg, opts)];
			break;
	}
	const idMap: Record<string, string> = {
		ortho: 'cross_ortho',
		diag: 'cross_diag',
		pd_zo: 'cross_d2_xo',
		nd_zo: 'cross_d1_xo',
	};
	const nameMap: Record<string, string> = {
		ortho: shapeDisplay('cross_ortho', 'ctg.shape.desc.cross_ortho'),
		diag: shapeDisplay('cross_diag', 'ctg.shape.desc.cross_diag'),
		pd_zo: shapeDisplay('cross_d2_xo', 'ctg.shape.desc.cross_pd_zo'),
		nd_zo: shapeDisplay('cross_d1_xo', 'ctg.shape.desc.cross_nd_zo'),
	};
	return { id: idMap[kind], name: nameMap[kind], cubes };
}

/** 形状定义表：全部 TrackShape 的生成器 */
export interface ShapeDef {
	id: string;
	name: string;
	build: (cfg: TrackConfig, opts?: GeneratorOptions) => ShapeSpec;
}

/**
 * 对形状应用整体 Y 偏移（wholeModelYOffset）。
 * 抬升整个模型（含枕木、钢轨、传送门门框），连旋转枢轴（origin）一起平移。
 * 在 allShapes 统一施加，保证 16 种形状行为一致；各形状生成器保持"居中于原点"的纯几何输出。
 */
function applyWholeOffset(cfg: TrackConfig, shape: ShapeSpec): ShapeSpec {
	const dy = cfg.wholeModelYOffset ?? 0;
	if (dy === 0) return shape;
	return { ...shape, cubes: lift(shape.cubes, dy) };
}

/**
 * 生成全部 9 种轨道形状 —— 只生成 blockstates 需要引用的模型，多余的由旋转表达：
 *  - 不生成 z_ortho：shape=zo 由 x_ortho 旋转 90° 表达
 *  - 不生成 ascending_north/east/west：方向由 ascending_south 经 blockstates 的 y 旋转表达
 *  - 不生成 teleport_x：传送门 4 方向都由 teleport（Z 向）经 y 旋转表达
 *  - 不生成 cross_d1_zo / cross_d2_zo：cross 的 xo/zo 方向都由 cross_d1_xo / cross_d2_xo
 *    （都是「斜轨 + Z 直轨」）经 90° 旋转表达（见 src/logic/export.ts 的 BLOCKSTATE_SHAPES）
 * 弯道渲染基础分组 tie / segment_left / segment_right 由 buildBaseParts 单独创建。
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
		{ id: 'cross_d1_xo', name: 'cross_d1_xo', build: (c) => cross(c, 'nd_zo', opts) },
		{ id: 'cross_d2_xo', name: 'cross_d2_xo', build: (c) => cross(c, 'pd_zo', opts) },
	];
	return defs.map((d) => applyWholeOffset(cfg, d.build(cfg)));
}
