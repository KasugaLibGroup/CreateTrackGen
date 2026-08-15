# `src/logic/parts.ts` — 零件解析与归一化

把 `.bbmodel` 的 elements 或当前项目的选中元素统一解析成 `PartModel`，并做归一化：
底面 y 平移到 0，模型的对称点平移到 (0,0)。纯函数，可在 Node 中单测（传入 JSON 结构的 elements）。

**对称点的确定依据模型格式**（用户规定）：

- Java Block/Item（`java_block` / `java_item`）：画布 0..16，原点在角上，对称点 (8,8)
- 其他格式（generic/free 等）：原点即画布中心，对称点 (0,0)

这样 Java 模式下零件可以在 0..16 画布内做大，而不必受「关于零点对称」的尺寸限制。

## 原始元素结构

### `ElementRotation`

element 的旋转：Blockbench `.bbmodel` 的数组形式 `[rx, ry, rz]` 或旧式对象形式。

```ts
export type ElementRotation =
	| [number, number, number]
	| { angle?: number; axis?: 'x' | 'y' | 'z'; origin?: [number, number, number] };
```

### `RawCubeElement`

体块元素（type='cube' 或缺省）：from/to + 六面。

```ts
export interface RawCubeElement {
	name?: string;
	type?: 'cube';
	from: [number, number, number];
	to: [number, number, number];
	rotation?: ElementRotation;
	origin?: [number, number, number]; // 数组形式旋转时，origin 是 rotation 的同级字段
	faces?: Partial<Record<CubeFaceDirection, { uv?: [number, number, number, number]; rotation?: number; texture?: string | number }>>;
}
```

### `RawMeshElement`

网格元素（type='mesh'）：顶点表 + 面表。面的 texture 是纹理数组下标（同 cube）。

```ts
export interface RawMeshElement {
	name?: string;
	type: 'mesh';
	vertices?: Record<string, [number, number, number]>;
	faces?: Record<string, { vertices?: string[]; uv?: number[] | Record<string, any>; rotation?: number; texture?: string | number }>;
	origin?: [number, number, number];
	rotation?: [number, number, number];
}
```

### `RawElement`

`.bbmodel` 文件中最小的 element 结构（cube 或 mesh）。

```ts
export type RawElement = RawCubeElement | RawMeshElement;
```

### `RawTexture`

`.bbmodel` 的 textures 数组元素。

```ts
export interface RawTexture {
	name?: string;
	id?: string | number;   // 纹理 id（面里用 texture 字段引用它）
	source?: string;        // base64 data URL 或桌面文件路径
	uv_width?: number;
	uv_height?: number;
}
```

### `RawBbModel`

`.bbmodel` 文件的顶层 JSON 结构。

```ts
export interface RawBbModel {
	meta?: { model_format?: string; texture_size?: [number, number] };
	resolution?: { width?: number; height?: number }; // Blockbench 5 的模型分辨率（纹理尺寸）
	elements?: RawElement[];
	textures?: RawTexture[];
}
```

## 判断与对称点

### `isMeshElement(el)`

判断 element 是否为 mesh 组。

```ts
export function isMeshElement(el: RawElement): el is RawMeshElement;
```

### `symmetryPointForFormat(format?)`

根据模型格式返回对称点（xz 平面，y 记 0）。Java Block/Item → (8,8)；其他 → (0,0)。

```ts
export function symmetryPointForFormat(format: string | undefined): Vec3;
```

### `outputOffsetForFormat(format?)`

生成到某格式工作区时，把「居中于原点」的几何平移到画布对称点所需的偏移，
是导入归一化（`symmetryPointForFormat`）的逆操作：

- Java Block/Item → (8, 8)：模型在 0..16 画布内以 (8,8) 为对称轴，保证导出对称正确
- 其他格式 → (0, 0)：原点即画布中心，无需平移

```ts
export function outputOffsetForFormat(format: string | undefined): Vec3;
```

## 元素 → CubeSpec / MeshSpec

### `elementToCubeSpec(el)`

把单个 element 转成 `CubeSpec`。`.bbmodel` 里的 rotation 有两种形式都要支持：

- 数组形式 `[rx, ry, rz]`（Blockbench 标准导出格式），origin 为 rotation 的同级字段；
- 对象形式 `{ angle, axis, origin }`（旧式 / Java 模型 JSON 格式）。

此前只解析对象形式，导致带数组旋转的零件（如 `[0,-90,0]` 的钢轨）导入时方向被丢弃。

```ts
export function elementToCubeSpec(el: RawElement): CubeSpec;
```

### `elementsToCubeSpecs(elements)`

解析 `.bbmodel` JSON 的 elements → `CubeSpec[]`（只保留 cube 元素，mesh 跳过）。

```ts
export function elementsToCubeSpecs(elements: RawElement[]): CubeSpec[];
```

### `extractMeshes(elements)`

