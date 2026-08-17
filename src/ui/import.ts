/**
 * Part acquisition — imports .bbmodel files from disk or extracts parts from the current project.
 */

import { elementsToRaw } from '../build/assembly';
import { parseBbModel, extractFromElements, textureUvSize, formatUsesPerTextureUv, type RawElement } from '../logic/parts';
import { t } from '../i18n';
import type { PartModel, SourceTexture } from '../logic/types';

/** A lightweight structure for an imported file's result (compatible with Filesystem.FileResult) */
export interface ImportedFile {
	name: string;
	content: string | ArrayBuffer;
}

/**
 * Opens the disk file picker to import .bbmodel file contents.
 * Resolves to ImportedFile[], or null when the user cancels.
 */
export function pickBbModels(): Promise<ImportedFile[] | null> {
	return new Promise((resolve) => {
		Filesystem.importFile(
			{
				type: t('ctg.import.model_type'),
				extensions: ['bbmodel'],
				multiple: true,
				readtype: 'text',
				title: t('ctg.import.pick_parts_title'),
			},
			(files) => {
				const valid = files
					.filter((f) => typeof f.content === 'string' && f.content.length > 0)
					.map((f) => ({ name: f.name, content: f.content as string }));
				if (valid.length === 0) {
					resolve(null);
					return;
				}
				resolve(valid);
			}
		);
	});
}

/**
 * Parses a single .bbmodel file content into a part. The symmetry point is decided by the file's
 * meta.model_format (java_block/java_item → (8,8), others → (0,0)). Throws on failure (the caller
 * surfaces the message).
 */
export function parseImportedBbModel(file: ImportedFile): PartModel {
	const json = JSON.parse(String(file.content)) as Parameters<typeof parseBbModel>[0];
	// Resolve the format's real per_texture_uv_size flag from the runtime Formats registry, falling back
	// to the id heuristic for formats the host doesn't expose. Only the free/generic model sets it true —
	// for everything else the model resolution (not per-texture uv_width) is the UV size.
	const fmt = json.meta?.model_format;
	const perTextureUv = formatUsesPerTextureUv(fmt, (globalThis as any).Formats?.[fmt as string]?.per_texture_uv_size);
	const part = parseBbModel(json, undefined, perTextureUv);
	if (part.cubes.length === 0 && !part.hasMesh) {
		throw new Error(t('ctg.import.no_elements', file.name));
	}
	return part;
}

/** Normalizes a file content into a Uint8Array (supports ArrayBuffer and Uint8Array/DataView) */
function toBytes(content: string | ArrayBuffer | ArrayBufferView): Uint8Array {
	if (content instanceof ArrayBuffer) return new Uint8Array(content);
	if (ArrayBuffer.isView(content)) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
	throw new Error(t('ctg.import.unsupported_content'));
}

/** Reads a PNG's width/height from its binary (IHDR header: signature(8) + length(4) + "IHDR"(4); width/height at offsets 16/20) */
function pngSize(bytes: Uint8Array): [number, number] {
	if (bytes.length < 24) throw new Error(t('ctg.import.invalid_png'));
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return [v.getUint32(16), v.getUint32(20)];
}

/** Bytes → base64 data URL (chunked concatenation to avoid stack overflow on large files) */
function arrayBufferToDataURL(bytes: Uint8Array, mime = 'image/png'): string {
	let bin = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return `data:${mime};base64,${btoa(bin)}`;
}

/** Shared implementation for importing a single PNG (reused by the two portal import buttons) */
function pickSinglePng(title: string, key: string): Promise<SourceTexture | null> {
	return new Promise((resolve) => {
		Filesystem.importFile(
			{
				type: t('ctg.import.texture_type'),
				extensions: ['png'],
				multiple: false,
				readtype: 'binary',
				title,
			},
			(files) => {
				try {
					// binary reads may return ArrayBuffer or Uint8Array/DataView — normalize uniformly
					const isBinary = (c: unknown): boolean =>
						typeof c === 'object' && c !== null && (c instanceof ArrayBuffer || ArrayBuffer.isView(c));
					const f = files.find((x) => isBinary(x.content) && (x.content as any).byteLength > 0);
					if (!f) {
						resolve(null);
						return;
					}
					const bytes = toBytes(f.content as string | ArrayBuffer | ArrayBufferView);
					const [w, h] = pngSize(bytes);
					resolve({ key, name: f.name, source: arrayBufferToDataURL(bytes), width: w, height: h });
				} catch (e: any) {
					console.error(t('ctg.import.portal_failed'), e);
					resolve(null);
				}
			}
		);
	});
}

/**
 * Imports portal_track.png from disk (optional; covers the track/ties).
 * Returns a SourceTexture (key 'track'); null when cancelled / no file could be read.
 */
export function pickPortalTrackTexture(): Promise<SourceTexture | null> {
	return pickSinglePng(t('ctg.import.pick_portal_track'), 'track');
}

