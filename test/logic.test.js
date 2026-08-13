/**
 * 纯逻辑层单测 —— 零 Blockbench 依赖，直接 require 打包产物。
 * 运行：node test/logic.test.js（由 npm test 串联）
 */
'use strict';

const assert = require('assert');
const L = require('../logic_bundle.cjs');

let passed = 0;
const t = (name, fn) => {
	fn();
	passed++;
	console.log('  ✅', name);
};

console.log('== logic.test.js ==');

// ── gauge：二次拟合精确穿过三锚点 ──
t('fitQuadratic 精确穿过三个锚点', () => {
	for (const p of L.GAUGE_ANCHORS) {
		const v = L.gaugeMMToScale(p.gaugeMM, L.DEFAULT_FIT);
		assert(Math.abs(v - p.scale) < 1e-9, `gauge ${p.gaugeMM}mm 拟合值 ${v} 应接近 ${p.scale}`);
	}
});

t('DEFAULT_FIT 系数合理（二次项为正，锚点区间内单调）', () => {
	const { a, b, c } = L.DEFAULT_FIT;
	assert(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c));
	// 拟合曲线顶点在 ~1004mm，1000mm 附近近乎水平；从 1100mm 起严格单调不减
	let prev = L.gaugeMMToScale(1100);
	for (let g = 1101; g <= 1600; g += 10) {
		const cur = L.gaugeMMToScale(g);
		assert(cur >= prev, `gauge=${g} 比例应单调不减`);
		prev = cur;
	}
});

t('mm↔px 换算基准（1 米 = 1 格 = 16px）', () => {
	// 锚点：1435mm → 22.96px；1600mm → 25.6px；1000mm → 16px
	assert(Math.abs(L.mmToPx(1435) - 22.96) < 1e-9);
	assert(Math.abs(L.mmToPx(1600) - 25.6) < 1e-9);
	assert(Math.abs(L.mmToPx(1000) - 16) < 1e-9);
	assert(Math.abs(L.pxToMM(25.6) - 1600) < 1e-9);
	assert(Math.abs(L.pxToMM(16) - 1000) < 1e-9);
	// px → mm → px 往返一致
	assert(Math.abs(L.mmToPx(L.pxToMM(22.96)) - 22.96) < 1e-9);
});

t('mm↔英寸 换算（1 英寸 = 25.4mm）', () => {
	assert(Math.abs(L.inchToMM(1) - 25.4) < 1e-12);
	assert(Math.abs(L.mmToInch(25.4) - 1) < 1e-12);
	assert(Math.abs(L.mmToInch(1435) - 1435 / 25.4) < 1e-9);
	assert(Math.abs(L.mmToInch(1600) - 1600 / 25.4) < 1e-9);
	// px ↔ inch 往返一致
	assert(Math.abs(L.inchToPx(L.pxToInch(22.96)) - 22.96) < 1e-9);
});

t('scaleForPx 与新锚点一致（25.6px → 0.965 等）', () => {
	assert(Math.abs(L.scaleForPx(25.6) - 0.965) < 1e-9, 'Create 默认 1600mm（25.6px）→ 0.965');
	assert(Math.abs(L.scaleForPx(22.96) - 0.755) < 1e-9, '标准轨 1435mm（22.96px）→ 0.755');
	assert(Math.abs(L.scaleForPx(16) - 0.525) < 1e-9, '米轨 1000mm（16px）→ 0.525');
});

// ── parts：.bbmodel 解析与归一化 ──
const sampleBbModel = {
	elements: [
		{ name: 'rail', from: [6, 2, 0], to: [10, 4, 16] },
		{ name: 'base', from: [2, 0, 4], to: [14, 1, 12] },
		{
			name: 'ang',
			from: [6, 2, 0],
			to: [10, 4, 16],
			rotation: { angle: 45, axis: 'y', origin: [8, 8, 8] },
		},
	],
};

t('symmetryPointForFormat：java→(8,8)，其他→(0,0)', () => {
	assert.deepStrictEqual(L.symmetryPointForFormat('java_block'), [8, 0, 8]);
	assert.deepStrictEqual(L.symmetryPointForFormat('java_item'), [8, 0, 8]);
	assert.deepStrictEqual(L.symmetryPointForFormat('generic'), [0, 0, 0]);
	assert.deepStrictEqual(L.symmetryPointForFormat(undefined), [0, 0, 0]);
});

t('parseBbModel（Java 块，对称点 8,8）：对称点平移到原点', () => {
	// 原始 bbox：x 2..14（对称中心 8）、z 0..16（对称中心 8）、y 0..4
	// 归一化后：x 变为 -6..6（中心 0），z 变为 -8..8（中心 0），y 仍 0..4
	const part = L.parseBbModel({ meta: { model_format: 'java_block' }, elements: sampleBbModel.elements });
	assert.strictEqual(part.bbox.min[0], -6);
	assert.strictEqual(part.bbox.max[0], 6);
	assert.strictEqual(part.bbox.min[2], -8);
	assert.strictEqual(part.bbox.max[2], 8);
	assert.strictEqual(part.bbox.min[1], 0);
	assert.strictEqual(part.bbox.max[1], 4);
	assert.strictEqual(part.xMid, 0);
});

t('parseBbModel（其他格式，对称点 0,0）：仅底面归零，x/z 不动', () => {
	// 模型本身关于 (0,0) 对称：x -6..6、z -8..8、y 2..6
	const genericModel = {
		elements: [
			{ name: 'rail', from: [-6, 2, -8], to: [6, 6, 8] },
		],
	};
	const part = L.parseBbModel(genericModel);
	assert.strictEqual(part.bbox.min[0], -6);
	assert.strictEqual(part.bbox.max[0], 6);
	assert.strictEqual(part.bbox.min[2], -8);
	assert.strictEqual(part.bbox.max[2], 8);
	// 底面归零：y 从 2..6 → 0..4
	assert.strictEqual(part.bbox.min[1], 0);
	assert.strictEqual(part.bbox.max[1], 4);
	assert.strictEqual(part.xMid, 0);
});

t('elementToCubeSpec 转换 rotation 结构', () => {
	const spec = L.elementToCubeSpec(sampleBbModel.elements[2]);
	assert.deepStrictEqual(spec.rotation, [0, 45, 0]);
	assert.deepStrictEqual(spec.origin, [8, 8, 8]);
});

t('elementToCubeSpec 解析 .bbmodel 数组旋转 [x,y,z]（origin 为同级字段）', () => {
	const spec = L.elementToCubeSpec({
		from: [4, 0, 7],
		to: [12, 1, 9],
		rotation: [0, -90, 0],
		origin: [8, 0.5, 8],
	});
	assert.deepStrictEqual(spec.rotation, [0, -90, 0]);
	assert.deepStrictEqual(spec.origin, [8, 0.5, 8]);
	// 零旋转数组不产生 rotation 字段
	const plain = L.elementToCubeSpec({ from: [0, 0, 0], to: [1, 1, 1], rotation: [0, 0, 0] });
	assert.strictEqual(plain.rotation, undefined);
});

