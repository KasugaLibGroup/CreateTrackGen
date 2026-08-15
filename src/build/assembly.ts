/**
 * 组装层 —— 把 logic 层产出的 ShapeSpec[] 转成 Blockbench 真实的 Cube/Group。
 * 这是整个项目中唯一 import Cube / Group 的模块（依赖 Blockbench 全局 API）。
 */

import { computeBBox, outputOffsetForFormat } from '../logic/parts';
import { bakePartAxisAligned, translate } from '../logic/transform';
import { orientTiePerpendicular } from '../logic/generator';
import type { CubeSpec, MeshSpec, PartModel, ShapeSpec, TrackConfig, Vec3 } from '../logic/types';

/**
 * 单个 CubeSpec → Blockbench Cube。
 * faces 透传（uv / rotation / texture），rotation 用三轴角（度）+ origin 表达。
 * textureByKey 非空时，把面的源纹理 key 解析为新工作区里导入的 Texture。
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
 * 把一个形状的所有 Cube 挂到指定 Group 下。
 * offset 非零时，把居中于原点的几何平移到画布对称点（Java 画布中心 (8,8)），
 * 使导出模型的对称轴正确（与导入归一化互为逆操作）。
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

/** 平移 mesh：顶点与 origin 整体平移指定偏移量 */
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
 * 单个 MeshSpec → Blockbench Mesh。
 * faces 透传（vertices / uv / rotation），面的源纹理 key 解析为新工作区里导入的 Texture。
 * 用于把输入零件的 mesh 组搬进新工作区的基础分组（tie / segment_left / segment_right）。
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
 * 基础分组用的轨道零件几何：cube 部分先烘焙轴对齐（钢轨沿 Z、枕木跨 X），
 * mesh 部分原样保留（无法烘焙）。返回定位所需的 xMid 与 z 边界。
 */
function baseRailGeometry(part: PartModel): { cubes: CubeSpec[]; meshes: MeshSpec[]; xMid: number; zMin: number } {
	if (part.cubes.length) {
		const baked = bakePartAxisAligned(part);
		return { cubes: baked.cubes, meshes: part.meshes ?? [], xMid: baked.xMid, zMin: baked.bbox.min[2] };
	}
	return { cubes: [], meshes: part.meshes ?? [], xMid: part.xMid, zMin: part.bbox.min[2] };
}

/** 基础分组用的枕木几何：cube 部分烘焙 + 转成跨 X（同 placeTies），mesh 原样保留 */
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
 * 把三个轨道零件搬进新工作区，作为基础分组：segment_left / segment_right / tie。
 * Create 的弯道渲染使用这三个模型（tie.obj / segment_left.obj / segment_right.obj），
 * 分组内各含对应零件的全部元素（cube 体块 + mesh 组），挂到轨道大组 parent 下、
 * 与 16 种轨道形状并列，便于单独导出。
 *
 * 布局 = z_ortho 直轨「靠近 x 轴那半边」的轨道单元（不再按输出格式偏移）：
 *  - segment_left / segment_right：轨道模型自身的中心（Java 为 xz(8,8)、其他格式为 (0,0)）
 *    的 x 坐标归零（offset.x = -xMid），近 z 端靠在 xy 平面（z 从 0 起，8px 段中心 z=4），
 *    钢轨底面抬升到 轨道高度 + 整体 Y 偏移。两条钢轨各自以自身中心为轴（Create 的
 *    segment_left.obj / segment_right.obj 同样以钢轨自身中心为 x=0，游戏在渲染时摆到 ±轨距/2）。
 *  - tie：枕木移动到 z_ortho 中靠近 x 轴的第一个枕木位置（z=4，= 枕木间距/2），
 *    横向居中于 x=0，底面仅加整体 Y 偏移（不抬升）。
 */
export function buildBaseParts(
	parent: Group,
	parts: { left: PartModel; right: PartModel; tie: PartModel },
	config: TrackConfig,
	textureByKey?: Map<string, Texture>
): Group[] {
	const height = config.heightPx;
	const yoff = config.wholeModelYOffset ?? 0;
	/** z_ortho 靠近 x 轴的第一个枕木的 z 位置（= 枕木间距/2，默认 4） */
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
 * 生成全部形状，挂到父 Group（名字 = 当前工作区名，默认 'track'）下。
 * 每个形状一个子 Group（按 TrackShape id 命名）。
 * 输出工作区为 Java Block/Item 时，把整体几何平移到 xz 平面 (8,8) 处，
 * 保证模型关于画布中心的对称性（同导入时的归一化约定）。
 * textureByKey 非空时，把零件源纹理应用到对应 cube 的面（左轨/右轨/枕木各自贴自己的纹理）。
 * 返回父 Group。
 */
export function buildAllShapes(shapes: ShapeSpec[], textureByKey?: Map<string, Texture>): Group {
	const format = (Project as any).format?.id as string | undefined;
	const offset = outputOffsetForFormat(format);
	// 大组名 = 当前工作区名（与导出时按工作区名查找一致），缺省 'track'
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
 * 把 Blockbench 元素（Cube/Group）转成 logic 层的 RawElement[]，供零件解析。
 * 从当前项目提取零件时使用。
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
				// 保留完整三轴旋转（数组形式）+ 同级 origin，与 parts.elementToCubeSpec 的解析对应
				raw.rotation = [...rot] as [number, number, number];
				if (el.origin) raw.origin = [...el.origin] as [number, number, number];
			}
			const faces: any = {};
			for (const [dir, face] of Object.entries(el.faces)) {
				if (!face) continue;
				const f: any = {};
				if (face.uv) f.uv = [...face.uv];
				if (face.rotation) f.rotation = face.rotation;
				// 面引用的纹理 UUID，供零件纹理提取与导入映射
				if (face.texture) f.texture = face.texture;
				faces[dir] = f;
			}
			if (Object.keys(faces).length) raw.faces = faces;
			raws.push(raw);
		} else if (el instanceof Mesh) {
			// mesh 元素：用 Blockbench 的 getSaveCopy 序列化（vertices/faces/origin/rotation），
			// 面纹理是 uuid（非下标），由 extractSelectedPart 按 uuid 收集源纹理
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
			// 递归展开 Group 的子元素
			raws.push(...elementsToRaw(el.children as (Cube | Group | Mesh)[]));
		}
	}
	return raws;
}
