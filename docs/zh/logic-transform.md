# `src/logic/transform.ts` — 几何变换

纯函数，操作 `CubeSpec[]`。与 Blockbench 解耦：平移直接改 from/to/origin；旋转返回带
rotation 字段的 CubeSpec，由 assembly 层用 `Cube.rotation` 表达。

## 拷贝与平移

### `cloneCubes(cubes)`

深拷贝 `CubeSpec` 列表，避免污染原始零件。

```ts
export function cloneCubes(cubes: CubeSpec[]): CubeSpec[];
```

### `translate(cubes, offset)`

平移所有 Cube 指定偏移量。

```ts
export function translate(cubes: CubeSpec[], offset: Vec3): CubeSpec[];
```

### `lift(cubes, dy)`

抬升所有 Cube（y 方向平移，正值向上）。

```ts
export function lift(cubes: CubeSpec[], dy: number): CubeSpec[];
```

## 旋转

### `rotateY(cubes, angleDeg, origin)`

绕 Y 轴旋转（角度制）。生成的是「带旋转字段」的 Cube：直接把 rotation 的 Y 分量设为 angle
（并保证 origin 存在），from/to 不变。这样 Blockbench 会用 `Cube.rotation` 表达旋转，
而非重算旋转后坐标。

```ts
export function rotateY(cubes: CubeSpec[], angleDeg: number, origin: Vec3): CubeSpec[];
```

### `rotateX(cubes, angleDeg, origin)`

绕 X 轴旋转（角度制），用于上升轨道坡度。若既有 Y 旋转（yaw），叠加保留。

```ts
export function rotateX(cubes: CubeSpec[], angleDeg: number, origin: Vec3): CubeSpec[];
```

### `rotateVec(v, rot)`

按 `[rx, ry, rz]` 依次绕 X→Y→Z 旋转向量（Minecraft 的 `Cube.rotation` 顺序，与
Blockbench 约定一致）。

```ts
export function rotateVec(v: Vec3, rot: Vec3): Vec3;
```

## 面的 UV 变换

### `transformFaceUV(dir, face, rot)`

把「面的 UV 采样」按立方体旋转 rot 变换，得到新的面方向与（uv 盒, rotation）。

纹理是「粘」在体块上的：体块旋转后，同一块纹理区域仍贴在同一物理面上，只是该面的法向/局部
UV 轴变了。对 90° 倍数的轴旋转：

- 纯旋转（det>0）：uv 盒不变，只把旋转角叠加到 `face.rotation` 上；
- 反射（det<0，90° 轴旋转里可能出现，如绕 Z 时 side 面）：uv 盒的 v 反向（交换 v0/v1）
  以表达镜像——Minecraft 的 `face.rotation` 只有 0/90/180/270，不能表镜像。

旋转轴由 Minecraft/Blockbench 的 `Cube.rotation` 顺序（X→Y→Z）计算。

```ts
export function transformFaceUV(
	dir: CubeFaceDirection,
	face: FaceSpec,
	rot: Vec3
): { dir: CubeFaceDirection; face: FaceSpec };
```

## 镜像

### `mirrorPartYz(part)`

把零件沿其横向中心（xMid）的 YZ 平面镜像，得到左右对称的零件。
用于「右轨 = 左轨的镜像」（Create 的 segment_left / segment_right 互为沿轨道中心线的镜像）：

- 几何：from/to/origin 的 x → `2·xMid − x`（from/to 交换保证 from<to）
- 旋转：ry 与 rz 取反（rx 不变），即 `[rx, −ry, −rz]`
- 面：east↔west 交换 + u 轴反向 + rotation 取反
- mesh：顶点 x 反射 + 面顶点顺序反转

纹理（textures / textureSize）不变——镜像零件仍引用同一张源纹理。返回新 `PartModel`
（不污染入参）。关于自身中心的镜像是一次对合（`mirror(mirror(x)) === x`）。

```ts
export function mirrorPartYz(part: PartModel): PartModel;
```

## 旋转烘焙

### `bakePartAxisAligned(part)`

把零件中「90° 倍数、保持轴对齐」的旋转烘焙进 from/to，产出无 rotation 字段的普通盒子。
这样派生形状（straightX / diag / ascending / teleport_x / cross_*）再叠加组旋转
（rotateY / rotateX）时不会覆盖零件自身方向——否则钢轨自带的 `[0,-90,0]` 会被组旋转覆盖，
导致钢轨与枕木平行。

旋转围绕 cube 自身 origin 进行；非 90° 倍数旋转无法烘焙，保留 rotation 字段。
返回重新计算过 bbox / xMid 的新 `PartModel`（不污染入参）。

```ts
export function bakePartAxisAligned(part: PartModel): PartModel;
```

### `bakeRotateY90(cubes, center)`

把每个无 rotation 的 Cube 绕 Y 轴「烘焙」旋转 -90°（关于指定中心），直接换算 from/to，
并把每个面的 UV 采样变换到新方向。产物是不带 rotation 字段的普通盒子，后续
rotateY/rotateX 叠加时不会互相覆盖。带自身 rotation 的 cube 原样返回。

方向映射（-90° 绕 Y）：north→east、south→west、east→south、west→north、up/down 不变。

```ts
export function bakeRotateY90(cubes: CubeSpec[], center: Vec3): CubeSpec[];
```