t('parseBbModel 保留数组旋转，placeRails 烘焙进坐标（钢轨方向不丢失）', () => {
	const json = {
		meta: { model_format: 'java_block' },
		elements: [
			{ name: 'rail', from: [4, 0, 7], to: [12, 1, 9], rotation: [0, -90, 0], origin: [8, 0.5, 8] },
		],
	};
	const part = L.parseBbModel(json);
	// 零件层保留数组旋转
	assert.deepStrictEqual(part.cubes[0].rotation, [0, -90, 0]);
	// placeRails 把 -90° 烘焙进坐标：钢轨成为沿 Z 的普通盒子（无 rotation 字段，方向不丢）
	const cfgR = {
		gaugePx: 8,
		heightPx: 2,
		parts: { left: part, right: part, tie: { cubes: [], bbox: { min: [0, 0, 0], max: [0, 0, 0] }, xMid: 0 } },
	};
	const shape = L.placeRails(cfgR, { length: 8 });
	const rail = shape[0];
	assert.strictEqual(rail.rotation, undefined, '钢轨旋转应烘焙为普通盒子');
	const zSpan = Math.abs(rail.to[2] - rail.from[2]);
	const xSpan = Math.abs(rail.to[0] - rail.from[0]);
	assert(zSpan > xSpan, `钢轨应沿 Z（zSpan=${zSpan}, xSpan=${xSpan}）`);
});

t('outputOffsetForFormat：java 平移 (8,8)，其他 (0,0)', () => {
	assert.deepStrictEqual(L.outputOffsetForFormat('java_block'), [8, 0, 8]);
	assert.deepStrictEqual(L.outputOffsetForFormat('java_item'), [8, 0, 8]);
	assert.deepStrictEqual(L.outputOffsetForFormat('generic'), [0, 0, 0]);
	assert.deepStrictEqual(L.outputOffsetForFormat(undefined), [0, 0, 0]);
});

// ── 纹理：.bbmodel 纹理提取与分辨率一致性 ──
// 面的 texture 字段是纹理数组下标（不是 id），与 parseBbTextures 的 key 对齐
const texBbModel = {
	meta: { model_format: 'java_block' },
	resolution: { width: 64, height: 64 },
	textures: [
		{ name: 'rail.png', id: '4', uv_width: 64, uv_height: 64, source: 'data:image/png;base64,AAA' },
		{ name: 'rail2.png', id: '5', uv_width: 64, uv_height: 64, source: 'data:image/png;base64,BBB' },
	],
	elements: [
		{
			name: 'rail',
			from: [6, 2, 0],
			to: [10, 4, 16],
			faces: { north: { uv: [0, 0, 8, 8], texture: 0 }, up: { uv: [0, 8, 8, 16], texture: 1 } },
		},
	],
};

t('parseBbTextures 以纹理数组下标为 key，分辨率取 resolution', () => {
	const { textureSize, textures } = L.parseBbTextures(texBbModel);
	assert.deepStrictEqual(textureSize, [64, 64]);
	assert.strictEqual(textures.length, 2);
	assert.deepStrictEqual(textures[0], { key: '0', name: 'rail.png', source: 'data:image/png;base64,AAA', width: 64, height: 64 });
	assert.strictEqual(textures[1].key, '1');
});

t('parseBbModel 面纹理引用归一化为数组下标，与 parseBbTextures 的 key 对齐', () => {
	const part = L.parseBbModel(texBbModel);
	assert.deepStrictEqual(part.textureSize, [64, 64]);
	assert.strictEqual(part.cubes[0].faces.north.texture, '0', '数字 texture 下标应转为字符串');
	assert.strictEqual(part.cubes[0].faces.up.texture, '1');
	// 关键：面的纹理引用必须能在 parseBbTextures 的 key 里找到，否则 assembly 层贴不上纹理
	const { textures } = L.parseBbTextures(texBbModel);
	const keys = new Set(textures.map((t) => t.key));
	for (const [dir, face] of Object.entries(part.cubes[0].faces)) {
		assert(keys.has(face.texture), `${dir} 面引用的纹理 key ${face.texture} 应能在源纹理中找到`);
	}
});

t('无纹理 / 纹理尺寸不一致时不给出分辨率', () => {
	assert.strictEqual(L.parseBbTextures({ meta: { model_format: 'java_block' }, elements: [] }).textureSize, undefined);
	const mixed = L.parseBbTextures({
		textures: [
			{ name: 'a', id: '1', uv_width: 64, uv_height: 64, source: 'data:x' },
			{ name: 'b', id: '2', uv_width: 32, uv_height: 32, source: 'data:y' },
		],
	});
	assert.strictEqual(mixed.textureSize, undefined, '模型内纹理尺寸不一致不应给出单一分辨率');
});

t('consistentTextureSize：一致返回尺寸，不一致/缺失返回 null', () => {
	assert.deepStrictEqual(L.consistentTextureSize([{ textureSize: [64, 64] }, { textureSize: [64, 64] }]), [64, 64]);
	assert.strictEqual(L.consistentTextureSize([{ textureSize: [64, 64] }, { textureSize: [32, 32] }]), null);
	assert.strictEqual(L.consistentTextureSize([{}, { textureSize: [64, 64] }]), null);
	assert.strictEqual(L.consistentTextureSize([]), null);
});

t('scopeTextureKeys 给零件纹理 key 加前缀，面引用同步改写且全局唯一', () => {
	const part = L.scopeTextureKeys(L.parseBbModel(texBbModel), 'L');
	assert.strictEqual(part.textures[0].key, 'L/0');
	assert.strictEqual(part.textures[1].key, 'L/1');
	assert.strictEqual(part.cubes[0].faces.north.texture, 'L/0', '面引用应同步改为加前缀的 key');
	assert.strictEqual(part.cubes[0].faces.up.texture, 'L/1');
	// 左/右两份零件（同为下标 0）加不同前缀后 key 全局唯一，不互相覆盖
	const left = L.scopeTextureKeys(L.parseBbModel(texBbModel), 'L');
	const right = L.scopeTextureKeys(L.parseBbModel(texBbModel), 'R');
	assert.notStrictEqual(left.textures[0].key, right.textures[0].key, '不同零件的前缀 key 应互不相同');
});

// ── mesh 组：识别 / 归一化 / 加前缀 / 镜像 / 格式判定 ──
// 一个含 mesh 组（type='mesh'）的 .bbmodel：顶点偏在 Java 画布一侧，便于验证对称点归一化
const meshBbModelJava = {
	meta: { model_format: 'java_block' },
	resolution: { width: 32, height: 32 },
	textures: [{ name: 'mesh.png', id: '1', uv_width: 32, uv_height: 32, source: 'data:image/png;base64,mesh' }],
	elements: [
		{
			name: 'railmesh',
			type: 'mesh',
			vertices: {
				'0': [6, 2, 0],
				'1': [10, 2, 0],
				'2': [10, 6, 0],
				'3': [6, 6, 0],
				'4': [6, 2, 16],
				'5': [10, 2, 16],
				'6': [10, 6, 16],
				'7': [6, 6, 16],
			},
			faces: { '0': { vertices: ['0', '1', '2', '3'], uv: [0, 0, 8, 8], texture: 0 } },
		},
	],
};

