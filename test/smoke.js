/**
 * 冒烟测试：在 Node 中桩住 Blockbench 全局 API，执行打包产物 create_track_gen.js，
 * 验证「注册 → onload 注册菜单 → 轨距换算 → 单页配置对话框（右轨镜像）→ 生成 → onunload 清理」链路。
 * 运行：node test/smoke.js
 */
'use strict';

const path = require('path');
const assert = require('assert');

// ── 桩：Blockbench 全局对象 ────────────────────────────────
const addedActions = [];
let registered = null;
let unloadHooks = [];
const createdCubes = [];
const createdGroups = [];
const createdMeshes = [];
let undoRuns = 0;
let lastToast = null;
let lastMessageBox = null;

global.Group = class Group {
	constructor(opts) {
		this.name = opts?.name ?? '';
		this.origin = opts?.origin ? [...opts.origin] : [0, 0, 0];
		this.rotation = opts?.rotation ? [...opts.rotation] : [0, 0, 0];
		this.children = [];
		this.deleted = false;
		createdGroups.push(this);
	}
	init() {
		return this;
	}
	addTo(parent) {
		parent.children.push(this);
		return this;
	}
	delete() {
		this.deleted = true;
	}
};

global.Cube = class Cube {
	constructor(opts) {
		this.opts = opts;
		this.name = opts.name;
		this.from = opts.from;
		this.to = opts.to;
		this.rotation = opts.rotation;
		this.origin = opts.origin;
		this.faces = opts.faces;
		this.children = [];
		this.deleted = false;
	}
	init() {
		createdCubes.push(this);
		return this;
	}
	addTo(parent) {
		parent.children.push(this);
		return this;
	}
	delete() {
		this.deleted = true;
	}
};

global.Mesh = class Mesh {
	constructor(opts) {
		this.opts = opts;
		this.name = opts?.name ?? '';
		this.type = 'mesh';
		this.vertices = opts?.vertices ?? {};
		this.faces = opts?.faces ?? {};
		this.origin = opts?.origin;
		this.rotation = opts?.rotation;
		this.children = [];
		this.deleted = false;
		createdMeshes.push(this);
	}
	init() {
		return this;
	}
	addTo(parent) {
		parent.children.push(this);
		return this;
	}
	delete() {
		this.deleted = true;
	}
	getSaveCopy() {
		return {
			name: this.name,
			type: 'mesh',
			vertices: this.vertices,
			faces: this.faces,
			origin: this.origin,
			rotation: this.rotation,
		};
	}
};

// 打开的标签页（项目）列表与一个示例标签页（供「选择一个标签页」测试）
global.ModelProject = { all: [] };
const tabProject = {
	uuid: 'tab-project-uuid',
	name: '轨道零件库',
	format: { id: 'java_block' },
	texture_width: 64,
	texture_height: 64,
	textures: [{ uuid: 'tex-tab', name: 'part.png', width: 64, height: 64, source: 'data:image/png;base64,tab', canvas: null }],
	selected_elements: [
		new global.Cube({
			name: 'rail',
			from: [-2, 0, 0],
			to: [2, 4, 16],
			faces: { up: { uv: [0, 0, 8, 8], texture: 'tex-tab' } },
		}),
	],
};

global.Action = class Action {
	constructor(id, data) {
		this.id = id;
		this.name = data.name;
		this.click = data.click;
		this.deleted = false;
	}
	delete() {
		this.deleted = true;
	}
};

global.MenuBar = {
	menus: {
		tools: {
			addAction(action) {
				addedActions.push(action);
			},
		},
	},
};

global.Undo = {
	initEdit() {},
	finishEdit() {
		undoRuns++;
	},
	cancelEdit() {},
};

global.Canvas = {
	updateView() {},
};

// 零件样例：一个单方块左右的零件（关于 x=0 对称、底面 y=0），带 64×64 纹理
// 面的 texture 是纹理数组下标（0），与 .bbmodel 的约定一致
// 钢轨零件：单根钢轨（长 16px、沿 Z、关于 x=0 对称）
const railPartJson = {
	meta: { model_format: 'java_block' },
	resolution: { width: 64, height: 64 },
	textures: [
		{ name: 'rail.png', id: '1', uv_width: 64, uv_height: 64, source: 'data:image/png;base64,sample' },
	],
	elements: [
		{ name: 'rail', from: [-2, 0, 0], to: [2, 4, 16], faces: { north: { uv: [0, 0, 8, 8], texture: 0 }, south: { uv: [0, 0, 8, 8], texture: 0 }, up: { uv: [0, 0, 8, 8], texture: 0 }, down: { uv: [0, 0, 8, 8], texture: 0 } } },
	],
};

