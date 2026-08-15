/**
 * Gauge conversion module — converts a player-entered track gauge into the scale constant Create
 * uses for curves.
 *
 * Anchors (user-provided, measured in-game, updated 2026-08-11):
 *   1435mm standard gauge  -> 0.755
 *   1600mm Create default gauge -> 0.965
 *   1000mm meter gauge     -> 0.525
 *
 * The conversion curve is a quadratic y = a·x² + b·x + c fitted exactly through these three
 * anchors (Cramer's rule). Pure functions, Node-testable.
 */

export interface GaugeAnchor {
	gaugeMM: number;
	scale: number;
}

/** The three known anchors */
export const GAUGE_ANCHORS: GaugeAnchor[] = [
	{ gaugeMM: 1435, scale: 0.755 },
	{ gaugeMM: 1600, scale: 0.965 },
	{ gaugeMM: 1000, scale: 0.525 },
];

/** Quadratic coefficients y = a·x² + b·x + c */
export interface QuadraticCoeffs {
	a: number;
	b: number;
	c: number;
}

/**
 * Fits the quadratic coefficients through three points via Cramer's rule.
 * Returns null for invalid input (not exactly three points, or duplicate x values).
 */
export function fitQuadratic(points: GaugeAnchor[]): QuadraticCoeffs | null {
	if (points.length !== 3) return null;
	const [p1, p2, p3] = points;
	const { gaugeMM: x1, scale: y1 } = p1;
	const { gaugeMM: x2, scale: y2 } = p2;
	const { gaugeMM: x3, scale: y3 } = p3;

	// Vandermonde matrix [[x1²,x1,1],[x2²,x2,1],[x3²,x3,1]] determinant
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

/** Default fit (through the three anchors) */
export const DEFAULT_FIT: QuadraticCoeffs = fitQuadratic(GAUGE_ANCHORS)!;

/** Gauge (mm) → curve scale constant */
export function gaugeMMToScale(gaugeMM: number, coeffs: QuadraticCoeffs = DEFAULT_FIT): number {
	const { a, b, c } = coeffs;
	return a * gaugeMM * gaugeMM + b * gaugeMM + c;
}

/**
 * Conversion basis (updated 2026-08-11): 1 block = 1 m = 1000mm = 16px.
 * i.e. px = mm × 16 / 1000, 1 px = 62.5mm, matching Minecraft's "one block = one meter" ratio.
 * Differs from the old basis (16px ↔ 1600mm, MM_PER_PX=100): Create's default gauge 1600mm now maps
 * to 25.6px. The gauge is still measured as the center distance between the rails.
 */
const MM_PER_PX = 1000 / 16;
/** Millimeters per inch */
const MM_PER_INCH = 25.4;

/** Create's default nominal gauge (mm) */
export const DEFAULT_GAUGE_MM = 1600;
/** Model px for Create's default gauge (1600mm → 25.6px) */
export const DEFAULT_GAUGE_PX = mmToPx(DEFAULT_GAUGE_MM);

export function mmToPx(gaugeMM: number): number {
	return gaugeMM / MM_PER_PX;
}

export function pxToMM(gaugePx: number): number {
	return gaugePx * MM_PER_PX;
}

export function mmToInch(gaugeMM: number): number {
	return gaugeMM / MM_PER_INCH;
}

export function inchToMM(gaugeInch: number): number {
	return gaugeInch * MM_PER_INCH;
}

export function inchToPx(gaugeInch: number): number {
	return mmToPx(inchToMM(gaugeInch));
}

export function pxToInch(gaugePx: number): number {
	return mmToInch(pxToMM(gaugePx));
}

/** Gauge entered directly in px → curve scale constant (converts to mm first, then fits) */
export function scaleForPx(gaugePx: number, coeffs: QuadraticCoeffs = DEFAULT_FIT): number {
	return gaugeMMToScale(pxToMM(gaugePx), coeffs);
}

/**
 * Formats the fit coefficients as a human-readable formula string (negative coefficients shown as
 * 「−」 rather than 「+ -」). Example: y = 1.24e-6·x² - 0.0025·x + 1.7756
 */
export function formatFit(coeffs: QuadraticCoeffs = DEFAULT_FIT): string {
	const { a, b, c } = coeffs;
	const sign = (v: number) => (v < 0 ? '-' : '+');
	return (
		`y = ${a.toExponential(2)}·x² ${sign(b)} ${Math.abs(b).toFixed(4)}·x ` +
		`${sign(c)} ${Math.abs(c).toFixed(4)}`
	);
}
