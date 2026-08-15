/**
 * Track gauge converter — a single dialog showing inches / millimeters / pixels (1/16 block) /
 * output value at once.
 *
 * Entering a value in any input (inch / mm / px) updates the other two inputs and the "output value"
 * (Create curve scale constant, read-only) together:
 *  - px is the generation basis: mm = px×1000/16, in = mm/25.4;
 *  - the output scale is computed from the pixel gauge via the quadratic fit (scaleForPx).
 * The output value cannot be edited by the user; it only follows the gauge.
 */

import type { DialogOptions } from 'blockbench-types/generated/interface/dialog';
import { t } from '../i18n';
import { DEFAULT_FIT, DEFAULT_GAUGE_MM, formatFit, inchToPx, mmToPx, pxToInch, pxToMM, scaleForPx } from '../logic/gauge';

/** The converter tool's current state */
interface GaugeState {
	inch: number;
	mm: number;
	px: number;
	/** Create curve scale constant (read-only output) */
	scale: number;
}

/** Smoke-test driver hook (not used by real Blockbench) */
export interface GaugeDriver {
	setInch(v: number): void;
	setMM(v: number): void;
	setPx(v: number): void;
	getState(): GaugeState;
}

/** Display rounding: at most digits decimals with trailing zeros stripped (62.990000 → 62.99) */
function roundDisplay(n: number, digits = 4): number {
	return Number(n.toFixed(digits));
}

/** Syncs all fields from the pixel gauge (px is the generation basis) */
function syncFromPx(state: GaugeState, px: number): void {
	state.px = px;
	state.mm = pxToMM(px);
	state.inch = pxToInch(px);
	state.scale = scaleForPx(px);
}

// ── Dialog styles ───────────────────────────────────────────────────────
const GAUGE_STYLE_ID = 'create-track-gen-gauge-dialog-styles';
const GAUGE_STYLE = `
#create-track-gen-gauge-dialog .ctg-gauge-field { margin: 8px 0 12px; }
#create-track-gen-gauge-dialog .ctg-gauge-field > label { display: block; font-weight: 600; margin-bottom: 4px; }
#create-track-gen-gauge-dialog input.ctg-gauge-input {
	width: 100%;
	box-sizing: border-box;
	background: var(--color-input, #202020);
	color: var(--text-color, #eee);
	border: 1px solid var(--color-border, #555);
	border-radius: 3px;
	padding: 5px 7px;
	font: inherit;
}
#create-track-gen-gauge-dialog input.ctg-gauge-input:focus { border-color: var(--active-color, #4caf50); outline: none; }
#create-track-gen-gauge-dialog input.ctg-gauge-output {
	background: var(--color-input, #202020);
	color: var(--active-color, #7cb342);
	font-weight: 700;
}
#create-track-gen-gauge-dialog .ctg-gauge-hint {
	font-size: 12px;
	color: var(--color-subtle_text, #8a8a8a);
	line-height: 1.5;
	margin-top: 2px;
}
#create-track-gen-gauge-dialog .ctg-gauge-note {
	border: 1px solid var(--color-border, #3a3a3a);
	border-radius: 5px;
	padding: 8px 10px;
	margin-top: 6px;
	background: rgba(127, 127, 127, 0.06);
}
`;

