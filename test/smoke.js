/**
 * 冒烟测试：在 Node 中桩住 Blockbench 全局 API，执行打包产物 create_track_gen.js，
 * 验证「注册 → onload 注册菜单 → 轨距换算 → 单页配置对话框（右轨镜像）→ 生成 → onunload 清理」链路。
 * 运行：node test/smoke.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
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

let groupCounter = 0;
global.Group = class Group {
	constructor(opts) {
		this.name = opts?.name ?? '';
		this.origin = opts?.origin ? [...opts.origin] : [0, 0, 0];
		this.rotation = opts?.rotation ? [...opts.rotation] : [0, 0, 0];
		this.children = [];
		this.parent = null;
		this.uuid = 'g-' + groupCounter++;
		this.deleted = false;
		createdGroups.push(this);
	}
	init() {
		return this;
	}
	addTo(parent) {
		this.parent = parent;
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

// Array.prototype.replace — Blockbench 扩展（splice 原位替换），MeshFace 的 extend 依赖它
if (!Array.prototype.replace) {
	Object.defineProperty(Array.prototype, 'replace', {
		value: function (items) {
			this.splice(0, this.length, ...items);
			return this;
		},
		writable: true,
	});
}
// MeshFace 桩：忠实复刻 Blockbench 的 MeshFace（extend 按顶点 key 过滤 + 默认 uv + 替换 uv）
global.MeshFace = class MeshFace {
	constructor(mesh, data) {
		this.mesh = mesh;
		this.uv = {};
		this.texture = false;
		this.vertices = [];
		this.rotation = 0;
		this.element = mesh;
		if (data) this.extend(data);
	}
	extend(data) {
		if (data.vertices !== undefined) this.vertices.replace(data.vertices);
		if (data.rotation !== undefined) this.rotation = data.rotation;
		if (data.texture === null) this.texture = null;
		else if (data.texture === false) this.texture = false;
		else if (data.texture && data.texture.uuid) this.texture = data.texture.uuid;
		else if (typeof data.texture === 'string') this.texture = data.texture;
		for (let i = this.vertices.length - 1; i >= 0; i--) {
			const key = this.vertices[i];
			if (typeof key != 'string' || !key.length) {
				this.vertices.splice(i, 1);
				delete this.uv[key];
				continue;
			}
			if (!this.uv[key]) this.uv[key] = [0, 0];
			if (data.uv && data.uv[key] instanceof Array) this.uv[key].replace(data.uv[key]);
		}
		for (let key in this.uv) {
			if (!this.vertices.includes(key)) delete this.uv[key];
		}
		return this;
	}
	getSaveCopy() {
		return { vertices: this.vertices.slice(), uv: this.uv, rotation: this.rotation, texture: this.texture };
	}
};
// Mesh 桩：忠实复刻 Blockbench 的 Mesh 元素。官方建 mesh 的姿势是 new Mesh({name, vertices:{}})
// + addVertices() + addFaces(new MeshFace(...))（与 OBJ 导入器一致）；直接往构造函数传
// vertices/faces 是非官方用法。vertices/faces 走 _static.properties（与真实一致）。
global.Mesh = class Mesh {
	constructor(opts, uuid) {
		this.uuid = uuid || 'mesh-' + createdMeshes.length;
		this.name = opts?.name ?? 'mesh';
		this.type = 'mesh';
		this.origin = opts?.origin ? [...opts.origin] : [0, 0, 0];
		this.rotation = opts?.rotation ? [...opts.rotation] : [0, 0, 0];
		this.shading = opts?.shading ?? 'flat';
		this.visibility = opts?.visibility ?? true;
		this.children = [];
		this.parent = 'root';
		this.deleted = false;
		this._static = { properties: { vertices: {}, faces: {}, seams: {} } };
		// 忠实复刻：无 vertices 时 Mesh 构造器会塞一个默认 2×2×2 方块（东/西/上/下/南/北 6 面）
		if (!opts || !opts.vertices) {
			this.addVertices([2, 4, 2], [2, 4, -2], [2, 0, 2], [2, 0, -2], [-2, 4, 2], [-2, 4, -2], [-2, 0, 2], [-2, 0, -2]);
			const keys = Object.keys(this.vertices);
			[
				[keys[0], keys[2], keys[1], keys[3]],
				[keys[4], keys[5], keys[6], keys[7]],
				[keys[0], keys[1], keys[4], keys[5]],
				[keys[2], keys[6], keys[3], keys[7]],
				[keys[0], keys[4], keys[2], keys[6]],
				[keys[1], keys[3], keys[5], keys[7]],
			].forEach((v, i) => {
				const face = new global.MeshFace(this, { vertices: v });
				face.uv[v[0]] = [0, 0];
				face.uv[v[1]] = [0, 16];
				face.uv[v[2]] = [16, 0];
				face.uv[v[3]] = [16, 16];
				this.addFaces(face);
			});
		}
		if (opts && typeof opts === 'object') this.extend(opts);
		createdMeshes.push(this);
	}
	get vertices() {
		return this._static.properties.vertices;
	}
	set vertices(v) {
		this._static.properties.vertices = v;
	}
	get faces() {
		return this._static.properties.faces;
	}
	set faces(v) {
		this._static.properties.faces = v;
	}
	extend(object) {
		if (object.name) this.name = object.name;
		if (object.origin) this.origin = object.origin.slice();
		if (object.rotation) this.rotation = object.rotation.slice();
		if (typeof object.vertices == 'object') {
			for (let key in this.vertices) {
				if (!object.vertices[key]) delete this.vertices[key];
			}
			if (object.vertices instanceof Array) {
				object.vertices.forEach((v) => {
					const key = 'v' + Object.keys(this.vertices).length;
					this.vertices[key] = [v[0] || 0, v[1] || 0, v[2] || 0];
				});
			} else {
				for (let key in object.vertices) {
					if (!this.vertices[key]) this.vertices[key] = [];
					this.vertices[key].replace(object.vertices[key]);
				}
			}
		}
		if (typeof object.faces == 'object') {
			for (let key in this.faces) {
				if (!object.faces[key]) delete this.faces[key];
			}
			for (let key in object.faces) {
				if (this.faces[key]) this.faces[key].extend(object.faces[key]);
				else this.faces[key] = new global.MeshFace(this, object.faces[key]);
			}
		}
		return this;
	}
	addVertices(...vectors) {
		return vectors.map((vector) => {
			const key = 'v' + Object.keys(this.vertices).length;
			this.vertices[key] = [vector[0] || 0, vector[1] || 0, vector[2] || 0];
			return key;
		});
	}
	addFaces(...faces) {
		return faces.map((face, i) => {
			const key = 'f' + i;
			this.faces[key] = face;
			return key;
		});
	}
	init() {
		return this;
	}
	addTo(parent) {
		this.parent = parent;
		parent.children.push(this);
		return this;
	}
	delete() {
		this.deleted = true;
	}
	getSaveCopy() {
		const el = { vertices: {}, faces: {}, type: 'mesh', origin: this.origin, rotation: this.rotation, name: this.name };
		for (let key in this.vertices) el.vertices[key] = this.vertices[key].slice();
		for (let key in this.faces) el.faces[key] = this.faces[key].getSaveCopy();
		return el;
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
	meta: { model_format: 'free' },
	resolution: { width: 32, height: 32 },
	textures: [{ name: 'mesh.png', id: '1', uv_width: 32, uv_height: 32, source: 'data:image/png;base64,mesh' }],
	elements: [
		{
			name: 'railmesh',
			type: 'mesh',
			vertices: { '0': [-8, -8, 0], '1': [8, -8, 0], '2': [8, -2, 0], '3': [-8, -2, 0], '4': [-8, -8, 16], '5': [8, -8, 16], '6': [8, -2, 16], '7': [-8, -2, 16] },
			origin: [8, 8, 8],
			rotation: [0, 0, 0],
			// uv 带逐顶点坐标（与真实 .bbmodel 的 mesh 面一致）：specToMesh 必须把 uv 从源顶点 key
			// 重映射到 addVertices 分配的新 key，否则 MeshFace 逐顶点查找全部落空 → 退回 [0,0]
			faces: { '0': { vertices: ['0', '1', '2', '3'], texture: 0, uv: { '0': [0, 0], '1': [8, 0], '2': [8, 4], '3': [0, 4] } } },
		},
	],
};

let importCalls = 0;
let meshImport = false; // 置 true 后 .bbmodel 导入返回 mesh 零件（测自由模型工作区）
let nextPartKind = 'rail'; // 本次 .bbmodel 导入返回 rail 还是 tie 零件
let exportDir = ''; // 导出的目标文件夹（pickDirectory 返回）
/** 导出时记录写出的文件（scoped fs 桩） */
const exportedFiles = [];
/** i18n 磁盘加载测试用的翻译目录（放 lang/en.json、lang/zh.json） */
let langDir = '';
/**
 * scoped require 桩：与真实 Blockbench 一致，由 `new Function("requireNativeModule","require",code)`
 * 作为局部参数注入插件（`t(n,n)`，两个参数同一引用）；同时也挂到 global.require（Dev Tools 模式）。
 */
