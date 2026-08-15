# `src/build/export.ts` — 导出轨道模型

导出层：把当前工作区轨道大组（名 = 工作区名）下的各分组，按四种模式（`new_java` / `classic_java` /
`bedrock` / `obj`）导出到用户指定文件夹。

导出配置用与「生成」类似的单页大对话框收集（左侧配置 / 右侧每张纹理的资源路径）：

- 导出模式 / 命名空间 / 轨道 id 由用户填写；
- 导出根目录 = 资源包 `assets/{命名空间}` 所在目录——所有文件都写到这里，归类为
  `models/` textures/ blockstates/；
- 模型资源路径 = 写入模型文件的 `{命名空间}:path/file` 的 path（blockstates 引用模型用），默认
  `block/track/{轨道id}`；模型写到 根目录/models/{path}/；
- 每张纹理一个资源路径（模型引用纹理用），默认同样 `block/track/{轨道id}`；纹理写到
  根目录/textures/{path}/。

所有路径字段都可手动编辑，并预置默认生成的路径；文件内引用直接用这些资源路径。

文件写入用 Blockbench 的 scoped `require('fs', { scope })`（桌面端，首次会请求「访问文件夹」权限）；
Node 冒烟测试里用 `global.require` 桩替换。无法导出的判定与各格式序列化在纯逻辑层
`src/logic/export.ts`（可单测）。

## 常量

### `TRACK_PARENT_NAME`

轨道大组（父分组）的名称，与 `buildAllShapes` 里创建的一致。

```ts
export const TRACK_PARENT_NAME = '机械动力轨道';
```

## 导出配置类型

### `ExportOptions`

导出配置（对话框收集后传给 `writeTrackExport`）。

```ts
export interface ExportOptions {
	mode: ExportMode;
	namespace: string;
	trackId: string;
	root: string;         // 导出根目录（资源包 assets/{命名空间} 所在目录，所有文件都写到这里）
	modelPath: string;    // 模型资源路径（blockstates 引用模型用 {命名空间}:path/file 的 path）
	texturePaths: Record<string, string>;  // texture key → 纹理资源路径
}
```

### `ExportDriver`

冒烟测试驱动导出对话框的钩子（真实 Blockbench 不依赖它）。

```ts
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
```

## 样式注入

### `injectExportStyles()` / `disposeExportStyles()`

注入 / 卸载时清理导出对话框样式（有 document 时；Node 冒烟测试安全跳过）。

```ts
export function injectExportStyles(): void;
export function disposeExportStyles(): void;
```

## 导出对话框

### `promptExportOptions(defaultTrackId, textures)`

导出配置对话框（单页大框框，两列：左侧导出配置 + 右侧每张纹理的导出路径）。所有路径字段均为
可编辑文本框 + 「浏览…」/「重置」按钮，并预置默认生成的路径。返回 `null` 表示取消。

```ts
export function promptExportOptions(
	defaultTrackId: string,
	textures: ExportTexture[]
): Promise<ExportOptions | null>;
```

## 导出主流程

### `writeTrackExport(opts)`

把轨道大组下的各分组按 mode 导出到配置的目录：

- Java（`new_java` / `classic_java`）：元素模型 JSON + 纹理；无法导出的分组回退 OBJ
- `obj`：全部分组烘焙为单一合并网格 OBJ（.obj + .mtl + forge:obj 引用 JSON）
- `bedrock`：`minecraft:geometry` + blocks.json + 纹理；无法导出的分组回退 OBJ
- Java / OBJ 模式写 blockstates 到 root；基岩版模式写 blocks.json 到 root

写盘位置由资源路径派生：模型 → `root/models/{modelPath}/`，纹理 → `root/textures/{texturePath}/`
（texturePath 每张纹理各自配置）；文件内引用直接用这些资源路径。返回统计信息
（写出的文件、跳过的分组、警告）。

```ts
export function writeTrackExport(opts: ExportOptions & {
	subgroups: Group[];
	texInfos: ExportTexture[];
	keyOf: Map<Texture, string>;
}): { files: number; skipped: string[]; warnings: string[] };
```

### `runTrackExport()`

导出主流程：找大组 → 收集纹理 → 大对话框（模式/命名空间/id/路径）→ 写文件 → 汇总。

```ts
export async function runTrackExport(): Promise<void>;
```
