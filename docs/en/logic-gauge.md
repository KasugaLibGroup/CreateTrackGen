# `src/logic/gauge.ts` — Gauge conversion

Converts a player-entered track gauge into the scale constant Create uses for curves.
The curve is a quadratic `y = a·x² + b·x + c` fitted exactly through three anchor points
(Cramer's rule). Pure functions, Node-testable.

**Conversion basis** (updated 2026-08-11): 1 block = 1 m = 1000 mm = 16 px, so `px = mm × 16 / 1000`
(1 px = 62.5 mm), matching Minecraft's "one block = one meter" ratio. 1 inch = 25.4 mm.
The gauge is measured as the center distance between the left and right rails.

## Types & constants

### `GaugeAnchor`

```ts
export interface GaugeAnchor {
	gaugeMM: number;   // gauge in mm
	scale: number;     // Create curve scale constant
}
```

### `GAUGE_ANCHORS`

The three known anchor points (measured in-game, updated 2026-08-11):

```ts
export const GAUGE_ANCHORS: GaugeAnchor[] = [
	{ gaugeMM: 1435, scale: 0.755 },  // standard gauge
	{ gaugeMM: 1600, scale: 0.965 },  // Create default gauge
	{ gaugeMM: 1000, scale: 0.525 },  // meter gauge
];
```

### `QuadraticCoeffs`

Quadratic coefficients `y = a·x² + b·x + c`.

```ts
export interface QuadraticCoeffs {
	a: number;
	b: number;
	c: number;
}
```

### `DEFAULT_FIT`

The default fit (through the three anchors).

```ts
export const DEFAULT_FIT: QuadraticCoeffs = fitQuadratic(GAUGE_ANCHORS)!;
```

### `DEFAULT_GAUGE_MM` / `DEFAULT_GAUGE_PX`

Create's default nominal gauge 1600 mm and its model px equivalent (1600 mm → 25.6 px).

```ts
export const DEFAULT_GAUGE_MM = 1600;
export const DEFAULT_GAUGE_PX = mmToPx(DEFAULT_GAUGE_MM); // 25.6
```

## Fitting & scaling

### `fitQuadratic(points)`

Fits the quadratic coefficients through three points via Cramer's rule. Returns `null` for invalid
input (not exactly three points, or duplicate x values).

```ts
export function fitQuadratic(points: GaugeAnchor[]): QuadraticCoeffs | null;
```

### `gaugeMMToScale(gaugeMM, coeffs?)`

Gauge (mm) → curve scale constant.

```ts
export function gaugeMMToScale(gaugeMM: number, coeffs: QuadraticCoeffs = DEFAULT_FIT): number;
```

### `scaleForPx(gaugePx, coeffs?)`

Gauge entered directly in px → curve scale constant (converts to mm first, then fits).

```ts
export function scaleForPx(gaugePx: number, coeffs: QuadraticCoeffs = DEFAULT_FIT): number;
```

### `formatFit(coeffs?)`

Formats the fit coefficients as a human-readable formula string (negative coefficients shown as
`−` rather than `+ -`). Example: `y = 1.24e-6·x² - 0.0025·x + 1.7756`.

```ts
export function formatFit(coeffs: QuadraticCoeffs = DEFAULT_FIT): string;
```
