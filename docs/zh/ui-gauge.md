# `src/ui/gauge.ts` — 轨距换算对话框

单个对话框内同时显示 英寸 / 毫米 / 像素(1/16 方块) / 输出值。用户在任意一个输入框里输入
（英寸 / 毫米 / 像素），其余两个输入框与「输出值」（Create 弯道比例常数，只读）一起联动更新：
px 是生成基准（mm = px×1000/16，in = mm/25.4），输出比例常数由像素轨距经二次拟合曲线计算
（`scaleForPx`）。

## 类型

### `GaugeDriver`

冒烟测试驱动钩子（真实 Blockbench 不依赖它）。

```ts
export interface GaugeDriver {
	setInch(v: number): void;
	setMM(v: number): void;
	setPx(v: number): void;
	getState(): GaugeState;
}
```

## 样式清理

### `disposeGaugeStyles()`

卸载时清理轨距换算对话框样式。

```ts
export function disposeGaugeStyles(): void;
```

## 入口

### `runGaugeConverter()`

打开轨距换算对话框（英寸/毫米/像素/输出值联动）。默认 Create 标称轨距 1600mm。

```ts
export function runGaugeConverter(): void;
```