t('parseBbModel 识别 mesh 组：hasMesh/meshes，顶点随对称点归一化', () => {
	const part = L.parseBbModel(meshBbModelJava);
	assert.strictEqual(part.hasMesh, true, '含 mesh 的零件 hasMesh 应为 true');
	assert.strictEqual(part.cubes.length, 0, 'mesh 元素不应进入 cubes');
	assert.strictEqual(part.meshes.length, 1);
	const m = part.meshes[0];
	// bbox x 6..10（对称点 (8,8)）、y 2..6、z 0..16 → 顶点减 (8,-2,8)：'0' [6,2,0] → [-2,0,-8]
	assert.deepStrictEqual(m.vertices['0'], [-2, 0, -8]);
	assert.deepStrictEqual(m.vertices['1'], [2, 0, -8]);
	assert.deepStrictEqual(m.origin, undefined, '无 origin 时保持 undefined');
	// 面纹理引用归一化为字符串下标 0
	assert.strictEqual(m.faces['0'].texture, '0');
	assert.deepStrictEqual(m.faces['0'].vertices, ['0', '1', '2', '3']);
	// 纹理信息照常提取
	assert.strictEqual(part.textures[0].key, '0');
	assert.deepStrictEqual(part.textureSize, [32, 32]);
	// 归一化后 bbox 关于 xMid=0 对称，底面 y=0
	assert.strictEqual(part.bbox.min[0], -2);
	assert.strictEqual(part.bbox.max[0], 2);
	assert.strictEqual(part.bbox.min[1], 0);
	assert.strictEqual(part.bbox.max[1], 4);
});

t('混合 cube + mesh：cubes 与 meshes 分开收集，mesh 不参与轨道形状', () => {
	const json = {
		meta: { model_format: 'java_block' },
		elements: [
			{ name: 'rail', from: [6, 2, 0], to: [10, 4, 16] },
			{ name: 'meshpart', type: 'mesh', vertices: { '0': [6, 2, 0], '1': [10, 2, 0], '2': [10, 6, 0], '3': [6, 6, 0] }, faces: {} },
		],
	};
	const part = L.parseBbModel(json);
	assert.strictEqual(part.hasMesh, true);
	assert.strictEqual(part.cubes.length, 1, 'cube 元素照常进 cubes');
	assert.strictEqual(part.meshes.length, 1);
	const cfg = { gaugePx: 8, heightPx: 2, parts: { left: part, right: part, tie: part } };
	const shapes = L.allShapes(cfg);
	assert.strictEqual(shapes.length, 16, '含 mesh 时轨道形状仍照常生成（只用 cube 部分）');
});

t('extractFromElements 识别 mesh 元素（hasMesh/meshes）', () => {
	const elements = [
		{
			name: 'railmesh',
			type: 'mesh',
			vertices: { '0': [6, 2, 0], '1': [10, 2, 0], '2': [10, 6, 0], '3': [6, 6, 0] },
			faces: { '0': { vertices: ['0', '1', '2', '3'], texture: 'tex-uuid' } },
		},
	];
	const part = L.extractFromElements(elements, 'java_block');
	assert.strictEqual(part.hasMesh, true);
	assert.strictEqual(part.cubes.length, 0);
	assert.strictEqual(part.meshes[0].faces['0'].texture, 'tex-uuid', 'mesh 面纹理 key 保留');
});

t('scopeTextureKeys 同步改写 mesh 面纹理 key', () => {
	const part = L.scopeTextureKeys(L.parseBbModel(meshBbModelJava), 'L');
	assert.strictEqual(part.textures[0].key, 'L/0');
	assert.strictEqual(part.meshes[0].faces['0'].texture, 'L/0', 'mesh 面纹理引用应同步改为加前缀的 key');
});

t('mirrorPartYz 镜像 mesh：顶点 x 反射 + 面绕序反转（对合）', () => {
	const part = L.parseBbModel(meshBbModelJava);
	const m = L.mirrorPartYz(part);
	assert.strictEqual(m.hasMesh, true);
	assert.strictEqual(m.meshes.length, 1);
	// 顶点 '0' [-2,0,-8] 关于 xMid 0 反射 → [2,0,-8]
	assert.deepStrictEqual(m.meshes[0].vertices['0'], [2, 0, -8]);
	// 反射改变面绕序：顶点顺序反转
	assert.deepStrictEqual(m.meshes[0].faces['0'].vertices, ['3', '2', '1', '0']);
	// 对合：镜像两次还原（含顶点 / 面绕序）
	const twice = L.mirrorPartYz(m);
	assert.deepStrictEqual(twice.meshes, part.meshes);
});

t('targetFormatForParts：含 mesh → generic，全 cube → Java 方块/物品', () => {
	assert.strictEqual(L.targetFormatForParts([{ hasMesh: true }, {}], 'java_block'), 'generic', '任一零件含 mesh → 自由模型');
	assert.strictEqual(L.targetFormatForParts([{ hasMesh: false }, {}], 'java_block'), 'java_block');
	assert.strictEqual(L.targetFormatForParts([{}, {}], 'java_item'), 'java_item');
	assert.strictEqual(L.targetFormatForParts([{}, {}], 'generic'), 'java_block', '非 Java 项目全 cube 默认 java_block');
});

// ── mesh origin 参考系：origin 是世界锚点、顶点是局部坐标，必须烘焙进顶点 ──
t('mesh origin+rotation 烘焙进顶点：世界坐标 = origin + R·顶点，origin 置空', () => {
	const json = {
		meta: { model_format: 'java_block' },
		elements: [
			{
				name: 'm',
				type: 'mesh',
				// 局部顶点（围绕 origin 0,0,0）：x[-2,2]、y[-2,4]、z[-8,8]
				vertices: { '0': [-2, -2, -8], '1': [2, -2, -8], '2': [2, 4, -8], '3': [-2, 4, -8], '4': [-2, -2, 8], '5': [2, -2, 8], '6': [2, 4, 8], '7': [-2, 4, 8] },
				origin: [8, 2, 8],
				rotation: [0, 0, 0],
				faces: {},
			},
		],
	};
	const part = L.parseBbModel(json);
	assert.strictEqual(part.hasMesh, true);
	const m = part.meshes[0];
	assert.strictEqual(m.origin, undefined, 'origin 应被烘焙置空');
	assert.strictEqual(m.rotation, undefined, '零旋转应被烘焙置空');
	// 世界坐标 = origin + 顶点：'0' [-2,-2,-8] + (8,2,8) = [6,0,0]；
	// parseBbModel 再归一化（java 对称点 8,8，减 8）：[6-8, 0, 0-8] = [-2,0,-8]
	assert.deepStrictEqual(m.vertices['0'], [-2, 0, -8], '顶点应烘焙 origin 并随归一化平移');
	// 归一化（java 对称点 8,8）：世界 bbox x[6,10] y[0,6] z[0,16] → 减 (8,8) → x[-2,2] y[0,6] z[-8,8]，xMid=0
	assert.strictEqual(part.bbox.min[0], -2, '烘焙后归一化应居中 x 于 0');
	assert.strictEqual(part.bbox.max[0], 2);
	assert.strictEqual(part.bbox.min[2], -8);
	assert.strictEqual(part.bbox.max[2], 8);
	assert.strictEqual(part.xMid, 0);
});