// 枕木零件：单根枕木（宽 12px、高 2px、厚 1px，横向居中，长轴跨 X）
const tiePartJson = {
	meta: { model_format: 'java_block' },
	resolution: { width: 64, height: 64 },
	textures: [
		{ name: 'tie.png', id: '1', uv_width: 64, uv_height: 64, source: 'data:image/png;base64,sample' },
	],
	elements: [
		{ name: 'tie', from: [-6, 0, -0.5], to: [6, 2, 0.5], faces: { north: { uv: [0, 0, 8, 8], texture: 0 }, south: { uv: [0, 0, 8, 8], texture: 0 }, up: { uv: [0, 0, 8, 8], texture: 0 }, down: { uv: [0, 0, 8, 8], texture: 0 } } },
	],
};

// 含 mesh 组（type='mesh'）的零件样例（自由模型格式）。
// 特意带非零 origin (8,8,8)：mesh 的 origin 是世界锚点、顶点是局部坐标，
// 必须烘焙进顶点，否则平移会双重位移导致轨道中心偏到 x=8。
// 局部顶点 x[-8,8]、y[-8,-2]、z[0,16] → 世界 x[0,16]、y[0,6]、z[8,24]（中心 x=8）。
const meshPartJson = {
	meta: { model_format: 'generic' },
	resolution: { width: 32, height: 32 },
	textures: [{ name: 'mesh.png', id: '1', uv_width: 32, uv_height: 32, source: 'data:image/png;base64,mesh' }],
	elements: [
		{
			name: 'railmesh',
			type: 'mesh',
			vertices: { '0': [-8, -8, 0], '1': [8, -8, 0], '2': [8, -2, 0], '3': [-8, -2, 0], '4': [-8, -8, 16], '5': [8, -8, 16], '6': [8, -2, 16], '7': [-8, -2, 16] },
			origin: [8, 8, 8],
			rotation: [0, 0, 0],
			faces: { '0': { vertices: ['0', '1', '2', '3'], texture: 0 } },
		},
	],
};

let importCalls = 0;
let meshImport = false; // 置 true 后 .bbmodel 导入返回 mesh 零件（测自由模型工作区）
let nextPartKind = 'rail'; // 本次 .bbmodel 导入返回 rail 还是 tie 零件
global.Filesystem = {
	importFile(options, cb) {
		// 传送门纹理：返回两张假 PNG（IHDR 头带 32×32 尺寸，宽高在偏移 16/20）
		if ((options.extensions || []).includes('png')) {
			// 按 title 区分 portal_track / portal_track_mip；seed 区分内容避免导入时按 source 去重合并
			const isMip = /mip/i.test(options.title || '');
			const name = isMip ? 'portal_track_mip.png' : 'portal_track.png';
			const buf = new ArrayBuffer(24);
			const v = new DataView(buf);
			v.setUint32(16, 32);
			v.setUint32(20, 32);
			v.setUint8(23, isMip ? 2 : 1);
			cb([{ name, path: name, content: buf }]);
			return;
		}
		importCalls++;
		// 每次（左/右/枕木）返回一张不同 source 的纹理，面的 texture 始终是数组下标 0
		const src = meshImport ? meshPartJson : nextPartKind === 'tie' ? tiePartJson : railPartJson;
		const json = JSON.parse(JSON.stringify(src));
		json.textures[0].id = String(importCalls);
		json.textures[0].source = (meshImport ? 'data:image/png;base64,mesh' : 'data:image/png;base64,sample') + importCalls;
		cb([
			{ name: 'part.bbmodel', path: 'part.bbmodel', content: JSON.stringify(json) },
		]);
	},
};

global.Project = {
	selected_elements: [],
	textures: [],
	name: '',
	texture_width: 16,
	texture_height: 16,
	format: { id: 'java_block' },
};

