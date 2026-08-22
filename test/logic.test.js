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
	assert.deepStrictEqual(L.symmetryPointForFormat('free'), [0, 0, 0]);
	assert.deepStrictEqual(L.symmetryPointForFormat(undefined), [0, 0, 0]);
});

t('isFreeModelFormat：free/generic 为自由模型，java 非', () => {
	assert.strictEqual(L.isFreeModelFormat('free'), true, 'free 是自由模型格式');
	assert.strictEqual(L.isFreeModelFormat('generic'), true, 'generic 是自由模型的旧名');
	assert.strictEqual(L.isFreeModelFormat('java_block'), false);
	assert.strictEqual(L.isFreeModelFormat('java_item'), false);
	assert.strictEqual(L.isFreeModelFormat(undefined), false);
});

t('examplePartBox：示例钢轨/枕木为长方体，尺寸参考 test/sample_parts 并居中于对称点', () => {
	// java_block 对称点 (8,8)：钢轨 2.4 宽 × 2.8 高 × 8 长，枕木 32 宽 × 4 高 × 3.5 深，底 y=0
	assert.deepStrictEqual(L.examplePartBox('rail', 'java_block'), { from: [6.8, 0, 4], to: [9.2, 2.8, 12] });
	assert.deepStrictEqual(L.examplePartBox('tie', 'java_block'), { from: [-8, 0, 6.25], to: [24, 4, 9.75] });
	// 自由模型对称点 (0,0)
	assert.deepStrictEqual(L.examplePartBox('rail', 'free'), { from: [-1.2, 0, -4], to: [1.2, 2.8, 4] });
	assert.deepStrictEqual(L.examplePartBox('tie', 'free'), { from: [-16, 0, -1.75], to: [16, 4, 1.75] });
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
	assert.deepStrictEqual(L.outputOffsetForFormat('free'), [0, 0, 0]);
	assert.deepStrictEqual(L.outputOffsetForFormat(undefined), [0, 0, 0]);
});

