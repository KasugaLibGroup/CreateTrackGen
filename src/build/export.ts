/**
 * 导出层 —— 把当前工作区轨道大组（名 = 工作区名）下的各分组，
 * 按四种模式（new_java / classic_java / bedrock / obj）导出到用户指定文件夹。
 *
 * 导出配置用与「生成」类似的单页大对话框收集（左侧配置 / 右侧每张纹理的资源路径）：
 *  - 导出模式 / 命名空间 / 轨道 id 由用户填写；
 *  - 导出根目录 = 资源包 assets/{命名空间} 所在目录——所有文件都写到这里，归类为
 *    models/ textures/ blockstates/；
 *  - 模型资源路径 = 写入模型文件的 {命名空间}:path/file 的 path（blockstates 引用模型用），
 *    默认 block/track/{轨道id}；模型写到 根目录/models/{path}/；
 *  - 每张纹理一个资源路径（模型引用纹理用），默认同样 block/track/{轨道id}；
 *    纹理写到 根目录/textures/{path}/。
 * 所有路径字段都可手动编辑，并预置默认生成的路径；文件内引用直接用这些资源路径。
 *
 * 文件写入用 Blockbench 的 scoped `require('fs', { scope })`（桌面端，首次会请求
 * 「访问文件夹」权限）；Node 冒烟测试里用 global.require 桩替换。
 * 无法导出的判定与各格式序列化在纯逻辑层 src/logic/export.ts（可单测）。
 */

import {
	buildBedrockBlocksJson,
	buildBedrockGeometry,
	buildBlockstates,
	blockstatesFileName,
	buildJavaModelJson,
	buildObj,
	buildObjReferenceJson,
	cleanGroupName,
	EXPORT_MODES,
	type ExportCubeData,
	type ExportElement,
	type ExportFaceData,
	type ExportMeshFaceData,
	type ExportMode,
	type ExportTexture,
	groupNeedsObj,
	modelFileName,
	textureResourceName,
	TRACK_MODEL_FILES,
} from '../logic/export';
import type { CubeFaceDirection, Vec3 } from '../logic/types';
import { t } from '../i18n';
import type { DialogOptions } from 'blockbench-types/generated/interface/dialog';

/** 轨道大组（父分组）的名称，与 buildAllShapes 里创建的一致 */
export const TRACK_PARENT_NAME = '机械动力轨道';

/**
 * Blockbench 加载插件脚本用 `new Function("requireNativeModule","require",code)` 求值，
 * scoped require 以局部参数 `requireNativeModule`（与 `require`）注入插件作用域。
 * 用 `requireNativeModule` 是因为 esbuild 会把自由标识符 `require` 改名为 `__require`
 * （undefined），而 `requireNativeModule` 原样保留。这里做类型声明；Web 端不存在时 typeof 守卫兜底。
 */
declare const requireNativeModule: ((id: string, options?: Record<string, unknown>) => any) | undefined;

type ScopedRequire = (id: string, options?: Record<string, unknown>) => any;
type ExportFs = { mkdirSync(p: string, opts?: { recursive?: boolean }): void; writeFileSync(p: string, content: string | Uint8Array, opts?: unknown): void };

/**
 * 取得 Blockbench 插件环境的 scoped require。
 * 优先级：`globalThis.require`（Node 冒烟测试桩、Dev Tools 模式的 window.require）
 * → 插件局部参数 `requireNativeModule`（桌面端正常路径，esbuild 原样保留）。
 */
function nodeRequire(): ScopedRequire | undefined {
	const g = globalThis as { require?: unknown };
	if (typeof g.require === 'function') return g.require as ScopedRequire;
	const local = (typeof requireNativeModule !== 'undefined' ? requireNativeModule : undefined) as ScopedRequire | undefined;
	return typeof local === 'function' ? local : undefined;
}

/** 取得以 dir 为根的 scoped fs；失败（未授权等）返回 undefined */
function scopedFs(dir: string): ExportFs | undefined {
	const req = nodeRequire();
	if (!req) return undefined;
	try {
		return req('fs', { scope: dir }) as ExportFs;
	} catch {
		return undefined;
	}
}

/** 把 scope 目录与若干相对路径段拼成绝对路径（统一正斜杠） */
function joinPath(dir: string, ...rel: string[]): string {
	return `${dir.replace(/[\\/]+$/, '')}/${rel.join('/')}`;
}

/** 纹理的实际像素尺寸（宽, 高） */
function textureSizeOf(tex: Texture): [number, number] {
	return [tex.width || tex.uv_width || 16, tex.height || tex.uv_height || 16];
}