// 生成流程用到的全局：新建工作区 + 纹理
global.newProject = (format) => {
	// 记录新工作区格式（buildAllShapes / buildBaseParts 按 Project.format 计算输出偏移）
	const id = typeof format === 'string' ? format : (format && format.id) || 'java_block';
	Project.format = { id };
	return true;
};
global.Texture = class Texture {
	constructor() {
		this.name = '';
		this.uv_width = 16;
		this.uv_height = 16;
		this.source = '';
		this.uuid = 'tex-' + Texture._counter++;
	}
	fromDataURL(url) {
		this.source = url;
		return this;
	}
	remove() {}
};
Texture._counter = 0;

const messageBoxQueue = [];
global.Blockbench = {
	showMessageBox(options, cb) {
		lastMessageBox = options;
		if (messageBoxQueue.length > 0) {
			const q = messageBoxQueue.shift();
			q(options, cb);
		} else if (cb) {
			cb(0);
		}
	},
	textPrompt(title, value, cb) {
		// 依次返回：轨距 / 高度；其余 prompt 返回 null（取消）
		cb(value);
	},
	showToastNotification(options) {
		lastToast = options;
	},
	showQuickMessage() {},
};

global.Plugin = {
	register(id, data) {
		registered = { id, data };
		if (data.onload) data.onload();
		unloadHooks.push(data.onunload);
	},
};

// 配置对话框：捕获配置供测试驱动（真实 Blockbench 中 Dialog 由运行时提供）
let lastDialog = null;
global.Dialog = class Dialog {
	constructor(config) {
		this.config = config;
		this.closed = false;
		lastDialog = this;
	}
	show() {
		if (this.config.onOpen) this.config.onOpen();
		return this;
	}
	close() {
		this.closed = true;
	}
};

// ── 执行产物 ────────────────────────────────────────────────
const bundlePath = path.join(__dirname, '..', 'create_track_gen.js');
require(bundlePath);

// ── 断言 ────────────────────────────────────────────────────
assert(registered, '❌ Plugin.register 未被调用');
assert.strictEqual(registered.id, 'create_track_gen', `❌ 插件 ID 应为 create_track_gen，实际 ${registered.id}`);
assert.strictEqual(registered.data.variant, 'both');

// 菜单注册了两个 Action
assert.strictEqual(addedActions.length, 2, '❌ 应注册 2 个 Action（生成 + 换算）');
const [genAction, gaugeAction] = addedActions;
assert.strictEqual(genAction.id, 'create_track_gen.generate');
assert.strictEqual(gaugeAction.id, 'create_track_gen.gauge');

// 轨距换算独立入口：textPrompt 返回 '1435' → 比例常数 ≈ 0.755
let gaugeResult = null;
const origMessageBox = global.Blockbench.showMessageBox;
const origTextPrompt = global.Blockbench.textPrompt;
global.Blockbench.showMessageBox = (options, cb) => {
	if (options.title === '轨距换算结果') gaugeResult = options;
	if (cb) cb(0);
};
// 需要让 textPrompt 的 callback 以 1435 触发
global.Blockbench.textPrompt = (title, value, cb) => cb('1435');
gaugeAction.click();
assert(gaugeResult, '❌ 轨距换算应弹出结果');
assert(/0\.755/.test(gaugeResult.message), `❌ 1435mm 应换算 ≈0.755，实际：${gaugeResult?.message}`);
global.Blockbench.showMessageBox = origMessageBox;
global.Blockbench.textPrompt = origTextPrompt;

