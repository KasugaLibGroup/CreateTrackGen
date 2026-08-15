/**
 * 用纯逻辑层（logic_bundle.cjs）+ test/sample_parts 零件重新生成 test/meter 输出，
 * 便于与 assets/tracks/meter 参考文件比对。运行：node test/regen_meter.js
 *
 * 复刻插件导出管线：解析零件 → scopeTextureKeys(L/R/T) → allShapes → java (8,8) 偏移
 * → buildJavaModelJson（经典模式）→ buildBlockstates。只写模型与 blockstates，纹理沿用
 * test/meter/textures 下已有的 PNG。
 */
'use strict';
const L = require('../logic_bundle.cjs');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const METER = path.join(__dirname, 'meter');
const MODEL_DIR = path.join(METER, 'models/block/track/meter');
const BS_DIR = path.join(METER, 'blockstates/track_and_bogey');

function readJson(p) {
	return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(rel, json) {
	const p = path.join(METER, rel);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, JSON.stringify(json, null, '\t'));
}

// ── 1. 解析零件（java_block 格式 → 对称点 (8,8)，底面 y 归一化到 0）──
const rail = L.parseBbModel(readJson(path.join(ROOT, 'test/sample_parts/test_rail.bbmodel')));
const tie = L.parseBbModel(readJson(path.join(ROOT, 'test/sample_parts/test_tie.bbmodel')));

// ── 2. 纹理作用域 + 配置（右轨 = 左轨镜像；轨距 16px、高度 2.7，与既有 test/meter 一致）──
const left = L.scopeTextureKeys(rail, 'L');
const right = L.scopeTextureKeys(L.mirrorPartYz(rail), 'R');
const tiePart = L.scopeTextureKeys(tie, 'T');
const cfg = {
	gaugePx: 16,
	heightPx: 2.7,
	wholeModelYOffset: 0,
	parts: { left, right, tie: tiePart },
};

// ── 3. 纹理注册：源 key → {resName,width,height}（L/R 同源去重）──
const texByKey = new Map(); // scoped key → ExportTexture.key ('t0'/'t1')
const texInfos = []; // ExportTexture[]
const resNameOf = new Map(); // source dataURL → resName（去重）
const resNameUsed = new Set();
const resNameByKey = {}; // scoped key → resName
function registerPartTextures(part) {
	for (const t of part.textures || []) {
		let resName = resNameOf.get(t.source);
		if (!resName) {
			resName = L.textureResourceName(t.name, resNameUsed);
			resNameOf.set(t.source, resName);
		}
		resNameByKey[t.key] = resName;
	}
}
registerPartTextures(left);
registerPartTextures(right);
registerPartTextures(tiePart);

// 形状内按出现顺序分配 t0/t1…（rail 先于 tie）
function ensureTex(key) {
	if (!key || !resNameByKey[key]) return undefined;
	if (texByKey.has(key)) return texByKey.get(key);
	const resName = resNameByKey[key];
	// 同源（L/R 共享 rail 纹理）复用同一 ExportTexture
	const existing = texInfos.find((t) => t.resName === resName);
	if (existing) {
		texByKey.set(key, existing.key);
		return existing.key;
	}
	const k = `t${texInfos.length}`;
	texInfos.push({ key: k, resName, width: 64, height: 64 });
	texByKey.set(key, k);
	return k;
}

// ── 4. 构建全部形状 → 转 ExportElement（+ java (8,8) 偏移）──
const shapes = L.allShapes(cfg);
const offset = L.outputOffsetForFormat('java_block'); // [8,0,8]

function shapeToElements(shape) {
	return shape.cubes.map((c) => {
		const faces = {};
		for (const [dir, f] of Object.entries(c.faces || {})) {
			if (!f) continue;
			const fd = {};
			if (f.uv) fd.uv = [...f.uv];
			if (f.rotation) fd.rotation = f.rotation;
			const tk = f.texture ? ensureTex(f.texture) : undefined;
			if (tk) fd.textureKey = tk;
			faces[dir] = fd;
		}
		const t = L.translate([c], offset)[0];
		return {
			type: 'cube',
			name: c.name,
			from: [...t.from],
			to: [...t.to],
			rotation: t.rotation && t.rotation.some((v) => v !== 0) ? [...t.rotation] : undefined,
			origin: t.origin ? [...t.origin] : undefined,
			faces,
		};
	});
}

// ── 5. 写模型文件（经典 Java）+ blockstates ──
const writtenModels = [];
function writeShapeModel(id, elements, offset) {
	const file = L.modelFileName(id);
	if (!file) return;
	const usedKeys = new Set();
	for (const el of elements) for (const f of Object.values(el.faces)) if (f?.textureKey) usedKeys.add(f.textureKey);
	const shapeTexs = texInfos.filter((t) => usedKeys.has(t.key));
	const json = L.buildJavaModelJson({ mode: 'classic_java', elements, textures: shapeTexs, textureSize: [64, 64], namespace: 'kuayue', trackId: 'meter' });
	writeJson(`models/block/track/meter/${file}`, json);
	writtenModels.push(file);
}

// 轨道形状（java (8,8) 偏移）
for (const shape of shapes) {
	writeShapeModel(shape.id, shapeToElements(shape), offset);
}

// 弯道基础分组：tie / segment_left / segment_right（布局 = z_ortho 靠近 x 轴的轨道单元，
// 不按输出格式偏移：钢轨以自身中心 x=0、近 z 端靠 xy 平面、底面抬升到轨道高度；枕木 z=4）
const TIE_Z = 4;
const yoff = cfg.wholeModelYOffset ?? 0;
const baseRailL = L.bakePartAxisAligned(left);
const baseRailR = L.bakePartAxisAligned(right);
const baseTie = L.orientTiePerpendicular(L.bakePartAxisAligned(tiePart));
const tieBBox = L.computeBBox(baseTie);
const baseDefs = [
	{ id: 'segment_left', cubes: baseRailL.cubes, offset: [-baseRailL.xMid, cfg.heightPx + yoff, -baseRailL.bbox.min[2]] },
	{ id: 'segment_right', cubes: baseRailR.cubes, offset: [-baseRailR.xMid, cfg.heightPx + yoff, -baseRailR.bbox.min[2]] },
	{ id: 'tie', cubes: baseTie, offset: [-(tieBBox.min[0] + tieBBox.max[0]) / 2, yoff, TIE_Z - (tieBBox.min[2] + tieBBox.max[2]) / 2] },
];
for (const b of baseDefs) {
	const elements = [];
	for (const c of b.cubes) {
		const t = L.translate([c], b.offset)[0];
		const faces = {};
		for (const [dir, f] of Object.entries(t.faces || {})) {
			if (!f) continue;
			const fd = {};
			if (f.uv) fd.uv = [...f.uv];
			if (f.rotation) fd.rotation = f.rotation;
			const tk = f.texture ? ensureTex(f.texture) : undefined;
			if (tk) fd.textureKey = tk;
			faces[dir] = fd;
		}
		elements.push({
			type: 'cube',
			name: t.name,
			from: [...t.from],
			to: [...t.to],
			rotation: t.rotation && t.rotation.some((v) => v !== 0) ? [...t.rotation] : undefined,
			origin: t.origin ? [...t.origin] : undefined,
			faces,
		});
	}
	writeShapeModel(b.id, elements, b.offset);
}
const bs = L.buildBlockstates('kuayue', 'meter');
writeJson('blockstates/track_and_bogey/meter_track.json', bs);

console.log('已生成模型：', writtenModels.sort().join(', '));
console.log('blockstates：', Object.keys(bs.variants).length, '个变体');