t('mesh 有非零旋转时烘焙 rotation 进顶点', () => {
	const json = {
		meta: { model_format: 'generic' },
		elements: [
			{
				name: 'm',
				type: 'mesh',
				vertices: { '0': [1, 0, 0], '1': [2, 0, 0] },
				origin: [0, 0, 0],
				rotation: [0, 90, 0], // 绕 Y +90°：(x,z) → (-z,x)
				faces: {},
			},
		],
	};
	const part = L.parseBbModel(json);
	const m = part.meshes[0];
	assert.strictEqual(m.rotation, undefined, '旋转应被烘焙掉');
	// 顶点 [1,0,0] 绕 Y +90° → [0,0,1]；再无所谓 origin（为 0）
	assert(Math.abs(m.vertices['0'][0]) < 1e-9 && Math.abs(m.vertices['0'][2] - 1) < 1e-9, `顶点应旋转为 [0,0,1]，实际 ${m.vertices['0']}`);
});

// ── transform：平移 / 旋转 / 抬升 ──
t('translate 平移 from/to/origin', () => {
	const cubes = [{ from: [1, 1, 1], to: [2, 2, 2], origin: [0, 0, 0] }];
	const out = L.translate(cubes, [10, 0, 0]);
	assert.deepStrictEqual(out[0].from, [11, 1, 1]);
	assert.deepStrictEqual(out[0].origin, [10, 0, 0]);
	// 不污染入参
	assert.deepStrictEqual(cubes[0].from, [1, 1, 1]);
});

t('rotateY 写入 rotation Y 分量并设 origin', () => {
	const cubes = [{ from: [0, 0, 0], to: [16, 16, 16] }];
	const out = L.rotateY(cubes, 45, [8, 8, 8]);
	assert.deepStrictEqual(out[0].rotation, [0, 45, 0]);
	assert.deepStrictEqual(out[0].origin, [8, 8, 8]);
});

t('rotateX 写入 rotation X 分量', () => {
	const cubes = [{ from: [0, 0, 0], to: [16, 16, 16] }];
	const out = L.rotateX(cubes, -45, [8, 8, 8]);
	assert.deepStrictEqual(out[0].rotation, [-45, 0, 0]);
});

t('lift 等价于 y 平移', () => {
	const cubes = [{ from: [0, 0, 0], to: [16, 4, 16] }];
	const out = L.lift(cubes, 2);
	assert.deepStrictEqual(out[0].from, [0, 2, 0]);
	assert.deepStrictEqual(out[0].to, [16, 6, 16]);
});

// ── UV 变换：烘焙立方体旋转时，面贴图的旋转/翻转必须一并修正 ──
t('transformFaceUV：绕 -90°Y 时顶/底面旋转角被修正，侧面保持', () => {
	// 模拟 rail 的 [0,-90,0] 烘焙
	const up = L.transformFaceUV('up', { uv: [32, 0, 0, 5] }, [0, -90, 0]);
	assert.strictEqual(up.dir, 'up');
	// 90° 与 270° 是同一映射的两种编码；规范化为 uv-swap 表示，顶面取 90°
	assert.strictEqual(up.face.rotation, 90, 'up 面绕 -90°Y 应旋转 90°（uv-swap 规范表示）');
	assert.deepStrictEqual(up.face.uv, [0, 5, 32, 0], 'uv 盒整体交换（与 rot90 等价）');
	const down = L.transformFaceUV('down', { uv: [32, 11, 0, 6] }, [0, -90, 0]);
	assert.strictEqual(down.face.rotation, 270, 'down 面绕 -90°Y 应旋转 270°（uv-swap 规范表示）');
	assert.deepStrictEqual(down.face.uv, [0, 6, 32, 11]);
	const north = L.transformFaceUV('north', { uv: [32, 30, 0, 31.5] }, [0, -90, 0]);
	assert.strictEqual(north.dir, 'west', 'north 面绕 -90°Y 应映射到 west');
	assert.strictEqual(north.face.rotation, 0, '侧面绕 Y 纯平移，旋转角 0');
	assert.deepStrictEqual(north.face.uv, [32, 30, 0, 31.5]);
});

t('transformFaceUV：绕 +90°Y（枕木转向）顶面旋转角为 270°', () => {
	const up = L.transformFaceUV('up', { uv: [0, 0, 1, 1] }, [0, 90, 0]);
	assert.strictEqual(up.dir, 'up');
	assert.strictEqual(up.face.rotation, 270, 'up 面绕 +90°Y 应旋转 270°（uv-swap 规范表示）');
	assert.deepStrictEqual(up.face.uv, [1, 1, 0, 0]);
	const north = L.transformFaceUV('north', { uv: [0, 0, 1, 1] }, [0, 90, 0]);
	assert.strictEqual(north.dir, 'east', 'north 面绕 +90°Y 应映射到 east');
	assert.strictEqual(north.face.rotation, 0);
	assert.deepStrictEqual(north.face.uv, [0, 0, 1, 1]);
});

// ── generator：形状组装 ──
function makeRailPart() {
	// 单根钢轨：宽 4px、高 4px、长 16px，关于 x=0 对称（xMid=0）
	return {
		cubes: [{ name: 'rail', from: [-2, 0, 0], to: [2, 4, 16] }],
		bbox: { min: [-2, 0, 0], max: [2, 4, 16] },
		xMid: 0,
	};
}
function makeTiePart() {
	// 枕木：宽 12px、高 2px、厚 1px，横向居中
	return {
		cubes: [{ name: 'tie', from: [-6, 0, -0.5], to: [6, 2, 0.5] }],
		bbox: { min: [-6, 0, -0.5], max: [6, 2, 0.5] },
		xMid: 0,
	};
}
function makeRotatedRail() {
	// 横跨 X 的钢轨零件，带 [0,-90,0] 旋转（模拟 test_rail 这类真实模型），烘焙后转为沿 Z 的 8px 段
	return {
		cubes: [{ name: 'rail', from: [-4, 0, -1], to: [4, 1, 1], rotation: [0, -90, 0], origin: [0, 0, 0] }],
		bbox: { min: [-4, 0, -1], max: [4, 1, 1] },
		xMid: 0,
	};
}
const testCfg = {
	gaugePx: 8,
	heightPx: 2,
	parts: { left: makeRailPart(), right: makeRailPart(), tie: makeTiePart() },
};

