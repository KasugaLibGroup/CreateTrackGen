# `src/build/workspace.ts` — Workspace creation & texture import

Blockbench-dependent layer. Instead of dumping output into the current workspace, generation creates a
new standalone workspace (model tab):

- the workspace name is set by the user in the wizard
- the workspace texture resolution = the shared texture size of the three input parts
- the parts' source textures are imported into that workspace; the assembly layer resolves cube-face
  `texture` references to real `Texture` objects from there

## `createTrackWorkspace(format, name, textureSize, textures)`

Creates the output workspace and imports the part textures, returning a "source texture key → Texture"
map.

- creates the workspace with the given format: pass `'generic'` (free model) when a part has mesh
  groups, otherwise Java block/item model
- sets the workspace name and texture resolution
- removes the new workspace's default blank texture, then imports the parts' source textures
  (deduplicated by source)

Throws on failure (invalid format / cannot create); the caller surfaces the message.

```ts
export function createTrackWorkspace(
	format: ModelFormat | string,
	name: string,
	textureSize: [number, number],
	textures: SourceTexture[]
): Map<string, Texture>;
```
