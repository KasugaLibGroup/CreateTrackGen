/**
 * 零件获取 —— 从磁盘导入 .bbmodel 或从当前项目提取。
 */

import { elementsToRaw } from '../build/assembly';
import { parseBbModel, extractFromElements, type RawElement } from '../logic/parts';
import type { PartModel, SourceTexture } from '../logic/types';

/** 导入文件结果的轻量结构（与 Filesystem.FileResult 兼容） */
export interface ImportedFile {
	name: string;
	content: string | ArrayBuffer;
}

/**
 * 从磁盘打开文件选择对话框，导入 .bbmodel 文件内容。
 * 返回 Promise<ImportedFile[]>，用户取消则 resolve null。
 */
export function pickBbModels(): Promise<ImportedFile[] | null> {
	return new Promise((resolve) => {
		Filesystem.importFile(
			{
				type: '模型文件',
				extensions: ['bbmodel'],
				multiple: true,
				readtype: 'text',
				title: '选择轨道零件模型（左轨 / 右轨 / 枕木）',
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
 * 解析单个 .bbmodel 文件内容为零件。
 * 对称点由文件内 meta.model_format 决定（java_block/java_item → (8,8)，其他 → (0,0)）。
 * 失败时抛错（由调用方捕获提示）。
 */
export function parseImportedBbModel(file: ImportedFile): PartModel {
	const json = JSON.parse(String(file.content)) as Parameters<typeof parseBbModel>[0];
	const part = parseBbModel(json);
	if (part.cubes.length === 0 && !part.hasMesh) {
		throw new Error(`「${file.name}」没有可用的 elements`);
	}
	return part;
}

/** 把文件内容规范化为 Uint8Array（兼容 ArrayBuffer 与 Uint8Array/DataView） */
function toBytes(content: string | ArrayBuffer | ArrayBufferView): Uint8Array {
	if (content instanceof ArrayBuffer) return new Uint8Array(content);
	if (ArrayBuffer.isView(content)) return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
	throw new Error('不支持的文件内容类型');
}

/** 从 PNG 二进制读宽高（IHDR 头：signature(8) + 长度(4) + "IHDR"(4)，宽高在偏移 16/20） */
function pngSize(bytes: Uint8Array): [number, number] {
	if (bytes.length < 24) throw new Error('无效的 PNG 文件');
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return [v.getUint32(16), v.getUint32(20)];
}

/** 字节 → base64 data URL（分块拼接，避免大文件超栈） */
function arrayBufferToDataURL(bytes: Uint8Array, mime = 'image/png'): string {
	let bin = '';
	const CHUNK = 0x8000;
	for (let i = 0; i < bytes.length; i += CHUNK) {
		bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return `data:${mime};base64,${btoa(bin)}`;
}

/** 单张 PNG 的公共导入实现（多个导入按钮复用） */
function pickSinglePng(title: string, key: string): Promise<SourceTexture | null> {
	return new Promise((resolve) => {
		Filesystem.importFile(
			{
				type: '纹理文件',
				extensions: ['png'],
				multiple: false,
				readtype: 'binary',
				title,
			},
			(files) => {
				try {
					// binary 读取可能返回 ArrayBuffer 或 Uint8Array/DataView，统一规范化
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
					console.error('导入传送门纹理失败', e);
					resolve(null);
				}
			}
		);
	});
}

/**
 * 从磁盘导入 portal_track.png（可选，铺轨道/枕木）。
 * 返回 SourceTexture（key 'track'）；用户取消/读不到文件时返回 null。
 */
export function pickPortalTrackTexture(): Promise<SourceTexture | null> {
	return pickSinglePng('选择 portal_track 纹理（portal_track.png）', 'track');
}

/**
 * 从磁盘导入 portal_track_mip.png（可选，贴覆层块）。
 * 返回 SourceTexture（key 'mip'）；用户取消/读不到文件时返回 null。
 */
export function pickPortalMipTexture(): Promise<SourceTexture | null> {
	return pickSinglePng('选择 portal_track_mip 纹理（portal_track_mip.png）', 'mip');
}

/**
 * 从某个标签页（项目）选中的元素提取零件。
 * 对称点由该项目的模型格式决定（java_block/java_item → (8,8)，其他 → (0,0)）。
 * project 缺省为当前项目（Project）。需要玩家事先在目标标签页中选中组成零件的一组元素。
 * 同时收集这些元素面（cube 面 + mesh 面）所引用的纹理（按 UUID 去重），作为零件的源纹理与分辨率。
 */
export function extractSelectedPart(project?: ModelProject): PartModel {
	const proj = project ?? (Project as unknown as ModelProject);
	const selected = (proj.selected_elements ?? []) as (Cube | Group | Mesh)[];
	const raws: RawElement[] = elementsToRaw(selected);
	const format = (proj as any).format?.id as string | undefined;
	const part = extractFromElements(raws, format);
	if (part.cubes.length === 0 && !part.hasMesh) {
		throw new Error('该标签页没有选中任何元素，请先选中一个零件的全部元素');
	}
	// 收集选中元素（cube 六面 + mesh 面）引用的纹理 UUID
	const keys = new Set<string>();
	for (const r of raws) {
		for (const key of Object.keys((r as any).faces ?? {})) {
			const f = (r as any).faces[key] as { texture?: string | number } | undefined;
			if (f && f.texture != null) keys.add(String(f.texture));
		}
	}
	const textures: SourceTexture[] = [];
	for (const t of proj.textures ?? []) {
		if (keys.has(t.uuid)) {
			textures.push({
				key: t.uuid,
				name: t.name,
				// 用 canvas 导出位图，避免引用旧项目里文件链接的绝对路径
				source: t.canvas ? t.canvas.toDataURL() : t.source,
				width: t.width || t.uv_width || 16,
				height: t.height || t.uv_height || 16,
			});
		}
	}
	part.textures = textures;
	// 分辨率：所选纹理共享的尺寸；否则回退为该项目的纹理尺寸
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
 * 从当前打开的标签页（项目）中选一个，返回选中的 ModelProject。
 * 用户点选某个标签页后，插件再调用 extractSelectedPart(proj) 提取该标签页已选中的元素。
 * 取消 / 没有标签页时返回 null。
 */
export function pickTabProject(): Promise<ModelProject | null> {
	return new Promise((resolve) => {
		const tabs = (ModelProject.all ?? []).filter((p) => p && p.uuid);
		if (tabs.length === 0) {
			Blockbench.showQuickMessage('当前没有打开的标签页');
			resolve(null);
			return;
		}
		const commands: Record<string, { text: string; description?: string }> = {};
		for (const p of tabs) {
			commands[p.uuid] = {
				text: p.name || p.getDisplayName?.() || '未命名',
				description: (p as any).format?.name ?? (p as any).format?.id,
			};
		}
		Blockbench.showMessageBox(
			{
				title: '选择一个标签页',
				message: '从当前打开的标签页中选择一个，插件将提取该标签页中已选中的元素作为零件（请先在目标标签页里选中该零件的全部元素）。',
				buttons: ['取消'],
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