t('straight Z：左右轨按轨距摆放，钢轨抬升而枕木落在 xz 平面', () => {
	const shape = L.straight(testCfg, 'z', { length: 16, tieInterval: 8 });
	const rails = shape.cubes.filter((c) => c.name === 'rail');
	// 零件 x 范围 [-2,2]；左轨平移到 [-6,-2]（中心 -4），右轨平移到 [2,6]（中心 +4）
	const xs = rails.map((c) => c.from[0]).sort((a, b) => a - b);
	assert.deepStrictEqual(xs, [-6, 2]);
	// 轨距 = 中心距 = 8px
	const centers = rails.map((c) => (c.from[0] + c.to[0]) / 2).sort((a, b) => a - b);
	assert.strictEqual(centers[1] - centers[0], 8);
	// 钢轨抬升到轨道高度 2；枕木不抬升（底部在 xz 平面 y=0）
	for (const c of shape.cubes) {
		if (c.name === 'rail') {
			assert.strictEqual(c.from[1], 2, '钢轨应抬升到 heightPx');
		} else {
			assert.strictEqual(c.from[1], 0, '枕木应落在 xz 平面（不应用 heightPx）');
		}
	}
	// 枕木数量：长度16 / 间距8 = 2
	const ties = shape.cubes.filter((c) => c.name === 'tie');
	assert.strictEqual(ties.length, 2);
});

t('Z 方向长轴枕木自动旋转为跨 X（垂直钢轨），已跨 X 的不变', () => {
	const zTie = {
		cubes: [
			{
				name: 'tie',
				from: [-2, 0, -6],
				to: [2, 2, 6],
				faces: {
					north: { uv: [0, 0, 1, 1] }, // z=-6 面
					south: { uv: [1, 1, 2, 2] }, // z=+6 面
					up: { uv: [0, 0, 1, 1] },
				},
			},
		], // 长轴沿 Z（平行轨道）
		bbox: { min: [-2, 0, -6], max: [2, 2, 6] },
		xMid: 0,
	};
	const cfgZ = {
		gaugePx: 8,
		heightPx: 2,
		parts: { left: makeRailPart(), right: makeRailPart(), tie: zTie },
	};
	const shape = L.straight(cfgZ, 'z', { length: 16, tieInterval: 8 });
	const tie = shape.cubes.find((c) => c.name === 'tie');
	assert(tie, '应有枕木');
	// 旋转后长轴跨 X
	const xSpan = Math.abs(tie.to[0] - tie.from[0]);
	const zSpan = Math.abs(tie.to[2] - tie.from[2]);
	assert(xSpan > zSpan, `枕木应跨 X（xSpan=${xSpan}, zSpan=${zSpan}）`);
	// 底部落在 xz 平面，不应用 heightPx
	assert.strictEqual(tie.from[1], 0, '枕木底部应在 xz 平面');
	// 面方向随 90° 烘焙交换：原 north(z-) 面 → 旋转后 east(x+) 面
	assert.deepStrictEqual(tie.faces.east.uv, [0, 0, 1, 1], '原 north 面应映射到 east');
	assert.deepStrictEqual(tie.faces.west.uv, [1, 1, 2, 2], '原 south 面应映射到 west');
	assert.strictEqual(tie.faces.up.rotation, 270, '顶面随枕木转向旋转应修正为 270°（uv-swap 规范表示）');
	assert.deepStrictEqual(tie.faces.up.uv, [1, 1, 0, 0], '顶面 uv 盒整体交换');
	assert.strictEqual(tie.rotation, undefined, '烘焙后应为普通盒子（无旋转字段）');
	// 已跨 X 的枕木（如 makeTiePart）不应被旋转
	const shapeX = L.straight(testCfg, 'z', { length: 16, tieInterval: 8 });
	const tieX = shapeX.cubes.find((c) => c.name === 'tie');
	assert.strictEqual(tieX.rotation, undefined, '跨 X 枕木应保持普通盒子（无旋转字段）');
});

t('bakePartAxisAligned 把钢轨 [0,-90,0] 烘焙为沿 Z 的普通盒子', () => {
	const baked = L.bakePartAxisAligned(makeRotatedRail());
	const c = baked.cubes[0];
	assert.strictEqual(c.rotation, undefined, '烘焙后不应有 rotation 字段');
	const zSpan = Math.abs(c.to[2] - c.from[2]);
	const xSpan = Math.abs(c.to[0] - c.from[0]);
	assert(zSpan > xSpan, `钢轨应转为沿 Z（zSpan=${zSpan}, xSpan=${xSpan}）`);
	assert.strictEqual(baked.xMid, 0, '烘焙后仍横向居中');
});

t('所有形状中钢轨与枕木保持垂直（钢轨旋转被烘焙，派生形状统一组旋转）', () => {
	const rail = makeRotatedRail();
	const cfgR = { gaugePx: 8, heightPx: 2, parts: { left: rail, right: rail, tie: makeTiePart() } };
	// straightZ：钢轨沿 Z（from/to z 跨距大），枕木跨 X
	const zs = L.straightZ(cfgR, { length: 16, tieInterval: 8 });
	const zRail = zs.find((c) => c.name === 'rail');
	const zTie = zs.find((c) => c.name === 'tie');
	assert.strictEqual(zRail.rotation, undefined, 'straightZ 钢轨应无 rotation（已烘焙）');
	assert(Math.abs(zRail.to[2] - zRail.from[2]) > Math.abs(zRail.to[0] - zRail.from[0]), 'straightZ 钢轨应沿 Z');
	assert(Math.abs(zTie.to[0] - zTie.from[0]) > Math.abs(zTie.to[2] - zTie.from[2]), 'straightZ 枕木应跨 X');
	// straightX：所有 cube 统一组旋转 90°（不再残留钢轨自身 -90°），钢轨 from/to 仍沿 Z → 视觉沿 X
	const sx = L.straightX(cfgR, { length: 16, tieInterval: 8 });
	const sxRail = sx.find((c) => c.name === 'rail');
	assert.deepStrictEqual(sxRail.rotation, [0, 90, 0], 'straightX 钢轨应统一为组旋转 90°');
	assert(Math.abs(sxRail.to[2] - sxRail.from[2]) > Math.abs(sxRail.to[0] - sxRail.from[0]), 'straightX 钢轨 from/to 沿 Z（烘焙过）');
	// ascending：钢轨含 -45°X 旋转，且保留 Y 组旋转（south=0）
	const asc = L.ascending(cfgR, 'south', { length: 16, tieInterval: 8 });
	const ascRail = asc.cubes.find((c) => c.name === 'rail');
	assert.strictEqual(ascRail.rotation[0], -45, 'ascending 钢轨应含 -45°X');
	assert.strictEqual(ascRail.rotation[1], 0, 'ascending south 应无 Y 转向');
});

t('直轨/上升轨 2 段 2 枕木，斜轨 3 段 3 枕木', () => {
	const rail = makeRotatedRail(); // 烘焙后 8px 段
	const cfgR = { gaugePx: 8, heightPx: 2, parts: { left: rail, right: rail, tie: makeTiePart() } };
	// 直轨
	const zs = L.straightZ(cfgR, { tieInterval: 8 });
	assert.strictEqual(zs.filter((c) => c.name === 'rail').length / 2, 2, '直轨每侧应 2 段钢轨');
	assert.strictEqual(zs.filter((c) => c.name === 'tie').length, 2, '直轨应 2 根枕木');
	// 上升轨
	const asc = L.ascending(cfgR, 'north', { tieInterval: 8 });
	assert.strictEqual(asc.cubes.filter((c) => c.name === 'tie').length, 2, '上升轨应 2 根枕木');
	// 斜轨
	const diag = L.diagonal(cfgR, false, { tieInterval: 8 });
	assert.strictEqual(diag.cubes.filter((c) => c.name === 'rail').length / 2, 3, '斜轨每侧应 3 段钢轨');
	assert.strictEqual(diag.cubes.filter((c) => c.name === 'tie').length, 3, '斜轨应 3 根枕木');
	// 对角交叉：每条对角各 3 根枕木（两条 = 6）
	const crossD = L.cross(cfgR, 'diag', { tieInterval: 8 });
	assert.strictEqual(crossD.cubes.filter((c) => c.name === 'tie').length, 6, '对角交叉应共 6 根枕木');
});

