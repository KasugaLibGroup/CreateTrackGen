# `src/ui/dialog.ts` — 生成配置对话框

单页大对话框收集全部输入：

- 三个零件（左轨 / 右轨 / 枕木）的来源：从磁盘导入 `.bbmodel`，或「选择一个标签页」从当前打开的
  标签页中提取该标签页已选中的元素；右轨额外提供「从第一个模型对称」——把左轨沿其中心 YZ 平面
  镜像生成（`mirrorPartYz`）。
- 轨距（px，含毫米 / 英寸换算：任一字段回车即回填其余两个）/ 轨道高度 / 整体 Y 偏移（px）与新工作区名称。
- 传送门纹理：两张分别可选导入——portal_track 铺轨道/枕木（缺省用零件默认纹理），portal_track_mip
  生成左右覆层块 `teleport_left` / `teleport_right`（包裹枕木左/右半边、不含钢轨，贴 mip，缺省不生成）。
- 工作区格式由输入零件决定：任一零件含 mesh 组 → 自由模型（generic）；否则 Java 方块/物品模型。

零件在对话框内收集时**不**加纹理前缀，生成时统一 `scopeTextureKeys` 加前缀（L / R / T），保证
「源 key → 导入 Texture」映射全局唯一。

## 类型

### `GenerateOutput`

对话框流程的最终输出。

```ts
export interface GenerateOutput {
	config: TrackConfig;
	shapes: ShapeSpec[];
	textureByKey: Map<string, Texture>;  // 源纹理 key → 新工作区里导入的 Texture，供 assembly 层贴纹理
}
```

## 样式注入

### `injectDialogStyles()` / `disposeDialogStyles()`

注入 / 卸载时清理生成对话框样式（Blockbench 有 document；Node 冒烟测试无 document 时安全跳过）。

```ts
export function injectDialogStyles(): void;
export function disposeDialogStyles(): void;
```

## 生成入口

### `runGenerateWizard()`

完整生成流程入口（单页对话框）。返回生成结果，失败/取消返回 `null`。用户在对话框里填好所有输入后
点「确定」，`onConfirm` 里同步建工作区并 resolve。

```ts
export function runGenerateWizard(): Promise<GenerateOutput | null>;
```