/** data URL → Uint8Array（PNG 写盘用） */
function dataUrlToBytes(url: string): Uint8Array {
	const comma = url.indexOf(',');
	const b64 = url.slice(comma + 1);
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

/** 面纹理引用（Texture 实例 或 uuid）→ Texture；无法解析返回 undefined */
function faceTextureOf(v: unknown): Texture | undefined {
	if (v instanceof Texture) return v;
	if (typeof v === 'string') {
		const list = ((Project as any).textures ?? []) as Texture[];
		return list.find((t) => t.uuid === v);
	}
	return undefined;
}

/**
 * 找到当前项目里的轨道大组。大组名 = 生成时的工作区名（默认 'track'）。
 * 从多个权威来源收集顶层分组（Outliner 树根 / Project.elements / Group.all 顶层组，按 uuid 去重），
 * 依次按：① 当前工作区名（新约定）→ ② 旧名「机械动力轨道」（兼容旧工作区）→ ③ 含已知形状子分组的启发式。
 */
export function findTrackGroup(): Group | null {
	const seen = new Set<string>();
	const candidates: Group[] = [];
	const add = (el: unknown) => {
		if (!(el instanceof Group)) return;
		if (el.uuid != null) {
			if (seen.has(el.uuid)) return;
			seen.add(el.uuid);
		}
		candidates.push(el);
	};
	// ① Outliner 树根（顶层元素权威数组）
	const outlinerRoot = (globalThis as { Outliner?: { root?: unknown } }).Outliner?.root;
	if (Array.isArray(outlinerRoot)) outlinerRoot.forEach(add);
	// ② Project.elements（创建时 init() 也 safePush 到这里）
	const projElements = (Project as any).elements;
	if (Array.isArray(projElements)) projElements.forEach(add);
	// ③ Group.all 里的顶层分组（兜底；Blockbench 顶层组的 parent 是字符串 'root'）
	const allGroups = (globalThis as { Group?: { all?: unknown } }).Group?.all;
	if (Array.isArray(allGroups)) {
		for (const g of allGroups) {
			const parent = (g as { parent?: unknown }).parent;
			if (g instanceof Group && (parent === 'root' || parent == null || parent === '')) add(g);
		}
	}
	const wanted = String((Project as any).name || '').trim() || 'track';
	// ① 当前工作区名（= 大组名）
	const byWorkspace = candidates.find((g) => g.name === wanted);
	if (byWorkspace) return byWorkspace;
	// ② 旧名（兼容旧版本生成的工作区）
	const legacy = candidates.find((g) => g.name === TRACK_PARENT_NAME);
	if (legacy) return legacy;
	// ③ 启发式：直接含已知形状子分组的组
	const known = new Set(Object.keys(TRACK_MODEL_FILES));
	return (
		candidates.find((g) =>
			(g.children ?? []).some((ch) => ch instanceof Group && known.has(cleanGroupName(ch.name)))
		) ?? null
	);
}

/**
 * 全局收集所有分组引用的纹理：分配稳定 key（t0/t1…）+ 全局去重的资源名 + 尺寸 + 位图。
 * 供所有形状的 JSON / OBJ / 基岩版几何共用同一资源名，PNG 只写一次。
 */
function collectTexturesGlobal(subgroups: Group[]): { infos: ExportTexture[]; keyOf: Map<Texture, string> } {
	const usedNames = new Set<string>();
	const keyOf = new Map<Texture, string>();
	const infos: ExportTexture[] = [];
	const register = (tex: Texture) => {
		if (keyOf.has(tex)) return;
		const key = `t${keyOf.size}`;
		const resName = textureResourceName(tex.name, usedNames);
		const [width, height] = textureSizeOf(tex);
		keyOf.set(tex, key);
		infos.push({ key, resName, width, height, dataUrl: tex.source });
	};
	for (const g of subgroups) {
		for (const child of g.children ?? []) {
			if (child instanceof Cube) {
				for (const f of Object.values(child.faces ?? {})) {
					const tex = faceTextureOf(f?.texture);
					if (tex) register(tex);
				}
			} else if (child instanceof Mesh) {
				const save = child.getSaveCopy();
				for (const f of Object.values((save.faces ?? {}) as Record<string, any>)) {
					const tex = faceTextureOf(f?.texture);
					if (tex) register(tex);
				}
			}
		}
	}
	return { infos, keyOf };
}

/** 从 live Group 抽取平台无关的元素描述符（cube / mesh + 面纹理 key） */
function extractElements(group: Group, keyOf: Map<Texture, string>): ExportElement[] {
	const out: ExportElement[] = [];
	for (const child of group.children ?? []) {
		if (child instanceof Cube) {
			const faces: ExportCubeData['faces'] = {};
			for (const [dir, f] of Object.entries(child.faces ?? {})) {
				if (!f || f.enabled === false) continue;
				const fd: ExportFaceData = {};
				if (f.uv) fd.uv = [...f.uv] as [number, number, number, number];
				if (f.rotation) fd.rotation = f.rotation;
				const tex = faceTextureOf(f.texture);
				if (tex && keyOf.has(tex)) fd.textureKey = keyOf.get(tex);
				faces[dir as CubeFaceDirection] = fd;
			}
			out.push({
				type: 'cube',
				name: child.name,
				from: [...child.from] as Vec3,
				to: [...child.to] as Vec3,
				rotation: child.rotation && child.rotation.some((v) => v !== 0) ? ([...child.rotation] as Vec3) : undefined,
				origin: child.origin ? ([...child.origin] as Vec3) : undefined,
				faces,
			});
		} else if (child instanceof Mesh) {
			const save = child.getSaveCopy();
			const faces: Record<string, ExportMeshFaceData> = {};
			for (const [id, f] of Object.entries((save.faces ?? {}) as Record<string, any>)) {
				if (!f) continue;
				const mf: ExportMeshFaceData = { vertices: f.vertices ? [...f.vertices] : [] };
				if (f.uv) mf.uv = f.uv;
				const tex = faceTextureOf(f.texture);
				if (tex && keyOf.has(tex)) mf.textureKey = keyOf.get(tex);
				faces[id] = mf;
			}
			out.push({ type: 'mesh', name: child.name, vertices: save.vertices ?? {}, faces });
		}
	}
	return out;
}

/** 形状实际引用的纹理（按全局注册顺序），供模型 / MTL / blocks.json 引用 */
function shapeTextures(elements: ExportElement[], infos: ExportTexture[]): ExportTexture[] {
	const keys = new Set<string>();
	for (const el of elements) {
		for (const f of Object.values(el.faces)) {
			if (f?.textureKey) keys.add(f.textureKey);
		}
	}
	return infos.filter((tex) => keys.has(tex.key));
}

/** 写一张纹理 PNG（按绝对路径去重，只写一次） */
function writeTexturePng(
	fs: ExportFs,
	dir: string,
	tex: ExportTexture,
	files: string[],
	warnings: string[],
	writtenTextures: Set<string>,
	projW: number,
	projH: number
): void {
	if (!tex.dataUrl || !tex.dataUrl.startsWith('data:')) {
		warnings.push(t('ctg.export.texture_no_data', tex.resName));
		return;
	}
	const abs = joinPath(dir, `${tex.resName}.png`);
	if (!writtenTextures.has(abs)) {
		writtenTextures.add(abs);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(abs, dataUrlToBytes(tex.dataUrl));
		files.push(abs);
	}
	if (tex.width !== projW || tex.height !== projH) {
		warnings.push(t('ctg.export.texture_size_warn', [tex.resName, tex.width, tex.height, projW, projH]));
	}
}

// ── 导出配置大对话框 ──────────────────────────────────────────

/** 导出配置（对话框收集后传给 writeTrackExport） */
export interface ExportOptions {
	mode: ExportMode;
	namespace: string;
	trackId: string;
	/** 导出根目录（资源包 assets/{命名空间} 所在目录，所有文件都写到这里） */
	root: string;
	/**
	 * 模型资源路径（blockstates 引用模型用 {命名空间}:path/file 的 path，如 block/track/{id}）。
	 * 模型写到 根目录/models/{path}/，blockstates 引用 {命名空间}:{path}/{形状}。
	 */
	modelPath: string;
	/** texture key → 纹理资源路径（模型引用纹理用 {命名空间}:path/file 的 path） */
	texturePaths: Record<string, string>;
}

/** 对话框的表单状态（供 DOM 绑定与冒烟测试驱动共享） */
interface ExportFormState extends ExportOptions {
	/** 每个字段是否被用户改动过（改动后不再被默认路径覆盖） */
	dirty: { model: boolean; textures: Record<string, boolean> };
}

/** 冒烟测试驱动导出对话框的钩子（真实 Blockbench 不依赖它） */
export interface ExportDriver {
	setMode(mode: ExportMode): void;
	setNamespace(v: string): void;
	setTrackId(v: string): void;
	setRoot(v: string): void;
	setModelPath(v: string): void;
	setTexturePath(key: string, v: string): void;
	confirm(): boolean;
	getState(): ExportFormState;
}

/** 导出根目录的默认生成路径：优先当前项目文件所在目录，否则桌面 / 主目录下的 create_track_export */
function defaultExportRoot(): string {
	const proj = Project as any;
	const fp = typeof proj.save_path === 'string' ? proj.save_path : proj.file_path;
	if (typeof fp === 'string' && fp) {
		const i = Math.max(fp.lastIndexOf('/'), fp.lastIndexOf('\\'));
		if (i > 0) return fp.slice(0, i);
	}
	const sys = (globalThis as any).SystemInfo as { desktop_directory?: string; home_directory?: string } | undefined;
	const base =
		typeof sys?.desktop_directory === 'string' && sys.desktop_directory
			? sys.desktop_directory
			: typeof sys?.home_directory === 'string'
				? sys.home_directory
				: '';
	return base ? joinPath(base, 'create_track_export') : '';
}

/** 重新按 mode / trackId 生成默认资源路径（只覆盖用户未改动的字段） */
function recomputeDefaults(state: ExportFormState): void {
	const javaLike = state.mode !== 'bedrock';
	// Java/OBJ 惯例 block/track/{id}；基岩版惯例 blocks/{id}
	const sub = javaLike ? `block/track/${state.trackId}` : `blocks/${state.trackId}`;
	if (!state.dirty.model) state.modelPath = sub;
	for (const key of Object.keys(state.texturePaths)) {
		if (!state.dirty.textures[key]) state.texturePaths[key] = sub;
	}
}

/**
 * 校验资源路径是否合法：小写字母/数字/`/`/`_`/`.`/`-`，不以 / 开头或结尾，不含 `..` 段。
 */
function isValidResourcePath(p: string): boolean {
	if (!p || p.startsWith('/') || p.endsWith('/')) return false;
	if (!/^[a-z0-9/._-]+$/.test(p)) return false;
	if (p.split('/').some((seg) => seg === '..')) return false;
	return true;
}

// ── 导出对话框样式（与生成对话框同风格）────────────────────────
const EXPORT_STYLE_ID = 'create-track-gen-export-dialog-styles';
const EXPORT_STYLE = `
#create-track-gen-export-dialog .ctg-export {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	column-gap: 36px;
	row-gap: 4px;
	align-items: start;
}
#create-track-gen-export-dialog .ctg-export > * { min-width: 0; }
#create-track-gen-export-dialog .ctg-col { min-width: 0; }
#create-track-gen-export-dialog .ctg-col-title {
	font-weight: 700;
	font-size: 12px;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--color-subtle_text, #9a9a9a);
	margin: 2px 0 10px;
	padding-bottom: 6px;
	border-bottom: 1px solid var(--color-border, #3a3a3a);
}
#create-track-gen-export-dialog .ctg-exp-field { margin: 6px 0 14px; }
#create-track-gen-export-dialog .ctg-exp-field > label,
#create-track-gen-export-dialog .ctg-export-sub-title {
	display: block;
	font-weight: 600;
	margin-bottom: 4px;
	font-size: inherit;
	text-transform: none;
	letter-spacing: normal;
	border-bottom: none;
}
#create-track-gen-export-dialog .ctg-exp-input-row { display: flex; gap: 6px; align-items: center; }
#create-track-gen-export-dialog .ctg-exp-input-row input.ctg-exp-path { flex: 1; min-width: 0; }
/* 资源路径等文本输入框：明确可编辑样式 + 全宽 */
#create-track-gen-export-dialog input.ctg-exp-path,
#create-track-gen-export-dialog select.ctg-exp-select {
	width: 100%;
	box-sizing: border-box;
	background: var(--color-input, #202020);
	color: var(--text-color, #eee);
	border: 1px solid var(--color-border, #555);
	border-radius: 3px;
	padding: 5px 7px;
	font: inherit;
}
#create-track-gen-export-dialog input.ctg-exp-path:focus,
#create-track-gen-export-dialog select.ctg-exp-select:focus {
	border-color: var(--active-color, #4caf50);
	outline: none;
}
#create-track-gen-export-dialog .ctg-exp-field > input.ctg-exp-path,
#create-track-gen-export-dialog .ctg-tex-row > input.ctg-exp-path { margin-top: 3px; }
#create-track-gen-export-dialog .ctg-tex-row { margin: 4px 0 12px; }
#create-track-gen-export-dialog .ctg-tex-name {
	font-size: 12px;
	color: var(--color-subtle_text, #8a8a8a);
	margin-bottom: 3px;
	font-family: monospace;
}
#create-track-gen-export-dialog .ctg-btn {
	padding: 4px 12px;
	border: 1px solid var(--color-border, #555);
	border-radius: 4px;
	background: var(--color-button, #3f3f3f);
	color: var(--text-color, #eee);
	cursor: pointer;
	white-space: nowrap;
	flex: 0 0 auto;
}
#create-track-gen-export-dialog .ctg-btn:hover { border-color: var(--active-color, #4caf50); color: var(--active-color, #4caf50); }
#create-track-gen-export-dialog .ctg-hint {
	font-size: 12px;
	color: var(--color-subtle_text, #8a8a8a);
	margin-top: 2px;
	line-height: 1.5;
}
#create-track-gen-export-dialog .dialog_bar.button_bar { text-align: right; }
`;

/** 注入导出对话框样式（有 document 时；Node 冒烟测试安全跳过） */
export function injectExportStyles(): void {
	if (typeof document === 'undefined') return;
	if (document.getElementById(EXPORT_STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = EXPORT_STYLE_ID;
	style.textContent = EXPORT_STYLE;
	document.head.appendChild(style);
}

/** 卸载时清理导出对话框样式 */
export function disposeExportStyles(): void {
	if (typeof document === 'undefined') return;
	document.getElementById(EXPORT_STYLE_ID)?.remove();
}

/** 创建带类名与文本的 DOM 元素 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

/**
 * 导出配置对话框（单页大框框，两列：左侧导出配置 + 右侧每张纹理的导出路径）。
 * 所有路径字段均为可编辑文本框 + 「浏览…」按钮，并预置默认生成的路径。
 * 返回 null 表示取消。
 */
export function promptExportOptions(
	defaultTrackId: string,
	textures: ExportTexture[]
): Promise<ExportOptions | null> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (v: ExportOptions | null) => {
			if (settled) return;
			settled = true;
			resolve(v);
		};

		// 表单状态（初始：默认模式 classic_java + 默认命名空间 create + 默认根目录 + 默认资源路径）
		const state: ExportFormState = {
			mode: 'classic_java',
			namespace: 'create',
			trackId: defaultTrackId,
			root: defaultExportRoot(),
			modelPath: '',
			texturePaths: {},
			dirty: { model: false, textures: {} },
		};
		for (const t of textures) {
			state.texturePaths[t.key] = '';
			state.dirty.textures[t.key] = false;
		}
		recomputeDefaults(state);

		let dialogNode: HTMLElement | null = null;

		const errorBox = (message: string): void => {
			Blockbench.showMessageBox({ title: t('ctg.invalid_input'), message, buttons: [t('ctg.ok')], confirm: 0 });
		};

		/** 校验并把合法结果交给 finish；非法时弹提示并保持对话框打开 */
		const confirmExport = (): boolean => {
			syncFromDom(); // 兜底：采用用户在 DOM 输入框里实际填写的值
			const namespace = state.namespace.trim();
			const trackId = state.trackId.trim();
			const valid = /^[a-z0-9_]+$/;
			if (!EXPORT_MODES.some((m) => m.id === state.mode)) {
				errorBox(t('ctg.export.invalid_mode'));
				return false;
			}
			if (!namespace || !trackId) {
				errorBox(t('ctg.export.empty_ns_id'));
				return false;
			}
			if (!valid.test(namespace) || !valid.test(trackId)) {
				errorBox(t('ctg.export.invalid_chars'));
				return false;
			}
			if (!state.root || !state.modelPath || Object.values(state.texturePaths).some((p) => !p)) {
				errorBox(t('ctg.export.empty_paths'));
				return false;
			}
			if (!isValidResourcePath(state.modelPath)) {
				errorBox(t('ctg.export.invalid_resource_path'));
				return false;
			}
			for (const key of Object.keys(state.texturePaths)) {
				if (!isValidResourcePath(state.texturePaths[key])) {
					errorBox(t('ctg.export.invalid_resource_path'));
					return false;
				}
			}
			finish({
				mode: state.mode,
				namespace,
				trackId,
				root: state.root,
				modelPath: state.modelPath,
				texturePaths: { ...state.texturePaths },
			});
			return true;
		};

		const driver: ExportDriver = {
			setMode(mode) {
				state.mode = mode;
				recomputeDefaults(state);
				if (dialogNode) renderExportPaths(dialogNode, state);
			},
			setNamespace(v) {
				state.namespace = v;
			},
			setTrackId(v) {
				state.trackId = v;
				recomputeDefaults(state);
				if (dialogNode) renderExportPaths(dialogNode, state);
			},
			setRoot(v) {
				state.root = v;
				if (dialogNode) renderExportPaths(dialogNode, state);
			},
			setModelPath(v) {
				state.modelPath = v;
				state.dirty.model = true;
			},
			setTexturePath(key, v) {
				state.texturePaths[key] = v;
				state.dirty.textures[key] = true;
			},
			confirm() {
				return confirmExport();
			},
			getState() {
				return state;
			},
		};

		/** 把 state 里的资源路径同步回 DOM 输入框 */
		const renderExportPaths = (node: HTMLElement, s: ExportFormState): void => {
			const set = (key: string, v: string): void => {
				const input = node.querySelector<HTMLInputElement>(`[data-export="${key}"]`);
				if (input) input.value = v;
			};
			set('root', s.root);
			set('model', s.modelPath);
			for (const tk of Object.keys(s.texturePaths)) {
				const input = node.querySelector<HTMLInputElement>(`[data-export="texture"][data-tex-key="${tk}"]`);
				if (input) input.value = s.texturePaths[tk];
			}
		};

		/** 一个普通文本框（namespace / 资源路径等），data-export 标识绑定目标 */
		const textField = (which: string, value: string, texKey?: string): HTMLInputElement => {
			const input = el('input', 'ctg-exp-path') as HTMLInputElement;
			input.type = 'text';
			input.dataset.export = which;
			if (texKey) input.dataset.texKey = texKey;
			input.value = value;
			return input;
		};

		/** 一个带「浏览…」按钮的文件夹字段（仅导出根目录用） */
		const rootField = (): HTMLElement => {
			const row = el('div', 'ctg-exp-input-row');
			const input = textField('root', state.root);
			const browse = el('button', 'ctg-btn', t('ctg.export.browse')) as HTMLButtonElement;
			browse.type = 'button';
			row.append(input, browse);
			browse.addEventListener('click', () => {
				const picked = Filesystem.pickDirectory({ title: t('ctg.export.pick_root'), startpath: state.root });
				if (!picked) return;
				state.root = picked;
				if (dialogNode) renderExportPaths(dialogNode, state);
			});
			return row;
		};

		/** 当前模式/轨道 id 下的默认资源路径（Java block/track/{id}，基岩版 blocks/{id}） */
		const defaultPathFor = (): string => {
			const javaLike = state.mode !== 'bedrock';
			return javaLike ? `block/track/${state.trackId}` : `blocks/${state.trackId}`;
		};

		/** 资源路径字段（文本框 + 「重置」按钮），重置回默认路径 */
		const pathRow = (which: string, value: string, texKey?: string): HTMLElement => {
			const row = el('div', 'ctg-exp-input-row');
			row.append(textField(which, value, texKey));
			const reset = el('button', 'ctg-btn', t('ctg.export.reset')) as HTMLButtonElement;
			reset.type = 'button';
			reset.addEventListener('click', () => {
				const def = defaultPathFor();
				if (which === 'model') {
					state.modelPath = def;
					state.dirty.model = false;
				} else if (which === 'texture' && texKey) {
					state.texturePaths[texKey] = def;
					state.dirty.textures[texKey] = false;
				}
				if (dialogNode) renderExportPaths(dialogNode, state);
			});
			row.append(reset);
			return row;
		};

		/** 一个带标签与说明的字段行 */
		const fieldRow = (label: string, input: HTMLElement, hint?: string): HTMLElement => {
			const row = el('div', 'ctg-exp-field');
			row.append(el('label', undefined, label));
			row.append(input);
			if (hint) row.append(el('div', 'ctg-hint', hint));
			return row;
		};

		/** 构建导出对话框的两列 DOM（无 document 时返回空字符串，供 Node 测试跳过渲染） */
		const buildExportLines = (): HTMLElement | '' => {
			if (typeof document === 'undefined') return '';
			const wrap = el('div', 'ctg-export');

			// ── 左列：导出配置（非路径项）──
			const left = el('div', 'ctg-col');
			left.append(el('div', 'ctg-col-title', t('ctg.export.col_config')));

			const modeSelect = el('select', 'ctg-exp-select');
			modeSelect.dataset.export = 'mode';
			for (const m of EXPORT_MODES) {
				const opt = el('option', undefined, m.label) as HTMLOptionElement;
				opt.value = m.id;
				modeSelect.append(opt);
			}
			modeSelect.value = state.mode;
			left.append(fieldRow(t('ctg.export.mode'), modeSelect, t('ctg.export.mode.desc')));
			left.append(fieldRow(t('ctg.export.namespace'), textField('namespace', state.namespace), t('ctg.export.namespace.desc')));
			left.append(fieldRow(t('ctg.export.track_id'), textField('trackid', state.trackId), t('ctg.export.track_id.desc')));

			wrap.append(left);

			// ── 右列：全部路径调整项（根目录 / 模型资源路径 / 每张纹理资源路径）──
			const right = el('div', 'ctg-col');
			right.append(el('div', 'ctg-col-title', t('ctg.export.col_paths')));
			right.append(fieldRow(t('ctg.export.root'), rootField(), t('ctg.export.root.desc')));
			right.append(fieldRow(t('ctg.export.model_path'), pathRow('model', state.modelPath), t('ctg.export.model_path.desc')));

			// 纹理资源路径的小标题：字号与「模型资源路径」等字段标签一致（不用列标题的大写字距样式）
			const texTitle = el('div', 'ctg-export-sub-title', t('ctg.export.col_textures'));
			texTitle.style.marginTop = '16px';
			right.append(texTitle);
			right.append(el('div', 'ctg-hint', t('ctg.export.textures_hint')));
			if (textures.length === 0) {
				right.append(el('div', 'ctg-hint', t('ctg.export.no_textures')));
			}
			for (const tex of textures) {
				const row = el('div', 'ctg-tex-row');
				row.append(el('div', 'ctg-tex-name', `${tex.resName}.png`));
				row.append(pathRow('texture', state.texturePaths[tex.key] ?? '', tex.key));
				right.append(row);
			}
			wrap.append(right);

			// 初始同步一次默认路径
			renderExportPaths(wrap, state);
			return wrap;
		};

		/** 绑定 DOM 输入事件 → state（含资源路径默认值联动）。同时监听 input + change，保证值被捕获 */
		const wireExportDom = (node: HTMLElement): void => {
			node.querySelectorAll('[data-export]').forEach((input) => {
				const key = (input as HTMLElement).getAttribute('data-export');
				const onEdit = (): void => {
					const v = (input as HTMLInputElement).value;
					if (key === 'mode') {
						state.mode = v as ExportMode;
						recomputeDefaults(state);
						renderExportPaths(node, state);
					} else if (key === 'namespace') state.namespace = v;
					else if (key === 'trackid') {
						state.trackId = v;
						recomputeDefaults(state);
						renderExportPaths(node, state);
					} else if (key === 'root') state.root = v;
					else if (key === 'model') {
						state.modelPath = v;
						state.dirty.model = true;
					} else if (key === 'texture') {
						const tk = (input as HTMLElement).getAttribute('data-tex-key');
						if (tk) {
							state.texturePaths[tk] = v;
							state.dirty.textures[tk] = true;
						}
					}
				};
				input.addEventListener('input', onEdit);
				input.addEventListener('change', onEdit);
			});
		};

		/**
		 * 确认前把 DOM 输入框的当前值同步回 state —— 兜底保证用户手动编辑的路径一定被采用，
		 * 即使 input 监听在某些环境下未触发。无 document（冒烟测试）时跳过。
		 */
		const syncFromDom = (): void => {
			if (!dialogNode) return;
			const val = (sel: string): string | null => {
				const el = dialogNode!.querySelector<HTMLInputElement>(sel);
				return el ? el.value : null;
			};
			const mode = val('[data-export="mode"]');
			if (mode) state.mode = mode as ExportMode;
			const ns = val('[data-export="namespace"]');
			if (ns != null) state.namespace = ns;
			const tid = val('[data-export="trackid"]');
			if (tid != null) state.trackId = tid;
			const root = val('[data-export="root"]');
			if (root != null) state.root = root;
			const model = val('[data-export="model"]');
			if (model != null) {
				state.modelPath = model;
				state.dirty.model = true;
			}
			for (const tk of Object.keys(state.texturePaths)) {
				const v = val(`[data-export="texture"][data-tex-key="${tk}"]`);
				if (v != null) {
					state.texturePaths[tk] = v;
					state.dirty.textures[tk] = true;
				}
			}
		};

		const config = {
			id: 'create-track-gen-export-dialog',
			title: t('ctg.export.title'),
			icon: 'export',
			width: 780,
			buttons: [t('ctg.export_btn'), t('ctg.cancel')],
			confirmIndex: 0,
			cancelIndex: 1,
			lines: [buildExportLines()],
			onBuild(node?: HTMLElement) {
				if (!node) return;
				dialogNode = node;
				wireExportDom(node);
			},
			onConfirm() {
				return confirmExport() ? undefined : false;
			},
			onCancel() {
				finish(null);
			},
			onClose() {
				finish(null);
			},
		} as DialogOptions & { _driver?: ExportDriver };

		// 冒烟测试钩子：直接驱动表单状态 + 确认（真实 Blockbench 不依赖它）
		config._driver = driver;

		injectExportStyles();
		new Dialog(config).show();
	});
}