t('allShapes 生成 16 种形状，ID 与 TrackShape 对齐', () => {
	const shapes = L.allShapes(testCfg);
	const ids = shapes.map((s) => s.id);
	assert.strictEqual(shapes.length, 16);
	for (const id of ['z_ortho', 'x_ortho', 'diag', 'diag_2', 'ascending_south', 'ascending_north', 'ascending_east', 'ascending_west', 'teleport', 'teleport_x', 'cross_ortho', 'cross_diag', 'cross_d1_xo', 'cross_d1_zo', 'cross_d2_xo', 'cross_d2_zo']) {
		assert(ids.includes(id), `缺少 ${id}`);
	}
	// 每种形状至少有 2 个 cube
	for (const s of shapes) assert(s.cubes.length >= 2, `${s.id} 应有 >=2 个 cube`);
});

t('diag 形状含 45°Y 旋转', () => {
	const shape = L.diagonal(testCfg, false);
	assert(shape.cubes.some((c) => c.rotation?.[1] === 45), 'diag 应含 45°Y 旋转');
});

t('ascending 形状含 -45°X 旋转', () => {
	const shape = L.ascending(testCfg, 'south');
	assert(shape.cubes.some((c) => c.rotation?.[0] === -45), 'ascending 应含 -45°X 旋转');
});

// ── 回归：枕木消失（短钢轨零件 + 缺省长度）──
t('短钢轨零件（半块段）默认也生成完整 16px 轨道和枕木', () => {
	// Create 的钢轨段是 8px 半块段，之前轨道长度取零件 z 长度 → 枕木不生成
	const shortRail = {
		cubes: [{ name: 'rail', from: [-1, 0, 0], to: [1, 4, 8] }],
		bbox: { min: [-1, 0, 0], max: [1, 4, 8] },
		xMid: 0,
	};
	const cfg2 = {
		gaugePx: 8,
		heightPx: 2,
		parts: { left: shortRail, right: shortRail, tie: makeTiePart() },
	};
	const shape = L.straight(cfg2, 'z'); // 不传 opts
	const ties = shape.cubes.filter((c) => c.name === 'tie');
	assert(ties.length >= 2, `短钢轨零件默认也应生成 >=2 根枕木，实际 ${ties.length}`);
	// 平铺后轨道覆盖完整 16px
	const rails = shape.cubes.filter((c) => c.name === 'rail');
	const zs = rails.flatMap((c) => [c.from[2], c.to[2]]);
	assert.strictEqual(Math.max(...zs) - Math.min(...zs), 16, '缺省轨道长度应为 16px');
	// 左右轨中心距仍为轨距 8（tiling 会产生多份副本，取最左/最右的中心）
	const centers = rails.map((c) => (c.from[0] + c.to[0]) / 2);
	assert(Math.abs(Math.max(...centers) - Math.min(...centers) - 8) < 1e-9, '钢轨中心距应等于轨距 8px');
});

// ── 回归：上升轨道旋转枢轴 ──
t('ascending 旋转枢轴在轨道中心（xz 即 Java 方块中心 (8,8)），而非前缘', () => {
	const shape = L.ascending(testCfg, 'south');
	const rail = shape.cubes.find((c) => c.name === 'rail');
	assert(rail, 'ascending 应含钢轨 cube');
	assert(rail.origin, 'ascending cube 应有 origin');
	// 中心 = straightZ 结果 z 的中心（直轨居中于原点，16px 轨 z 从 -8..8，中心 0；
	// 输出到 Java 工作区 +8 → 方块中心 z=8）
	const zs = L.straightZ(testCfg);
	const zsFlat = zs.flatMap((c) => [c.from[2], c.to[2]]);
	const zCenter = (Math.min(...zsFlat) + Math.max(...zsFlat)) / 2;
	assert.strictEqual(rail.origin[2], zCenter, `ascending 枢轴 z 应为轨道中心 ${zCenter}，实际 ${rail.origin[2]}`);
	assert.strictEqual(rail.origin[0], 0, '枢轴 x 应为轨道横向中心（Java 空间 8）');
	assert.strictEqual(rail.origin[1], testCfg.heightPx, '枢轴 y 应在轨道高度');
	assert.strictEqual(rail.rotation[0], -45);
});

// ── 传送门覆层：teleport 形状叠加左右两个 mip 覆层板 ──
t('teleport 配置 portal 时生成 2 个覆层，未配置则与 z_ortho / x_ortho 一致', () => {
	// 未配置 portal：teleport 应与 z_ortho 完全一致（无覆层体块）
	const plain = L.teleport(testCfg, 'z');
	assert(plain.cubes.every((c) => !c.name?.startsWith('teleport_')), '未配置 portal 不应生成覆层');
	const ortho = L.straight(testCfg, 'z');
	assert.deepStrictEqual(plain.cubes, ortho.cubes, '未配置 portal 时 teleport 应与 z_ortho 一致');
	// teleport_x 与 x_ortho 一致
	const plainX = L.teleport(testCfg, 'x');
	const orthoX = L.straight(testCfg, 'x');
	assert.deepStrictEqual(plainX.cubes, orthoX.cubes, '未配置 portal 时 teleport_x 应与 x_ortho 一致');
	// 配置 portal：直轨 + 2 覆层（用带面的零件，验证 body 纹理重映射）
	const railFace = {
		name: 'rail', from: [-4, 0, -1], to: [4, 1, 1], rotation: [0, -90, 0], origin: [0, 0, 0],
		faces: { up: { uv: [0, 0, 8, 8], texture: 'L/0' }, north: { uv: [0, 0, 8, 8], texture: 'L/0' } },
	};
	const tieFace = {
		name: 'tie', from: [-6, 0, -0.5], to: [6, 2, 0.5],
		faces: { up: { uv: [0, 0, 12, 12], texture: 'T/0' } },
	};
	const cfgPortal = {
		gaugePx: 8, heightPx: 2,
		parts: {
			left: { cubes: [railFace], bbox: { min: [-4, 0, -1], max: [4, 1, 1] }, xMid: 0 },
			right: { cubes: [railFace], bbox: { min: [-4, 0, -1], max: [4, 1, 1] }, xMid: 0 },
			tie: { cubes: [tieFace], bbox: { min: [-6, 0, -0.5], max: [6, 2, 0.5] }, xMid: 0 },
		},
		portal: { trackTexture: 'P/track', mipTexture: 'P/mip' },
	};
	const shape = L.teleport(cfgPortal, 'z');
	const overlays = shape.cubes.filter((c) => c.name === 'teleport_left' || c.name === 'teleport_right');
	assert.strictEqual(overlays.length, 2, `应生成 2 个传送门覆层，实际 ${overlays.length}`);
	const left = overlays.find((c) => c.name === 'teleport_left');
	const right = overlays.find((c) => c.name === 'teleport_right');
	assert(left && right, '覆层应为 teleport_left / teleport_right');
	// 左覆层在 x 负半轴、右覆层在正半轴
	assert(left.to[0] <= 0 && left.from[0] < 0, '左覆层应位于负半轴');
	assert(right.from[0] >= 0 && right.to[0] > 0, '右覆层应位于正半轴');
	// 覆层沿轨道铺满：z 跨度 = 轨道长度 16
	const zSpan =
		Math.max(...shape.cubes.flatMap((c) => [c.from[2], c.to[2]])) -
		Math.min(...shape.cubes.flatMap((c) => [c.from[2], c.to[2]]));
	assert.strictEqual(zSpan, 16, '覆层应沿 16px 轨道铺满');
	// 轨道/枕木铺 portal_track，覆层块贴 portal_track_mip
	const body = shape.cubes.filter((c) => c.name === 'rail' || c.name === 'tie');
	assert(body.length > 0, 'teleport 应含轨道/枕木');
	for (const b of body) {
		const texes = Object.values(b.faces ?? {}).map((f) => f?.texture).filter(Boolean);
		assert(texes.length > 0 && texes.every((t) => t === 'P/track'), '轨道/枕木面应铺 portal_track');
	}
	for (const o of overlays) {
		const texes = Object.values(o.faces ?? {}).map((f) => f?.texture).filter(Boolean);
		assert(texes.length > 0 && texes.every((t) => t === 'P/mip'), '覆层面应贴 portal_track_mip');
	}
	// teleport_x 旋转后仍有 2 覆层
	const shapeX = L.teleport(cfgPortal, 'x');
	assert.strictEqual(shapeX.cubes.filter((c) => c.name === 'teleport_left' || c.name === 'teleport_right').length, 2, 'teleport_x 也应生成 2 覆层');
});

