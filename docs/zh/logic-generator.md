# `src/logic/generator.ts` — 轨道形状组装

核心纯逻辑。输入 `TrackConfig`（三零件 + 轨距 + 高度），输出全部 `TrackShape` 的 `CubeSpec` 集合。

组装规则：

- 直轨默认沿 Z 方向铺设在 xz 平面，左右钢轨中心在 x = ±轨距/2，整体抬升高度。
- 轨道默认生成一个完整方块（16px）的长度，钢轨零件不足时沿 Z 平铺补足（Create 的钢轨段是
  8px 的半块段，一个方块需要两块）。
- 其余形状由直轨经 rotation 派生（参考 Kuayue 的 diag_template/ascending_template，
  用 `Cube.rotation` + origin 表达，而非重算旋转后坐标）。

纯函数，可在 Node 中单测。

## 配置

### `GeneratorOptions`

生成配置：轨道长度与枕木间距。

```ts
export interface GeneratorOptions {
	length?: number;       // 轨道沿铺设方向的总长度（px），缺省为 16（一个完整方块）
	tieInterval?: number;  // 枕木间距（px）
}
```

### `TrackAxis`

轨道铺设方向。

```ts
export type TrackAxis = 'x' | 'z';
```

## 基础铺设

### `placeRails(cfg, opts?)`

放置左右钢轨：左轨中心 x=-g/2、右轨 x=+g/2，整体抬升 heightPx。以零件归一化后的实际横向中心
（xMid）为基准对齐，零件未精确居中时也不会错位。钢轨沿 Z 平铺覆盖整个轨道长度。
先烘焙零件的轴对齐旋转（如 `[0,-90,0]`），使钢轨成为沿 Z 的普通盒子——否则派生形状叠加组旋转时
会覆盖钢轨自身旋转，导致钢轨与枕木平行。

```ts
export function placeRails(cfg: TrackConfig, opts?: GeneratorOptions): CubeSpec[];
```

### `orientTiePerpendicular(tie)`

确保枕木长轴跨 X（与沿 Z 铺设的钢轨垂直）。若枕木零件长轴沿 Z（与轨道平行），绕 Y 烘焙旋转 90°
使其跨 X；带自身旋转的零件信任其朝向（解析器已保留），不自动旋转。供 placeTies 与 buildBaseParts 共用。

```ts
export function orientTiePerpendicular(tie: PartModel): CubeSpec[];
```

### `placeTies(cfg, opts?)`

放置枕木：沿轨道方向（Z）从起点到终点按 `tieInterval` 循环铺。枕木横向居中（x=0）、纵向按自身
中心对齐到铺设位置，长轴自动调整为跨 X（垂直钢轨）。注意：`heightPx` 是「钢轨距底面的高度」，
只作用于钢轨，枕木不抬升、底部直接落在 xz 平面。

```ts
export function placeTies(cfg: TrackConfig, opts?: GeneratorOptions): CubeSpec[];
```

### `centerOf(cubes)`

计算 `CubeSpec[]` 的包围盒中心。

```ts
export function centerOf(cubes: CubeSpec[]): Vec3;
```

## 各形状

### `straight(cfg, axis?, opts?)`

直轨形状（`x_ortho` / `z_ortho`）。`axis` 缺省 `'z'`。

```ts
export function straight(cfg: TrackConfig, axis?: TrackAxis, opts?: GeneratorOptions): ShapeSpec;
```

### `straightZ(cfg, opts?)` / `straightX(cfg, opts?)`

直轨（沿 Z）：左右钢轨 + 枕木。`straightX` 把 Z 直轨绕整组中心旋转 90°（Y 轴）。

```ts
export function straightZ(cfg: TrackConfig, opts?: GeneratorOptions): CubeSpec[];
export function straightX(cfg: TrackConfig, opts?: GeneratorOptions): CubeSpec[];
```

### `diagonal(cfg, mirror, opts?)`

45° 斜轨：把 Z 直轨绕整组中心绕 Y 旋转 ±45°。diag = +45°（PD 正对角），diag_2 = -45°（ND 负对角）。
斜轨覆盖方块对角，需要 3 段钢轨 / 3 根枕木（长度 = 3 × 枕木间距，默认 24px），而非直轨的
2 段 / 2 根（16px）。

```ts
export function diagonal(cfg: TrackConfig, mirror: boolean, opts?: GeneratorOptions): ShapeSpec;
```