t('shapeOutputOffset：轨道方向形状在任何输出格式都平移到 xz(8,8)（Create 兼容）', () => {
	// 方向形状（非基础分组）在任何格式下都居中于 xz(8,8)：Java 画布对称点 = 自由模型导出时
	// Create 自身轨道模型的中心。基础分组（tie/segment_left/segment_right）不偏移（见 buildBaseParts）。
	assert.deepStrictEqual(L.shapeOutputOffset(), [8, 0, 8]);
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

t('parseBbTextures：无 uv_width 的纹理回退到模型 resolution（不落到 16）', () => {
	const json = {
		meta: { model_format: 'java_block' },
		resolution: { width: 64, height: 64 },
		textures: [{ name: 'rail.png', id: '1', source: 'data:image/png;base64,AAA' }],
	};
	const { textureSize, textures } = L.parseBbTextures(json);
	assert.deepStrictEqual(textureSize, [64, 64]);
	assert.strictEqual(textures[0].width, 64, '无 uv_width 时应取模型 resolution 64，而非 16');
	assert.strictEqual(textures[0].height, 64);
});

t('formatUsesPerTextureUv：仅 free/generic 为逐纹理 UV（Blockbench 默认 false），override 优先', () => {
	// 对应 Format.per_texture_uv_size：只有 free/generic 设 true（java_block/java_item/modded_entity 等都是默认 false）
	assert.strictEqual(L.formatUsesPerTextureUv('free'), true);
	assert.strictEqual(L.formatUsesPerTextureUv('generic'), true);
	assert.strictEqual(L.formatUsesPerTextureUv('java_block'), false);
	assert.strictEqual(L.formatUsesPerTextureUv('modded_entity'), false, 'modded_entity 默认 per_texture_uv_size=false（画布 UV）');
	assert.strictEqual(L.formatUsesPerTextureUv('bedrock'), false);
	assert.strictEqual(L.formatUsesPerTextureUv(undefined), false);
	// 传入真实格式对象的 per_texture_uv_size 时以它为准（绕开 id 猜测）
	assert.strictEqual(L.formatUsesPerTextureUv('free', false), false);
	assert.strictEqual(L.formatUsesPerTextureUv('modded_entity', true), true);
});

t('textureUvSize：画布优先（per_texture_uv=false，忽略不一致 uv_width），free 用逐纹理 uv_width', () => {
	// java_block 等画布 UV 格式：Texture.getUVWidth() 返回画布尺寸（64），纹理 uv_width 16 被忽略
	assert.deepStrictEqual(L.textureUvSize(false, { uv_width: 16, uv_height: 16 }, [64, 64]), [64, 64]);
	// free（逐纹理 UV）：uv_width 优先
	assert.deepStrictEqual(L.textureUvSize(true, { uv_width: 32, uv_height: 32 }, [64, 64]), [32, 32]);
	// 双方缺省回退到 16
	assert.deepStrictEqual(L.textureUvSize(false, {}, undefined), [16, 16]);
	// parseBbTextures 经 textureUvSize：java_block 纹理 uv_width 16 也取 resolution 64
	const part = L.parseBbTextures({
		meta: { model_format: 'java_block' },
		resolution: { width: 64, height: 64 },
		textures: [{ name: 'rail.png', id: '1', uv_width: 16, uv_height: 16, source: 'data:image/png;base64,AAA' }],
	});
	assert.strictEqual(part.textures[0].width, 64, 'java_block 纹理 uv_width 16 应被画布 64 覆盖');
});

t('parseBbTextures：free 模型分辨率不是 UV 尺寸——resolution 16 但 uv_width 64 取 64（回归）', () => {
	// 用户真实样例 test_rail_obj.bbmodel：free、resolution 16×16、纹理 uv_width 64×64。
	// UV 编辑器显示 64×64（getUVWidth=uv_width），零件纹理/分辨率必须取 64，而不是画布 16。
	const part = L.parseBbTextures({
		meta: { model_format: 'free' },
		resolution: { width: 16, height: 16 },
		textures: [{ name: 'standard_track_tie.png', id: '4', uv_width: 64, uv_height: 64, source: 'data:image/png;base64,AAA' }],
	});
	assert.deepStrictEqual(part.textureSize, [64, 64], 'free 零件分辨率应为纹理 UV 尺寸 64，而非模型 resolution 16');
	assert.strictEqual(part.textures[0].width, 64);
	assert.strictEqual(part.textures[0].height, 64);
});

t('parseBbTextures：per_texture_uv=false 的 modded_entity 用画布（override 生效）', () => {
	// modded_entity 默认 per_texture_uv_size=false：Texture.getUVWidth()=Project.texture_width（画布）。
	// 传入真实格式标志后应取画布 64，而不是纹理 uv_width 32。
	const part = L.parseBbTextures(
		{
			meta: { model_format: 'modded_entity' },
			resolution: { width: 64, height: 64 },
			textures: [{ name: 'rail.png', id: '1', uv_width: 32, uv_height: 32, source: 'data:image/png;base64,AAA' }],
		},
		false
	);
	assert.deepStrictEqual(part.textureSize, [64, 64], 'modded_entity 零件分辨率应为画布 64');
	assert.strictEqual(part.textures[0].width, 64, 'modded_entity 纹理 UV 尺寸应为画布 64');
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
	assert.strictEqual(shapes.length, 11, '含 mesh 时轨道形状仍照常生成（只用 cube 部分）');
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

t('targetFormatForParts：含 mesh → free，全 cube → Java 方块/物品', () => {
	assert.strictEqual(L.targetFormatForParts([{ hasMesh: true }, {}], 'java_block'), 'free', '任一零件含 mesh → 自由模型');
	assert.strictEqual(L.targetFormatForParts([{ hasMesh: false }, {}], 'java_block'), 'java_block');
	assert.strictEqual(L.targetFormatForParts([{}, {}], 'java_item'), 'java_item');
	assert.strictEqual(L.targetFormatForParts([{}, {}], 'free'), 'java_block', '非 Java 项目全 cube 默认 java_block');
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
		meta: { model_format: 'free' },
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

t('translateMesh / liftMesh 平移 mesh 顶点（origin 同步）', () => {
	const mesh = {
		name: 'm',
		vertices: { '0': [1, 2, 3], '1': [4, 5, 6] },
		faces: {},
		origin: [10, 10, 10],
	};
	const t = L.translateMesh(mesh, [1, 0, -1]);
	assert.deepStrictEqual(t.vertices['0'], [2, 2, 2], '顶点应平移');
	assert.deepStrictEqual(t.origin, [11, 10, 9], 'origin 应同步平移');
	assert.deepStrictEqual(mesh.vertices['0'], [1, 2, 3], '不污染入参');
	const lifted = L.liftMesh(mesh, 5);
	assert.deepStrictEqual(lifted.vertices['1'], [4, 10, 6], 'lift 即沿 Y 平移');
});

t('rotateMesh 绕枢轴烘焙旋转进顶点（world′ = pivot + R·(world−pivot)）', () => {
	const mesh = {
		name: 'm',
		vertices: { '0': [1, 0, 0], '1': [-1, 0, 0], '2': [0, 2, 0] },
		faces: {},
		origin: [0, 0, 0],
	};
	// 绕原点 Y +90°：[1,0,0] → [0,0,1]；[-1,0,0] → [0,0,-1]
	const r = L.rotateMesh(mesh, [0, 90, 0], [0, 0, 0]);
	assert(Math.abs(r.vertices['0'][0]) < 1e-9 && Math.abs(r.vertices['0'][2] - 1) < 1e-9, `顶点应旋转为 [0,0,1]，实际 ${r.vertices['0']}`);
	assert(Math.abs(r.vertices['1'][2] + 1) < 1e-9, `顶点应旋转为 [0,0,-1]，实际 ${r.vertices['1']}`);
	// 绕非零枢轴：[2,0,0] 绕枢轴 [1,0,0] Y+90° → rel [1,0,0] → [0,0,1]，world [1,0,1]
	const r2 = L.rotateMesh({ ...mesh, vertices: { '0': [2, 0, 0] } }, [0, 90, 0], [1, 0, 0]);
	assert(Math.abs(r2.vertices['0'][0] - 1) < 1e-9 && Math.abs(r2.vertices['0'][2] - 1) < 1e-9, `绕枢轴旋转错误，实际 ${r2.vertices['0']}`);
	assert.strictEqual(r2.origin, undefined, '烘焙后 origin 应置空');
});

t('含 mesh 零件的 allShapes：11 个方向形状都携带变换后的 mesh 几何', () => {
	// 左/右轨 + 枕木都带 mesh（mesh-only 钢轨：0 cube，只贡献 mesh 几何）
	const meshPart = {
		cubes: [],
		meshes: [
			{
				name: 'railmesh',
				vertices: { '0': [-1, 0, 0], '1': [1, 0, 0], '2': [1, 4, 0], '3': [-1, 4, 0], '4': [-1, 0, 16], '5': [1, 0, 16], '6': [1, 4, 16], '7': [-1, 4, 16] },
				faces: { '0': { vertices: ['0', '1', '2', '3'] } },
			},
		],
		bbox: { min: [-1, 0, 0], max: [1, 4, 16] },
		xMid: 0,
		hasMesh: true,
		textureSize: [16, 16],
	};
	const tieMeshPart = {
		...meshPart,
		bbox: { min: [-1, 0, 0], max: [1, 4, 16] },
	};
	const cfg = {
		gaugePx: 8,
		heightPx: 2,
		parts: { left: meshPart, right: JSON.parse(JSON.stringify(meshPart)), tie: tieMeshPart },
	};
	const shapes = L.allShapes(cfg);
	assert.strictEqual(shapes.length, 11);
	// 每个形状都有 mesh 几何，且每个 mesh 的面顶点引用都能解析到自身顶点
	for (const s of shapes) {
		assert(Array.isArray(s.meshes) && s.meshes.length > 0, `${s.id} 应携带 mesh 几何`);
		for (const m of s.meshes) {
			for (const f of Object.values(m.faces)) {
				for (const vk of f.vertices ?? []) {
					assert(m.vertices[vk], `${s.id} mesh 面引用缺失顶点 ${vk}`);
				}
			}
		}
	}
	// 直轨左轨 mesh 应位于 x=−g/2=−4（钢轨沿 Z 摆放、抬升 heightPx=2）——用 straight('z') 检查
	const zStraight = L.straight(cfg, 'z');
	const leftRailMesh = zStraight.meshes.find((m) => m.name === 'railmesh');
	assert(leftRailMesh, 'z 直轨应含钢轨 mesh');
	const xs = Object.values(leftRailMesh.vertices).map((v) => v[0]);
	assert(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 + 4) < 1e-9, `左轨 mesh 中心应在 x=-4，实际 ${(Math.min(...xs) + Math.max(...xs)) / 2}`);
	// 左轨 y 应抬升到 heightPx=2（底面 y=2），且轨道沿 Z（z 跨度大）
	const ys = Object.values(leftRailMesh.vertices).map((v) => v[1]);
	const zs = Object.values(leftRailMesh.vertices).map((v) => v[2]);
	assert(Math.min(...ys) > 1.9, `左轨 mesh 底面应抬升到 heightPx=2，实际 ${Math.min(...ys)}`);
	assert(Math.max(...zs) - Math.min(...zs) > 10, '左轨 mesh 应沿 Z 摆放');
	// x_ortho 的 mesh 应被旋转 90°（钢轨变为 x 跨度）
	const xo = shapes.find((s) => s.id === 'x_ortho');
	const xoMesh = xo.meshes[0];
	const xoXs = Object.values(xoMesh.vertices).map((v) => v[0]);
	assert(Math.max(...xoXs) - Math.min(...xoXs) > 10, 'x_ortho 的钢轨 mesh 应旋转 90°（x 跨度大）');
	// diag 的 mesh 应绕 Y ±45°（顶点 x/z 都非零）
	const diag = shapes.find((s) => s.id === 'diag');
	const diagMesh = diag.meshes.find((m) => m.name === 'railmesh');
	const dvs = Object.values(diagMesh.vertices);
	const rotated45 = dvs.some((v) => Math.abs(v[0]) > 0.5 && Math.abs(v[2]) > 0.5);
	assert(rotated45, 'diag 的 mesh 应被旋转 45°（x 与 z 均非零）');
});

// ── 回归：45° 斜轨的 mesh 方向必须与 cube 一致 ──
// 背景：Blockbench 渲染 Cube.rotation [0,+,0] 用标准 R_y（+angle 把 +Z 转向 +X），而本插件的
// rotateVec/rotY 是 R_y 的反方向。cube 走 rotation 字段、mesh 走烘焙顶点，若给 mesh 烘 +45°，会落在
// 与 cube 相反的对角线上（枕木 mesh 与枕木 cube 交叉）。修复：mesh 的 Y 旋转取反，与 cube 同向。
/** 顶点云的主轴方向（PCA 最大特征向量，x 归正） */
function meshDir(verts) {
	const n = verts.length;
	const mean = [0, 0, 0];
	for (const v of verts) for (let i = 0; i < 3; i++) mean[i] += v[i];
	for (let i = 0; i < 3; i++) mean[i] /= n;
	let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
	for (const v of verts) {
		const dx = v[0] - mean[0], dy = v[1] - mean[1], dz = v[2] - mean[2];
		xx += dx * dx; xy += dx * dy; xz += dx * dz;
		yy += dy * dy; yz += dy * dz; zz += dz * dz;
	}
	let d = [1, 0, 0];
	for (let i = 0; i < 50; i++) {
		const nx = xx * d[0] + xy * d[1] + xz * d[2];
		const ny = xy * d[0] + yy * d[1] + yz * d[2];
		const nz = xz * d[0] + yz * d[1] + zz * d[2];
		const l = Math.hypot(nx, ny, nz) || 1;
		d = [nx / l, ny / l, nz / l];
	}
	return d[0] < 0 ? d.map((v) => -v) : d;
}
/** 用标准 R_y（Blockbench 渲染 Cube.rotation 的约定）烘焙一个带 rotation 的 cube 的 8 个角点 */
function renderStdRY(c) {
	const a = (c.rotation[1] * Math.PI) / 180;
	const cos = Math.cos(a), sin = Math.sin(a);
	const p = c.origin;
	const pts = [];
	for (const x of [c.from[0], c.to[0]])
		for (const y of [c.from[1], c.to[1]])
			for (const z of [c.from[2], c.to[2]]) {
				const rel = [x - p[0], y - p[1], z - p[2]];
				pts.push([cos * rel[0] + sin * rel[2] + p[0], rel[1] + p[1], -sin * rel[0] + cos * rel[2] + p[2]]);
			}
	return pts;
}
const dot3 = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);

t('diag / diag_2：枕木 mesh 与枕木 cube 同向、钢轨 mesh 与之垂直（不再反向）', () => {
	// mesh-only 钢轨零件（Z 长 8px，与 Create 半块段一致）+ 带 cube 与 mesh 的枕木零件（X 长）
	const railMesh = {
		cubes: [],
		meshes: [{ name: 'railmesh', vertices: { '0': [-1, 0, -4], '1': [1, 0, -4], '2': [1, 4, -4], '3': [-1, 4, -4], '4': [-1, 0, 4], '5': [1, 0, 4], '6': [1, 4, 4], '7': [-1, 4, 4] }, faces: {} }],
		bbox: { min: [-1, 0, -4], max: [1, 4, 4] },
		xMid: 0, hasMesh: true,
	};
	const tieMixed = {
		cubes: [{ name: 'tie', from: [-8, 0, -1], to: [8, 1, 1] }],
		meshes: [{ name: 'tiemesh', vertices: { '0': [-8, 0, -1], '1': [8, 0, -1], '2': [8, 1, -1], '3': [-8, 1, -1], '4': [-8, 0, 1], '5': [8, 0, 1], '6': [8, 1, 1], '7': [-8, 1, 1] }, faces: {} }],
		bbox: { min: [-8, 0, -1], max: [8, 1, 1] },
		xMid: 0, hasMesh: true,
	};
	const cfgD = { gaugePx: 8, heightPx: 2, parts: { left: railMesh, right: JSON.parse(JSON.stringify(railMesh)), tie: tieMixed } };
	for (const mirror of [false, true]) {
		const label = mirror ? 'diag_2' : 'diag';
		const s = L.diagonal(cfgD, mirror, { tieInterval: 8 });
		const tieCube = s.cubes.find((c) => c.name === 'tie' && c.rotation);
		assert(tieCube, `${label} 应含旋转的枕木 cube`);
		const tieCubeDir = meshDir(renderStdRY(tieCube));
		const tieMesh = s.meshes.find((m) => m.name === 'tiemesh');
		assert(tieMesh, `${label} 应含枕木 mesh`);
		const tieMeshDir = meshDir(Object.values(tieMesh.vertices));
		assert(dot3(tieCubeDir, tieMeshDir) > 0.99, `${label} 枕木 mesh 应与枕木 cube 同向（dir cube=${tieCubeDir}, mesh=${tieMeshDir}）`);
		const rail = s.meshes.find((m) => m.name === 'railmesh');
		const railDir = meshDir(Object.values(rail.vertices));
		assert(dot3(tieMeshDir, railDir) < 0.1, `${label} 钢轨 mesh 应与枕木垂直（沿轨道方向）`);
	}
});

t('cross_d1_xo / cross_d2_xo：斜轨部分 mesh 与 cube 同向', () => {
	const railMesh = {
		cubes: [],
		meshes: [{ name: 'railmesh', vertices: { '0': [-1, 0, -4], '1': [1, 0, -4], '2': [1, 4, -4], '3': [-1, 4, -4], '4': [-1, 0, 4], '5': [1, 0, 4], '6': [1, 4, 4], '7': [-1, 4, 4] }, faces: {} }],
		bbox: { min: [-1, 0, -4], max: [1, 4, 4] },
		xMid: 0, hasMesh: true,
	};
	const tieMixed = {
		cubes: [{ name: 'tie', from: [-8, 0, -1], to: [8, 1, 1] }],
		meshes: [{ name: 'tiemesh', vertices: { '0': [-8, 0, -1], '1': [8, 0, -1], '2': [8, 1, -1], '3': [-8, 1, -1], '4': [-8, 0, 1], '5': [8, 0, 1], '6': [8, 1, 1], '7': [-8, 1, 1] }, faces: {} }],
		bbox: { min: [-8, 0, -1], max: [8, 1, 1] },
		xMid: 0, hasMesh: true,
	};
	const cfgX = { gaugePx: 8, heightPx: 2, parts: { left: railMesh, right: JSON.parse(JSON.stringify(railMesh)), tie: tieMixed } };
	for (const id of ['cross_d1_xo', 'cross_d2_xo']) {
		const s = L.allShapes(cfgX).find((x) => x.id === id);
		// 交叉里每个旋转枕木 cube 都应有同向的枕木 mesh（逐段比，避免直轨 X 长枕木干扰总和 PCA）
		const rotTies = s.cubes.filter((c) => c.name === 'tie' && c.rotation);
		assert(rotTies.length >= 3, `${id} 应含旋转的枕木 cube`);
		for (const tc of rotTies) {
			const tcDir = meshDir(renderStdRY(tc));
			const tm = s.meshes.filter((m) => m.name === 'tiemesh').find((m) => {
				const d = meshDir(Object.values(m.vertices));
				return dot3(tcDir, d) > 0.99;
			});
			assert(tm, `${id} 每个旋转枕木 cube 都应有同向的枕木 mesh`);
		}
	}
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

t('直轨 2 段 2 枕木，斜轨 / 上升轨 3 段 3 枕木', () => {
	const rail = makeRotatedRail(); // 烘焙后 8px 段
	const cfgR = { gaugePx: 8, heightPx: 2, parts: { left: rail, right: rail, tie: makeTiePart() } };
	// 直轨
	const zs = L.straightZ(cfgR, { tieInterval: 8 });
	assert.strictEqual(zs.filter((c) => c.name === 'rail').length / 2, 2, '直轨每侧应 2 段钢轨');
	assert.strictEqual(zs.filter((c) => c.name === 'tie').length, 2, '直轨应 2 根枕木');
	// 上升轨：与斜轨一样 3 段 / 3 枕木（长度 24px，不再是直轨的 16px）
	const asc = L.ascending(cfgR, 'north', { tieInterval: 8 });
	assert.strictEqual(asc.cubes.filter((c) => c.name === 'rail').length / 2, 3, '上升轨每侧应 3 段钢轨');
	assert.strictEqual(asc.cubes.filter((c) => c.name === 'tie').length, 3, '上升轨应 3 根枕木');
	// 斜轨
	const diag = L.diagonal(cfgR, false, { tieInterval: 8 });
	assert.strictEqual(diag.cubes.filter((c) => c.name === 'rail').length / 2, 3, '斜轨每侧应 3 段钢轨');
	assert.strictEqual(diag.cubes.filter((c) => c.name === 'tie').length, 3, '斜轨应 3 根枕木');
	// 对角交叉：每条对角各 3 根枕木（两条 = 6）
	const crossD = L.cross(cfgR, 'diag', { tieInterval: 8 });
	assert.strictEqual(crossD.cubes.filter((c) => c.name === 'tie').length, 6, '对角交叉应共 6 根枕木');
});

/** 计算 CubeSpec[] 应用各自旋转后的世界坐标最低 y（含整体偏移时再加 wholeY） */
function renderedMinYOf(cubes, wholeY = 0) {
	let minY = Infinity;
	for (const c of cubes) {
		const origin = c.origin ?? [0, 0, 0];
		const rot = c.rotation ?? [0, 0, 0];
		for (const x of [c.from[0], c.to[0]])
			for (const y of [c.from[1], c.to[1]])
				for (const z of [c.from[2], c.to[2]]) {
					const rel = [x - origin[0], y - origin[1], z - origin[2]];
					const r = L.rotateVec(rel, rot);
					minY = Math.min(minY, r[1] + origin[1] + wholeY);
				}
	}
	return minY;
}

t('ascending 整体抬升：最低点落在 xz 平面上（y≥0）', () => {
	const cfgR = { gaugePx: 8, heightPx: 2, parts: { left: makeRotatedRail(), right: makeRotatedRail(), tie: makeTiePart() } };
	for (const dir of ['south', 'north', 'east', 'west']) {
		const asc = L.ascending(cfgR, dir, { tieInterval: 8 });
		assert(renderedMinYOf(asc.cubes) >= 0, `ascending ${dir} 最低点应在 xz 平面之上（y≥0）`);
	}
});

t('ascending 抬升在整体 Y 偏移生效之后：整体偏移为负时仍保持最低点 ≥0', () => {
	const base = { gaugePx: 8, heightPx: 2, parts: { left: makeRotatedRail(), right: makeRotatedRail(), tie: makeTiePart() } };
	for (const wholeY of [-3, -2, -1, 0, 2, 5]) {
		// ascending 的抬升必须覆盖 applyWholeOffset 在形状返回后统一施加的整体偏移
		const asc = L.ascending({ ...base, wholeModelYOffset: wholeY }, 'south', { tieInterval: 8 });
		const applied = L.lift(asc.cubes, wholeY); // 模拟 applyWholeOffset
		assert(renderedMinYOf(applied) >= 0, `wholeModelYOffset=${wholeY} 时最低点应 ≥0，实际 ${renderedMinYOf(applied)}`);
	}
});

t('allShapes 只生成 11 种形状（多余形状由 blockstates 旋转表达）', () => {
	const shapes = L.allShapes(testCfg);
	const ids = shapes.map((s) => s.id);
	assert.strictEqual(shapes.length, 11);
	for (const id of ['x_ortho', 'diag', 'diag_2', 'ascending_south', 'teleport', 'cross_ortho', 'cross_diag', 'cross_d1_xo', 'cross_d2_xo', 'cross_d1_zo', 'cross_d2_zo']) {
		assert(ids.includes(id), `缺少 ${id}`);
	}
	// 由 blockstates 旋转表达、不再生成：z_ortho / ascending_n/e/w / teleport_x
	for (const id of ['z_ortho', 'ascending_north', 'ascending_east', 'ascending_west', 'teleport_x']) {
		assert(!ids.includes(id), `不应再生成 ${id}`);
	}
	// 每种形状至少有 2 个 cube
	for (const s of shapes) assert(s.cubes.length >= 2, `${s.id} 应有 >=2 个 cube`);
});

t('cross_d1_xo = 正对角 + X 直轨，cross_d2_xo = 负对角 + X 直轨（与参考 Kuayue 命名一致）', () => {
	const cfgR = { gaugePx: 8, heightPx: 2, parts: { left: makeRotatedRail(), right: makeRotatedRail(), tie: makeTiePart() } };
	const d1 = L.allShapes(cfgR).find((s) => s.id === 'cross_d1_xo');
	const d2 = L.allShapes(cfgR).find((s) => s.id === 'cross_d2_xo');
	// cross_d1_xo 应含正对角（LINE mod180=45）
	assert(d1.cubes.some((c) => (((c.rotation?.[1] ?? 0) % 180) + 180) % 180 === 45), 'cross_d1_xo 应含正对角');
	// cross_d2_xo 应含负对角（LINE mod180=135）
	assert(d2.cubes.some((c) => (((c.rotation?.[1] ?? 0) % 180) + 180) % 180 === 135), 'cross_d2_xo 应含负对角');
	// 两者都含 X 直轨（[0,270,0] = 顺时针 90°）
	for (const [name, s] of [['cross_d1_xo', d1], ['cross_d2_xo', d2]]) {
		assert(
			s.cubes.some((c) => c.rotation?.[1] === 270 && c.rotation[0] === 0 && c.rotation[2] === 0),
			`${name} 应含 X 直轨（[0,270,0]）`
		);
	}
});

t('cross_dN_zo = 基础「对角 + Z 直轨」不旋转；cross_dN_xo = 另一 zo 顺时针旋转 90°', () => {
	const cfgR = { gaugePx: 8, heightPx: 2, parts: { left: makeRotatedRail(), right: makeRotatedRail(), tie: makeTiePart() } };
	const all = L.allShapes(cfgR);
	const d1xo = all.find((s) => s.id === 'cross_d1_xo');
	const d1zo = all.find((s) => s.id === 'cross_d1_zo');
	const d2xo = all.find((s) => s.id === 'cross_d2_xo');
	const d2zo = all.find((s) => s.id === 'cross_d2_zo');
	// zo = 基础交叉（对角 + Z 直轨），不旋转：cross_d1_zo 正对角、cross_d2_zo 负对角，直轨未旋转
	assert(d1zo.cubes.some((c) => (((c.rotation?.[1] ?? 0) % 180) + 180) % 180 === 45), 'cross_d1_zo 应含正对角');
	assert(d2zo.cubes.some((c) => (((c.rotation?.[1] ?? 0) % 180) + 180) % 180 === 135), 'cross_d2_zo 应含负对角');
	for (const [name, s] of [['cross_d1_zo', d1zo], ['cross_d2_zo', d2zo]]) {
		assert(
			s.cubes.some((c) => !c.rotation && Math.abs(c.to[2] - c.from[2]) > Math.abs(c.to[0] - c.from[0])),
			`${name} 应含 Z 直轨（未旋转）`
		);
	}
	// xo = 另一 zo 顺时针旋转 90°（每个 cube 的 Y 旋转 −90，from/to 不变，枢轴统一）
	for (const [zo, xo] of [[d2zo, d1xo], [d1zo, d2xo]]) {
		assert(xo && zo, `缺少 ${xo?.id}`);
		assert.strictEqual(zo.cubes.length, xo.cubes.length, `${xo.id} cube 数应与 ${zo.id} 一致`);
		for (let i = 0; i < zo.cubes.length; i++) {
			const z = zo.cubes[i];
			const x = xo.cubes[i];
			assert.deepStrictEqual(x.from, z.from, `${xo.id}[${i}] from 应不变`);
			assert.deepStrictEqual(x.to, z.to, `${xo.id}[${i}] to 应不变`);
			const zY = z.rotation?.[1] ?? 0;
			const xY = x.rotation?.[1] ?? 0;
			assert.strictEqual((((xY - zY) % 360) + 360) % 360, 270, `${xo.id}[${i}] Y 旋转应 −90（${zY}→${xY}）`);
			assert(x.origin, `${xo.id}[${i}] 应设枢轴 origin`);
		}
	}
	// 方向语义：cross_d1_xo 正对角 + X 直轨、cross_d2_xo 负对角 + X 直轨，
	// 与 blockstates cr_pdx→cross_d1_xo / cr_ndx→cross_d2_xo 对应
	assert(d1xo.cubes.some((c) => (((c.rotation?.[1] ?? 0) % 180) + 180) % 180 === 45), 'cross_d1_xo 应含正对角（对应 cr_pdx）');
	assert(d2xo.cubes.some((c) => (((c.rotation?.[1] ?? 0) % 180) + 180) % 180 === 135), 'cross_d2_xo 应含负对角（对应 cr_ndx）');
	for (const xo of [d1xo, d2xo]) {
		assert(
			xo.cubes.some((c) => c.rotation?.[1] === 270 && c.rotation[0] === 0 && c.rotation[2] === 0),
			`${xo.id} 应含 X 直轨（[0,270,0]）`
		);
	}
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
	// ascending 缺省长度 = 3 × 枕木间距（24px，3 段钢轨 / 3 枕木）；
	// 枢轴 z = 该直轨平铺结果 z 的中心（测试零件 16px 段平铺 24px 会越界到 32px，
	// 中心落在越界后的视觉中心；真实 8px 段零件则精确居中于原点）
	const zs = L.straightZ(testCfg, { tieInterval: 8, length: 3 * 8 });
	const zsFlat = zs.flatMap((c) => [c.from[2], c.to[2]]);
	const zCenter = (Math.min(...zsFlat) + Math.max(...zsFlat)) / 2;
	assert.strictEqual(rail.origin[2], zCenter, `ascending 枢轴 z 应为轨道中心 ${zCenter}，实际 ${rail.origin[2]}`);
	assert.strictEqual(rail.origin[0], 0, '枢轴 x 应为轨道横向中心（Java 空间 8）');
	// 枢轴 y 在轨道高度之上（整体抬升把最低点顶到 xz 平面，origin 随 lift 一起平移）
	assert(rail.origin[1] >= testCfg.heightPx, `枢轴 y 应不低于轨道高度，实际 ${rail.origin[1]}`);
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

// ── export：Create/Kuayue 命名规范 + blockstates ──
t('TRACK_MODEL_FILES 覆盖全部 16 形状 + 3 基础分组', () => {
	const expected = ['z_ortho', 'x_ortho', 'diag', 'diag_2', 'ascending_south', 'ascending_north', 'ascending_east', 'ascending_west', 'teleport', 'teleport_x', 'cross_ortho', 'cross_diag', 'cross_d1_xo', 'cross_d1_zo', 'cross_d2_xo', 'cross_d2_zo', 'tie', 'segment_left', 'segment_right'];
	for (const id of expected) assert(id in L.TRACK_MODEL_FILES, `缺少 ${id}`);
});

t('TRACK_MODEL_FILES 命名映射（ascending 只留 s 变体、teleport 只留 z、4 个交叉模型都导出）', () => {
	assert.strictEqual(L.TRACK_MODEL_FILES.z_ortho, null, 'z_ortho 不导出（blockstate 用 x_ortho 旋转 90°）');
	assert.strictEqual(L.TRACK_MODEL_FILES.x_ortho, 'x_ortho.json');
	assert.strictEqual(L.TRACK_MODEL_FILES.diag, 'diag.json');
	assert.strictEqual(L.TRACK_MODEL_FILES.diag_2, 'diag_2.json');
	assert.strictEqual(L.TRACK_MODEL_FILES.ascending_south, 'ascending.json');
	assert.strictEqual(L.TRACK_MODEL_FILES.ascending_north, null, 'ascending 其余方向不单独导出（blockstate 用 y 旋转）');
	assert.strictEqual(L.TRACK_MODEL_FILES.teleport, 'teleport.json');
	assert.strictEqual(L.TRACK_MODEL_FILES.teleport_x, null, 'teleport_x 不导出（blockstate 用 y 旋转）');
	assert.strictEqual(L.TRACK_MODEL_FILES.cross_d1_xo, 'cross_d1_xo.json');
	assert.strictEqual(L.TRACK_MODEL_FILES.cross_d1_zo, 'cross_d1_zo.json', 'cross_d1_zo 单独导出（对角 + Z 直轨）');
	assert.strictEqual(L.TRACK_MODEL_FILES.cross_d2_xo, 'cross_d2_xo.json');
	assert.strictEqual(L.TRACK_MODEL_FILES.cross_d2_zo, 'cross_d2_zo.json', 'cross_d2_zo 单独导出（对角 + Z 直轨）');
	assert.strictEqual(L.TRACK_MODEL_FILES.tie, 'tie.json');
	assert.strictEqual(L.TRACK_MODEL_FILES.segment_left, 'segment_left.json');
	assert.strictEqual(L.TRACK_MODEL_FILES.segment_right, 'segment_right.json');
});

t('cleanGroupName 去掉「（…）」展示后缀', () => {
	assert.strictEqual(L.cleanGroupName('z_ortho（Z 直轨）'), 'z_ortho');
	assert.strictEqual(L.cleanGroupName('cross_ortho（正交交叉）'), 'cross_ortho');
	assert.strictEqual(L.cleanGroupName('ascending_south'), 'ascending_south');
	assert.strictEqual(L.cleanGroupName('tie'), 'tie');
});

t('modelFileName / blockstatesFileName', () => {
	assert.strictEqual(L.modelFileName('z_ortho'), null, 'z_ortho 不单独导出');
	assert.strictEqual(L.modelFileName('x_ortho'), 'x_ortho.json');
	assert.strictEqual(L.modelFileName('ascending_north'), null);
	assert.strictEqual(L.modelFileName('cross_d1_zo'), 'cross_d1_zo.json');
	assert.strictEqual(L.modelFileName('cross_d2_zo'), 'cross_d2_zo.json');
	assert.strictEqual(L.modelFileName('不存在'), null);
	assert.strictEqual(L.blockstatesFileName('standard'), 'standard_track.json');
	assert.strictEqual(L.blockstatesFileName('track'), 'track_track.json');
});

t('textureResourceName：去扩展名、小写、清洗、去重', () => {
	const used = new Set();
	assert.strictEqual(L.textureResourceName('Rail.PNG', used), 'rail');
	assert.strictEqual(L.textureResourceName('rail.png', used), 'rail_1', '重名应追加序号');
	assert.strictEqual(L.textureResourceName('portal track.png', used), 'portal_track');
	assert.strictEqual(L.textureResourceName('中文名.png', used), '___');
	assert.strictEqual(L.textureResourceName('', used), 'texture');
});

t('buildBlockstates：变体组合 = (none + 18 形状) × turn × waterlogged', () => {
	const bs = L.buildBlockstates('kuayue', 'standard');
	const keys = Object.keys(bs.variants);
	assert.strictEqual(keys.length, (1 + 18) * 2 * 2);
	// shape=none → 空气；直轨/斜轨 → 对应模型
	assert.strictEqual(bs.variants['shape=none,turn=false,waterlogged=false'].model, 'minecraft:block/air');
	// zo 直轨不单独导出，用 x_ortho 旋转 90° 表达（匹配参考 blockstates）
	assert.strictEqual(bs.variants['shape=zo,turn=false,waterlogged=false'].model, 'kuayue:block/track/standard/x_ortho');
	assert.strictEqual(bs.variants['shape=zo,turn=false,waterlogged=false'].y, 90);
	assert.strictEqual(bs.variants['shape=xo,turn=false,waterlogged=false'].model, 'kuayue:block/track/standard/x_ortho');
	assert.strictEqual(bs.variants['shape=xo,turn=false,waterlogged=false'].y, undefined);
	assert.strictEqual(bs.variants['shape=pd,turn=true,waterlogged=true'].model, 'kuayue:block/track/standard/diag');
	// ascending / teleport 用 y 旋转表达方向（south=0 不带 y）
	assert.strictEqual(bs.variants['shape=as,turn=false,waterlogged=false'].model, 'kuayue:block/track/standard/ascending');
	assert.strictEqual(bs.variants['shape=as,turn=false,waterlogged=false'].y, undefined);
	assert.strictEqual(bs.variants['shape=an,turn=false,waterlogged=false'].y, 180);
	assert.strictEqual(bs.variants['shape=ae,turn=false,waterlogged=false'].y, 270);
	assert.strictEqual(bs.variants['shape=aw,turn=false,waterlogged=false'].y, 90);
	assert.strictEqual(bs.variants['shape=ts,turn=false,waterlogged=false'].y, undefined);
	assert.strictEqual(bs.variants['shape=tw,turn=false,waterlogged=false'].y, 90);
	// 交叉：4 个交叉模型各自直接引用（匹配参考 Kuayue standard blockstates，无需 y 旋转；
	// d1=正对角、d2=负对角，zo=Z 直轨、xo=X 直轨）
	assert.strictEqual(bs.variants['shape=cr_o,turn=false,waterlogged=false'].model, 'kuayue:block/track/standard/cross_ortho');
	assert.strictEqual(bs.variants['shape=cr_pdx,turn=false,waterlogged=false'].model, 'kuayue:block/track/standard/cross_d1_xo');
	assert.strictEqual(bs.variants['shape=cr_pdx,turn=false,waterlogged=false'].y, undefined);
	assert.strictEqual(bs.variants['shape=cr_pdz,turn=false,waterlogged=false'].model, 'kuayue:block/track/standard/cross_d1_zo');
	assert.strictEqual(bs.variants['shape=cr_pdz,turn=false,waterlogged=false'].y, undefined);
	assert.strictEqual(bs.variants['shape=cr_ndx,turn=false,waterlogged=false'].model, 'kuayue:block/track/standard/cross_d2_xo');
	assert.strictEqual(bs.variants['shape=cr_ndx,turn=false,waterlogged=false'].y, undefined);
	assert.strictEqual(bs.variants['shape=cr_ndz,turn=false,waterlogged=false'].model, 'kuayue:block/track/standard/cross_d2_zo');
	assert.strictEqual(bs.variants['shape=cr_ndz,turn=false,waterlogged=false'].y, undefined);
	// 所有形状组合覆盖 turn/waterlogged
	for (const turn of [false, true]) {
		for (const wl of [false, true]) {
			assert(bs.variants[`shape=zo,turn=${turn},waterlogged=${wl}`], `缺 shape=zo,turn=${turn},waterlogged=${wl}`);
		}
	}
});

// ── export：4 种导出模式 + 判定 + OBJ / Bedrock / Java 新格式 ──
t('EXPORT_MODES 定义 4 种模式', () => {
	assert.strictEqual(L.EXPORT_MODES.length, 4);
	const ids = L.EXPORT_MODES.map((m) => m.id);
	assert.deepStrictEqual(ids, ['new_java', 'classic_java', 'bedrock', 'obj']);
	for (const m of L.EXPORT_MODES) assert(m.label && m.description, `模式 ${m.id} 应有标签与判定说明`);
});

t('groupNeedsObj：obj 模式全部回退；mesh 各模式回退', () => {
	const meshEl = { type: 'mesh', vertices: { a: [0, 0, 0] }, faces: { f: { vertices: ['a'], textureKey: 't0' } } };
	const cubeEl = { type: 'cube', from: [0, 0, 0], to: [4, 4, 4], faces: { up: { uv: [0, 0, 4, 4], textureKey: 't0' } } };
	assert.strictEqual(L.groupNeedsObj([cubeEl], 'obj'), true, 'obj 模式全部回退');
	for (const mode of ['new_java', 'classic_java', 'bedrock']) {
		assert.strictEqual(L.groupNeedsObj([meshEl], mode), true, `${mode} 含 mesh 应回退`);
		assert.strictEqual(L.groupNeedsObj([cubeEl], mode), false, `${mode} 纯 cube 不应回退`);
	}
});

t('groupNeedsObj：经典 Java 多轴旋转回退，新 Java / 基岩版不回退', () => {
	const single = { type: 'cube', from: [0, 0, 0], to: [4, 4, 4], rotation: [0, 45, 0], origin: [2, 2, 2], faces: { up: { textureKey: 't0' } } };
	const multi = { type: 'cube', from: [0, 0, 0], to: [4, 4, 4], rotation: [-45, 90, 0], origin: [2, 2, 2], faces: { up: { textureKey: 't0' } } };
	assert.strictEqual(L.groupNeedsObj([single], 'classic_java'), false, '经典单轴不回退');
	assert.strictEqual(L.groupNeedsObj([multi], 'classic_java'), true, '经典多轴回退');
	assert.strictEqual(L.groupNeedsObj([multi], 'new_java'), false, '新 Java 多轴不回退');
	assert.strictEqual(L.groupNeedsObj([multi], 'bedrock'), false, '基岩版多轴不回退');
});

t('groupNeedsObj：基岩版多纹理回退', () => {
	const twoTex = {
		type: 'cube',
		from: [0, 0, 0],
		to: [4, 4, 4],
		faces: { up: { textureKey: 't0' }, north: { textureKey: 't1' } },
	};
	assert.strictEqual(L.groupNeedsObj([twoTex], 'bedrock'), true, '基岩版多纹理回退');
	assert.strictEqual(L.groupNeedsObj([twoTex], 'new_java'), false, 'Java 多纹理不回退');
});

t('rotationToJava：经典单轴 {angle,axis,origin}', () => {
	assert.deepStrictEqual(L.rotationToJava([0, 45, 0], [8, 2, 8], 'classic_java'), { angle: 45, axis: 'y', origin: [8, 2, 8] });
	assert.deepStrictEqual(L.rotationToJava([-45, 0, 0], undefined, 'classic_java'), { angle: -45, axis: 'x', origin: [0, 0, 0] });
	assert.strictEqual(L.rotationToJava([0, 0, 0], [1, 2, 3], 'classic_java'), undefined, '无旋转不写');
});

t('rotationToJava：新格式多轴 / >45° → {x,y,z,origin}', () => {
	assert.deepStrictEqual(L.rotationToJava([-45, 90, 0], [8, 2, 8], 'new_java'), { x: -45, y: 90, z: 0, origin: [8, 2, 8] });
	assert.deepStrictEqual(L.rotationToJava([0, 90, 0], [8, 2, 8], 'new_java'), { x: 0, y: 90, z: 0, origin: [8, 2, 8] }, '|angle|>45 也走 {x,y,z}');
	assert.deepStrictEqual(L.rotationToJava([0, 45, 0], [8, 2, 8], 'new_java'), { angle: 45, axis: 'y', origin: [8, 2, 8] }, '单轴 ≤45 仍用 {angle,axis}');
});

t('buildJavaModelJson：经典无 format_version，新格式有 1.21.11', () => {
	const elements = [{ type: 'cube', from: [-2, 2, 0], to: [2, 6, 16], rotation: [0, 45, 0], origin: [8, 2, 8], faces: { up: { uv: [0, 0, 8, 8], textureKey: 't0' } } }];
	const tex = [{ key: 't0', resName: 'rail', width: 64, height: 64 }];
	const classic = L.buildJavaModelJson({ mode: 'classic_java', elements, textures: tex, textureSize: [64, 64], namespace: 'kuayue', trackId: 'track' });
	assert.strictEqual(classic.format_version, undefined, '经典不应有 format_version');
	assert.deepStrictEqual(classic.elements[0].rotation, { angle: 45, axis: 'y', origin: [8, 2, 8] });
	assert.deepStrictEqual(classic.elements[0].faces.up.uv, [0, 0, 2, 2], 'UV 像素 → 16 单位制');
	assert.strictEqual(classic.elements[0].faces.up.texture, '#0');
	const fresh = L.buildJavaModelJson({ mode: 'new_java', elements: [{ ...elements[0], rotation: [-45, 90, 0] }], textures: tex, textureSize: [64, 64], namespace: 'kuayue', trackId: 'track' });
	assert.strictEqual(fresh.format_version, '1.21.11');
	assert.deepStrictEqual(fresh.elements[0].rotation, { x: -45, y: 90, z: 0, origin: [8, 2, 8] }, '新格式多轴 {x,y,z}');
});

// buildObj 已从纯逻辑层移除：OBJ 导出现在把每个形状分组的 cube+mesh 合并成单个 Blockbench Mesh
// （官方 Mesh API），再用 Blockbench 自身的 OBJ codec（Codecs.obj.compile）序列化 —— 见
// src/build/export.ts 的 mergeGroupToMesh / exportGroupAsObj（Blockbench 层，冒烟测试覆盖）。
// 纯逻辑层只保留 forge:obj 引用 JSON 的生成（见下方 buildObjReferenceJson 用例）。

t('buildBedrockGeometry：bones / X 镜像 / pivot / per-face uv / up 翻转', () => {
	const cube = {
		type: 'cube',
		name: 'tie',
		from: [0, 0, 6],
		to: [16, 2, 10],
		faces: { up: { uv: [8, 0, 0, 1.25], rotation: 90, textureKey: 't0' }, down: { uv: [0, 0, 4, 4], textureKey: 't0' } },
	};
	const geo = L.buildBedrockGeometry({ identifier: 'geometry.track_tie', elements: [cube], textureSize: [64, 64] });
	assert.strictEqual(geo.format_version, '1.21.0');
	const g = geo['minecraft:geometry'][0];
	assert.strictEqual(g.description.identifier, 'geometry.track_tie');
	assert.strictEqual(g.description.texture_width, 64);
	const bcube = g.bones[0].cubes[0];
	// origin[0] 取反：from=[0,0,6] size=[16,2,4] → origin=[-(0+16), 0, 6]=[-16,0,6]
	assert.deepStrictEqual(bcube.origin, [-16, 0, 6]);
	assert.deepStrictEqual(bcube.size, [16, 2, 4]);
	// up 面 per-face uv：uv=[u1,v1]=[8,0] → 翻转 uv+=size([8,0]+[-8,1.25]=[0,1.25])、size 取反（[-8,1.25]→[8,-1.25]）
	assert.deepStrictEqual(bcube.uv.up.uv, [0, 1.25]);
	assert.deepStrictEqual(bcube.uv.up.uv_size, [8, -1.25]);
	assert.strictEqual(bcube.uv.up.uv_rotation, 90);
	// down 面 uv=[0,0,4,4] → uv=[0,0]、size=[4,4] → 翻转 uv=[4,4]、size=[-4,-4]
	assert.deepStrictEqual(bcube.uv.down.uv, [4, 4]);
	assert.deepStrictEqual(bcube.uv.down.uv_size, [-4, -4]);
});

t('buildBedrockGeometry：旋转立方体带 pivot + rx/ry 取反', () => {
	const cube = {
		type: 'cube',
		name: 'rail',
		from: [-2, 0, 0],
		to: [2, 4, 16],
		rotation: [-45, 90, 0],
		origin: [8, 2, 8],
		faces: { up: { uv: [0, 0, 16, 16], textureKey: 't0' } },
	};
	const geo = L.buildBedrockGeometry({ identifier: 'geometry.track_diag', elements: [cube], textureSize: [64, 64] });
	const bcube = geo['minecraft:geometry'][0].bones[0].cubes[0];
	assert.deepStrictEqual(bcube.pivot, [-8, 2, 8], 'pivot X 取反');
	assert.deepStrictEqual(bcube.rotation, [45, -90, 0], 'rx/ry 取反、rz 保留');
});

t('buildObjReferenceJson：forge:obj 引用 + flip_v + model 路径', () => {
	const ref = L.buildObjReferenceJson({ namespace: 'kuayue', trackId: 'track', shape: 'z_ortho', textures: [{ key: 't0', resName: 'rail', width: 64, height: 64 }] });
	assert.strictEqual(ref.loader, 'forge:obj');
	assert.strictEqual(ref.flip_v, true);
	assert.strictEqual(ref.model, 'kuayue:models/block/track/track/z_ortho.obj');
	assert.strictEqual(ref.textures['0'], 'kuayue:block/track/track/rail');
	assert.strictEqual(ref.textures.particle, 'kuayue:block/track/track/rail');
});

t('buildBedrockBlocksJson：每形状一个方块（texturePath 随资源目录）', () => {
	const blocks = L.buildBedrockBlocksJson({ namespace: 'kuayue', trackId: 'track', shapes: [{ id: 'tie', texturePath: 'blocks/track/tie' }, { id: 'segment_left', texturePath: 'custom/rail' }] });
	assert.strictEqual(blocks.format_version, '1.21.0');
	assert(blocks.blocks['kuayue:track_tie'], '应定义 kuayue:track_tie');
	assert.strictEqual(blocks.blocks['kuayue:track_tie'].geometry, 'geometry.track_tie');
	assert.strictEqual(blocks.blocks['kuayue:track_tie'].textures, 'blocks/track/tie');
	assert.strictEqual(blocks.blocks['kuayue:track_segment_left'].textures, 'custom/rail', 'textures 应随自定义资源目录');
});

t('textureResourcePath：纹理资源路径覆盖，缺省为 block/track/{id}', () => {
	assert.strictEqual(L.textureResourcePath('kuayue', 'track', 'rail'), 'kuayue:block/track/track/rail');
	assert.strictEqual(L.textureResourcePath('kuayue', 'track', 'rail', 'custom/track'), 'kuayue:custom/track/rail');
});

t('buildJavaModelJson：texturePathOf 逐纹理资源路径覆盖', () => {
	const elements = [{ type: 'cube', from: [-2, 2, 0], to: [2, 6, 16], faces: { up: { uv: [0, 0, 8, 8], textureKey: 't0' }, north: { uv: [0, 0, 8, 8], textureKey: 't1' } } }];
	const tex = [
		{ key: 't0', resName: 'rail', width: 64, height: 64 },
		{ key: 't1', resName: 'tie', width: 64, height: 64 },
	];
	const json = L.buildJavaModelJson({ mode: 'classic_java', elements, textures: tex, textureSize: [64, 64], namespace: 'kuayue', trackId: 'track', texturePathOf: { t0: 'custom/rail', t1: 'block/track/track' } });
	const refs = Object.values(json.textures).filter((v) => typeof v === 'string');
	assert(refs.includes('kuayue:custom/rail/rail'), `自定义纹理路径应生效，实际 ${refs.join(', ')}`);
	assert(refs.includes('kuayue:block/track/track/tie'), '其余纹理保持默认资源路径');
});

t('buildBlockstates：自定义模型资源路径时引用跟随', () => {
	const bs = L.buildBlockstates('kuayue', 'track', 'custom/track');
	assert.strictEqual(bs.variants['shape=xo,turn=false,waterlogged=false'].model, 'kuayue:custom/track/x_ortho');
	// 缺省模型资源路径保持 block/track/{id}
	assert.strictEqual(L.buildBlockstates('kuayue', 'track').variants['shape=xo,turn=false,waterlogged=false'].model, 'kuayue:block/track/track/x_ortho');
});

t('buildObjReferenceJson：自定义模型资源路径时 .obj 引用跟随', () => {
	const ref = L.buildObjReferenceJson({ namespace: 'kuayue', trackId: 'track', shape: 'x_ortho', textures: [], modelPath: 'custom/track' });
	assert.strictEqual(ref.model, 'kuayue:models/custom/track/x_ortho.obj');
});

t('buildObjReferenceJson：自定义模组加载器前缀（forge→neoforge）', () => {
	const forge = L.buildObjReferenceJson({ namespace: 'kuayue', trackId: 'track', shape: 'x_ortho', textures: [] });
	assert.strictEqual(forge.loader, 'forge:obj', '缺省 loader 应为 forge:obj');
	const neo = L.buildObjReferenceJson({ namespace: 'kuayue', trackId: 'track', shape: 'x_ortho', textures: [], loader: 'neoforge' });
	assert.strictEqual(neo.loader, 'neoforge:obj', 'loader=neoforge 时 loader 应为 neoforge:obj');
});

console.log(`\n✅ logic.test.js 全部通过（${passed} 项）`);
