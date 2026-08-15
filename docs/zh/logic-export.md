# `src/logic/export.ts` — 导出约定与序列化

纯逻辑，把轨道大组下的分组映射成 Create/Kuayue 的模型文件命名，并生成对应的 blockstates JSON。
零依赖，可在 Node 中单测。

**导出模式**（见 `EXPORT_MODES`）：

- `new_java`（1.21.11+）：`format_version` "1.21.11"，支持多轴旋转 `{x,y,z}`
- `classic_java`（1.21.11-）：不加 format_version（匹配 assets 示例），仅单轴旋转
- `bedrock`：`minecraft:geometry` 方块几何
- `obj`：全部烘焙为单一合并网格的 OBJ

无法导出的元素回退 OBJ（判定见 `groupNeedsObj`）。

## 导出模式

### `ExportMode`

```ts
export type ExportMode = 'new_java' | 'classic_java' | 'bedrock' | 'obj';
```

### `EXPORT_MODES`

导出模式元数据：id / 标签 / 判定说明（标签与说明经 i18n 本地化）。

```ts
export const EXPORT_MODES: { id: ExportMode; label: string; description: string }[];
```

## 平台无关元素描述符

供 Blockbench 层从 live Cube / Mesh 抽取后传给纯函数。面纹理用稳定的 `textureKey`
（Blockbench 层把 Texture 实例映射成 `'t0'`/`'t1'`…）。

### `ExportCubeData`

```ts
export interface ExportCubeData {
	name?: string;
	from: Vec3;
	to: Vec3;
	rotation?: Vec3;
	origin?: Vec3;
	faces: Partial<Record<CubeFaceDirection, ExportFaceData>>;
}
```

### `ExportFaceData`

```ts
export interface ExportFaceData {
	uv?: [number, number, number, number];
	rotation?: number;
	textureKey?: string;
}
```

### `ExportMeshFaceData`

```ts
export interface ExportMeshFaceData {
	vertices: string[];
	uv?: number[] | Record<string, number[]>;  // 逐顶点 UV：数组（按 face.vertices 顺序）或对象（按顶点 id）
	textureKey?: string;
}
```

### `ExportMeshData`

```ts
export interface ExportMeshData {
	name?: string;
	vertices: Record<string, Vec3>;
	faces: Record<string, ExportMeshFaceData>;
}
```

### `ExportElement`

```ts
export type ExportElement = ({ type: 'cube' } & ExportCubeData) | ({ type: 'mesh' } & ExportMeshData);
```

### `ExportTexture`

一形状引用的纹理：key / 资源名 / 像素尺寸 / 位图（data URL）。

```ts
export interface ExportTexture {
	key: string;
	resName: string;
	width: number;
	height: number;
	dataUrl?: string;  // base64 data URL（写 PNG 用；纯逻辑层不依赖）
}
```

## 判定与旋转序列化

### `groupNeedsObj(elements, mode)`

判定一个分组在给定模式下是否「无法导出」而回退 OBJ：

- `obj` 模式：全部回退
- 任一 mesh 元素 → 回退（Java JSON / Bedrock cube 都无法表达三角面）
- `classic_java` 且任一立方体多轴旋转 → 回退（经典格式元素只能单轴）
- `bedrock` 且形状引用 >1 张纹理 → 回退（基岩版单几何体单纹理）

```ts
export function groupNeedsObj(elements: ExportElement[], mode: ExportMode): boolean;
```

### `rotationToJava(rotation, origin, mode)`

元素旋转 → Java 模型 JSON 的 rotation 字段：

- 无旋转 → `undefined`（不写）
- `new_java` 且（多轴 或 任一角 >45°）→ `{x,y,z,origin}`（1.21.11+ 多轴旋转）
- 否则单轴 → `{angle,axis,origin}`（axis = 唯一非零轴）

```ts
export function rotationToJava(
	rotation: Vec3 | undefined,
	origin: Vec3 | undefined,
	mode: ExportMode
): { angle?: number; axis?: 'x' | 'y' | 'z'; x?: number; y?: number; z?: number; origin: Vec3 } | undefined;
```

## 命名映射

### `TRACK_MODEL_FILES`

轨道形状分组 id → 导出的模型文件名；`null` 表示该分组不单独导出。
`z_ortho` 不导出（shape=zo 由 blockstates 用 `x_ortho` 旋转 90° 表达）；`ascending_*`
只导出南向变体 `ascending.json`；`teleport_x` / `cross_*_zo` 不导出。

```ts
export const TRACK_MODEL_FILES: Record<string, string | null>;
```

### `cleanGroupName(name)`

分组名去掉「（…）」/「(…)」展示后缀，得到形状 id（`z_ortho（Z 直轨）` → `z_ortho`）。

```ts
export function cleanGroupName(name: string): string;
```

### `modelFileName(id)`

由形状 id 取导出文件名；未知 id / 不导出返回 `null`。

```ts
export function modelFileName(id: string): string | null;
```

### `blockstatesFileName(trackId)`

blockstates 文件名：`{轨道id}_track.json`。

```ts
export function blockstatesFileName(trackId: string): string;
```

### `textureResourceName(name, used)`

