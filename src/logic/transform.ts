/**
 * 几何变换 —— 纯函数，操作 CubeSpec[]。
 * 与 Blockbench 解耦：平移直接改 from/to/origin；旋转返回带 rotation 字段的 CubeSpec，
 * 由 assembly 层用 Cube.rotation 表达。
 */

import { computeBBox, partBBox } from './parts';
import type { CubeFaceDirection, CubeSpec, FaceSpec, MeshSpec, PartModel, Vec3 } from './types';

/** 深拷贝 CubeSpec 列表，避免污染原始零件 */
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

/** 平移所有 Cube 指定偏移量 */
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
 * 绕 Y 轴旋转（角度制）。生成的是"带旋转字段"的 Cube：
 * 直接把 rotation 的 Y 分量设为 angle（并保证 origin 存在），from/to 不变。
 * 这样 Blockbench 会用 Cube.rotation 表达旋转，而非重算旋转后坐标。
 */
export function rotateY(cubes: CubeSpec[], angleDeg: number, origin: Vec3): CubeSpec[] {
	return cubes.map((c) => ({
		...c,
		origin: origin,
		rotation: [c.rotation?.[0] ?? 0, angleDeg, c.rotation?.[2] ?? 0],
	}));
}

/**
 * 绕 X 轴旋转（角度制），用于上升轨道坡度。
 * 若既有 Y 旋转（yaw），叠加保留。
 */
export function rotateX(cubes: CubeSpec[], angleDeg: number, origin: Vec3): CubeSpec[] {
	return cubes.map((c) => ({
		...c,
		origin: origin,
		rotation: [angleDeg, c.rotation?.[1] ?? 0, c.rotation?.[2] ?? 0],
	}));
}

/** 抬升所有 Cube（y 方向平移，正值向上） */
export function lift(cubes: CubeSpec[], dy: number): CubeSpec[] {
	return translate(cubes, [0, dy, 0]);
}

/**
 * 绕 X/Y/Z 轴的向量旋转（角度制），与 Minecraft/Blockbench Cube.rotation 约定一致。
 * 其中 Y 旋转经 test_rail 的 [0,-90,0] 实测校验（-90 使横跨 X 的盒子转为沿 Z）。
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

/** 按 [rx, ry, rz] 依次绕 X→Y→Z 旋转向量（Minecraft 的 Cube.rotation 顺序） */
export function rotateVec(v: Vec3, rot: Vec3): Vec3 {
	return rotZ(rotY(rotX(v, rot[0]), rot[1]), rot[2]);
}

/** 面方向对应的法向量 */
const FACE_NORMAL: Record<CubeFaceDirection, Vec3> = {
	north: [0, 0, -1],
	south: [0, 0, 1],
	east: [1, 0, 0],
	west: [-1, 0, 0],
	up: [0, 1, 0],
	down: [0, -1, 0],
};

/** 法向量 → 面方向（90° 倍数旋转后法向量仍是 ±1 轴向量） */
const NORMAL_TO_FACE: Record<string, CubeFaceDirection> = Object.fromEntries(
	(Object.keys(FACE_NORMAL) as CubeFaceDirection[]).map((k) => [FACE_NORMAL[k].join(','), k])
);

/**
 * 各面方向对应的局部 UV 轴（世界方向），与 Blockbench CubeFace.UVToLocal 的约定一致：
 * 侧面 v 都朝 -y，u 沿各面的横向；up/down 的 u 朝 +x、v 朝 ±z。
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

/** 把（±1 轴）向量取整为整数值，消除浮点误差 */
function roundAxis(v: Vec3): Vec3 {
	return [Math.round(v[0]), Math.round(v[1]), Math.round(v[2])] as Vec3;
}

/**
 * 把「面的 UV 采样」按立方体旋转 rot 变换，得到新的面方向与（uv 盒, rotation）。
 *
 * 纹理是"粘"在体块上的：体块旋转后，同一块纹理区域仍贴在同一物理面上，只是该面
 * 的法向/局部 UV 轴变了。对 90° 倍数的轴旋转：
 *  - 纯旋转（det>0）：uv 盒不变，只把旋转角叠加到 face.rotation 上；
 *  - 反射（det<0，90° 轴旋转里可能出现，如绕 Z 时 side 面）：uv 盒的 v 反向
 *    （交换 v0/v1）以表达镜像——Minecraft 的 face.rotation 只有 0/90/180/270，不能表镜像。
 * 旋转轴由 Minecraft/Blockbench 的 Cube.rotation 顺序（X→Y→Z）计算。
 */