/**
 * 把轨道大组下的各分组按 mode 导出到配置的目录：
 *  - Java（new_java / classic_java）：元素模型 JSON + 纹理；无法导出的分组回退 OBJ
 *  - obj：全部分组烘焙为单一合并网格 OBJ（.obj + .mtl + forge:obj 引用 JSON）
 *  - bedrock：minecraft:geometry + blocks.json + 纹理；无法导出的分组回退 OBJ
 *  - Java / OBJ 模式写 blockstates 到 root；基岩版模式写 blocks.json 到 root
 * 写盘位置由资源路径派生：模型 → root/models/{modelPath}/，纹理 → root/textures/{texturePath}/
 * （texturePath 每张纹理各自配置）；文件内引用直接用这些资源路径（{命名空间}:{path}/…）。
 * 返回统计信息（写出的文件、跳过的分组、警告）。
 */
export function writeTrackExport(opts: ExportOptions & {
	subgroups: Group[];
	texInfos: ExportTexture[];
	keyOf: Map<Texture, string>;
}): { files: number; skipped: string[]; warnings: string[] } {
	const { root, modelPath, texturePaths, namespace, trackId, subgroups, mode, texInfos, keyOf } = opts;
	const fs = scopedFs(root);
	if (!fs) {
		throw new Error(t('ctg.export.no_fs'));
	}
	const projW = (Project as any).texture_width || 16;
	const projH = (Project as any).texture_height || 16;
	const fallbackSize: [number, number] = [projW, projH];

	/** 模型写盘目录（绝对）：root/models/{modelPath}/ */
	const modelDir = joinPath(root, `models/${modelPath}`);
	/** 某张纹理的写盘目录（绝对）：root/textures/{texturePath}/ */
	const textureDirOf = (key: string): string => joinPath(root, `textures/${texturePaths[key] ?? modelPath}`);

	const sizeOf: Record<string, [number, number]> = {};
	for (const tex of texInfos) sizeOf[tex.key] = [tex.width, tex.height];

	const files: string[] = [];
	const skipped: string[] = [];
	const warnings: string[] = [];
	const writtenTextures = new Set<string>();

	/** 基岩版 blocks.json 里定义的形状（只有原生导出的形状） */
	const bedrockShapes: { id: string; texturePath: string }[] = [];

	for (const group of subgroups) {
		const id = cleanGroupName(group.name);
		const file = modelFileName(id);
		if (!file) {
			skipped.push(group.name);
			continue;
		}
		const elements = extractElements(group, keyOf);
		const shapeTexs = shapeTextures(elements, texInfos);

		if (mode === 'obj' || groupNeedsObj(elements, mode)) {
			// ── OBJ（单一合并网格）或回退 ──
			const shape = file.replace(/\.json$/, '');
			const objRes = buildObj({ elements, textures: shapeTexs, sizeOf, namespace, trackId, mtlName: `${shape}.mtl`, texturePathOf: texturePaths });
			fs.mkdirSync(modelDir, { recursive: true });
			fs.writeFileSync(joinPath(modelDir, `${shape}.obj`), objRes.obj);
			fs.writeFileSync(joinPath(modelDir, `${shape}.mtl`), objRes.mtl);
			fs.writeFileSync(joinPath(modelDir, file), JSON.stringify(buildObjReferenceJson({ namespace, trackId, shape, textures: shapeTexs, texturePathOf: texturePaths, modelPath }), null, '\t'));
			files.push(joinPath(modelDir, `${shape}.obj`), joinPath(modelDir, `${shape}.mtl`), joinPath(modelDir, file));
			for (const tex of shapeTexs) writeTexturePng(fs, textureDirOf(tex.key), tex, files, warnings, writtenTextures, projW, projH);
			if (mode === 'bedrock') {
				warnings.push(t('ctg.export.bedrock_fallback', id));
			}
		} else if (mode === 'bedrock') {
			// ── 基岩版 geometry ──
			const ts: [number, number] = shapeTexs[0] ? [shapeTexs[0].width, shapeTexs[0].height] : fallbackSize;
			const geo = buildBedrockGeometry({ identifier: `geometry.${trackId}_${id}`, elements, textureSize: ts });
			fs.mkdirSync(modelDir, { recursive: true });
			fs.writeFileSync(joinPath(modelDir, file), JSON.stringify(geo, null, '\t'));
			files.push(joinPath(modelDir, file));
			for (const tex of shapeTexs) writeTexturePng(fs, textureDirOf(tex.key), tex, files, warnings, writtenTextures, projW, projH);
			if (shapeTexs[0]) bedrockShapes.push({ id, texturePath: `${texturePaths[shapeTexs[0].key] ?? modelPath}/${shapeTexs[0].resName}` });
		} else {
			// ── Java JSON（经典 / 新）──
			const json = buildJavaModelJson({ mode, elements, textures: shapeTexs, textureSize: fallbackSize, namespace, trackId, texturePathOf: texturePaths });
			fs.mkdirSync(modelDir, { recursive: true });
			fs.writeFileSync(joinPath(modelDir, file), JSON.stringify(json, null, '\t'));
			files.push(joinPath(modelDir, file));
			for (const tex of shapeTexs) writeTexturePng(fs, textureDirOf(tex.key), tex, files, warnings, writtenTextures, projW, projH);
		}
	}

	if (mode === 'bedrock') {
		const blocksJson = buildBedrockBlocksJson({ namespace, trackId, shapes: bedrockShapes });
		fs.writeFileSync(joinPath(root, 'blocks.json'), JSON.stringify(blocksJson, null, '\t'));
		files.push(joinPath(root, 'blocks.json'));
	} else {
		const bsFile = blockstatesFileName(trackId);
		fs.mkdirSync(joinPath(root, 'blockstates/track_and_bogey'), { recursive: true });
		fs.writeFileSync(joinPath(root, `blockstates/track_and_bogey/${bsFile}`), JSON.stringify(buildBlockstates(namespace, trackId, modelPath), null, '\t'));
		files.push(joinPath(root, `blockstates/track_and_bogey/${bsFile}`));
	}

	return { files: files.length, skipped, warnings };
}

