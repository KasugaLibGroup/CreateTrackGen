/**
 * Workspace creation & texture import — the Blockbench-dependent layer.
 *
 * Generation no longer dumps output into the current workspace; instead it creates a new standalone
 * workspace (model tab):
 *  - the workspace name is set by the user in the wizard
 *  - the workspace texture resolution = the shared texture size of the three input parts
 *  - the parts' source textures are imported into that workspace, which the assembly layer uses to
 *    resolve cube-face texture references to real Texture objects
 */

import type { SourceTexture } from '../logic/types';
import { t } from '../i18n';

/** Imports a texture into the current project from a data URL */
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
 * Imports the part's source textures into the current project (deduplicated by source), returning a
 * "source texture key → imported Texture" map for the assembly layer to resolve cube-face texture
 * references (source keys) to real Blockbench Textures.
 */
function importSourceTextures(textures: SourceTexture[]): Map<string, Texture> {
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
 * Creates the output workspace and imports the part textures, returning a "source texture key →
 * Texture" map.
 *  - creates the workspace with the given format: 'generic' (free model) when a part has mesh groups,
 *    otherwise Java block/item model
 *  - sets the workspace name and texture resolution
 *  - removes the new workspace's default blank texture, then imports the parts' source textures
 * Throws on failure (invalid format / cannot create); the caller surfaces the message.
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
	// Remove the default blank texture the new project ships with
	for (const t of Project.textures.slice()) {
		t.remove(true);
	}
	return importSourceTextures(textures);
}
