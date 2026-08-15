# `src/ui/import.ts` — 零件获取

从磁盘导入 `.bbmodel` 或从当前项目提取零件。

## 类型

### `ImportedFile`

导入文件结果的轻量结构（与 `Filesystem.FileResult` 兼容）。

```ts
export interface ImportedFile {
	name: string;
	content: string | ArrayBuffer;
}
```

## 文件导入

### `pickBbModels()`

从磁盘打开文件选择对话框，导入 `.bbmodel` 文件内容。
返回 `Promise<ImportedFile[]>`，用户取消则 resolve `null`。

```ts
export function pickBbModels(): Promise<ImportedFile[] | null>;
```

### `parseImportedBbModel(file)`

解析单个 `.bbmodel` 文件内容为零件。对称点由文件内 `meta.model_format` 决定
（`java_block`/`java_item` → (8,8)，其他 → (0,0)）。失败时抛错（由调用方捕获提示）。

```ts
export function parseImportedBbModel(file: ImportedFile): PartModel;
```

## 传送门纹理导入

### `pickPortalTrackTexture()`

从磁盘导入 `portal_track.png`（可选，铺轨道/枕木）。返回 `SourceTexture`（key `'track'`）；
用户取消/读不到文件时返回 `null`。

```ts
export function pickPortalTrackTexture(): Promise<SourceTexture | null>;
```

### `pickPortalMipTexture()`

从磁盘导入 `portal_track_mip.png`（可选，贴覆层块）。返回 `SourceTexture`（key `'mip'`）；
用户取消/读不到文件时返回 `null`。

```ts
export function pickPortalMipTexture(): Promise<SourceTexture | null>;
```

## 标签页提取

### `extractSelectedPart(project?)`

从某个标签页（项目）选中的元素提取零件。对称点由该项目的模型格式决定
（`java_block`/`java_item` → (8,8)，其他 → (0,0)）。`project` 缺省为当前项目（`Project`）。
需要玩家事先在目标标签页中选中组成零件的一组元素。同时收集这些元素面（cube 面 + mesh 面）
所引用的纹理（按 UUID 去重），作为零件的源纹理与分辨率。

```ts
export function extractSelectedPart(project?: ModelProject): PartModel;
```

### `pickTabProject()`

从当前打开的标签页（项目）中选一个，返回选中的 `ModelProject`。用户点选某个标签页后，
插件再调用 `extractSelectedPart(proj)` 提取该标签页已选中的元素。取消 / 没有标签页时返回 `null`。

```ts
export function pickTabProject(): Promise<ModelProject | null>;
```
