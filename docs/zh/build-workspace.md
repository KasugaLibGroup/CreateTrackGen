# `src/build/workspace.ts` — 新建工作区与纹理导入

Blockbench 依赖层。生成轨道时不再把产物塞进当前工作区，而是新建一个独立的工作区（模型选项卡）：

- 工作区名由用户在向导里指定
- 工作区纹理分辨率 = 三个输入零件一致的纹理尺寸
- 零件的源纹理被导入该工作区，assembly 层据此把 cube 面的 texture 引用解析成真实 `Texture`

## `createTrackWorkspace(format, name, textureSize, textures)`

创建存放产物的新工作区并导入零件纹理，返回「源纹理 key → Texture」映射。

- 按指定格式新建工作区：零件含 mesh 组时传 `'generic'`（自由模型），否则 Java 方块/物品模型
- 设置工作区名与纹理分辨率
- 移除新建工作区自带的默认空白纹理，再导入零件的源纹理（按 source 去重）

失败（格式无效 / 无法新建）时抛错，由调用方提示。

```ts
export function createTrackWorkspace(
	format: ModelFormat | string,
	name: string,
	textureSize: [number, number],
	textures: SourceTexture[]
): Map<string, Texture>;
```