从 elements 提取 mesh 组（type='mesh'），转成 `MeshSpec[]`。面的 texture 引用（数组下标 / uuid）
统一为字符串 key，与 cube 面约定一致。mesh 的 origin（世界锚点）与 rotation 会被烘焙进顶点，
`origin`/`rotation` 置空——否则后续 normalize / translate 同时平移 origin 和 vertices 会对含非零
origin 的 mesh（如 java 模型的 origin (8,8,8)）造成双重位移。

```ts
export function extractMeshes(elements: RawElement[]): MeshSpec[];
```

## 包围盒

### `computeBBox(cubes)`

计算 `CubeSpec[]` 的包围盒（考虑 from/to，不含 rotation）。

```ts
export function computeBBox(cubes: CubeSpec[]): { min: Vec3; max: Vec3 };
```

### `computeMeshBBox(meshes)`

计算 `MeshSpec[]` 的包围盒（遍历全部顶点；顶点已烘焙为世界坐标，origin 已置空）。

```ts
export function computeMeshBBox(meshes: MeshSpec[]): { min: Vec3; max: Vec3 };
```

### `partBBox(cubes, meshes?)`

零件（cube + mesh）的合并包围盒。

```ts
export function partBBox(cubes: CubeSpec[], meshes?: MeshSpec[]): { min: Vec3; max: Vec3 };
```

## 归一化

### `normalize(cubes, symmetry?, meshes?)`

把 `CubeSpec[]`（+ 可选 mesh）归一化为 `PartModel`：

- 底面 y 平移到 0：所有 y 减 `bbox.min.y`
- 对称点平移到 (0,0)：所有 x 减 `symmetry[0]`、z 减 `symmetry[2]`（symmetry 未提供时，回退为按包围盒横向中心自动居中，保持向后兼容）
- mesh 顶点与 origin 用同一偏移平移（保证 cube 与 mesh 相对位置不变）

返回新的 CubeSpec（不污染入参）。

```ts
export function normalize(cubes: CubeSpec[], symmetry?: Vec3, meshes?: MeshSpec[]): PartModel;
```

## 纹理

### `parseBbTextures(json)`

从 `.bbmodel` 的 textures 数组提取源纹理与纹理分辨率。

关键：`.bbmodel` 里 element 的面用 `texture` 字段引用的是**纹理数组的下标**，不是纹理的 id
（Blockbench 加载器 `Texture.all[face.texture]`）。因此这里把源纹理的 key 设为数组下标
（`String(index)`），与 `elementToCubeSpec` 归一化出的面纹理引用对齐。

分辨率优先级：`resolution` → `meta.texture_size` → 全部纹理共享的 uv 尺寸 → undefined。
无纹理（或 source 缺失）的模型返回空数组、尺寸 undefined。

```ts
export function parseBbTextures(json: RawBbModel): { textureSize?: [number, number]; textures: SourceTexture[] };
```

### `consistentTextureSize(parts)`

检查多个零件（左轨 / 右轨 / 枕木）的纹理分辨率是否一致。
全部零件都有定义且相同的 `[w, h]` 时返回该尺寸，否则返回 `null`（应拒绝生成）。

```ts
export function consistentTextureSize(parts: { textureSize?: [number, number] }[]): [number, number] | null;
```

### `scopeTextureKeys(part, prefix)`

给零件的源纹理 key 加前缀，使三个零件（左轨 / 右轨 / 枕木）的纹理 key 全局唯一。

背景：`.bbmodel` 面的 texture 引用是纹理数组下标（0、1…），每个零件都从 0 开始，
若直接用下标当 key，三份零件会在「源 key → 导入 Texture」映射里互相覆盖。
加前缀（如 `L/0`、`R/0`、`T/0`）后各自唯一。cube 面与 mesh 面的 texture 一并同步改写。
返回同一个 `PartModel`（就地改写）。

```ts
export function scopeTextureKeys(part: PartModel, prefix: string): PartModel;
```

## 模型格式与解析入口

### `targetFormatForParts(parts, currentFormat?)`

根据输入零件是否含 mesh 组决定新工作区的模型格式：

- 任一零件含 mesh → `'generic'`（自由模型，只有它能容纳 mesh 组）
- 全为 cube → Java 方块/物品模型（当前项目为 `java_item` 则用 `java_item`，否则 `java_block`）

```ts
export function targetFormatForParts(parts: { hasMesh?: boolean }[], currentFormat?: string): string;
```

### `parseBbModel(json, format?)`

解析 `.bbmodel` JSON → `PartModel`（自动归一化，对称点由 `meta.model_format` 决定），附带纹理信息。

```ts
export function parseBbModel(json: RawBbModel, format?: string): PartModel;
```

### `extractFromElements(elements, format?)`

从元素列表提取零件（`.bbmodel` 的 elements 或某个标签页选中的元素）。format 为来源模型格式
（如 `Project.format.id` / 标签页格式），决定对称点；缺省按其他格式 (0,0)。

```ts
export function extractFromElements(elements: RawElement[], format?: string): PartModel;
```
