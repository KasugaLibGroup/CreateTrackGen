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

/** A texture's actual pixel size (width, height) */
function textureSizeOf(tex: Texture): [number, number] {
	return [tex.width || tex.uv_width || 16, tex.height || tex.uv_height || 16];
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

		// Form state (initial: default mode classic_java + default namespace create + default root +
		// default resource paths)
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

		/** Validates and hands the legal result to finish; on invalid input pops a message and keeps the dialog open */
		const confirmExport = (): boolean => {
			syncFromDom(); // fallback: adopt the values the user actually typed in the DOM inputs
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
	const { root, modelPath, texturePaths, namespace, trackId, subgroups, mode, texInfos, keyOf } = opts;
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

	const sizeOf: Record<string, [number, number]> = {};
	for (const tex of texInfos) sizeOf[tex.key] = [tex.width, tex.height];

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
			const shape = file.replace(/\.json$/, '');
			const objRes = buildObj({ elements, textures: shapeTexs, sizeOf, namespace, trackId, mtlName: `${shape}.mtl`, texturePathOf: texturePaths });
			fs.mkdirSync(modelDir, { recursive: true });
			fs.writeFileSync(joinPath(modelDir, `${shape}.obj`), objRes.obj);
			fs.writeFileSync(joinPath(modelDir, `${shape}.mtl`), objRes.mtl);
			fs.writeFileSync(joinPath(modelDir, file), JSON.stringify(buildObjReferenceJson({ namespace, trackId, shape, textures: shapeTexs, texturePathOf: texturePaths, modelPath }), null, '\t'));
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