/**
 * 导出结果对话框：比默认消息框更宽（640px），每条警告/提示独立显示框。
 * Blockbench 有 document 时用自定义 DOM 对话框；Node 冒烟测试无 document 时
 * 退化为 showMessageBox（仅汇总文本，警告仍逐条列出）。
 */
function showExportResult(opts: { title: string; summary: string[]; notes: string[] }): void {
	if (typeof document === 'undefined') {
		const message =
			opts.summary.join('\n') + (opts.notes.length ? `\n\n${t('ctg.export.notice')}\n${opts.notes.join('\n')}\n` : '');
		Blockbench.showMessageBox({ title: opts.title, message, buttons: [t('ctg.ok')], confirm: 0 });
		return;
	}
	const lines: HTMLElement[] = [];
	// 汇总信息区
	const summary = document.createElement('div');
	summary.className = 'ctg-export-summary';
	summary.style.display = 'flex';
	summary.style.flexDirection = 'column';
	summary.style.gap = '4px';
	for (const line of opts.summary) {
		const p = document.createElement('div');
		p.textContent = line;
		p.style.whiteSpace = 'pre-wrap';
		p.style.lineHeight = '1.5';
		summary.appendChild(p);
	}
	lines.push(summary);
	// 每条警告一个独立显示框
	for (const note of opts.notes) {
		const box = document.createElement('div');
		box.className = 'ctg-export-warning';
		box.textContent = `⚠ ${note}`;
		box.style.border = '1px solid rgba(242, 177, 52, 0.55)';
		box.style.background = 'rgba(242, 177, 52, 0.12)';
		box.style.borderRadius = '4px';
		box.style.padding = '8px 10px';
		box.style.margin = '6px 0 0';
		box.style.whiteSpace = 'pre-wrap';
		box.style.lineHeight = '1.5';
		box.style.color = 'var(--text-color, #eee)';
		lines.push(box);
	}
	new Dialog({
		id: 'create-track-gen-export-result',
		title: opts.title,
		icon: 'export',
		width: 640,
		buttons: [t('ctg.ok')],
		confirmIndex: 0,
		lines,
	} as DialogOptions).show();
}