纹理资源名：去掉扩展名、小写、非 `[a-z0-9_]` 替换为 `_`，并保证在 `used` 内唯一（重名时追加 `_1` / `_2` …）。

```ts
export function textureResourceName(name: string, used: Set<string>): string;
```

### `textureResourcePath(namespace, trackId, resName, texturePath?)`

模型内纹理资源路径：`{命名空间}:{纹理资源路径}/{资源名}`。纹理资源路径缺省为
`block/track/{轨道id}`（Create/Kuayue 惯例）。

```ts
export function textureResourcePath(namespace: string, trackId: string, resName: string, texturePath?: string): string;
```

## blockstates

### `buildBlockstates(namespace, trackId, modelPath?)`

生成轨道对应的 blockstates JSON 对象。变体组合 = shape × turn × waterlogged（与 Create 轨道块的
状态一致），shape=none 指向空气模型，其余指向 `{命名空间}:{模型资源路径}/{模型}`（缺省
`block/track/{轨道id}`）。`modelPath` 为模型资源路径（如自定义模型导出路径时传入），保证引用跟随。

shape 键 → 模型文件（+ y 旋转）映射与 Create/Kuayue 的 track 块约定一致：`zo` → `x_ortho` 旋转 90°；
cross 的 xo/zo 方向都由 `cross_d1_xo` / `cross_d2_xo` 经 90° 旋转表达（`cr_pdx→cross_d1_xo y:90`、
`cr_pdz→cross_d2_xo y:180`、`cr_ndx→cross_d2_xo y:270`、`cr_ndz→cross_d1_xo`）。

```ts
export function buildBlockstates(
	namespace: string,
	trackId: string,
	modelPath?: string
): { variants: Record<string, { model: string; y?: number }> };
```

## Java 模型 JSON

### `buildJavaModelJson(opts)`

构建 Java 模型 JSON：

- `new_java`：加 `format_version` "1.21.11"，多轴旋转 `{x,y,z}`
- `classic_java`：不加 format_version（匹配 Create/Kuayue 示例），仅单轴旋转

传入 elements 应为已判定可导出的立方体（mesh 已回退 OBJ）。UV 从像素换算为 16 单位制。

```ts
export function buildJavaModelJson(opts: {
	mode: ExportMode;
	elements: ExportElement[];
	textures: ExportTexture[];
	textureSize: [number, number];
	namespace: string;
	trackId: string;
	texturePathOf?: Record<string, string>;  // texture key → 资源目录（缺省 block/track/{trackId}）
}): Record<string, unknown>;
```

## OBJ

### `buildObj(opts)`

把一组的全部元素烘焙成单一合并网格的 OBJ + MTL：

- 顶点坐标 px/16（方块单位）；vt 像素/尺寸且 v 翻底；vn 由三角形外法向计算
- 整个文件只有一根 `o` 对象（无每元素 o / 无 g 分组），位于根下 —— Forge 加载器可整体读取
- 纹理通过 `usemtl m_<key>` 区分，MTL 每张纹理一个 `newmtl` + `map_Kd {ns}:block/track/{id}/{res}`

```ts
export function buildObj(opts: {
	elements: ExportElement[];
	textures: ExportTexture[];
	sizeOf: Record<string, [number, number]>;
	namespace: string;
	trackId: string;
	mtlName?: string;                          // MTL 文件名（用于 mtllib 行），缺省 materials.mtl
	texturePathOf?: Record<string, string>;    // texture key → 资源目录
}): { obj: string; mtl: string };
```

### `buildObjReferenceJson(opts)`

forge:obj 引用 JSON（.obj 模型 + flip_v + textures），与 Create/Kuayue 示例一致。

```ts
export function buildObjReferenceJson(opts: {
	namespace: string;
	trackId: string;
	shape: string;
	textures: ExportTexture[];
	texturePathOf?: Record<string, string>;
	modelPath?: string;   // 模型资源路径（blockstates 引用用），缺省 block/track/{trackId}
}): Record<string, unknown>;
```

## 基岩版

### `buildBedrockGeometry(opts)`

把一组的立方体构建成 `minecraft:geometry` 方块模型。参考 Blockbench o6/r6：立方体 origin[0] 取反
（X 镜像）、带旋转时 pivot=旋转原点（X 镜像）+ rotation 的 rx/ry 取反；per-face uv
（uv + uv_size + uv_rotation），up/down 面 uv+=size、size 取反。传参 elements 应为已判定可导出的
立方体（mesh / 多纹理形状已回退 OBJ）。

```ts
export function buildBedrockGeometry(opts: {
	identifier: string;
	elements: ExportElement[];
	textureSize: [number, number];
}): Record<string, unknown>;
```

### `buildBedrockBlocksJson(opts)`

基岩版方块定义（blocks.json，行为包根目录；legacy 聚合格式）。每形状一个块：
identifier `{ns}:{trackId}_{shape}`，geometry + material_instances 指向该形状的纹理。
`texturePath` 是相对 `textures/` 目录的资源路径（写入 `textures/{texturePath}.png` → `"{texturePath}"`）。

```ts
export function buildBedrockBlocksJson(opts: {
	namespace: string;
	trackId: string;
	shapes: { id: string; texturePath: string }[];
}): Record<string, unknown>;
```
