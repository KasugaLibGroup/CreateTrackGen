/**
 * 轨距换算模块 —— 把玩家输入的轨距换算成机械动力（Create）用于计算弯道的比例常数。
 *
 * 锚点（用户提供，实测于游戏，2026-08-11 更新）：
 *   1435mm 标准轨  -> 0.755
 *   1600mm 机械动力默认轨 -> 0.965
 *   1000mm 米轨     -> 0.525
 *
 * 换算曲线用二次多项式 y = a·x² + b·x + c 精确穿过这三个锚点（克拉默法则求解）。
 * 纯函数，可在 Node 中单测。
 */

export interface GaugeAnchor {
	gaugeMM: number;
	scale: number;
}

/** 三个已知锚点 */
export const GAUGE_ANCHORS: GaugeAnchor[] = [
	{ gaugeMM: 1435, scale: 0.755 },
	{ gaugeMM: 1600, scale: 0.965 },
	{ gaugeMM: 1000, scale: 0.525 },
];

/** 二次多项式系数 y = a·x² + b·x + c */
export interface QuadraticCoeffs {
	a: number;
	b: number;
	c: number;
}

/**
 * 用克拉默法则求过三点的二次多项式系数。
 * 若三个 x 互不相同则必有唯一解；返回 null 表示输入非法。
 */
export function fitQuadratic(points: GaugeAnchor[]): QuadraticCoeffs | null {
	if (points.length !== 3) return null;
	const [p1, p2, p3] = points;
	const { gaugeMM: x1, scale: y1 } = p1;
	const { gaugeMM: x2, scale: y2 } = p2;
	const { gaugeMM: x3, scale: y3 } = p3;

	// 范德蒙德矩阵 [[x1²,x1,1],[x2²,x2,1],[x3²,x3,1]] 的行列式
	const det = x1 * x1 * (x2 - x3) + x2 * x2 * (x3 - x1) + x3 * x3 * (x1 - x2);
	if (det === 0) return null;

	const detA =
		y1 * (x2 - x3) + y2 * (x3 - x1) + y3 * (x1 - x2);
	const detB =
		x1 * x1 * (y2 - y3) + x2 * x2 * (y3 - y1) + x3 * x3 * (y1 - y2);
	const detC =
		x1 * x1 * (x2 * y3 - x3 * y2) +
		x2 * x2 * (x3 * y1 - x1 * y3) +
		x3 * x3 * (x1 * y2 - x2 * y1);

	return {
		a: detA / det,
		b: detB / det,
		c: detC / det,
	};
}

/** 默认拟合（使用三个锚点） */
export const DEFAULT_FIT: QuadraticCoeffs = fitQuadratic(GAUGE_ANCHORS)!;

/** 轨距(mm) → 比例常数 */
export function gaugeMMToScale(gaugeMM: number, coeffs: QuadraticCoeffs = DEFAULT_FIT): number {
	const { a, b, c } = coeffs;
	return a * gaugeMM * gaugeMM + b * gaugeMM + c;
}

/**
 * 换算基准（2026-08-11 更新）：1 格方块 = 1 米 = 1000mm = 16px。
 * 即 px = mm × 16 / 1000，每 px = 62.5mm，与 Minecraft「一格 = 一米」的比例一致。
 * 与旧基准（16px ↔ 1600mm，MM_PER_PX=100）不同：Create 默认轨距 1600mm 现在对应 25.6px。
 * 轨距的度量仍是「左右钢轨中心距」。
 */
const MM_PER_PX = 1000 / 16;
/** 每英寸对应的 mm 数 */
const MM_PER_INCH = 25.4;

/** Create 默认标称轨距（mm） */
export const DEFAULT_GAUGE_MM = 1600;
/** Create 默认轨距对应的模型 px（1600mm → 25.6px） */
export const DEFAULT_GAUGE_PX = mmToPx(DEFAULT_GAUGE_MM);

/** mm → 模型轨距 px（1/16 方块） */
export function mmToPx(gaugeMM: number): number {
	return gaugeMM / MM_PER_PX;
}

/** 模型轨距 px（1/16 方块）→ mm */
export function pxToMM(gaugePx: number): number {
	return gaugePx * MM_PER_PX;
}

/** mm → 英寸 */
export function mmToInch(gaugeMM: number): number {
	return gaugeMM / MM_PER_INCH;
}

/** 英寸 → mm */
export function inchToMM(gaugeInch: number): number {
	return gaugeInch * MM_PER_INCH;
}

/** 英寸 → 模型轨距 px（1/16 方块） */
export function inchToPx(gaugeInch: number): number {
	return mmToPx(inchToMM(gaugeInch));
}

/** 模型轨距 px（1/16 方块）→ 英寸 */
export function pxToInch(gaugePx: number): number {
	return mmToInch(pxToMM(gaugePx));
}

/** 玩家直接输入 px 轨距 → 比例常数（先转 mm 再拟合） */
export function scaleForPx(gaugePx: number, coeffs: QuadraticCoeffs = DEFAULT_FIT): number {
	return gaugeMMToScale(pxToMM(gaugePx), coeffs);
}

/**
 * 将拟合系数格式化为人类可读的公式字符串（负数系数显示为「−」而非「+ -」）。
 * 例：y = 1.24e-6·x² - 0.0025·x + 1.7756
 */
export function formatFit(coeffs: QuadraticCoeffs = DEFAULT_FIT): string {
	const { a, b, c } = coeffs;
	const sign = (v: number) => (v < 0 ? '-' : '+');
	return (
		`y = ${a.toExponential(2)}·x² ${sign(b)} ${Math.abs(b).toFixed(4)}·x ` +
		`${sign(c)} ${Math.abs(c).toFixed(4)}`
	);
}
