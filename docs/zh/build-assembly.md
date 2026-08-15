# `src/build/assembly.ts` — CubeSpec → Cube/Group

组装层：把 logic 层产出的 `ShapeSpec[]` 转成 Blockbench 真实的 Cube/Group。
这是整个项目中唯一 import `Cube` / `Group` 的模块（依赖 Blockbench 全局 API）。

## `buildBaseParts(parent, parts, config, textureByKey?)`

把三个轨道零件搬进新工作区，作为基础分组：`segment_left` / `segment_right` / `tie`。
Create 的弯道渲染使用这三个模型（tie.obj / segment_left.obj / segment_right.obj），分组内各含
对应零件的全部元素（cube 体块 + mesh 组），挂到轨道大组 parent 下、与各方向轨道形状并列，便于单独导出。

布局 = z_ortho 直轨「靠近 x 轴那半边」的轨道单元（不再按输出格式偏移）：

- `segment_left` / `segment_right`：轨道模型自身的中心（Java 为 xz(8,8)、其他格式为 (0,0)）的 x 坐标
  归零（offset.x = -xMid），近 z 端靠在 xy 平面（z 从 0 起），钢轨底面抬升到 轨道高度 + 整体 Y 偏移。
  两条钢轨各自以自身中心为轴（Create 的 segment_left.obj / segment_right.obj 同样以钢轨自身中心为
  x=0，游戏在渲染时摆到 ±轨距/2）。
- `tie`：枕木移动到 z_ortho 中靠近 x 轴的第一个枕木位置（z=4，= 枕木间距/2），横向居中于 x=0，
  底面仅加整体 Y 偏移（不抬升）。

返回创建的三个分组。

```ts
export function buildBaseParts(
	parent: Group,
	parts: { left: PartModel; right: PartModel; tie: PartModel },
	config: TrackConfig,
	textureByKey?: Map<string, Texture>
): Group[];
```

## `buildAllShapes(shapes, textureByKey?)`

生成全部形状，挂到父 Group（名字 = 当前工作区名，默认 `'track'`）下。每个形状一个子 Group
（按 `TrackShape` id 命名）。输出工作区为 Java Block/Item 时，把整体几何平移到 xz 平面 (8,8) 处，
保证模型关于画布中心的对称性（同导入时的归一化约定）。`textureByKey` 非空时，把零件源纹理应用到
对应 cube 的面（左轨/右轨/枕木各自贴自己的纹理）。返回父 Group。

```ts
export function buildAllShapes(shapes: ShapeSpec[], textureByKey?: Map<string, Texture>): Group;
```

## `elementsToRaw(elements)`

把 Blockbench 元素（Cube/Group/Mesh）转成 logic 层的 `RawElement[]`，供零件解析。
从当前项目提取零件时使用。Group 会递归展开其子元素；mesh 元素用 `getSaveCopy()` 序列化
（vertices/faces/origin/rotation），面纹理是 uuid（非下标）。

```ts
export function elementsToRaw(elements: (Cube | Group | Mesh)[]): RawElement[];
```
