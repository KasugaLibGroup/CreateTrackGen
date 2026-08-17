/**
 * Export layer — exports the groups under the current workspace's track parent group (named after the
 * workspace) in four modes (new_java / classic_java / bedrock / obj) to a user-chosen folder.
 *
 * Export configuration is collected in a single large dialog similar to generation (config on the
 * left / per-texture resource paths on the right):
 *  - export mode / namespace / track id are filled in by the user;
 *  - the export root is the directory holding the resource pack's assets/{namespace} — everything is
 *    written there, organized into models/ textures/ blockstates/;
 *  - the model resource path is the {namespace}:path/file path used for the written model files (what
 *    blockstates reference), default block/track/{trackId}; models are written to root/models/{path}/;
 *  - each texture has its own resource path (what models reference), also defaulting to
 *    block/track/{trackId}; textures are written to root/textures/{texturePath}/.
 * All path fields are editable and pre-filled with default-generated paths; in-file references use
 * these resource paths directly.
 *
 * File writing uses Blockbench's scoped `require('fs', { scope })` (desktop; requests "folder access"
 * the first time); Node smoke tests substitute a global.require stub. Eligibility checks and per-format
 * serialization live in the pure logic layer src/logic/export.ts (unit-testable).
 */

import {
	buildBedrockBlocksJson,
	buildBedrockGeometry,
	buildBlockstates,
	blockstatesFileName,
	buildJavaModelJson,
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
	textureResourcePath,
	TRACK_MODEL_FILES,
} from '../logic/export';
import type { CubeFaceDirection, Vec3 } from '../logic/types';
import { isFreeModelFormat } from '../logic/parts';
import { t } from '../i18n';
import type { DialogOptions } from 'blockbench-types/generated/interface/dialog';

/** The track parent group's name, matching the one created in buildAllShapes */
export const TRACK_PARENT_NAME = '机械动力轨道';

/**
 * Blockbench evaluates plugin scripts via `new Function("requireNativeModule","require",code)`,
 * injecting the scoped require as local params `requireNativeModule` (and `require`). Using
 * `requireNativeModule` matters because esbuild renames the free identifier `require` to `__require`
 * (undefined), while `requireNativeModule` is preserved as-is. Type-declared here; guarded with
 * typeof when absent on web.
 */
declare const requireNativeModule: ((id: string, options?: Record<string, unknown>) => any) | undefined;

type ScopedRequire = (id: string, options?: Record<string, unknown>) => any;
type ExportFs = { mkdirSync(p: string, opts?: { recursive?: boolean }): void; writeFileSync(p: string, content: string | Uint8Array, opts?: unknown): void };

/**
 * Resolves the scoped require in the Blockbench plugin environment.
 * Priority: `globalThis.require` (Node smoke-test stub, Dev-Tools-mode window.require)
 * → the plugin-local param `requireNativeModule` (normal desktop path, preserved as-is by esbuild).
 */
function nodeRequire(): ScopedRequire | undefined {
	const g = globalThis as { require?: unknown };
	if (typeof g.require === 'function') return g.require as ScopedRequire;
	const local = (typeof requireNativeModule !== 'undefined' ? requireNativeModule : undefined) as ScopedRequire | undefined;
	return typeof local === 'function' ? local : undefined;
}

/** Returns a scoped fs rooted at dir; undefined on failure (e.g. not authorized) */
function scopedFs(dir: string): ExportFs | undefined {
	const req = nodeRequire();
	if (!req) return undefined;
	try {
		return req('fs', { scope: dir }) as ExportFs;
	} catch {
		return undefined;
	}
}

/** Joins the scope directory with relative path segments into an absolute path (forward slashes) */
function joinPath(dir: string, ...rel: string[]): string {
	return `${dir.replace(/[\\/]+$/, '')}/${rel.join('/')}`;
}

/**
 * A texture's UV size (uv_width × uv_height), used as the model texture_size / UV-normalization base.
 * UV coordinates live in the texture's UV space (what Texture.getUVWidth() reports), not the bitmap's
 * pixel dimensions — the imported texture's uv_width is set from the part's UV size during generation,
 * so reading it first keeps the exported texture_size consistent with the face UVs (falling back to the
 * bitmap size only as a last resort).
 */
function textureSizeOf(tex: Texture): [number, number] {
	return [tex.uv_width || tex.width || 16, tex.uv_height || tex.height || 16];
}