t('传送门覆层包裹枕木：各包半边（不含钢轨），尺寸取枕木包围盒 + 余量', () => {
	// testCfg 枕木：x -6..6、y 0..2 → tieHalfW=6、tieTop=2；余量 0.1
	const cfgPortal = { ...testCfg, gaugePx: 8, heightPx: 2, portal: { trackTexture: 'P/track', mipTexture: 'P/mip' } };
	const shape = L.teleport(cfgPortal, 'z');
	const overlays = shape.cubes.filter((c) => c.name === 'teleport_left' || c.name === 'teleport_right');
	// 宽度 = tieHalfW + margin = 6.1（左从 -6.1..0，右从 0..6.1）
	const widths = overlays.map((c) => Math.max(c.to[0] - c.from[0], c.from[0] - c.to[0]));
	assert(widths.every((w) => Math.abs(w - 6.1) < 1e-9), `覆层宽应为 tieHalfW(6)+margin(0.1)=6.1，实际 ${widths}`);
	// 高度：-margin..min(tieTop+margin, heightPx) = -0.1..2（包裹枕木且不高于钢轨底面，不含钢轨）
	assert(
		overlays.every((c) => Math.abs(c.from[1] + 0.1) < 1e-9 && Math.abs(c.to[1] - 2) < 1e-9),
		'覆层 y 应为 -margin..min(tieTop+margin, heightPx)（包裹枕木，不高于钢轨底面）'
	);
});

// ── 传送门纹理独立可选：无 mip 不生成覆层，无 track 用默认纹理 ──
t('只给 track（无 mip）：轨道/枕木铺 portal_track，但不生成覆层块', () => {
	const onlyTrack = { ...testCfg, portal: { trackTexture: 'P/track' } };
	const shape = L.teleport(onlyTrack, 'z');
	assert(shape.cubes.every((c) => !c.name?.startsWith('teleport_')), '无 mip 时不应生成覆层块');
	// 无 mip 时 teleport 与只有 body 重映射（无覆层）一致；z 跨度仍是直轨 16
	const zSpan =
		Math.max(...shape.cubes.flatMap((c) => [c.from[2], c.to[2]])) -
		Math.min(...shape.cubes.flatMap((c) => [c.from[2], c.to[2]]));
	assert.strictEqual(zSpan, 16, '无覆层时应仍是 16px 直轨');
});

t('只给 mip（无 track）：生成 2 覆层，轨道/枕木保持默认纹理', () => {
	const railFace = {
		name: 'rail', from: [-4, 0, -1], to: [4, 1, 1], rotation: [0, -90, 0], origin: [0, 0, 0],
		faces: { up: { uv: [0, 0, 8, 8], texture: 'L/0' }, north: { uv: [0, 0, 8, 8], texture: 'L/0' } },
	};
	const tieFace = {
		name: 'tie', from: [-6, 0, -0.5], to: [6, 2, 0.5],
		faces: { up: { uv: [0, 0, 12, 12], texture: 'T/0' } },
	};
	const onlyMip = {
		gaugePx: 8, heightPx: 2,
		parts: {
			left: { cubes: [railFace], bbox: { min: [-4, 0, -1], max: [4, 1, 1] }, xMid: 0 },
			right: { cubes: [railFace], bbox: { min: [-4, 0, -1], max: [4, 1, 1] }, xMid: 0 },
			tie: { cubes: [tieFace], bbox: { min: [-6, 0, -0.5], max: [6, 2, 0.5] }, xMid: 0 },
		},
		portal: { mipTexture: 'P/mip' },
	};
	const shape = L.teleport(onlyMip, 'z');
	const overlays = shape.cubes.filter((c) => c.name === 'teleport_left' || c.name === 'teleport_right');
	assert.strictEqual(overlays.length, 2, '无 track 只给 mip 时也应生成 2 个覆层');
	for (const o of overlays) {
		const texes = Object.values(o.faces ?? {}).map((f) => f?.texture).filter(Boolean);
		assert(texes.every((t) => t === 'P/mip'), '覆层应贴 portal_track_mip');
	}
	// 轨道/枕木不重映射：仍保持零件默认纹理（L/0、T/0）
	const body = shape.cubes.filter((c) => c.faces && (c.name === 'rail' || c.name === 'tie'));
	assert(body.length > 0, '应含带面的轨道/枕木');
	for (const b of body) {
		const texes = Object.values(b.faces ?? {}).map((f) => f?.texture).filter(Boolean);
		assert(texes.length > 0 && texes.every((t) => t !== 'P/track'), '无 track 时轨道/枕木不应重映射为 portal_track');
	}
});