export function transformFaceUV(
	dir: CubeFaceDirection,
	face: FaceSpec,
	rot: Vec3
): { dir: CubeFaceDirection; face: FaceSpec } {
	const src = FACE_UV_AXES[dir];
	const newDir = NORMAL_TO_FACE[roundAxis(rotateVec(src.n, rot)).join(',')] ?? dir;
	const dst = FACE_UV_AXES[newDir];
	// 旧 u/v 轴经旋转后，在新面局部 UV 基里的坐标
	const Ru = roundAxis(rotateVec(src.u, rot));
	const Rv = roundAxis(rotateVec(src.v, rot));
	const a = dot3(Ru, dst.u);
	const b = dot3(Ru, dst.v);
	const c = dot3(Rv, dst.u);
	const d = dot3(Rv, dst.v);
	const det = a * d - b * c;
	// 旧 u 轴在新面里的旋转角（90° 倍数），det 正负均适用
	const theta = Math.round(Math.atan2(b, a) / (Math.PI / 2)) * 90;
	let newRot = (face.rotation ?? 0) + theta;
	let uv = face.uv;
	if (det < 0) {
		// 反射：绕 u 轴镜像 → v 采样反向（交换 v0/v1）
		if (uv) uv = [uv[0], uv[3], uv[2], uv[1]] as [number, number, number, number];
	}
	newRot = ((newRot % 360) + 360) % 360;
	// 规范表示：旋转角为 90/270 时，换成等价的「uv 盒整体交换 + 180°」表示。
	// box rot270 与 uv-swap rot90 是同一映射的两种编码（渲染不变式验证两者 err=0）。
	// 选 uv-swap 表示，使烘焙后的顶/底面旋转角与未烘焙的枕木源一致（up=90 / down=270）。
	if (newRot === 90 || newRot === 270) {
		if (uv) uv = [uv[2], uv[3], uv[0], uv[1]] as [number, number, number, number];
		newRot = (newRot + 180) % 360;
	}
	return { dir: newDir, face: { ...face, uv, rotation: newRot } };
}

/** 面方向在「沿 X 轴镜像（YZ 平面反射）」下的映射：east↔west，其余不变 */
const MIRROR_FACE: Record<CubeFaceDirection, CubeFaceDirection> = {
	north: 'north',
	south: 'south',
	east: 'west',
	west: 'east',
	up: 'up',
	down: 'down',
};

/**
 * 把单个 Cube 的面在 YZ 平面反射下变换：
 *  - 面方向：east↔west（法向量随反射翻转，否则面法线朝内）；
 *  - UV：u 轴反向（uv 盒交换 u0/u1，v 不变）——反射是手性翻转（det=-1），
 *    face.rotation 只有 0/90/180/270 表达不了反射，Blockbench 用「翻转 uv 盒」表达镜像；
 *  - face.rotation 取反（-0=0、-90=270、-180=180、-270=90）。
 * 纹理引用（texture key）不变：镜像后的零件仍引用同一张源纹理，只是采样方向翻转。
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
 * 把 mesh 沿 YZ 平面反射（x → 2·cx − x）：
 *  - 顶点与 origin 的 x 反射，y/z 不变
 *  - 旋转 ry/rz 取反（rx 不变），同 cube 约定
 *  - 面顶点顺序反转（反射改变绕序，反转保持法线朝外），UV/纹理不变
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
 * 把零件沿其横向中心（xMid）的 YZ 平面镜像，得到左右对称的零件。
 * 用于「右轨 = 左轨的镜像」（Create 的 segment_left / segment_right 互为沿轨道中心线的镜像）：
 *  - 几何：from/to/origin 的 x → 2·xMid − x（from/to 交换保证 from<to）
 *  - 旋转：ry 与 rz 取反（rx 不变），即 [rx, −ry, −rz]（YZ 平面反射对旋转的共轭）
 *  - 面：east↔west 交换 + u 轴反向 + rotation 取反（见 mirrorFaces）
 *  - mesh：顶点 x 反射 + 面顶点顺序反转（见 mirrorMeshYz）
 * 纹理（textures / textureSize）不变——镜像零件仍引用同一张源纹理。
 * 返回新 PartModel（不污染入参）。关于自身中心的镜像是一次对合（mirror(mirror(x)) === x）。
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
 * 旋转后把每个面的 UV 采样（uv 盒 + face.rotation）一并变换到新方向，
 * 而不仅是换方向——否则面贴图会旋转错（如顶/底面在绕 Y 旋转后需要 +90/270°）。
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

/** 旋转各分量是否都是 90° 的倍数（保持轴对齐，才能烘焙进 from/to） */
function isAxisAlignedRot(rot: Vec3): boolean {
	return rot.some((v) => v !== 0) && rot.every((v) => v % 90 === 0);
}

/**
 * 把零件中「90° 倍数、保持轴对齐」的旋转烘焙进 from/to，产出无 rotation 字段的普通盒子。
 * 这样派生形状（straightX / diag / ascending / teleport_x / cross_*）再叠加组旋转
 * （rotateY / rotateX）时不会覆盖零件自身方向——否则钢轨自带的 [0,-90,0] 会被组旋转
 * 覆盖，导致钢轨与枕木平行。
 *
 * 旋转围绕 cube 自身 origin 进行；非 90° 倍数旋转无法烘焙，保留 rotation 字段。
 * 返回重新计算过 bbox / xMid 的新 PartModel（不污染入参）。
 */
export function bakePartAxisAligned(part: PartModel): PartModel {
	const cubes = part.cubes.map((c) => {
		const rot = c.rotation;
		if (!rot || !isAxisAlignedRot(rot)) return c;
		const origin = c.origin ?? ([0, 0, 0] as Vec3);
		// 旋转 8 个角点，取轴对齐包围盒
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
 * 把每个无 rotation 的 Cube 绕 Y 轴「烘焙」旋转 -90°（关于指定中心），直接换算 from/to，
 * 并把每个面的 UV 采样（uv 盒 + face.rotation）变换到新方向。产物是不带 rotation 字段的
 * 普通盒子，后续 rotateY/rotateX 叠加时不会互相覆盖（否则枕木自身旋转会被派生形状的
 * 组旋转覆盖，导致垂直性丢失）。
 *
 * 带自身 rotation 的 cube 原样返回：其朝向由旋转表达，解析器已保留，不应被烘焙覆盖。
 * 方向映射（-90° 绕 Y）：north→east、south→west、east→south、west→north、up/down 不变。
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