/** data URL → Uint8Array (for writing the PNG) */
function dataUrlToBytes(url: string): Uint8Array {
	const comma = url.indexOf(',');
	const b64 = url.slice(comma + 1);
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

/** Face texture reference (Texture instance or uuid) → Texture; undefined when unresolvable */
function faceTextureOf(v: unknown): Texture | undefined {
	if (v instanceof Texture) return v;
	if (typeof v === 'string') {
		const list = ((Project as any).textures ?? []) as Texture[];
		return list.find((t) => t.uuid === v);
	}
	return undefined;
}

/**
 * Finds the track parent group in the current project. Its name = the workspace name used at
 * generation (default 'track'). Collects top-level groups from multiple authoritative sources
 * (Outliner tree root / Project.elements / Group.all top-level groups, deduplicated by uuid), then
 * matches: ① current workspace name (new convention) → ② the legacy name TRACK_PARENT_NAME (compat
 * with old workspaces) → ③ a heuristic for groups directly containing known shape subgroups.
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
	// ① Outliner tree root (the authoritative top-level element array)
	const outlinerRoot = (globalThis as { Outliner?: { root?: unknown } }).Outliner?.root;
	if (Array.isArray(outlinerRoot)) outlinerRoot.forEach(add);
	// ② Project.elements (init() also safePushes here on creation)
	const projElements = (Project as any).elements;
	if (Array.isArray(projElements)) projElements.forEach(add);
	// ③ Top-level groups in Group.all (fallback; Blockbench top-level groups have parent string 'root')
	const allGroups = (globalThis as { Group?: { all?: unknown } }).Group?.all;
	if (Array.isArray(allGroups)) {
		for (const g of allGroups) {
			const parent = (g as { parent?: unknown }).parent;
			if (g instanceof Group && (parent === 'root' || parent == null || parent === '')) add(g);
		}
	}
	const wanted = String((Project as any).name || '').trim() || 'track';
	// ① Current workspace name (= the parent group name)
	const byWorkspace = candidates.find((g) => g.name === wanted);
	if (byWorkspace) return byWorkspace;
	// ② Legacy name (compat with workspaces generated by older versions)
	const legacy = candidates.find((g) => g.name === TRACK_PARENT_NAME);
	if (legacy) return legacy;
	// ③ Heuristic: a group directly containing known shape subgroups
	const known = new Set(Object.keys(TRACK_MODEL_FILES));
	return (
		candidates.find((g) =>
			(g.children ?? []).some((ch) => ch instanceof Group && known.has(cleanGroupName(ch.name)))
		) ?? null
	);
}

/**
 * Globally collects every texture referenced by the groups: assigns stable keys (t0/t1…) + globally
 * deduplicated resource names + sizes + bitmaps. All shapes' JSON / OBJ / Bedrock geometry share the
 * same resource names, and each PNG is written once.
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

/** Extracts platform-neutral element descriptors from a live Group (cube / mesh + face texture keys) */
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

/** The textures a shape actually references (in global registration order), for model / MTL / blocks.json */
function shapeTextures(elements: ExportElement[], infos: ExportTexture[]): ExportTexture[] {
	const keys = new Set<string>();
	for (const el of elements) {
		for (const f of Object.values(el.faces)) {
			if (f?.textureKey) keys.add(f.textureKey);
		}
	}
	return infos.filter((tex) => keys.has(tex.key));
}

/** Writes one texture PNG (deduplicated by absolute path, written once). No texture-size check — generation already validated part texture consistency. */
function writeTexturePng(
	fs: ExportFs,
	dir: string,
	tex: ExportTexture,
	files: string[],
	warnings: string[],
	writtenTextures: Set<string>
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
}

// ── Export configuration large dialog ──────────────────────────────────────

/** Export configuration (collected by the dialog, passed to writeTrackExport) */
export interface ExportOptions {
	mode: ExportMode;
	namespace: string;
	trackId: string;
	/**
	 * Mod loader for the OBJ reference JSON's loader field (forge → "forge:obj", neoforge →
	 * "neoforge:obj", …). Default forge; editable because 1.20~1.21 straddles forge → neoforge.
	 */
	loader: string;
	/** Export root (directory holding the resource pack's assets/{namespace}; everything is written here) */
	root: string;
	/**
	 * Model resource path (the {namespace}:path/file path blockstates use to reference models, e.g.
	 * block/track/{id}). Models are written to root/models/{path}/, blockstates reference
	 * {namespace}:{path}/{shape}.
	 */
	modelPath: string;
	/** texture key → texture resource path (what models reference as {namespace}:path/file) */
	texturePaths: Record<string, string>;
}

/** The dialog's form state (shared by the DOM bindings and the smoke-test driver) */
interface ExportFormState extends ExportOptions {
	/** Whether each field was edited by the user (edited fields are no longer overwritten by default paths) */
	dirty: { model: boolean; textures: Record<string, boolean> };
}

/** Smoke-test driver hook for the export dialog (real Blockbench doesn't depend on it) */
export interface ExportDriver {
	setMode(mode: ExportMode): void;
	setNamespace(v: string): void;
	setTrackId(v: string): void;
	setLoader(v: string): void;
	setRoot(v: string): void;
	setModelPath(v: string): void;
	setTexturePath(key: string, v: string): void;
	confirm(): boolean;
	getState(): ExportFormState;
}

/** Default export root: the current project file's directory when available, otherwise create_track_export under the desktop / home */
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

/** Regenerates the default resource paths for the current mode / trackId (only overwrites unedited fields) */
function recomputeDefaults(state: ExportFormState): void {
	const javaLike = state.mode !== 'bedrock';
	// Java/OBJ convention block/track/{id}; Bedrock convention blocks/{id}
	const sub = javaLike ? `block/track/${state.trackId}` : `blocks/${state.trackId}`;
	if (!state.dirty.model) state.modelPath = sub;
	for (const key of Object.keys(state.texturePaths)) {
		if (!state.dirty.textures[key]) state.texturePaths[key] = sub;
	}
}

/**
 * Validates a resource path: lowercase letters/digits/`/`/`_`/`.`/`-`, not starting or ending with `/`,
 * and no `..` segments.
 */
function isValidResourcePath(p: string): boolean {
	if (!p || p.startsWith('/') || p.endsWith('/')) return false;
	if (!/^[a-z0-9/._-]+$/.test(p)) return false;
	if (p.split('/').some((seg) => seg === '..')) return false;
	return true;
}

// ── Export dialog styles (same style as the generate dialog) ────────────────
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
/* Text inputs such as resource paths: clearly editable + full width */
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

/** Injects the export dialog styles (when a document exists; safely skipped in Node smoke tests) */
export function injectExportStyles(): void {
	if (typeof document === 'undefined') return;
	if (document.getElementById(EXPORT_STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = EXPORT_STYLE_ID;
	style.textContent = EXPORT_STYLE;
	document.head.appendChild(style);
}

export function disposeExportStyles(): void {
	if (typeof document === 'undefined') return;
	document.getElementById(EXPORT_STYLE_ID)?.remove();
}

/** Creates a DOM element with a class name and text */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

/**
 * Export configuration dialog (single large frame, two columns: export config on the left + each
 * texture's export path on the right). All path fields are editable text boxes + "Browse…" buttons,
 * pre-filled with default-generated paths. Returns null when cancelled.
 *
 * opts.forceObj locks the export mode to OBJ (used when the workspace is a free/generic model, whose
 * origin-centered, non-canvas-aligned geometry can't be expressed by the Java/Bedrock block formats):
 * the mode selector is disabled, only the OBJ entry is offered, and a hint explains why.
 */
export function promptExportOptions(
	defaultTrackId: string,
	textures: ExportTexture[],
	opts?: { forceObj?: boolean }
): Promise<ExportOptions | null> {
	return new Promise((resolve) => {
		const forceObj = opts?.forceObj ?? false;
		let settled = false;
		const finish = (v: ExportOptions | null) => {
			if (settled) return;
			settled = true;
			resolve(v);
		};

		// Form state (initial: default mode classic_java + default namespace create + default loader forge +
		// default root + default resource paths; forceObj starts locked at obj)
		const state: ExportFormState = {
			mode: forceObj ? 'obj' : 'classic_java',
			namespace: 'create',
			trackId: defaultTrackId,
			loader: 'forge',
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

		/** Validates and hands the legal result to finish; on invalid input pops a message and keeps the dialog open */
		const confirmExport = (): boolean => {
			syncFromDom(); // fallback: adopt the values the user actually typed in the DOM inputs
			if (forceObj) state.mode = 'obj'; // free/generic workspace: only OBJ export is allowed
			const namespace = state.namespace.trim();
			const trackId = state.trackId.trim();
			const loader = state.loader.trim();
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
			if (!loader || !valid.test(loader)) {
				errorBox(t('ctg.export.invalid_loader'));
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
				loader,
				root: state.root,
				modelPath: state.modelPath,
				texturePaths: { ...state.texturePaths },
			});
			return true;
		};

		const driver: ExportDriver = {
			setMode(mode) {
				// forceObj ignores any other mode (see confirmExport); kept in sync so the smoke driver
				// reflects the locked state too
				state.mode = forceObj ? 'obj' : mode;
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
			setLoader(v) {
				state.loader = v;
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

		/** Syncs the resource paths in state back to the DOM inputs */
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

		/** A plain text box (namespace / resource path etc.), data-export identifies the binding target */
		const textField = (which: string, value: string, texKey?: string): HTMLInputElement => {
			const input = el('input', 'ctg-exp-path') as HTMLInputElement;
			input.type = 'text';
			input.dataset.export = which;
			if (texKey) input.dataset.texKey = texKey;
			input.value = value;
			return input;
		};

		/** A folder field with a "Browse…" button (export root only) */
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

		/** The default resource path for the current mode / track id (Java block/track/{id}, Bedrock blocks/{id}) */
		const defaultPathFor = (): string => {
			const javaLike = state.mode !== 'bedrock';
			return javaLike ? `block/track/${state.trackId}` : `blocks/${state.trackId}`;
		};

		/** A resource path field (text box + "Reset" button), resetting to the default path */
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

		/** A field row with a label and an optional hint */
		const fieldRow = (label: string, input: HTMLElement, hint?: string): HTMLElement => {
			const row = el('div', 'ctg-exp-field');
			row.append(el('label', undefined, label));
			row.append(input);
			if (hint) row.append(el('div', 'ctg-hint', hint));
			return row;
		};

		/** Builds the export dialog's two-column DOM (empty string without a document, letting Node tests skip rendering) */
		const buildExportLines = (): HTMLElement | '' => {
			if (typeof document === 'undefined') return '';
			const wrap = el('div', 'ctg-export');

			// ── Left column: export config (non-path items) ──
			const left = el('div', 'ctg-col');
			left.append(el('div', 'ctg-col-title', t('ctg.export.col_config')));

			const modeSelect = el('select', 'ctg-exp-select');
			modeSelect.dataset.export = 'mode';
			if (forceObj) {
				// Free/generic workspace: the Java/Bedrock block formats can't express the geometry, so
				// only OBJ is offered and the selector is locked
				const objMode = EXPORT_MODES.find((m) => m.id === 'obj')!;
				const opt = el('option', undefined, objMode.label) as HTMLOptionElement;
				opt.value = 'obj';
				modeSelect.append(opt);
				modeSelect.value = 'obj';
				modeSelect.disabled = true;
			} else {
				for (const m of EXPORT_MODES) {
					const opt = el('option', undefined, m.label) as HTMLOptionElement;
					opt.value = m.id;
					modeSelect.append(opt);
				}
			}
			modeSelect.value = state.mode;
			left.append(fieldRow(t('ctg.export.mode'), modeSelect, forceObj ? t('ctg.export.mode.forced_obj_hint') : t('ctg.export.mode.desc')));
			left.append(fieldRow(t('ctg.export.namespace'), textField('namespace', state.namespace), t('ctg.export.namespace.desc')));
			left.append(fieldRow(t('ctg.export.track_id'), textField('trackid', state.trackId), t('ctg.export.track_id.desc')));
			left.append(fieldRow(t('ctg.export.loader'), textField('loader', state.loader), t('ctg.export.loader.desc')));

			wrap.append(left);

			// ── Right column: all path adjustments (root / model resource path / per-texture resource path) ──
			const right = el('div', 'ctg-col');
			right.append(el('div', 'ctg-col-title', t('ctg.export.col_paths')));
			right.append(fieldRow(t('ctg.export.root'), rootField(), t('ctg.export.root.desc')));
			right.append(fieldRow(t('ctg.export.model_path'), pathRow('model', state.modelPath), t('ctg.export.model_path.desc')));

			// Texture resource path subtitle: same size as the "model resource path" field labels (not the
			// uppercase letter-spaced column-title style)
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

			// Initial sync of the default paths
			renderExportPaths(wrap, state);
			return wrap;
		};

		/** Binds DOM input events → state (including resource-path default linking). Listens to both input + change so values are captured */
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
					} else if (key === 'loader') state.loader = v;
					else if (key === 'root') state.root = v;
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
		 * Before confirming, syncs the DOM inputs' current values back to state — a fallback ensuring the
		 * paths the user manually edited are always adopted, even if input listeners don't fire in some
		 * environment. Skipped without a document (smoke tests).
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
			const loader = val('[data-export="loader"]');
			if (loader != null) state.loader = loader;
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

		// Smoke-test hook: drives the form state + confirm directly (real Blockbench doesn't depend on it)
		config._driver = driver;

		injectExportStyles();
		new Dialog(config).show();
	});
}

// ── OBJ (single merged mesh, built through Blockbench's mesh API + OBJ codec) ──

/**
 * OBJ export does not string-build the .obj and never post-processes the codec's text (no stripping of
 * `o` lines — that corrupts the file). Instead each shape group's cubes + meshes are merged into a
 * single Blockbench Mesh, following the same steps as Blockbench's own merge-meshes tool:
 *   1. every cube is converted to mesh geometry (`getGlobalVertexPositions` — the corner mapping
 *      Blockbench's OBJ codec itself uses — so rotation + origin + ancestor bones are all baked);
 *   2. every mesh's vertices are re-baked into world space (own origin/rotation + ancestor bones),
 *      matching the `v` lines the OBJ codec would emit for it;
 *   3. the merged mesh is pulled out to the outliner root — no bone/folder wraps it, so its THREE
 *      node's matrixWorld is identity and the baked vertices export as-is (equivalent to "keep pulling
 *      the merged mesh out of bones until no bones and exactly one mesh remain");
 *   4. the single root mesh is exported with Blockbench's own OBJ codec (`Codecs.obj.compile`).
 *
 * The codec walks the THREE scene and resolves each node back to its element via
 * `OutlinerNode.uuids[node.name]` (scene nodes are named by element uuid). A runtime-built mesh only
 * gets that scene node after its `preview_controller.updateAll` runs — `init()` registers the uuid and
 * adds the element to the tree but never creates the node, so without that call the codec can never
 * reach the merged mesh and the .obj comes out empty. The merged mesh is added to the project, its
 * scene node is built, and every other element is marked non-exportable — the same partial-export
 * mechanism `Codec.patchCollectionExport` uses — producing an .obj with exactly one `o` object.
 * Everything is restored in a finally block.
 */

/** Cube's 8 corner picks (0-7) — matching Blockbench's getGlobalVertexPositions order */
const OBJ_CUBE_VERTEX_PICK: [number, number, number][] = [
	[1, 1, 1], [1, 1, 0], [1, 0, 1], [1, 0, 0],
	[0, 1, 0], [0, 1, 1], [0, 0, 0], [0, 0, 1],
];

/** Face direction → 1-based corner indices (matching Blockbench's OBJ exporter f-line order) */
const OBJ_FACE_CORNERS: Record<CubeFaceDirection, number[]> = {
	north: [2, 5, 7, 4],
	east: [1, 2, 4, 3],
	south: [6, 1, 3, 8],
	west: [5, 6, 8, 7],
	up: [5, 2, 1, 6],
	down: [8, 3, 4, 7],
};

/**
 * Standard right-hand rotation, matching how Blockbench renders `Cube.rotation` (THREE Euler XYZ order,
 * Y following the standard R_y: +Z → +X). NOT the plugin's rotateVec, whose Y direction is reversed.
 */
function standardRotate(v: Vec3, rot: Vec3): Vec3 {
	let [x, y, z] = v;
	const rad = (d: number) => (d * Math.PI) / 180;
	const ax = rad(rot[0]);
	let [c, s] = [Math.cos(ax), Math.sin(ax)];
	[y, z] = [y * c - z * s, y * s + z * c];
	const ay = rad(rot[1]);
	[c, s] = [Math.cos(ay), Math.sin(ay)];
	[x, z] = [x * c + z * s, -x * s + z * c];
	const az = rad(rot[2]);
	[c, s] = [Math.cos(az), Math.sin(az)];
	[x, y] = [x * c - y * s, x * s + y * c];
	return [x, y, z];
}

/** A cube's 8 world-space corners (rotation + origin baked) — fallback when getGlobalVertexPositions is unavailable */
function cubeWorldCorners(cube: Cube): Vec3[] {
	return OBJ_CUBE_VERTEX_PICK.map((pick) => {
		const v: Vec3 = [pick[0] ? cube.to[0] : cube.from[0], pick[1] ? cube.to[1] : cube.from[1], pick[2] ? cube.to[2] : cube.from[2]];
		const origin = cube.origin ?? [0, 0, 0];
		const rel: Vec3 = [v[0] - origin[0], v[1] - origin[1], v[2] - origin[2]];
		const r = cube.rotation && cube.rotation.some((a) => a !== 0) ? standardRotate(rel, cube.rotation) : rel;
		return [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]];
	});
}

/**
 * Bakes an element's local point into world space by applying the element's own origin/rotation then
 * every ancestor group's origin/rotation (leaf → root) — the transform chain Blockbench's preview
 * applies (each element rotates about its origin; children live in the parent's space). Mirrors what
 * the OBJ codec's mesh branch produces (`vertex × matrixWorld`), and matches getGlobalVertexPositions
 * by measuring relative to the scene root (scene.position is subtracted).
 */
function bakeWorldTransform(el: { origin?: Vec3; rotation?: Vec3; parent?: unknown }, v: Vec3): Vec3 {
	const chain: { origin: Vec3; rotation: Vec3 }[] = [];
	let cur: unknown = el;
	while (cur && typeof cur === 'object') {
		const o = (cur as { origin?: Vec3 }).origin;
		const r = (cur as { rotation?: Vec3 }).rotation;
		chain.push({
			origin: o && o.length === 3 ? [...o] : [0, 0, 0],
			rotation: r && r.length === 3 ? [...r] : [0, 0, 0],
		});
		const parent = (cur as { parent?: unknown }).parent;
		cur = parent && typeof parent === 'object' ? parent : null;
	}
	let out: Vec3 = [...v];
	for (const { origin, rotation } of chain) {
		const rel: Vec3 = [out[0] - origin[0], out[1] - origin[1], out[2] - origin[2]];
		const r = rotation.some((a) => a !== 0) ? standardRotate(rel, rotation) : rel;
		out = [r[0] + origin[0], r[1] + origin[1], r[2] + origin[2]];
	}
	const scene = (globalThis as { scene?: { position?: { x?: number; y?: number; z?: number } } }).scene;
	const sp = scene?.position;
	if (sp && (sp.x || sp.y || sp.z)) out = [out[0] - (sp.x ?? 0), out[1] - (sp.y ?? 0), out[2] - (sp.z ?? 0)];
	return out;
}

/**
 * Appends one Cube's 8 corners + textured faces to the merged mesh as quads, reusing Blockbench's own
 * corner order / per-corner UV layout so the serialized mesh matches what exporting the cube directly
 * would produce (rotation is baked into the corner positions, so the merged mesh needs no transform).
 */
function appendCubeToMerged(merged: Mesh, cube: Cube): void {
	const gvp = (cube as any).getGlobalVertexPositions as (() => Vec3[]) | undefined;
	const corners: Vec3[] = typeof gvp === 'function' ? gvp.call(cube) : cubeWorldCorners(cube);
	const cornerKeys: string[] = corners.map((p) => merged.addVertices(p)[0]);
	for (const [dir, rawFace] of Object.entries((cube as any).faces ?? {})) {
		const f = rawFace as any;
		if (!f || f.enabled === false || f.texture === null) continue;
		const O = OBJ_FACE_CORNERS[dir as CubeFaceDirection];
		if (!O) continue;
		const uv = f.uv ?? [0, 0, 16, 16];
		// The 4 per-corner UVs (raw px) in Blockbench's OBJ vt order, rotated by face.rotation the same way
		let out: [number, number][] = [
			[uv[0], uv[1]],
			[uv[2], uv[1]],
			[uv[2], uv[3]],
			[uv[0], uv[3]],
		];
		let rot = f.rotation || 0;
		while (rot > 0) {
			out.unshift(out.pop()!);
			rot -= 90;
		}
		// Face winding = reversed OBJ corner order (outward normal); per-corner UVs follow the vt order
		const vertices = [O[3] - 1, O[2] - 1, O[1] - 1, O[0] - 1].map((i) => cornerKeys[i]);
		const uvMap: Record<string, [number, number]> = {};
		uvMap[cornerKeys[O[0] - 1]] = out[0];
		uvMap[cornerKeys[O[1] - 1]] = out[1];
		uvMap[cornerKeys[O[2] - 1]] = out[2];
		uvMap[cornerKeys[O[3] - 1]] = out[3];
		merged.addFaces(new MeshFace(merged, { vertices, uv: uvMap, texture: f.texture }));
	}
}

/** Copies one Mesh's vertices + faces into the merged mesh, remapping vertex keys (per-vertex UV follows) */
function appendMeshToMerged(merged: Mesh, source: Mesh): void {
	const keyMap = new Map<string, string>();
	for (const [vkey, v] of Object.entries((source as any).vertices ?? {})) {
		// Re-bake the vertex to world space (own origin/rotation + ancestor bones), so the merged
		// root mesh's coordinates equal what the OBJ codec would emit for the source mesh.
		keyMap.set(vkey, merged.addVertices(bakeWorldTransform(source, v as [number, number, number]))[0]);
	}
	for (const rawFace of Object.values((source as any).faces ?? {})) {
		const f = rawFace as any;
		if (!f || f.vertices.length < 3) continue;
		let uv: any = f.uv;
		if (uv && typeof uv === 'object' && !Array.isArray(uv)) {
			// addVertices assigns fresh vertex keys; remap the per-vertex uv object so MeshFace's
			// per-vertex lookup doesn't miss every entry (same as specToMesh in assembly.ts)
			const remapped: Record<string, [number, number]> = {};
			for (const [vk, p] of Object.entries(uv as Record<string, any>)) {
				remapped[keyMap.get(vk) ?? vk] = p;
			}
			uv = remapped;
		}
		merged.addFaces(
			new MeshFace(merged, {
				vertices: (f.vertices as string[]).map((vk) => keyMap.get(vk) ?? vk),
				uv: uv as Record<string, [number, number]> | undefined,
				texture: f.texture,
			})
		);
	}
}

/**
 * Merges a shape group's whole subtree (cubes + meshes, recursing into nested folder/bone groups) into
 * a single Mesh, using the official Blockbench mesh API (`new Mesh({ vertices: {} })` +
 * `addVertices` + `addFaces(new MeshFace(...))` — the same pattern as Blockbench's OBJ importer /
 * merge-meshes tool). Cubes are converted via their global corner positions and meshes are world-baked,
 * so the merged mesh is already in final world space. Its origin/rotation stay [0,0,0]: the mesh sits
 * at the outliner root with no bone wrapping it, so its scene-node matrixWorld is identity and the
 * codec exports the vertices as-is (this is the "pull the merged mesh out of every folder/bone, then
 * remove the bones" step of Blockbench's merge — the bones are simply not kept).
 */
function mergeGroupToMesh(group: Group): Mesh {
	// vertices:{} is required — without it the Mesh constructor falls back to a default 2×2×2 cube.
	// The mesh name is the cleaned shape id (strips the 「（…）」display suffix), so the OBJ `o` line
	// carries a clean name with no parentheses / trailing spaces — same id as the .obj file name.
	const merged = new Mesh({ name: cleanGroupName(group.name) || 'mesh', vertices: {} });
	const visit = (el: unknown): void => {
		if (el instanceof Cube) appendCubeToMerged(merged, el);
		else if (el instanceof Mesh) appendMeshToMerged(merged, el);
		else if (el instanceof Group) (el.children ?? []).forEach(visit);
	};
	(group.children ?? []).forEach(visit);
	merged.origin = [0, 0, 0];
	merged.rotation = [0, 0, 0];
	return merged;
}

/** Builds the Create-compatible MTL (map_Kd = resource path) for the textures the merged mesh uses */
function buildObjMtl(
	merged: Mesh,
	opts: { namespace: string; trackId: string; texInfos: ExportTexture[]; keyOf: Map<Texture, string>; texturePathOf: Record<string, string> }
): string {
	const used = new Set<string>();
	for (const f of Object.values((merged as any).faces ?? {})) {
		const tex = (f as any).getTexture?.();
		if (tex && typeof tex === 'object' && typeof tex.uuid === 'string') used.add(tex.uuid);
	}
	const lines = ['# Made in Blockbench'];
	for (const [tex, key] of opts.keyOf) {
		if (!used.has(tex.uuid)) continue;
		const info = opts.texInfos.find((i) => i.key === key);
		const resName = info?.resName ?? tex.name ?? 'texture';
		lines.push(`newmtl m_${tex.uuid}`, `map_Kd ${textureResourcePath(opts.namespace, opts.trackId, resName, opts.texturePathOf[key])}`);
	}
	lines.push('newmtl none');
	return lines.join('\n');
}

/**
 * Builds the merged mesh's THREE scene node. Blockbench's OBJ codec walks the THREE scene and resolves
 * each node back to its element via `OutlinerNode.uuids[node.name]` (scene nodes are named by element
 * uuid). `Mesh.init()` registers `OutlinerNode.uuids[uuid]` and adds the element to the outliner tree,
 * but the scene node only exists after the element's `preview_controller.updateAll` runs (`setup()`
 * creates `Project.nodes_3d[uuid]` and parents it under `Project.model_3d`). Without this call the
 * codec can never reach the merged mesh, so the .obj comes out empty — the bug that used to make the
 * export look "broken". Falls back to manually registering a node when no preview_controller exists.
 */
function registerMergedMeshForCodec(merged: Mesh): void {
	const pc = (merged as any).preview_controller as { updateAll?: (el: Mesh) => unknown } | undefined;
	if (pc && typeof pc.updateAll === 'function') {
		try {
			pc.updateAll(merged);
			return;
		} catch {
			// fall through to the manual registration below
		}
	}
	const g = globalThis as { Project?: any; THREE?: any };
	const nodes3d = g.Project?.nodes_3d as Record<string, unknown> | undefined;
	const root = g.Project?.model_3d as { add?: (n: unknown) => void } | undefined;
	const THREE = g.THREE as any;
	if (nodes3d && root && typeof root.add === 'function' && THREE?.Mesh && THREE?.BufferGeometry && !nodes3d[merged.uuid]) {
		const node = new THREE.Mesh(new THREE.BufferGeometry());
		node.name = merged.uuid;
		nodes3d[merged.uuid] = node;
		root.add(node);
	}
}

/**
 * Serializes one shape group as a single merged OBJ mesh through Blockbench's own OBJ codec:
 *  1. mergeGroupToMesh merges the group's whole subtree (cubes + meshes, nested folders included) into
 *     one Mesh via the official mesh API — cubes through their global corners, meshes world-baked, so
 *     the merged mesh is a single root-level mesh with no bones around it;
 *  2. the merged mesh is added to the project and its THREE scene node is built (registerMergedMeshForCodec)
 *     and every other element is marked non-exportable — the same partial-export mechanism
 *     Codec.patchCollectionExport uses — so the codec's scene traversal emits exactly one `o` object;
 *  3. the project is restored in a finally block and a Create-compatible MTL is returned (Blockbench's
 *     own MTL references texture file names, which the forge:obj loader can't resolve to resource paths).
 */
export function exportGroupAsObj(opts: {
	group: Group;
	mtlName: string;
	namespace: string;
	trackId: string;
	texInfos: ExportTexture[];
	keyOf: Map<Texture, string>;
	texturePathOf: Record<string, string>;
}): { obj: string; mtl: string } {
	const { group } = opts;
	const codec = (globalThis as any).Codecs?.obj;
	if (!codec || typeof codec.compile !== 'function') {
		throw new Error(t('ctg.export.no_obj_codec'));
	}
	const merged = mergeGroupToMesh(group);
	// OBJ `o` name = cleaned shape id (no display suffix with parentheses / spaces), matching the .obj file name
	merged.name = cleanGroupName(group.name) || 'mesh';
	// Add the merged mesh to the project (registers uuid + outliner root) and build its THREE scene
	// node so the OBJ codec's scene traversal can reach it
	merged.init();
	registerMergedMeshForCodec(merged);
	// Partial-export isolation: save every element's export flag, mark all non-exportable, keep `merged`
	const saved = new Map<string, boolean>();
	const all = [
		...(((globalThis as any).Outliner?.elements as unknown[]) ?? []),
		...(((globalThis as any).Group?.all as unknown[]) ?? []),
	];
	for (const node of all) {
		const n = node as { uuid?: string; export?: unknown };
		if (typeof n.export === 'boolean') {
			saved.set(n.uuid ?? '', n.export);
			n.export = false;
		}
	}
	merged.export = true;
	try {
		const res = codec.compile({ mtl_name: opts.mtlName, all_files: true });
		const obj: string = res && typeof res === 'object' ? (res.obj as string) : String(res);
		return { obj, mtl: buildObjMtl(merged, opts) };
	} finally {
		for (const node of all) {
			const n = node as { uuid?: string; export?: unknown };
			const v = saved.get(n.uuid ?? '');
			if (typeof v === 'boolean') n.export = v;
		}
		(merged as any).remove?.();
	}
}

/**
 * Exports the groups under the track parent group according to mode into the configured directory:
 *  - Java (new_java / classic_java): element model JSON + textures; groups that can't be exported fall
 *    back to OBJ
 *  - obj: every group baked into a single merged OBJ mesh (.obj + .mtl + forge:obj reference JSON)
 *  - bedrock: minecraft:geometry + blocks.json + textures; groups that can't be exported fall back to OBJ
 *  - Java / OBJ modes write blockstates to root; Bedrock writes blocks.json to root
 * Write locations are derived from the resource paths: models → root/models/{modelPath}/, textures →
 * root/textures/{texturePath}/ (each texture its own path); in-file references use these resource
 * paths directly. Returns statistics (files written, skipped groups, warnings).
 */
export function writeTrackExport(opts: ExportOptions & {
	subgroups: Group[];
	texInfos: ExportTexture[];
	keyOf: Map<Texture, string>;
}): { files: number; skipped: string[]; warnings: string[] } {
	const { root, modelPath, texturePaths, namespace, trackId, loader, subgroups, mode, texInfos, keyOf } = opts;
	const fs = scopedFs(root);
	if (!fs) {
		throw new Error(t('ctg.export.no_fs'));
	}
	const projW = (Project as any).texture_width || 16;
	const projH = (Project as any).texture_height || 16;
	const fallbackSize: [number, number] = [projW, projH];

	/** Model write directory (absolute): root/models/{modelPath}/ */
	const modelDir = joinPath(root, `models/${modelPath}`);
	/** A texture's write directory (absolute): root/textures/{texturePath}/ */
	const textureDirOf = (key: string): string => joinPath(root, `textures/${texturePaths[key] ?? modelPath}`);

	const files: string[] = [];
	const skipped: string[] = [];
	const warnings: string[] = [];
	const writtenTextures = new Set<string>();

	/** The shapes defined in the Bedrock blocks.json (only natively exported shapes) */
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
			// ── OBJ (single merged mesh) or fallback ──
			// Merged into one Blockbench Mesh + serialized via Blockbench's OBJ codec (Codecs.obj.compile),
			// so the .obj carries a single `o` object with all the group's cubes + meshes
			const shape = file.replace(/\.json$/, '');
			const objRes = exportGroupAsObj({ group, mtlName: `${shape}.mtl`, namespace, trackId, texInfos, keyOf, texturePathOf: texturePaths });
			fs.mkdirSync(modelDir, { recursive: true });
			fs.writeFileSync(joinPath(modelDir, `${shape}.obj`), objRes.obj);
			fs.writeFileSync(joinPath(modelDir, `${shape}.mtl`), objRes.mtl);
			fs.writeFileSync(joinPath(modelDir, file), JSON.stringify(buildObjReferenceJson({ namespace, trackId, loader, shape, textures: shapeTexs, texturePathOf: texturePaths, modelPath }), null, '\t'));
			files.push(joinPath(modelDir, `${shape}.obj`), joinPath(modelDir, `${shape}.mtl`), joinPath(modelDir, file));
			for (const tex of shapeTexs) writeTexturePng(fs, textureDirOf(tex.key), tex, files, warnings, writtenTextures);
			if (mode === 'bedrock') {
				warnings.push(t('ctg.export.bedrock_fallback', id));
			}
		} else if (mode === 'bedrock') {
			// ── Bedrock geometry ──
			const ts: [number, number] = shapeTexs[0] ? [shapeTexs[0].width, shapeTexs[0].height] : fallbackSize;
			const geo = buildBedrockGeometry({ identifier: `geometry.${trackId}_${id}`, elements, textureSize: ts });
			fs.mkdirSync(modelDir, { recursive: true });
			fs.writeFileSync(joinPath(modelDir, file), JSON.stringify(geo, null, '\t'));
			files.push(joinPath(modelDir, file));
			for (const tex of shapeTexs) writeTexturePng(fs, textureDirOf(tex.key), tex, files, warnings, writtenTextures);
			if (shapeTexs[0]) bedrockShapes.push({ id, texturePath: `${texturePaths[shapeTexs[0].key] ?? modelPath}/${shapeTexs[0].resName}` });
		} else {
			// ── Java JSON (classic / new) ──
			const json = buildJavaModelJson({ mode, elements, textures: shapeTexs, textureSize: fallbackSize, namespace, trackId, texturePathOf: texturePaths });
			fs.mkdirSync(modelDir, { recursive: true });
			fs.writeFileSync(joinPath(modelDir, file), JSON.stringify(json, null, '\t'));
			files.push(joinPath(modelDir, file));
			for (const tex of shapeTexs) writeTexturePng(fs, textureDirOf(tex.key), tex, files, warnings, writtenTextures);
		}
	}

	if (mode === 'bedrock') {
		const blocksJson = buildBedrockBlocksJson({ namespace, trackId, shapes: bedrockShapes });
		fs.writeFileSync(joinPath(root, 'blocks.json'), JSON.stringify(blocksJson, null, '\t'));
		files.push(joinPath(root, 'blocks.json'));
	} else {
		// MC requires blockstates files directly under blockstates/ (no subfolders supported)
		const bsFile = blockstatesFileName(trackId);
		fs.mkdirSync(joinPath(root, 'blockstates'), { recursive: true });
		fs.writeFileSync(joinPath(root, `blockstates/${bsFile}`), JSON.stringify(buildBlockstates(namespace, trackId, modelPath), null, '\t'));
		files.push(joinPath(root, `blockstates/${bsFile}`));
	}

	return { files: files.length, skipped, warnings };
}

/**
 * Export result dialog: wider than the default message box (640px), with each warning/notice in its
 * own box. Uses a custom DOM dialog when a document exists; in Node smoke tests without a document it
 * degrades to showMessageBox (summary text only, warnings still listed one per line).
 */
function showExportResult(opts: { title: string; summary: string[]; notes: string[] }): void {
	if (typeof document === 'undefined') {
		const message =
			opts.summary.join('\n') + (opts.notes.length ? `\n\n${t('ctg.export.notice')}\n${opts.notes.join('\n')}\n` : '');
		Blockbench.showMessageBox({ title: opts.title, message, buttons: [t('ctg.ok')], confirm: 0 });
		return;
	}
	const lines: HTMLElement[] = [];
	// Summary section
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
	// Each warning in its own box
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

/** Export main flow: find the track group → collect textures → large dialog (mode/namespace/id/paths) → write files → summary */
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
	// Collect textures first: the export dialog needs to list each texture's directory
	const { infos: texInfos, keyOf } = collectTexturesGlobal(subgroups);
	// A free/generic-model workspace keeps origin-centered, non-canvas-aligned geometry that the
	// Java/Bedrock block formats can't express — restrict the dialog to OBJ export only
	const forceObj = isFreeModelFormat((Project as any).format?.id as string | undefined);
	const options = await promptExportOptions(defaultTrackId, texInfos, { forceObj });
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
		const forcedObjNote = forceObj ? t('ctg.export.mode.forced_obj_note') : '';
		// Deduplicated texture resource paths (they may differ)
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
							blockstatesFileName(options.trackId),
						]),
				t('ctg.export.done_namespace', options.namespace),
				t('ctg.export.done_condition', modeMeta?.description ?? ''),
				skipped.length ? t('ctg.export.done_skipped', skipped.join(', ')) : '',
			].filter(Boolean),
			notes: [...warnings, formatNote, forcedObjNote].filter(Boolean),
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