// ── wholeModelYOffset：整体 Y 偏移（含枕木与轨道）──
t('wholeModelYOffset 抬升整个模型（枕木、钢轨、传送门覆层及旋转枢轴）', () => {
	const cfg5 = { ...testCfg, wholeModelYOffset: 5 };
	const shapes0 = L.allShapes(testCfg);
	const shapes5 = L.allShapes(cfg5);
	assert.strictEqual(shapes0.length, shapes5.length);
	for (let i = 0; i < shapes0.length; i++) {
		const s0 = shapes0[i];
		const s5 = shapes5[i];
		assert.strictEqual(s0.cubes.length, s5.cubes.length, `${s0.id} cube 数应一致`);
		for (let j = 0; j < s0.cubes.length; j++) {
			const c0 = s0.cubes[j];
			const c5 = s5.cubes[j];
			assert.strictEqual(c5.from[1] - c0.from[1], 5, `${s0.id}[${j}] from.y 应 +5`);
			assert.strictEqual(c5.to[1] - c0.to[1], 5, `${s0.id}[${j}] to.y 应 +5`);
			// 旋转立方体（如 ascending）的枢轴 origin 也应随偏移抬升
			if (c0.origin) {
				assert.strictEqual(c5.origin[1] - c0.origin[1], 5, `${s0.id}[${j}] origin.y 应 +5`);
			}
		}
	}
	// 默认（缺省）不偏移：allShapes 原配置的钢轨仍抬升到 heightPx、枕木落 xz 平面
	const zs = L.straightZ(testCfg);
	for (const c of zs) {
		if (c.name === 'rail') assert.strictEqual(c.from[1], 2, '缺省整体偏移应为 0');
		else if (c.name === 'tie') assert.strictEqual(c.from[1], 0, '缺省整体偏移应为 0（枕木落 xz 平面）');
	}
});

// ── 镜像：mirrorPartYz（右轨 = 左轨沿其中心 YZ 平面镜像）──
t('mirrorPartYz：几何关于 xMid 的 YZ 平面反射（非对称零件左右互换）', () => {
	// 两个不对称盒子，整体 bbox 中心 xMid = (-6+5)/2 = -0.5
	const asym = {
		cubes: [
			{ name: 'A', from: [-6, 0, 0], to: [-2, 4, 16] },
			{ name: 'B', from: [1, 0, 0], to: [5, 4, 16] },
		],
		bbox: { min: [-6, 0, 0], max: [5, 4, 16] },
		xMid: -0.5,
	};
	const m = L.mirrorPartYz(asym);
	// A 沿 xMid=-0.5 反射到 B 的位置，B 反射到 A 的位置（from<to 保持）
	assert.deepStrictEqual(m.cubes[0].from, [1, 0, 0], 'A 应反射到右侧 B 的位置');
	assert.deepStrictEqual(m.cubes[0].to, [5, 4, 16]);
	assert.deepStrictEqual(m.cubes[1].from, [-6, 0, 0], 'B 应反射到左侧 A 的位置');
	assert.deepStrictEqual(m.cubes[1].to, [-2, 4, 16]);
	// 中心不变：反射后 bbox 仍关于 xMid 对称
	assert.strictEqual(m.xMid, -0.5);
});

t('mirrorPartYz：关于自身中心的镜像是自逆（对合）', () => {
	const asym = {
		cubes: [
			{ name: 'A', from: [-6, 0, 0], to: [-2, 4, 16] },
			{ name: 'B', from: [1, 0, 0], to: [5, 4, 16], rotation: [30, 45, 90], origin: [0, 2, 8] },
		],
		bbox: { min: [-6, 0, 0], max: [5, 4, 16] },
		xMid: -0.5,
	};
	const twice = L.mirrorPartYz(L.mirrorPartYz(asym));
	assert.deepStrictEqual(twice.cubes, asym.cubes, '镜像两次应还原（几何/旋转/origin 不变）');
});

t('mirrorPartYz：旋转 ry/rz 取反、origin.x 反射，rx 不变', () => {
	const part = {
		cubes: [{ name: 'r', from: [0, 0, 0], to: [4, 4, 4], rotation: [30, 90, 45], origin: [3, 0, 5] }],
		bbox: { min: [0, 0, 0], max: [4, 4, 4] },
		xMid: 2,
	};
	const m = L.mirrorPartYz(part);
	assert.deepStrictEqual(m.cubes[0].rotation, [30, -90, -45], '旋转应取反 ry/rz、保留 rx');
	assert.deepStrictEqual(m.cubes[0].origin, [1, 0, 5], 'origin.x 应反射，y/z 不变');
});

t('mirrorPartYz：面 east↔west 交换，uv 盒 u 轴反向 + rotation 取反', () => {
	const part = {
		cubes: [
			{
				name: 'f',
				from: [-2, 0, 0],
				to: [2, 4, 16],
				faces: {
					east: { uv: [10, 20, 30, 40], rotation: 90, texture: '0' },
					west: { uv: [0, 0, 1, 1], texture: '0' },
					north: { uv: [50, 60, 70, 80], rotation: 270 },
					up: { uv: [5, 5, 6, 6], rotation: 180 },
				},
			},
		],
		bbox: { min: [-2, 0, 0], max: [2, 4, 16] },
		xMid: 0,
	};
	const m = L.mirrorPartYz(part);
	const f = m.cubes[0].faces;
	// east → west：uv 盒 u0/u1 交换 [u1,v0,u0,v1]，旋转 -90 → 270
	assert.deepStrictEqual(f.west.uv, [30, 20, 10, 40], 'east 面应映射到 west 且 u 轴反向');
	assert.strictEqual(f.west.rotation, 270, '旋转 90° 取反应为 270°');
	assert.strictEqual(f.west.texture, '0', '纹理引用应保留');
	// west → east：无旋转的面保持无旋转（不引入 rotation: 0）
	assert.deepStrictEqual(f.east.uv, [1, 0, 0, 1], 'west 面应映射到 east 且 u 轴反向');
	assert.strictEqual(f.east.rotation, undefined);
	// north/up 方向不变，仅 u 轴反向 + rotation 取反
	assert.deepStrictEqual(f.north.uv, [70, 60, 50, 80]);
	assert.strictEqual(f.north.rotation, 90, '270° 取反应为 90°');
	assert.deepStrictEqual(f.up.uv, [6, 5, 5, 6]);
	assert.strictEqual(f.up.rotation, 180);
	// 面映射也是自逆：镜像两次还原（含 uv / rotation / texture）
	const twice = L.mirrorPartYz(m);
	assert.deepStrictEqual(twice.cubes[0].faces, part.cubes[0].faces, '面镜像两次应还原');
});

t('mirrorPartYz：保留纹理（textures / textureSize）供右轨复用左轨的源纹理', () => {
	const part = {
		cubes: [{ name: 'f', from: [-2, 0, 0], to: [2, 4, 16], faces: { east: { uv: [0, 0, 1, 1], texture: '0' } } }],
		bbox: { min: [-2, 0, 0], max: [2, 4, 16] },
		xMid: 0,
		textureSize: [64, 64],
		textures: [{ key: '0', name: 'rail.png', source: 'data:x', width: 64, height: 64 }],
	};
	const m = L.mirrorPartYz(part);
	assert.deepStrictEqual(m.textureSize, [64, 64]);
	assert.strictEqual(m.textures[0].key, '0');
	assert.strictEqual(m.cubes[0].faces.west.texture, '0', '镜像面仍引用同一张源纹理');
	// 不污染入参
	assert.deepStrictEqual(part.cubes[0].faces.east.uv, [0, 0, 1, 1]);
});

console.log(`\n✅ logic.test.js 全部通过（${passed} 项）`);