// 生成流程：单页对话框 → 新建工作区 + 导入纹理 + 生成形状（异步）
(async () => {
	const beforeCubes = createdCubes.length;
	const clickPromise = genAction.click();

	// 对话框已打开，暴露驱动钩子（测试用）
	const dlg = lastDialog;
	assert(dlg, '❌ 生成应打开配置对话框');
	const driver = dlg.config._driver;
	assert(driver, '❌ 配置对话框应暴露驱动钩子');

	// 模拟用户操作：左轨导入 .bbmodel、右轨「从第一个模型对称」、枕木导入、分别导入两张传送门纹理
	nextPartKind = 'rail';
	await driver.actions.importPart('left');
	nextPartKind = 'tie';
	await driver.actions.importPart('tie');
	await driver.actions.mirrorRight();
	await driver.actions.importPortalTrack();
	await driver.actions.importPortalMip();
	const state = driver.getState();
	assert.strictEqual(state.rightMode, 'mirror', '❌ 右轨应标记为「从第一个模型对称」');
	assert(state.portalTrack, '❌ 应导入 portal_track 纹理');
	assert.strictEqual(state.portalTrack.name, 'portal_track.png', '❌ portal_track 应为 portal_track.png');
	assert(state.portalMip, '❌ 应导入 portal_track_mip 纹理');
	assert.strictEqual(state.portalMip.name, 'portal_track_mip.png', '❌ portal_track_mip 应为 portal_track_mip.png');

	// 点「生成」：返回非 false（不阻止关闭），并同步完成建区 + 导纹理 + resolve
	const confirmReturn = dlg.config.onConfirm({ gauge: 16, height: 2, yoffset: 0, name: '机械动力轨道' });
	assert.notStrictEqual(confirmReturn, false, '❌ 配置合法时 onConfirm 不应阻止关闭');
	await clickPromise;

	// 生成的 cube / group 已创建（父分组 + 16 个子分组 + 3 个弯道基础分组）
	assert(createdCubes.length > beforeCubes, '❌ 生成应创建 Cube');
	assert(createdGroups.length >= 20, '❌ 应创建父分组 + 16 个子分组 + 3 个基础分组');
	// 弯道渲染基础分组：tie / segment_left / segment_right
	const baseGroups = createdGroups.filter((g) => ['segment_left', 'segment_right', 'tie'].includes(g.name));
	assert.strictEqual(baseGroups.length, 3, '❌ 应创建 tie / segment_left / segment_right 三个基础分组');
	for (const g of baseGroups) {
		assert(g.children.some((ch) => ch instanceof global.Cube), `❌ 基础分组 ${g.name} 应含 cube 元素`);
	}
	// 布局：高度 2，Y 偏移 0。
	// segment_left / segment_right 钢轨：自身模型中心（java 的 (8,8) → 归一化原点）x 归零，
	// 底面 = 2（轨道高度 + Y 偏移）、整体近 z 端靠在 xy 平面（z=0，模型一侧贴 z=0 平面）
	const gLeft = baseGroups.find((g) => g.name === 'segment_left');
	const railLeft = gLeft.children.find((ch) => ch instanceof global.Cube && (ch.to[2] - ch.from[2]) >= 16);
	assert(railLeft, '❌ segment_left 应含钢轨 cube');
	assert.strictEqual((railLeft.from[0] + railLeft.to[0]) / 2, 0, `❌ 左轨模型中心 x 应为 0，实际 ${(railLeft.from[0] + railLeft.to[0]) / 2}`);
	assert.strictEqual(Math.min(railLeft.from[1], railLeft.to[1]), 2, '❌ 左轨底面应抬升到 轨道高度 + Y 偏移 = 2');
	const gLeftZMin = Math.min(...gLeft.children.map((ch) => Math.min(ch.from[2], ch.to[2])));
	assert.strictEqual(gLeftZMin, 0, `❌ segment_left 整体近 z 端应靠在 xy 平面（z=0），实际 ${gLeftZMin}`);
	// segment_right 钢轨：同样模型中心 x 归零
	const gRight = baseGroups.find((g) => g.name === 'segment_right');
	const railRight = gRight.children.find((ch) => ch instanceof global.Cube && (ch.to[2] - ch.from[2]) >= 16);
	assert(railRight, '❌ segment_right 应含钢轨 cube');
	assert.strictEqual((railRight.from[0] + railRight.to[0]) / 2, 0, `❌ 右轨模型中心 x 应为 0，实际 ${(railRight.from[0] + railRight.to[0]) / 2}`);
	// tie 枕木：z 中线 = 4（z_ortho 靠近 x 轴的第一个枕木）、底面 = 0（仅 Y 偏移，不抬升）
	const gTie = baseGroups.find((g) => g.name === 'tie');
	const tieCube = gTie.children.find((ch) => ch instanceof global.Cube && Math.abs(ch.to[2] - ch.from[2]) < 4);
	assert(tieCube, '❌ tie 应含枕木 cube');
	assert.strictEqual((tieCube.from[2] + tieCube.to[2]) / 2, 4, `❌ 枕木 z 中线应为 4，实际 ${(tieCube.from[2] + tieCube.to[2]) / 2}`);
	assert.strictEqual(Math.min(tieCube.from[1], tieCube.to[1]), 0, '❌ 枕木底面应为 0（不抬升，仅 Y 偏移）');
	assert.strictEqual((tieCube.from[0] + tieCube.to[0]) / 2, 0, '❌ 枕木 x 中线应为 0（横向居中）');
	// 新工作区被命名，纹理分辨率 = 输入零件纹理尺寸（64×64）；全 cube → Java 方块模型
	assert.strictEqual(Project.name, '机械动力轨道', '❌ 新工作区名应取自用户输入');
	assert.strictEqual(Project.texture_width, 64, '❌ 新工作区纹理宽度应为 64');
	assert.strictEqual(Project.texture_height, 64, '❌ 新工作区纹理高度应为 64');
	assert.strictEqual(Project.format.id, 'java_block', '❌ 全 cube 零件的新工作区应为 Java 方块模型');
	// 右轨由左轨镜像生成，复用左轨的纹理源：导入 L(与 R 共享) + T + 2 张传送门纹理共 4 张位图
	assert.strictEqual(Project.textures.length, 4, '❌ 左轨（及其镜像右轨）+ 枕木 + 2 张传送门纹理应导入 4 张纹理');
	assert(Project.textures[0].source.includes('sample1'), '❌ 导入纹理应保留位图数据');
	// 生成的 cube 面引用 3 张纹理（镜像右轨复用左轨的 L 纹理，枕木用 T 纹理，覆层用 mip）
	const usedTex = new Set();
	for (const c of createdCubes) {
		const faces = c.opts && c.opts.faces;
		if (!faces) continue;
		for (const f of Object.values(faces)) {
			if (f && f.texture) usedTex.add(f.texture);
		}
	}
	assert.strictEqual(usedTex.size, 4, `❌ 生成 cube 应引用 4 张纹理（左轨/右轨共用 L + 枕木 T + 覆层 mip + 轨道/枕木 track），实际 ${usedTex.size}`);

	// 传送门覆层：teleport 与 teleport_x 各生成 2 个覆层块（teleport_left / teleport_right），贴 portal_track_mip
	const overlays = createdCubes.filter((c) => (c.opts?.name ?? '').startsWith('teleport_'));
	assert.strictEqual(overlays.length, 4, `❌ 应生成 4 个传送门覆层（teleport/teleport_x 各 2），实际 ${overlays.length}`);
	const trackTex = Project.textures.find((t) => t.name === 'portal_track.png');
	const mipTex = Project.textures.find((t) => t.name === 'portal_track_mip.png');
	assert(trackTex, '❌ 应导入 portal_track 纹理');
	assert(mipTex, '❌ 应导入 portal_track_mip 纹理');
	for (const o of overlays) {
		const faces = o.opts && o.opts.faces;
		assert(faces && Object.values(faces).some((f) => f && f.texture === mipTex), `❌ 覆层 ${o.opts.name} 应贴 portal_track_mip 纹理`);
	}
	// 传送门轨道/枕木铺 portal_track（teleport 形状的 rail/tie 面重映射为 trackTex）
	const bodyUsesTrack = createdCubes.some((c) => {
		const name = c.opts?.name ?? '';
		if (name !== 'rail' && name !== 'tie') return false;
		const faces = c.opts && c.opts.faces;
		return faces && Object.values(faces).some((f) => f && f.texture === trackTex);
	});
	assert(bodyUsesTrack, '❌ 传送门轨道/枕木应铺 portal_track 纹理');

	// ── 场景 B：选择一个标签页 → 从该标签页提取选中的元素作为零件 ──
	global.ModelProject.all = [tabProject];
	// 让标签页选择对话框点选 tabProject（commands 返回其 uuid）
	messageBoxQueue.push((options, cb) => cb('tab-project-uuid'));
	const b = genAction.click();
	const dlgB = lastDialog;
	assert(dlgB, '❌ 应再次打开配置对话框');
	const driverB = dlgB.config._driver;
	// 不导入文件，直接「选择一个标签页」提取左轨
	await driverB.actions.pickTab('left');
	const stateB = driverB.getState();
	assert(stateB.left, '❌ 从标签页应提取到左轨零件');
	assert.strictEqual(stateB.left.cubes.length, 1, '❌ 标签页零件应含 1 个 cube');
	assert.strictEqual(stateB.left.textures[0].key, 'tex-tab', '❌ 标签页零件应携带选中元素的纹理');
	nextPartKind = 'tie';
	await driverB.actions.importPart('tie');
	await driverB.actions.mirrorRight();
	const retB = dlgB.config.onConfirm({ gauge: 16, height: 2, yoffset: 0, name: '标签页轨道' });
	assert.notStrictEqual(retB, false, '❌ 标签页零件生成不应被阻止');
	await b;
	assert.strictEqual(Project.name, '标签页轨道', '❌ 场景 B 新工作区名应取自用户输入');
	assert.strictEqual(Project.format.id, 'java_block', '❌ 场景 B 全 cube 应为 Java 方块模型');
	console.log('   选择一个标签页 → 提取该标签页选中元素 ✓');

	// ── 场景 C：零件含 mesh 组 → 新工作区为自由模型，基础分组含 mesh 元素 ──
	meshImport = true;
	const groupsBeforeC = createdGroups.length;
	const c = genAction.click();
	const dlgC = lastDialog;
	assert(dlgC, '❌ 应再次打开配置对话框');
	const driverC = dlgC.config._driver;
	await driverC.actions.importPart('left');
	await driverC.actions.importPart('tie');
	await driverC.actions.mirrorRight();
	const stateC = driverC.getState();
	assert.strictEqual(stateC.left.hasMesh, true, '❌ mesh 零件 hasMesh 应为 true');
	assert.strictEqual(stateC.left.meshes.length, 1, '❌ mesh 零件应含 1 个 mesh 组');
	const retC = dlgC.config.onConfirm({ gauge: 16, height: 2, yoffset: 0, name: 'mesh轨道' });
	assert.notStrictEqual(retC, false, '❌ mesh 零件生成不应被阻止');
	await c;
	// 含 mesh → 自由模型
	assert.strictEqual(Project.format.id, 'generic', '❌ 含 mesh 零件的新工作区应为自由模型');
	assert.strictEqual(Project.name, 'mesh轨道', '❌ 场景 C 新工作区名应取自用户输入');
	// 基础分组存在且含 mesh 元素（只看本次生成新建的分组）
	const baseGroupsC = createdGroups
		.slice(groupsBeforeC)
		.filter((g) => ['segment_left', 'segment_right', 'tie'].includes(g.name));
	assert.strictEqual(baseGroupsC.length, 3, '❌ 场景 C 应创建 3 个基础分组');
	for (const g of baseGroupsC) {
		assert(g.children.some((ch) => ch instanceof global.Mesh), `❌ 场景 C 分组 ${g.name} 应含 mesh 元素`);
	}
	// mesh 布局：高度 2、Y 偏移 0。mesh 顶点原 x[-8,8]、z[0,16]，自身中心 x 归零。
	// segment_left / segment_right 顶点 x 中线都应 → 0（各自以自身中心为轴）
	const meshOf = (name) => baseGroupsC.find((g) => g.name === name).children.find((ch) => ch instanceof global.Mesh);
	const xs = (m) => (Math.min(...Object.values(m.vertices).map((v) => v[0])) + Math.max(...Object.values(m.vertices).map((v) => v[0]))) / 2;
	assert.strictEqual(xs(meshOf('segment_left')), 0, '❌ 场景 C 左轨 mesh 顶点 x 中线应为 0');
	assert.strictEqual(xs(meshOf('segment_right')), 0, '❌ 场景 C 右轨 mesh 顶点 x 中线应为 0');
	assert(createdMeshes.length > 0, '❌ 应创建 Mesh 元素');
	meshImport = false;
	console.log('   零件含 mesh 组 → 新工作区为自由模型，基础分组含 mesh ✓');

	// 卸载清理
	unloadHooks.forEach((fn) => fn && fn());
	assert(genAction.deleted, '❌ onunload 应删除生成 Action');
	assert(gaugeAction.deleted, '❌ onunload 应删除换算 Action');

	console.log('✅ 冒烟测试通过');
	console.log('   插件 ID:', registered.id);
	console.log('   注册 Action:', addedActions.map((a) => a.id).join(', '));
	console.log('   轨距换算 1435mm → ~0.755 ✓');
	console.log('   单页配置 → 右轨「从第一个模型对称」镜像左轨 ✓');
	console.log('   生成 → 新工作区「机械动力轨道」(64×64)，纹理已应用 ✓');
	console.log('   弯道基础分组 → tie / segment_left / segment_right 三个分组 ✓');
	console.log('   选择一个标签页 → 从该标签页提取选中元素 ✓');
	console.log('   零件含 mesh 组 → 新工作区为自由模型，基础分组含 mesh ✓');
	console.log('   传送门覆层 → 导入 2 张纹理（track 铺整体 / mip 贴覆层块），teleport 叠加左右 2 个覆层 ✓');
	console.log('   onunload 已清理 Action ✓');
})();