### `ascending(cfg, dir, opts?)`

上升轨道：把 Z 直轨绕 X 轴旋转 -45°，枢轴在轨道中心（xz 平面即 Java 模型的方块中心 (8,8)），
轨道绕方块中心整体倾斜。yaw 决定朝向（blockstate：south=0 / north=180 / east=270 / west=90）。

倾斜与转向必须共用同一个枢轴；枢轴取轨道 z 方向的中心（Java 画布 xz (8,8)），而非前缘 (8,0)。
上升轨与斜轨一样覆盖更长的铺设距离（长度 = 3 × 枕木间距，默认 24px）。

绕中心 -45° 倾斜后，轨道下端会沉入 xz 平面以下。这里抬升到「整体 Y 偏移生效之后」最低点恰好
落在 xz 平面上（y≥0）：整体偏移 ≥0 抬到 0；整体偏移 <0 多抬 `-wholeY`，把整体下沉的 ascending
顶回平面。`lift` 同时平移 from/to 与 origin，倾斜形状保持不变。

```ts
export function ascending(
	cfg: TrackConfig,
	dir: 'south' | 'north' | 'east' | 'west',
	opts?: GeneratorOptions
): ShapeSpec;
```

### `teleport(cfg, axis?, opts?)`

传送门轨道：两张纹理独立可选——

- `portal_track` 提供时把轨道/枕木铺 portal_track（面纹理重映射，保留 UV）；缺省用零件自身默认纹理。
- `portal_track_mip` 提供时生成两个覆层块（`teleport_left` / `teleport_right`）贴 mip；缺省不生成覆层块。

覆层把枕木左/右半边包住（各包半边），不包含钢轨（钢轨在枕木上方独立生成，覆层不覆盖它），
尺寸取枕木包围盒 + 包覆余量，沿铺设方向铺满整段轨道。两者都缺省时退化为纯直轨，
与 `z_ortho` / `x_ortho` 完全一致。

```ts
export function teleport(cfg: TrackConfig, axis?: TrackAxis, opts?: GeneratorOptions): ShapeSpec;
```

### `cross(cfg, kind, opts?)`

十字交叉轨道。`kind` 对应 `TrackShape`：

- `ortho`：Z 直轨 + X 直轨
- `diag`：正斜轨 + 负斜轨
- `pd_zo`：正斜轨 + Z 直轨 / `nd_zo`：负斜轨 + Z 直轨

交叉模型只生成 xo 名字的两个文件（`cross_d1_xo` / `cross_d2_xo`），但几何都是「斜轨 + Z 直轨」：
blockstates 里 xo / zo 方向都由它们经 90° 旋转表达。命名与 Create 相反：
`cross_d1_xo` = 负对角 + Z 直轨，`cross_d2_xo` = 正对角 + Z 直轨。

```ts
export function cross(
	cfg: TrackConfig,
	kind: 'ortho' | 'diag' | 'pd_zo' | 'nd_zo',
	opts?: GeneratorOptions
): ShapeSpec;
```

## 形状表与总入口

### `ShapeDef`

形状定义表：全部 `TrackShape` 的生成器。

```ts
export interface ShapeDef {
	id: string;
	name: string;
	build: (cfg: TrackConfig, opts?: GeneratorOptions) => ShapeSpec;
}
```

### `allShapes(cfg, opts?)`

生成全部 9 种轨道形状 —— 只生成 blockstates 需要引用的模型，多余的由旋转表达：

- 不生成 `z_ortho`：shape=zo 由 `x_ortho` 旋转 90° 表达
- 不生成 `ascending_north/east/west`：方向由 `ascending_south` 经 blockstates 的 y 旋转表达
- 不生成 `teleport_x`：传送门 4 方向都由 `teleport`（Z 向）经 y 旋转表达
- 不生成 `cross_d1_zo` / `cross_d2_zo`：cross 的 xo/zo 方向都由 `cross_d1_xo` / `cross_d2_xo`
  （都是「斜轨 + Z 直轨」）经 90° 旋转表达

弯道渲染基础分组 `tie` / `segment_left` / `segment_right` 由 buildBaseParts 单独创建。
整体 Y 偏移（`wholeModelYOffset`）在此统一施加（连旋转枢轴一起平移），保证各形状行为一致。

```ts
export function allShapes(cfg: TrackConfig, opts?: GeneratorOptions): ShapeSpec[];
```