/** 导出主流程：找大组 → 收集纹理 → 大对话框（模式/命名空间/id/路径）→ 写文件 → 汇总 */
export async function runTrackExport(): Promise<void> {
	const trackGroup = findTrackGroup();
	if (!trackGroup) {
		const wanted = String((Project as any).name || '').trim() || 'track';
		Blockbench.showMessageBox({
			title: t('ctg.export.not_found_title'),
			message: t('ctg.export.not_found_msg', wanted),
			buttons: [t('ctg.ok')],
			confirm: 0,
		});
		return;
	}
	const defaultTrackId = (Project as any).name || 'track';
	const subgroups = (trackGroup.children ?? []).filter((g) => g instanceof Group) as Group[];
	// 先收集纹理：导出对话框需要列出每张纹理的目录
	const { infos: texInfos, keyOf } = collectTexturesGlobal(subgroups);
	const options = await promptExportOptions(defaultTrackId, texInfos);
	if (!options) {
		Blockbench.showQuickMessage(t('ctg.cancelled'));
		return;
	}
	try {
		const { files, skipped, warnings } = writeTrackExport({ ...options, subgroups, texInfos, keyOf });
		const modeMeta = EXPORT_MODES.find((m) => m.id === options.mode);
		const format = (Project as any).format?.id;
		const formatNote =
			options.mode !== 'bedrock' && format && format !== 'java_block' && format !== 'java_item'
				? t('ctg.export.format_note', format)
				: '';
		// 去重的纹理资源路径（可能有差异）
		const distinctTexturePaths = [...new Set(Object.values(options.texturePaths))];
		showExportResult({
			title: t('ctg.export.done_title'),
			summary: [
				t('ctg.export.done_mode', modeMeta?.label ?? options.mode),
				t('ctg.export.done_files', [files, options.root]),
				t('ctg.export.done_model_res', `${options.namespace}:${options.modelPath}`),
				distinctTexturePaths.length
					? t('ctg.export.done_texture_res', distinctTexturePaths.map((p) => `${options.namespace}:${p}`).join(', '))
					: '',
				options.mode === 'bedrock'
					? t('ctg.export.done_model_bedrock', options.modelPath)
					: t('ctg.export.done_model_java', [
							options.modelPath,
							subgroups.filter((g) => modelFileName(cleanGroupName(g.name))).length,
							`blockstates/track_and_bogey/${blockstatesFileName(options.trackId)}`,
						]),
				t('ctg.export.done_namespace', options.namespace),
				t('ctg.export.done_condition', modeMeta?.description ?? ''),
				skipped.length ? t('ctg.export.done_skipped', skipped.join(', ')) : '',
			].filter(Boolean),
			notes: [...warnings, formatNote].filter(Boolean),
		});
	} catch (e: any) {
		Blockbench.showMessageBox({
			title: t('ctg.export.failed_title'),
			message: e?.message ?? String(e),
			buttons: [t('ctg.ok')],
			confirm: 0,
		});
	}
}
