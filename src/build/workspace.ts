/**
 * 工作区创建与纹理导入 —— Blockbench 依赖层。
 *
 * 生成轨道时不再把产物塞进当前工作区，而是新建一个独立的工作区（模型选项卡）：
 *  - 工作区名由用户在向导里指定
 *  - 工作区纹理分辨率 = 三个输入零件一致的纹理尺寸
 *  - 零件的源纹理被导入该工作区，assembly 层据此把 cube 面的 texture 引用解析成真实 Texture
 */

import type { SourceTexture } from '../logic/types';
import { t } from '../i18n';

/** 从 data URL 导入一张纹理到当前项目 */
function importTexture(st: SourceTexture): Texture {
	const tex = new Texture();
	tex.name = st.name;
	tex.uv_width = st.width;
	tex.uv_height = st.height;
	tex.fromDataURL(st.source);
	Project.textures.push(tex);
	return tex;
}

/**
 * 把零件源纹理导入当前项目（按 source 去重），返回「源纹理 key → 导入的 Texture」映射。
 * 供 assembly 层把 cube 面的 texture 引用（源 key）解析为 Blockbench 的真实 Texture。
 */
export function importSourceTextures(textures: SourceTexture[]): Map<string, Texture> {
	const bySource = new Map<string, Texture>();
	const byKey = new Map<string, Texture>();
	for (const st of textures) {
		if (!st.source) continue;
		let tex = bySource.get(st.source);
		if (!tex) {
			tex = importTexture(st);
			bySource.set(st.source, tex);
		}
		byKey.set(st.key, tex);
	}
	return byKey;
}

/**
 * 创建存放产物的新工作区并导入零件纹理，返回「源纹理 key → Texture」映射。
 *  - 按指定格式新建工作区：零件含 mesh 组时传 'generic'（自由模型），否则 Java 方块/物品模型
 *  - 设置工作区名与纹理分辨率
 *  - 移除新建工作区自带的默认空白纹理，再导入零件的源纹理
 * 失败（格式无效 / 无法新建）时抛错，由调用方提示。
 */
export function createTrackWorkspace(
	format: ModelFormat | string,
	name: string,
	textureSize: [number, number],
	textures: SourceTexture[]
): Map<string, Texture> {
	if (!newProject(format)) {
		throw new Error(t('ctg.workspace.create_fail'));
	}
	Project.name = name;
	Project.texture_width = textureSize[0];
	Project.texture_height = textureSize[1];
	// 移除新建项目自带的默认空白纹理
	for (const t of Project.textures.slice()) {
		t.remove(true);
	}
	return importSourceTextures(textures);
}
