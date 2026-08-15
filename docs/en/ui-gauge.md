# `src/ui/gauge.ts` — Gauge converter dialog

A single dialog showing inches / millimeters / pixels (1/16 block) / output value at once. Entering a
value in any input (inch / mm / px) updates the other two inputs and the "output value" (Create curve
scale constant, read-only): px is the generation basis (mm = px×1000/16, in = mm/25.4), and the output
scale is computed from the pixel gauge via the quadratic fit (`scaleForPx`).

## Types

### `GaugeDriver`

Smoke-test driver hook (not used by real Blockbench).

```ts
export interface GaugeDriver {
	setInch(v: number): void;
	setMM(v: number): void;
	setPx(v: number): void;
	getState(): GaugeState;
}
```

## Entry point

### `runGaugeConverter()`

Opens the gauge converter dialog (inch/mm/px/output linked). Defaults to Create's nominal gauge
1600 mm.

```ts
export function runGaugeConverter(): void;
```