/** Injects the dialog styles (when a document exists) */
function injectGaugeStyles(): void {
	if (typeof document === 'undefined') return;
	if (document.getElementById(GAUGE_STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = GAUGE_STYLE_ID;
	style.textContent = GAUGE_STYLE;
	document.head.appendChild(style);
}

export function disposeGaugeStyles(): void {
	if (typeof document === 'undefined') return;
	document.getElementById(GAUGE_STYLE_ID)?.remove();
}

/** Creates a DOM element with a class name and text */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

/** Opens the gauge converter dialog (inch/mm/px/output linked) */
export function runGaugeConverter(): void {
	// Default to Create's nominal gauge
	const state: GaugeState = { inch: 0, mm: 0, px: 0, scale: 0 };
	syncFromPx(state, mmToPx(DEFAULT_GAUGE_MM));

	let dialogNode: HTMLElement | null = null;

	/** Syncs state back to the DOM (skips the edited field, avoiding interrupting user input) */
	const render = (edited?: string): void => {
		if (!dialogNode) return;
		const set = (which: string, v: number): void => {
			if (which === edited) return;
			const input = dialogNode!.querySelector<HTMLInputElement>(`[data-gauge="${which}"]`);
			if (input) input.value = String(roundDisplay(v));
		};
		set('inch', state.inch);
		set('mm', state.mm);
		set('px', state.px);
		set('scale', state.scale);
	};

	/** Current value of an input → full conversion (px is the basis) */
	const onEdit = (which: 'inch' | 'mm' | 'px'): void => {
		if (!dialogNode) return;
		const input = dialogNode.querySelector<HTMLInputElement>(`[data-gauge="${which}"]`);
		if (!input) return;
		const v = parseFloat(input.value);
		if (!Number.isFinite(v) || v <= 0) return;
		if (which === 'inch') syncFromPx(state, inchToPx(v));
		else if (which === 'mm') syncFromPx(state, mmToPx(v));
		else syncFromPx(state, v);
		render(which);
	};

	const driver: GaugeDriver = {
		setInch(v) {
			syncFromPx(state, inchToPx(v));
			render();
		},
		setMM(v) {
			syncFromPx(state, mmToPx(v));
			render();
		},
		setPx(v) {
			syncFromPx(state, v);
			render();
		},
		getState() {
			return state;
		},
	};

	/** Builds the dialog DOM (empty string when no document exists) */
	const buildLines = (): HTMLElement | '' => {
		if (typeof document === 'undefined') return '';
		const wrap = el('div');

		const field = (which: string, label: string, value: number, hint?: string, readonly = false): HTMLElement => {
			const row = el('div', 'ctg-gauge-field');
			row.append(el('label', undefined, label));
			const input = el('input', readonly ? 'ctg-gauge-input ctg-gauge-output' : 'ctg-gauge-input') as HTMLInputElement;
			input.type = 'number';
			input.dataset.gauge = which;
			input.value = String(roundDisplay(value));
			if (readonly) input.readOnly = true;
			row.append(input);
			if (hint) row.append(el('div', 'ctg-gauge-hint', hint));
			return row;
		};

		wrap.append(field('inch', t('ctg.gauge.field_inch'), state.inch));
		wrap.append(field('mm', t('ctg.gauge.field_mm'), state.mm));
		wrap.append(field('px', t('ctg.gauge.field_px'), state.px));
		wrap.append(field('scale', t('ctg.gauge.field_scale'), state.scale, t('ctg.gauge.field_scale.desc'), true));
		wrap.append(el('div', 'ctg-gauge-hint', t('ctg.gauge.hint')));
		wrap.append(el('div', 'ctg-gauge-note', `${t('ctg.gauge.formula', formatFit(DEFAULT_FIT))}\n${t('ctg.gauge.anchors')}`));

		// Link the three inputs: editing any one updates the rest and the output together
		for (const which of ['inch', 'mm', 'px'] as const) {
			const input = wrap.querySelector<HTMLInputElement>(`[data-gauge="${which}"]`);
			if (input) input.addEventListener('input', () => onEdit(which));
		}
		return wrap;
	};

	const config = {
		id: 'create-track-gen-gauge-dialog',
		title: t('ctg.gauge.dialog_title'),
		icon: 'straighten',
		width: 460,
		buttons: [t('ctg.ok')],
		confirmIndex: 0,
		lines: [buildLines()],
		onBuild(node?: HTMLElement) {
			if (!node) return;
			dialogNode = node;
			// Ensure the initial display is correct (default 1600mm)
			render();
		},
		onConfirm() {
			return undefined;
		},
	} as DialogOptions & { _driver?: GaugeDriver };

	// Smoke-test hook: drives the conversion directly (real Blockbench doesn't depend on it)
	config._driver = driver;

	injectGaugeStyles();
	new Dialog(config).show();
}