const fakeScopedRequire = (id, opts) => {
	if (id === 'fs') {
		return {
			mkdirSync() {},
			writeFileSync(p, content, o) {
				exportedFiles.push({ path: p, content });
			},
			// i18n 磁盘加载：把 {插件目录}/lang/{name}.json 映射到测试用的 langDir
			readFileSync(p, enc) {
				const name = String(p).split(/[\\/]/).pop();
				const file = path.join(langDir, name);
				if (langDir && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
				throw new Error('lang file not found: ' + p);
			},
		};
	}
	return undefined;
};
global.require = fakeScopedRequire;
global.Filesystem = {
	pickDirectory() {
		return exportDir;
	},
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
// 与真实 Blockbench 一致：newProject 把格式 id 字符串解析成 Formats 注册表里的格式对象，
// 找不到时回退到自由模型（Formats.free）。插件传入的格式串必须真实有效，否则这里会暴露出来
// （例如旧代码传 'generic' —— 那不是有效 id，会解析成自由模型而非字面记录）。
const _bbFormats = {
	free: { id: 'free', name: '自由模型', meshes: true },
	java_block: { id: 'java_block', name: 'Java 方块', meshes: false },
	java_item: { id: 'java_item', name: 'Java 物品', meshes: false },
};
global.Formats = _bbFormats;
global.newProject = (format) => {
	// 记录新工作区格式（buildAllShapes / buildBaseParts 按 Project.format 计算输出偏移）
	const resolved =
		typeof format === 'string'
			? _bbFormats[format] ?? _bbFormats.free
			: format && format.id
				? format
				: _bbFormats.free;
	const id = resolved.id;
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

// ── i18n 桩：与 Blockbench 的 Language.addTranslations + tl 语义一致 ──
// 语言设为简体中文（code='zh'），使插件文案解析到中文，便于断言。
global.Language = {
	data: {},
	code: 'zh',
	options: { en: 'English', zh: '简体中文' },
	addTranslations(lang, strings) {
		for (const k in strings) {
			// 当前语言直接写入；en 作为兜底（仅当 key 尚未存在）
			if (lang === this.code || (lang === 'en' && this.data[k] == null)) this.data[k] = strings[k];
		}
	},
};
global.tl = (key, variables, defaultValue) => {
	let out = global.Language.data[key];
	if (out && out.length > 0) {
		if (variables) {
			// 占位符 %0/%1/…（0 基），与真实 Blockbench 的 tl 语义一致
			const arr = Array.isArray(variables) ? variables : [variables];
			for (let i = arr.length - 1; i >= 0; i--) out = out.replace(new RegExp('%' + i, 'g'), String(arr[i]));
		}
		return out;
	}
	return defaultValue ?? key;
};

// ── 执行产物 ────────────────────────────────────────────────
// 用与真实 Blockbench 相同的方式求值插件脚本：new Function("requireNativeModule","require",code)，t(n,n)
// 先准备磁盘翻译目录（模拟插件目录旁有 lang/*.json），onload 时应读取并覆盖内置默认
langDir = path.join(require('os').tmpdir(), 'ctg-lang-' + String(Math.random()).slice(2));
fs.mkdirSync(langDir, { recursive: true });
fs.writeFileSync(path.join(langDir, 'zh.json'), JSON.stringify({ 'ctg.ok': '确定-磁盘覆盖' }));
fs.writeFileSync(path.join(langDir, 'en.json'), JSON.stringify({ 'ctg.ok': 'OK-from-disk' }));
// 模拟 Blockbench 的 Plugins.registered（onload 经它取插件路径）
global.Plugins = { registered: { create_track_gen: { path: path.join(langDir, '..', 'create_track_gen.js') } } };

const bundlePath = path.join(__dirname, '..', 'create_track_gen.js');
const bundleCode = fs.readFileSync(bundlePath, 'utf8');
const loadPlugin = new Function('requireNativeModule', 'require', bundleCode + '\n//# sourceURL=PLUGINS/create_track_gen.js');
loadPlugin(fakeScopedRequire, fakeScopedRequire);

// ── 断言 ────────────────────────────────────────────────────
assert(registered, '❌ Plugin.register 未被调用');
assert.strictEqual(registered.id, 'create_track_gen', `❌ 插件 ID 应为 create_track_gen，实际 ${registered.id}`);
assert.strictEqual(registered.data.variant, 'both');
// i18n 磁盘加载：onload 读取了插件目录旁的 lang/zh.json，覆盖了内置的 ctg.ok
assert.strictEqual(tl('ctg.ok'), '确定-磁盘覆盖', `❌ 应从磁盘读取 lang/zh.json 覆盖翻译，实际 ${tl('ctg.ok')}`);

// 菜单注册了五个 Action：生成 + 换算 + 导出 + 示例钢轨 + 示例枕木
assert.strictEqual(addedActions.length, 5, '❌ 应注册 5 个 Action（生成 + 换算 + 导出 + 示例钢轨 + 示例枕木）');
const [genAction, gaugeAction, exportAction, exampleRailAction, exampleTieAction] = addedActions;
assert.strictEqual(genAction.id, 'create_track_gen.generate');
assert.strictEqual(gaugeAction.id, 'create_track_gen.gauge');
assert.strictEqual(exportAction.id, 'create_track_gen.export');
assert.strictEqual(exampleRailAction.id, 'create_track_gen.example_rail');
assert.strictEqual(exampleTieAction.id, 'create_track_gen.example_tie');

// 轨距换算独立入口：对话框（英寸/毫米/像素 + 只读输出值联动）
gaugeAction.click();
{
	const gDlg = lastDialog;
	assert(gDlg, '❌ 轨距换算应打开对话框');
	assert.strictEqual(gDlg.config.title, '轨距换算', '❌ 轨距换算对话框标题应为「轨距换算」');
	assert(gDlg.config.lines, '❌ 轨距换算对话框应有自定义内容');
	const gDrv = gDlg.config._driver;
	assert(gDrv, '❌ 轨距换算对话框应暴露驱动钩子');
	// 默认 Create 1600mm → px 25.6、inch ≈62.992、scale ≈0.965
	let g = gDrv.getState();
	assert(Math.abs(g.mm - 1600) < 1e-9, `❌ 默认毫米应为 1600，实际 ${g.mm}`);
	assert(Math.abs(g.px - 25.6) < 1e-6, `❌ 默认像素应为 25.6，实际 ${g.px}`);
	assert(Math.abs(g.inch - 62.9921) < 1e-3, `❌ 默认英寸应 ≈62.9921，实际 ${g.inch}`);
	assert(Math.abs(g.scale - 0.965) < 1e-3, `❌ 默认比例常数应 ≈0.965，实际 ${g.scale}`);
	// 输入 1435mm → px 22.96、inch ≈56.496、scale ≈0.755（其余字段联动）
	gDrv.setMM(1435);
	g = gDrv.getState();
	assert(Math.abs(g.px - 22.96) < 1e-6, `❌ 1435mm → px 应为 22.96，实际 ${g.px}`);
	assert(Math.abs(g.inch - 1435 / 25.4) < 1e-3, `❌ 1435mm → inch 应 ≈56.496，实际 ${g.inch}`);
	assert(Math.abs(g.scale - 0.755) < 1e-3, `❌ 1435mm → scale 应 ≈0.755，实际 ${g.scale}`);
	// 输入 16px（米轨）→ mm 1000、inch ≈39.37、scale ≈0.525
	gDrv.setPx(16);
	g = gDrv.getState();
	assert(Math.abs(g.mm - 1000) < 1e-6, `❌ 16px → mm 应为 1000，实际 ${g.mm}`);
	assert(Math.abs(g.scale - 0.525) < 1e-3, `❌ 16px → scale 应 ≈0.525，实际 ${g.scale}`);
	// 英寸也能作为输入：38.1in（= 967.74mm 附近）→ 校验联动不破坏
	gDrv.setInch(62.9921);
	g = gDrv.getState();
	assert(Math.abs(g.mm - 1600) < 1, `❌ 62.9921in → mm 应 ≈1600，实际 ${g.mm}`);
}
console.log('   轨距换算 → 英寸/毫米/像素联动 + 只读输出值 ✓');

// 示例零件工具：在当前工作区摆放示例长方体（初始 Project.format = java_block → 对称点 (8,8)）
{
	const cubesBefore = createdCubes.length;
	exampleRailAction.click();
	assert.strictEqual(createdCubes.length, cubesBefore + 1, '❌ 示例钢轨应创建一个 cube');
	const railCube = createdCubes[createdCubes.length - 1];
	assert.deepStrictEqual(railCube.from, [6.8, 0, 4], `❌ 示例钢轨 from 应参考 test_rail（居中 (8,8)），实际 ${railCube.from}`);
	assert.deepStrictEqual(railCube.to, [9.2, 2.8, 12], `❌ 示例钢轨 to 应参考 test_rail（居中 (8,8)），实际 ${railCube.to}`);
	exampleTieAction.click();
	assert.strictEqual(createdCubes.length, cubesBefore + 2, '❌ 示例枕木应创建一个 cube');
	const tieCube = createdCubes[createdCubes.length - 1];
	assert.deepStrictEqual(tieCube.from, [-8, 0, 6.25], `❌ 示例枕木 from 应参考 test_tie（居中 (8,8)），实际 ${tieCube.from}`);
	assert.deepStrictEqual(tieCube.to, [24, 4, 9.75], `❌ 示例枕木 to 应参考 test_tie（居中 (8,8)），实际 ${tieCube.to}`);
}
console.log('   示例零件工具 → 在当前工作区摆放示例钢轨/枕木长方体 ✓');

// 生成流程：单页对话框 → 新建工作区 + 导入纹理 + 生成形状（异步）
(async () => {
	const beforeCubes = createdCubes.length;
	const clickPromise = genAction.click();

	// 对话框已打开，暴露驱动钩子（测试用）
	const dlg = lastDialog;
	assert(dlg, '❌ 生成应打开配置对话框');
	const driver = dlg.config._driver;
	assert(driver, '❌ 配置对话框应暴露驱动钩子');
	// 工作区名称默认应为 track（不再默认「机械动力轨道」）
	assert.strictEqual(dlg.config.form.name.value, 'track', '❌ 新工作区名称默认值应为 track');

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

	// 生成的 cube / group 已创建（父分组 + 9 个形状子分组 + 3 个弯道基础分组；
	// z_ortho / cross_d1_zo / cross_d2_zo / ascending_n/e/w / teleport_x 不再生成，由 blockstates 旋转表达）
	assert(createdCubes.length > beforeCubes, '❌ 生成应创建 Cube');
	assert(createdGroups.length >= 13, '❌ 应创建父分组 + 9 个形状子分组 + 3 个基础分组');
	// 弯道渲染基础分组：tie / segment_left / segment_right，都挂到轨道大组下
	const parentGroup = createdGroups.find((g) => g.name === Project.name);
	assert(parentGroup, `❌ 应创建轨道大组（名 = 工作区名「${Project.name}」）`);
	assert.strictEqual(parentGroup.name, Project.name, '❌ 大组名应与工作区名保持一致');
	const baseGroups = createdGroups.filter((g) => ['segment_left', 'segment_right', 'tie'].includes(g.name));
	assert.strictEqual(baseGroups.length, 3, '❌ 应创建 tie / segment_left / segment_right 三个基础分组');
	for (const g of baseGroups) {
		assert(g.children.some((ch) => ch instanceof global.Cube), `❌ 基础分组 ${g.name} 应含 cube 元素`);
		assert.strictEqual(g.parent, parentGroup, `❌ 基础分组 ${g.name} 应挂到轨道大组下`);
	}
	// 轨道大组下应有 9 个形状子分组 + 3 个基础分组
	const parentChildrenGroups = parentGroup.children.filter((ch) => ch instanceof global.Group);
	assert.strictEqual(parentChildrenGroups.length, 12, `❌ 轨道大组应有 9 形状 + 3 基础分组，实际 ${parentChildrenGroups.length}`);
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

	// 传送门覆层：teleport 生成 2 个覆层块（teleport_left / teleport_right），贴 portal_track_mip
	// （teleport_x 不再生成：传送门 4 方向都由 teleport 经 blockstates y 旋转表达）
	const overlays = createdCubes.filter((c) => (c.opts?.name ?? '').startsWith('teleport_'));
	assert.strictEqual(overlays.length, 2, `❌ 应生成 2 个传送门覆层（teleport_left/teleport_right），实际 ${overlays.length}`);
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
	assert.strictEqual(Project.format.id, 'free', '❌ 含 mesh 零件的新工作区应为自由模型');
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
	// 无默认 2×2×2 方块：mesh 顶点数必须恰好等于源 mesh 的顶点数（8），不能是 8+8=16
	for (const name of ['segment_left', 'segment_right', 'tie']) {
		const m = meshOf(name);
		assert.strictEqual(
			Object.keys(m.vertices).length,
			8,
			`❌ 场景 C ${name} mesh 顶点数应为源 mesh 的 8 个（不应混入默认 2×2×2 方块）`
		);
		assert.strictEqual(
			Object.keys(m.faces).length,
			1,
			`❌ 场景 C ${name} mesh 面数应为源 mesh 的 1 个（不应混入默认方块 6 面）`
		);
	}
	// 9 个方向形状也应含 mesh（零件 mesh 几何被变换放进每个形状分组，不再只进基础分组）
	const shapeNames = ['x_ortho', 'diag', 'diag_2', 'ascending_south', 'teleport', 'cross_ortho', 'cross_diag', 'cross_d1_xo', 'cross_d2_xo'];
	const cParent = createdGroups.find((g) => g.name === Project.name);
	assert(cParent, '❌ 场景 C 应有轨道大组');
	for (const sn of shapeNames) {
		const sg = cParent.children.find((ch) => ch instanceof global.Group && ch.name.startsWith(sn));
		assert(sg, `❌ 场景 C 应有形状分组 ${sn}`);
		const hasMeshChild = sg.children.some((ch) => ch instanceof global.Mesh);
		assert(hasMeshChild, `❌ 场景 C 形状分组 ${sn} 应含 mesh（零件 mesh 几何要出现在每个方向形状里）`);
	}
	// 方向形状的 mesh 顶点数同样不能混入默认 2×2×2 方块（源 mesh 8 顶点 → 每个形状 mesh 也应 8 顶点）
	const firstShape = cParent.children.find((ch) => ch instanceof global.Group && ch.name.startsWith('x_ortho'));
	const firstShapeMesh = firstShape.children.find((ch) => ch instanceof global.Mesh);
	assert.strictEqual(Object.keys(firstShapeMesh.vertices).length, 8, '❌ 场景 C 方向形状 mesh 不应混入默认 2×2×2 方块');
	// mesh 面 uv 应保留源模型的逐顶点 uv：addVertices 重分配顶点 key 后 face.uv 必须跟着重映射，
	// 否则 MeshFace 逐顶点查找全部落空退回 [0,0]，整张 mesh 糊到纹理左上角
	const firstFace = Object.values(firstShapeMesh.faces)[0];
	const uvValues = Object.values(firstFace.uv ?? {});
	assert.strictEqual(uvValues.length, 4, `❌ 场景 C mesh 面应有 4 个逐顶点 uv，实际 ${JSON.stringify(firstFace.uv)}`);
	const flatUv = uvValues.flat();
	assert(flatUv.includes(8), `❌ 场景 C mesh 面 uv 应保留源模型的 [8,0]/[8,4] 值，实际 ${JSON.stringify(firstFace.uv)}`);
	assert(flatUv.some((v) => v === 4), `❌ 场景 C mesh 面 uv 应保留源模型的 v=4 值，实际 ${JSON.stringify(firstFace.uv)}`);
	assert(createdMeshes.length > 0, '❌ 应创建 Mesh 元素');
	meshImport = false;
	console.log('   零件含 mesh 组 → 新工作区为自由模型，基础分组 + 9 个方向形状都含 mesh ✓');

	// ── 场景 D：导出轨道模型（Create/Kuayue 命名规范 + blockstates）──
	// 场景 A 生成的轨道大组（parentGroup）仍可引用；
	// 场景 C 已把 Project 切到 generic 工作区，这里恢复场景 A 的纹理尺寸上下文。
	// 大组名改为当前工作区名（新约定：大组名 = 工作区名），验证导出按工作区名查找到
	// 同时删除 global.require，模拟真实 Blockbench 正常模式（无 window.require）——
	// 导出必须走插件局部参数 requireNativeModule 才能取得 scoped fs
	delete global.require;
	const trackParent = parentGroup;
	assert(trackParent, '❌ 导出前应有轨道大组');
	trackParent.name = 'track';
	Project.elements = [trackParent];
	Project.name = 'track';
	Project.texture_width = 64;
	Project.texture_height = 64;
	Project.format = { id: 'java_block' };
	exportDir = path.join(require('os').tmpdir(), 'ctg-export-' + String(Math.random()).slice(2));
	// 导出配置对话框（默认值断言，经 _driver 读取）
	const exportDlg0 = (() => {
		exportAction.click();
		const dlg = lastDialog;
		assert(dlg, '❌ 应打开导出配置对话框');
		assert.strictEqual(dlg.config.title, '导出轨道模型', '❌ 导出对话框标题应为「导出轨道模型」');
		const drv = dlg.config._driver;
		assert(drv, '❌ 导出对话框应暴露驱动钩子');
		const init = drv.getState();
		assert.strictEqual(init.namespace, 'create', '❌ 导出命名空间默认应为 create');
		assert.strictEqual(init.trackId, 'track', '❌ 导出轨道 id 默认应为工作区名');
		assert.strictEqual(init.mode, 'classic_java', '❌ 导出模式默认应为经典 Java');
		assert.strictEqual(init.modelPath, 'block/track/track', '❌ 模型资源路径默认应为 block/track/{轨道id}');
		const initTexPaths = Object.values(init.texturePaths);
		assert(initTexPaths.length > 0, '❌ 导出对话框应列出每张纹理的资源路径');
		assert(initTexPaths.every((p) => p === 'block/track/track'), '❌ 纹理资源路径默认应为 block/track/{轨道id}');
		return dlg;
	})();
	// 跑一次确认（先取消这个默认对话框，避免影响后续）
	exportDlg0.config.onCancel();

	/** 触发一次导出，返回写出的文件列表 */
	const runExport = async (mode) => {
		exportedFiles.length = 0;
		const click = exportAction.click();
		const dlg = lastDialog;
		assert(dlg, `❌ ${mode} 应打开导出配置对话框`);
		const drv = dlg.config._driver;
		drv.setMode(mode);
		drv.setNamespace('kuayue');
		drv.setTrackId('track');
		drv.setRoot(exportDir); // 自动生成模型/纹理的默认导出路径
		const ret = drv.confirm();
		assert.notStrictEqual(ret, false, `❌ ${mode} 导出配置合法时不应阻止关闭`);
		await new Promise((r) => setTimeout(r, 20));
		return exportedFiles;
	};
	const modelFiles = (arr) => arr.map((f) => f.path).filter((p) => p.includes('/models/block/track/track/') && p.endsWith('.json'));
	// z_ortho / cross_d1_zo / cross_d2_zo 不再单独导出：由 blockstates 90° 旋转表达
	const ALL_MODELS = ['x_ortho.json', 'diag.json', 'diag_2.json', 'ascending.json', 'teleport.json', 'cross_ortho.json', 'cross_diag.json', 'cross_d1_xo.json', 'cross_d2_xo.json', 'tie.json', 'segment_left.json', 'segment_right.json'];

	// ── 模式 1：经典 Java（默认）──
	let exported = await runExport('classic_java');
	let modelNames = modelFiles(exported).map((p) => p.split('/').pop()).sort();
	for (const name of ALL_MODELS) assert(modelNames.includes(name), `❌ 经典应导出模型 ${name}`);
	assert(!modelNames.includes('teleport_x.json'), '❌ 不应导出 teleport_x');
	assert(!modelNames.includes('z_ortho.json'), '❌ 不应导出 z_ortho（blockstates 用 x_ortho 旋转表达）');
	assert(!modelNames.includes('cross_d1_zo.json') && !modelNames.includes('cross_d2_zo.json'), '❌ 不应导出 cross_*_zo（blockstates 旋转表达）');
	assert.strictEqual(modelNames.length, 12, `❌ 经典应导出 12 个模型文件，实际 ${modelNames.length}`);
	const xOrtho = exported.find((f) => f.path.endsWith('/models/block/track/track/x_ortho.json'));
	const xJson = JSON.parse(xOrtho.content);
	assert(Array.isArray(xJson.elements) && xJson.elements.length > 0, '❌ x_ortho.json 应含 elements');
	assert(!xJson.format_version, '❌ 经典模式不应有 format_version 字段');
	assert.deepStrictEqual(xJson.texture_size, [64, 64], '❌ x_ortho.json texture_size 应为项目纹理尺寸 64×64');
	assert(xJson.textures && xJson.textures.particle, '❌ x_ortho.json 应含 particle 纹理');
	assert(/^kuayue:block\/track\/track\//.test(Object.values(xJson.textures).find((v) => typeof v === 'string') || ''), '❌ 模型纹理应引用 kuayue:block/track/track/…');
	const hasConvertedUv = xJson.elements.some((el) => {
		for (const f of Object.values(el.faces)) {
			if (f && Array.isArray(f.uv) && f.uv[2] === 2 && f.uv[3] === 2) return true;
		}
		return false;
	});
	assert(hasConvertedUv, '❌ 面 uv 应从像素单位换算为 16 单位制（[0,0,8,8] → [0,0,2,2]）');
	const ascFile = exported.find((f) => f.path.endsWith('/models/block/track/track/ascending.json'));
	const ascJson = JSON.parse(ascFile.content);
	const ascRot = ascJson.elements.find((el) => el.rotation);
	assert(ascRot && ascRot.rotation.axis === 'x' && ascRot.rotation.angle === -45, '❌ 经典 ascending 应为单轴 X -45°');
	const bsFile = exported.find((f) => f.path.endsWith('/blockstates/track_track.json'));
	const bsJson = JSON.parse(bsFile.content);
	assert.strictEqual(bsJson.variants['shape=none,turn=false,waterlogged=false'].model, 'minecraft:block/air');
	assert.strictEqual(bsJson.variants['shape=an,turn=false,waterlogged=false'].y, 180);
	assert.strictEqual(bsJson.variants['shape=zo,turn=false,waterlogged=false'].model, 'kuayue:block/track/track/x_ortho', '❌ shape=zo 应由 x_ortho 旋转 90° 表达');
	assert.strictEqual(bsJson.variants['shape=zo,turn=false,waterlogged=false'].y, 90);
	assert.strictEqual(bsJson.variants['shape=cr_pdx,turn=false,waterlogged=false'].y, 90, '❌ cr_pdx 应旋转 90°');
	assert.strictEqual(bsJson.variants['shape=cr_pdz,turn=false,waterlogged=false'].model, 'kuayue:block/track/track/cross_d2_xo');
	assert.strictEqual(bsJson.variants['shape=cr_pdz,turn=false,waterlogged=false'].y, 180);
	assert.strictEqual(bsJson.variants['shape=cr_ndx,turn=false,waterlogged=false'].y, 270);
	assert.strictEqual(bsJson.variants['shape=cr_ndz,turn=false,waterlogged=false'].model, 'kuayue:block/track/track/cross_d1_xo');
	assert.strictEqual(Object.keys(bsJson.variants).length, (1 + 18) * 2 * 2);
	// 每张纹理默认导出到 root/textures/block/track/track/（默认生成的纹理导出路径）
	const texturePngs = exported.filter((f) => f.path.includes('/textures/block/track/track/') && f.path.endsWith('.png'));
	assert(texturePngs.length > 0, '❌ 经典应导出纹理 PNG');
	assert(texturePngs.every((f) => f.path.startsWith(exportDir + '/')), '❌ 纹理应写进导出根目录内');
	console.log('   导出（经典 Java）→ 12 个模型 JSON + blockstates + 纹理 ✓');

	// ── 模式 2：新 Java（1.21.11+）──
	exported = await runExport('new_java');
	modelNames = modelFiles(exported).map((p) => p.split('/').pop()).sort();
	assert.strictEqual(modelNames.length, 12, '❌ 新格式应导出 12 个模型文件');
	const xJsonNew = JSON.parse(exported.find((f) => f.path.endsWith('/models/block/track/track/x_ortho.json')).content);
	assert.strictEqual(xJsonNew.format_version, '1.21.11', '❌ 新格式应有 format_version 1.21.11');
	assert(Array.isArray(xJsonNew.elements) && xJsonNew.elements.length > 0, '❌ 新格式 x_ortho 应含元素');
	// 新格式多轴旋转：手工注入一个多轴旋转立方体的分组 → 走 {x,y,z}（此处用 ascending 的南向，仍为单轴 -45）
	const ascJsonNew = JSON.parse(exported.find((f) => f.path.endsWith('/models/block/track/track/ascending.json')).content);
	assert(ascJsonNew.format_version === '1.21.11', '❌ 新格式 ascending 也应有 format_version');
	console.log('   导出（新 Java 1.21.11+）→ format_version 1.21.11 ✓');

	// ── 模式 3：全部 OBJ ──
	exported = await runExport('obj');
	const objPaths = exported.map((f) => f.path).filter((p) => p.includes('/models/block/track/track/') && p.endsWith('.obj'));
	assert.strictEqual(objPaths.length, 12, `❌ OBJ 模式应导出 12 个 .obj，实际 ${objPaths.length}`);
	const xObj = exported.find((f) => f.path.endsWith('/models/block/track/track/x_ortho.obj'));
	assert(xObj, '❌ 应导出 x_ortho.obj');
	assert(xObj.content.startsWith('# Made in Blockbench'), '❌ OBJ 应有文件头');
	assert(/^mtllib x_ortho\.mtl/m.test(xObj.content), '❌ OBJ 应引用 mtllib');
	// 单一合并网格：没有 o / g 分组标记，顶点坐标 px/16
	assert(!/^[og]\s/m.test(xObj.content), '❌ OBJ 应为单一合并网格（不应有 o / g 分组）');
	assert(xObj.content.includes('v -0.125 0.125 0'), '❌ OBJ 顶点应为 px/16（-2,2,0 → v -0.125 0.125 0）');
	assert(/^usemtl m_t/m.test(xObj.content), '❌ OBJ 应含 usemtl 材质');
	assert(/^f /m.test(xObj.content), '❌ OBJ 应含 f 面');
	const xMtl = exported.find((f) => f.path.endsWith('/models/block/track/track/x_ortho.mtl'));
	assert(xMtl && /^newmtl m_t/m.test(xMtl.content) && /^map_Kd kuayue:block\/track\/track\//m.test(xMtl.content), '❌ MTL 应有 newmtl + map_Kd');
	const xRef = JSON.parse(exported.find((f) => f.path.endsWith('/models/block/track/track/x_ortho.json')).content);
	assert.strictEqual(xRef.loader, 'forge:obj', '❌ OBJ 引用 JSON 应有 loader forge:obj');
	assert.strictEqual(xRef.model, 'kuayue:models/block/track/track/x_ortho.obj', '❌ OBJ 引用应指向 .obj');
	assert.strictEqual(xRef.flip_v, true, '❌ OBJ 引用应有 flip_v: true');
	// OBJ 模式仍写 blockstates
	assert(exported.some((f) => f.path.endsWith('/blockstates/track_track.json')), '❌ OBJ 模式也应导出 blockstates');
	console.log('   导出（全部 OBJ）→ 12 个单一合并网格 .obj/.mtl + 引用 JSON + blockstates ✓');

	// ── 模式 4：基岩版 ──
	exported = await runExport('bedrock');
	// 形状引用 rail+tie 多张纹理 → 回退 OBJ；tie/segment 各单纹理 → 基岩版 geometry
	const geoFiles = exported.filter((f) => f.path.includes('/models/blocks/track/') && f.path.endsWith('.json'));
	assert(geoFiles.length >= 3, `❌ 基岩版应导出单纹理形状的 geometry，实际 ${geoFiles.length}`);
	const tieGeo = exported.find((f) => f.path.endsWith('/models/blocks/track/tie.json'));
	assert(tieGeo, '❌ 应导出 tie 的基岩版 geometry');
	const geoJson = JSON.parse(tieGeo.content);
	assert.strictEqual(geoJson.format_version, '1.21.0', '❌ 基岩版 geometry format_version 应为 1.21.0');
	assert(Array.isArray(geoJson['minecraft:geometry']) && geoJson['minecraft:geometry'][0].bones, '❌ 基岩版 geometry 应含 minecraft:geometry.bones');
	assert.strictEqual(geoJson['minecraft:geometry'][0].description.identifier, 'geometry.track_tie', '❌ 基岩版 geometry 标识符应为 geometry.track_tie');
	// 多纹理形状回退 OBJ（x_ortho → obj），随 bedrock 模型目录（models/blocks/track/）
	assert(exported.some((f) => f.path.endsWith('/models/blocks/track/x_ortho.obj')), '❌ 基岩版多纹理形状应回退 OBJ');
	const blocksJson = exported.find((f) => f.path.endsWith('/blocks.json'));
	assert(blocksJson, '❌ 基岩版应导出 blocks.json');
	const blocksParsed = JSON.parse(blocksJson.content);
	assert(blocksParsed.blocks && Object.keys(blocksParsed.blocks).length >= 1, '❌ blocks.json 应定义方块');
	console.log('   导出（基岩版）→ 单纹理形状 geometry + blocks.json，多纹理形状回退 OBJ ✓');

	// ── 模式 5：自定义模型/纹理资源路径（用户可手动调整，引用跟随 path）──
	exportedFiles.length = 0;
	exportAction.click();
	const dlgP = lastDialog;
	assert(dlgP, '❌ 自定义路径应打开导出配置对话框');
	const drvP = dlgP.config._driver;
	drvP.setMode('classic_java');
	drvP.setNamespace('kuayue');
	drvP.setTrackId('track');
	drvP.setRoot(exportDir);
	const texKey = Object.keys(drvP.getState().texturePaths)[0];
	drvP.setModelPath('custom/track');
	drvP.setTexturePath(texKey, 'custom/tex');
	assert.notStrictEqual(drvP.confirm(), false, '❌ 自定义路径导出不应被阻止');
	await new Promise((r) => setTimeout(r, 20));
	// 模型写到 root/models/{模型资源路径}/（custom/track）
	assert(exportedFiles.some((f) => f.path.includes('/models/custom/track/') && f.path.endsWith('x_ortho.json')), '❌ 模型应写到 models/custom/track/');
	// 自定义纹理写到 root/textures/{纹理资源路径}/（custom/tex）
	assert(exportedFiles.some((f) => f.path.includes('/textures/custom/tex/') && f.path.endsWith('.png')), '❌ 自定义纹理应写到 textures/custom/tex/');
	// 模型内纹理引用跟随纹理资源路径：kuayue:custom/tex/<res>
	const customX = exportedFiles.find((f) => f.path.includes('/models/custom/track/') && f.path.endsWith('x_ortho.json'));
	const customXJson = JSON.parse(customX.content);
	const refs = Object.values(customXJson.textures).filter((v) => typeof v === 'string');
	assert(refs.some((r) => /^kuayue:custom\/tex\//.test(r)), `❌ 模型纹理引用应推导为 kuayue:custom/tex/…，实际 ${refs.join(', ')}`);
	// 未自定义的纹理仍走默认资源路径 block/track/track
	assert(exportedFiles.some((f) => f.path.includes('/textures/block/track/track/') && f.path.endsWith('.png')), '❌ 未自定义的纹理仍应写默认路径');
	// blockstates 引用跟随模型资源路径：kuayue:custom/track/x_ortho
	const customBs = exportedFiles.find((f) => f.path.endsWith('/blockstates/track_track.json'));
	const customBsJson = JSON.parse(customBs.content);
	assert.strictEqual(customBsJson.variants['shape=xo,turn=false,waterlogged=false'].model, 'kuayue:custom/track/x_ortho', '❌ blockstates 应引用自定义模型资源路径');
	console.log('   导出（自定义模型/纹理资源路径）→ 模型/纹理写到对应目录，blockstates/模型引用跟随 path ✓');

	// 汇总消息框弹出
	assert(lastMessageBox && lastMessageBox.title === '导出完成', '❌ 导出完成后应弹出汇总');
	console.log('   导出 4 种模式（经典 / 新 Java / OBJ / 基岩版）→ 判定 + 回退 + 结构 ✓');

	// ── 场景 E：自由模型工作区导出强制 OBJ（mode 锁定为 obj，setMode 无效）──
	Project.format = { id: 'free' };
	Project.elements = [trackParent];
	Project.name = 'track';
	exportAction.click();
	const dlgE = lastDialog;
	assert(dlgE, '❌ 自由模型工作区也应打开导出对话框');
	const drvE = dlgE.config._driver;
	assert.strictEqual(drvE.getState().mode, 'obj', '❌ 自由模型工作区导出模式应强制为 obj');
	drvE.setMode('classic_java');
	assert.strictEqual(drvE.getState().mode, 'obj', '❌ 自由模型工作区 setMode 应被锁定为 obj');
	// 直接走 confirm 也不应改变模式（且取消，不实际写文件）
	dlgE.config.onCancel();
	Project.format = { id: 'java_block' };
	console.log('   自由模型工作区 → 导出仅允许 OBJ ✓');

	// 卸载清理
	unloadHooks.forEach((fn) => fn && fn());
	assert(genAction.deleted, '❌ onunload 应删除生成 Action');
	assert(gaugeAction.deleted, '❌ onunload 应删除换算 Action');
	assert(exportAction.deleted, '❌ onunload 应删除导出 Action');
	assert(exampleRailAction.deleted, '❌ onunload 应删除示例钢轨 Action');
	assert(exampleTieAction.deleted, '❌ onunload 应删除示例枕木 Action');

	console.log('✅ 冒烟测试通过');
	console.log('   插件 ID:', registered.id);
	console.log('   注册 Action:', addedActions.map((a) => a.id).join(', '));
	console.log('   轨距换算 1435mm → ~0.755 ✓');
	console.log('   单页配置 → 右轨「从第一个模型对称」镜像左轨 ✓');
	console.log('   示例零件工具 → 示例钢轨 / 示例枕木长方体 ✓');
	console.log('   生成 → 新工作区「track」(64×64)，纹理已应用 ✓');
	console.log('   弯道基础分组 → tie / segment_left / segment_right 挂到轨道大组下 ✓');
	console.log('   选择一个标签页 → 从该标签页提取选中元素 ✓');
	console.log('   零件含 mesh 组 → 新工作区为自由模型，基础分组含 mesh ✓');
	console.log('   传送门覆层 → 导入 2 张纹理（track 铺整体 / mip 贴覆层块），teleport 叠加左右 2 个覆层 ✓');
	console.log('   导出轨道模型 → Create 命名规范模型 + blockstates + 纹理（自由模型强制 OBJ）✓');
	console.log('   onunload 已清理 Action ✓');
})();