/**
 * Imports portal_track_mip.png from disk (optional; textures the overlay cubes).
 * Returns a SourceTexture (key 'mip'); null when cancelled / no file could be read.
 */
export function pickPortalMipTexture(): Promise<SourceTexture | null> {
	return pickSinglePng(t('ctg.import.pick_portal_mip'), 'mip');
}

/**
 * Extracts a part from the elements selected in a tab (project). The symmetry point is decided by that
 * project's model format (java_block/java_item → (8,8), others → (0,0)). project defaults to the
 * current project (Project). The player must first select, in the target tab, the set of elements that
 * form the part. Also collects the textures referenced by those elements' faces (cube faces + mesh
 * faces, deduplicated by UUID) as the part's source textures and resolution.
 */
export function extractSelectedPart(project?: ModelProject): PartModel {
	const proj = project ?? (Project as unknown as ModelProject);
	const selected = (proj.selected_elements ?? []) as (Cube | Group | Mesh)[];
	const raws: RawElement[] = elementsToRaw(selected);
	const format = (proj as any).format?.id as string | undefined;
	const part = extractFromElements(raws, format);
	if (part.cubes.length === 0 && !part.hasMesh) {
		throw new Error(t('ctg.import.no_selection'));
	}
	// Collect the texture UUIDs referenced by the selected elements (cube faces + mesh faces)
	const keys = new Set<string>();
	for (const r of raws) {
		for (const key of Object.keys((r as any).faces ?? {})) {
			const f = (r as any).faces[key] as { texture?: string | number } | undefined;
			if (f && f.texture != null) keys.add(String(f.texture));
		}
	}
	const projFormat = (proj as any).format?.id as string | undefined;
	// The format's real per_texture_uv_size flag (Blockbench exposes it on the ModelFormat instance) —
	// only the free/generic model sets it true. Reading it directly instead of guessing from the id keeps
	// the extracted size identical to what the tab's UV editor shows (Texture.getUVWidth()).
	const projPerTextureUv = formatUsesPerTextureUv(projFormat, (proj as any).format?.per_texture_uv_size);
	const projCanvas: [number, number] = [(proj as any).texture_width || 16, (proj as any).texture_height || 16];
	const textures: SourceTexture[] = [];
	for (const t of proj.textures ?? []) {
		if (keys.has(t.uuid)) {
			// The tab's elements' face UVs live in the texture's UV coordinate space (Blockbench's
			// "uv size", Texture.getUVWidth()) — NOT the bitmap's pixel dimensions. textureUvSize
			// mirrors getUVWidth: java block/item and other canvas-UV formats use the tab project's
			// canvas size (what the UV editor's top-left shows), free/mesh formats use the texture's
			// uv_width. Falling back to the bitmap size (t.width) would mis-size the workspace and sample
			// only a corner of the image; hardcoding 16 loses canvas-UV tabs whose textures carry no
			// per-texture uv_width.
			const [w, h] = textureUvSize(projPerTextureUv, t, projCanvas);
			textures.push({
				key: t.uuid,
				name: t.name,
				// Export the bitmap via canvas to avoid referencing the old project's absolute file-link path
				source: t.canvas ? t.canvas.toDataURL() : t.source,
				width: w,
				height: h,
			});
		}
	}
	part.textures = textures;
	// Resolution: the shared size of the selected textures; otherwise fall back to the project's texture size
	if (textures.length > 0) {
		const w = textures[0].width;
		const h = textures[0].height;
		if (textures.every((tx) => tx.width === w && tx.height === h)) {
			part.textureSize = [w, h];
		}
	}
	if (!part.textureSize) {
		part.textureSize = [(proj as any).texture_width || 16, (proj as any).texture_height || 16];
	}
	return part;
}

/**
 * Lets the user pick one of the currently open tabs (projects), returning the chosen ModelProject.
 * After the user picks a tab, the plugin calls extractSelectedPart(proj) to extract the tab's selected
 * elements. Returns null when cancelled / no tabs are open.
 */
export function pickTabProject(): Promise<ModelProject | null> {
	return new Promise((resolve) => {
		const tabs = (ModelProject.all ?? []).filter((p) => p && p.uuid);
		if (tabs.length === 0) {
			Blockbench.showQuickMessage(t('ctg.import.no_tabs'));
			resolve(null);
			return;
		}
		const commands: Record<string, { text: string; description?: string }> = {};
		for (const p of tabs) {
			commands[p.uuid] = {
				text: p.name || p.getDisplayName?.() || t('ctg.import.unnamed'),
				description: (p as any).format?.name ?? (p as any).format?.id,
			};
		}
		Blockbench.showMessageBox(
			{
				title: t('ctg.import.pick_tab_title'),
				message: t('ctg.import.pick_tab_message'),
				buttons: [t('ctg.cancel')],
				commands,
			},
			(button) => {
				if (typeof button === 'string' && commands[button]) {
					const proj = tabs.find((p) => p.uuid === button);
					resolve(proj ?? null);
				} else {
					resolve(null);
				}
			}
		);
	});
}
