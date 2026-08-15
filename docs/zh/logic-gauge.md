# `src/logic/gauge.ts` — 轨距换算

把玩家输入的轨距换算成机械动力（Create）用于计算弯道的比例常数。

换算曲线用二次多项式 `y = a·x² + b·x + c` 精确穿过三个锚点（克拉默法则求解）。纯函数，可在 Node 中单测。

## 类型与常量

### `GaugeAnchor`

```ts
export interface GaugeAnchor {
	gaugeMM: number;   // 轨距（mm）
	scale: number;     // Create 弯道比例常数
}
```

### `GAUGE_ANCHORS`

三个已知锚点（实测于游戏，2026-08-11 更新）：

```ts
export const GAUGE_ANCHORS: GaugeAnchor[] = [
	{ gaugeMM: 1435, scale: 0.755 },  // 标准轨
	{ gaugeMM: 1600, scale: 0.965 },  // Create 默认轨
	{ gaugeMM: 1000, scale: 0.525 },  // 米轨
];
```

### `QuadraticCoeffs`

二次多项式系数 `y = a·x² + b·x + c`。

```ts
export interface QuadraticCoeffs {
	a: number;
	b: number;
	c: number;
}
```

### `DEFAULT_FIT`

默认拟合（使用三个锚点）。

```ts
export const DEFAULT_FIT: QuadraticCoeffs = fitQuadratic(GAUGE_ANCHORS)!;
```

### `DEFAULT_GAUGE_MM` / `DEFAULT_GAUGE_PX`

Create 默认标称轨距 1600mm 与其对应的模型 px（1600mm → 25.6px）。

```ts
export const DEFAULT_GAUGE_MM = 1600;
export const DEFAULT_GAUGE_PX = mmToPx(DEFAULT_GAUGE_MM); // 25.6
```

## 拟合与换算

### `fitQuadratic(points)`

用克拉默法则求过三点的二次多项式系数。若三个 x 互不相同则必有唯一解；返回 `null` 表示输入非法。

```ts
export function fitQuadratic(points: GaugeAnchor[]): QuadraticCoeffs | null;
```

参数：`points` — 恰好三个锚点。返回：二次多项式系数；点数不足或 x 重复时返回 `null`。

### `gaugeMMToScale(gaugeMM, coeffs?)`

轨距(mm) → 比例常数。

```ts
export function gaugeMMToScale(gaugeMM: number, coeffs: QuadraticCoeffs = DEFAULT_FIT): number;
```

### `scaleForPx(gaugePx, coeffs?)`

玩家直接输入 px 轨距 → 比例常数（先转 mm 再拟合）。

```ts
export function scaleForPx(gaugePx: number, coeffs: QuadraticCoeffs = DEFAULT_FIT): number;
```

### `formatFit(coeffs?)`

将拟合系数格式化为人类可读的公式字符串（负数系数显示为「−」而非「+ -」）。
例：`y = 1.24e-6·x² - 0.0025·x + 1.7756`。

```ts
export function formatFit(coeffs: QuadraticCoeffs = DEFAULT_FIT): string;
```

## 单位换算

换算基准（2026-08-11 更新）：1 格方块 = 1 米 = 1000mm = 16px，即 px = mm × 16 / 1000，
每 px = 62.5mm，与 Minecraft「一格 = 一米」的比例一致。每英寸 = 25.4mm。

```ts
export function mmToPx(gaugeMM: number): number;     // mm → 模型轨距 px（1/16 方块）
export function pxToMM(gaugePx: number): number;     // 模型轨距 px → mm
export function mmToInch(gaugeMM: number): number;   // mm → 英寸
export function inchToMM(gaugeInch: number): number; // 英寸 → mm
export function inchToPx(gaugeInch: number): number; // 英寸 → 模型轨距 px
export function pxToInch(gaugePx: number): number;   // 模型轨距 px → 英寸
```

轨距的度量是「左右钢轨中心距」。
