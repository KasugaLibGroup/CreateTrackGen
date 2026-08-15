# `src/logic/types.ts` — 纯类型定义

逻辑层与 Blockbench 之间的解耦枢纽。本模块零依赖，可在 Node 中直接单测。

## 基础类型

### `Vec3`

三维向量。

```ts
export type Vec3 = [number, number, number];
```

### `CubeFaceDirection`

方块面方向。

```ts
export type CubeFaceDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';
```

## 纹理与面

### `SourceTexture`

源纹理：从 `.bbmodel` 或当前项目提取的纹理，用于导入到新工作区并应用到对应面。
`key` 是源模型内的唯一标识（`.bbmodel` 的 texture id，或当前项目的纹理 UUID），
生成时由 `CubeSpec` 面的 texture 字段引用，assembly 层据此映射到新工作区里导入的 `Texture`。

```ts
export interface SourceTexture {
	key: string;        // 源模型内的唯一键
	name: string;
	source: string;     // 位图数据：base64 data URL 或桌面文件路径
	width: number;
	height: number;
}
```

### `FaceSpec`

面 UV 描述（透传给 Blockbench `CubeFace`）。

```ts
export interface FaceSpec {
	uv?: [number, number, number, number];
	rotation?: number;
	texture?: string;   // 源纹理 key（见 SourceTexture），由 assembly 层映射到导入的 Texture
}
```

### `MeshFaceSpec`

网格元素（mesh 组）的面：引用一组顶点 id，附 UV 与源纹理 key。
`uv` 直接透传 `.bbmodel` / Blockbench 的原始结构（mesh 面的 uv 是顶点 UV 列表，
数组或对象均可），创建 Mesh 时原样交还 Blockbench 解释。

```ts
export interface MeshFaceSpec {
	vertices: string[];                 // 组成该面的顶点 id 列表（按逆时针顺序）
	uv?: number[] | Record<string, any>; // 顶点 UV（透传，不做任何修改）
	rotation?: number;
	texture?: string;                   // 源纹理 key（见 SourceTexture）
}
```

## 立方体与网格

### `CubeSpec`

立方体的平台无关描述，与 Blockbench 的 `ICubeOptions` from/to/rotation/origin/faces 一一对应。
`from`/`to` 为盒子两个对角（px），`rotation` 为绕 `origin` 的三轴旋转角（度）。

```ts
export interface CubeSpec {
	name?: string;
	from: Vec3;
	to: Vec3;
	rotation?: Vec3;
	origin?: Vec3;
	faces?: Partial<Record<CubeFaceDirection, FaceSpec>>;
}
```

### `MeshSpec`

网格元素（mesh 组）：顶点 id → 位置，面 id → 面。
`.bbmodel` 中 type 为 `'mesh'` 的元素（区别于 `'cube'` 的体块组）。

```ts
export interface MeshSpec {
	name?: string;
	vertices: Record<string, Vec3>;
	faces: Record<string, MeshFaceSpec>;
	origin?: Vec3;
	rotation?: Vec3;
}
```

## 零件模型

### `PartModel`

零件模型：从 `.bbmodel` 或当前项目解析出的元素集合。
归一化约定：底面 y = 0，轨道横向中线 x = 0。
`cubes` 为体块元素（用于生成轨道形状），`meshes` 为网格元素（mesh 组，
仅用于工作区里的基础分组，不参与轨道形状生成）。

```ts
export interface PartModel {
	cubes: CubeSpec[];
	meshes?: MeshSpec[];          // mesh 元素（type='mesh'），有则说明该零件含网格组
	hasMesh?: boolean;            // 零件是否含 mesh 组（决定新工作区是否为自由模型）
	bbox: { min: Vec3; max: Vec3 }; // 归一化后的包围盒（含 cube 与 mesh 顶点）
	xMid: number;                 // 横向中线 x 值（归一化后通常为 0）
	textureSize?: [number, number]; // 纹理分辨率 [w, h]（px）。三个零件必须一致，否则拒绝生成
	textures?: SourceTexture[];   // 零件引用的全部源纹理
}
```

## 配置

### `PortalConfig`

传送门配置（可选）：两张纹理独立可选。

- `trackTexture`（portal_track）提供时，teleport 形状把轨道/枕木铺这个纹理；缺省则用零件自身的默认纹理。
- `mipTexture`（portal_track_mip）提供时，生成两个覆层块（`teleport_left` / `teleport_right`）把枕木左/右半边包住（不包含钢轨）并贴这个纹理；缺省则不生成覆层块。

结构参考 Create 原版 teleport.json —— 整个模型铺 portal_track，两个覆层（左 cube5 / 右 cube6）贴 mip。

```ts
export interface PortalConfig {
	trackTexture?: string;          // portal_track 纹理源 key（已带前缀，如 'P/track'）
	mipTexture?: string;            // portal_track_mip 纹理源 key（已带前缀，如 'P/mip'）
	mipTextureSize?: [number, number]; // 覆层（mip）纹理尺寸 [w, h]（px），缺省 32×32
	margin?: number;                // 覆层相对枕木外缘的包覆余量（px，避免共面闪烁），缺省 0.1
}
```

### `TrackConfig`

生成轨道所需的全部输入。

```ts
export interface TrackConfig {
	gaugePx: number;          // 轨距（px，1/16 方块）＝左右钢轨中心距
	heightPx: number;         // 轨道距模型底面的高度（px，1/16 方块）
	wholeModelYOffset?: number; // 整个模型（含枕木与轨道）的 y 偏移（px），默认 0
	parts: {
		left: PartModel;
		right: PartModel;
		tie: PartModel;
	};
	portal?: PortalConfig;    // 传送门配置（可选）：两张纹理独立可选
}
```

## 形状结果

### `ShapeSpec`

一种轨道形状的生成结果。

```ts
export interface ShapeSpec {
	id: string;     // TrackShape 标识，如 'x_ortho'、'diag'、'ascending_south'
	name: string;   // 展示名（Group 名）
	cubes: CubeSpec[];
}
```
