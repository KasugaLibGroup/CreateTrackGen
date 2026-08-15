/**
 * 轨距换算工具 —— 单个对话框内同时显示 英寸 / 毫米 / 像素(1/16 方块) / 输出值。
 *
 * 用户在任意一个输入框里输入（英寸 / 毫米 / 像素），其余两个输入框与
 * 「输出值」（Create 弯道比例常数，只读）一起联动更新：
 *  - px 是生成基准：mm = px×1000/16，in = mm/25.4；
 *  - 输出比例常数由像素轨距经二次拟合曲线计算（scaleForPx）。
 * 输出值不可由用户直接修改，只随轨距变化。
 */

import type { DialogOptions } from 'blockbench-types/generated/interface/dialog';
import { t } from '../i18n';
import { DEFAULT_FIT, DEFAULT_GAUGE_MM, formatFit, inchToPx, mmToPx, pxToInch, pxToMM, scaleForPx } from '../logic/gauge';

/** 换算工具的当前状态 */
interface GaugeState {
	inch: number;
	mm: number;
	px: number;
	/** Create 弯道比例常数（只读输出） */
	scale: number;
}

/** 冒烟测试驱动钩子（真实 Blockbench 不依赖它） */
export interface GaugeDriver {
	setInch(v: number): void;
	setMM(v: number): void;
	setPx(v: number): void;
	getState(): GaugeState;
}

/** 显示用舍入：最多保留 digits 位小数并去掉多余的 0（62.990000 → 62.99） */
function roundDisplay(n: number, digits = 4): number {
	return Number(n.toFixed(digits));
}

/** 由像素轨距同步全部字段（px 为生成基准） */
function syncFromPx(state: GaugeState, px: number): void {
	state.px = px;
	state.mm = pxToMM(px);
	state.inch = pxToInch(px);
	state.scale = scaleForPx(px);
}

// ── 对话框样式 ──────────────────────────────────────────────
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

/** 注入对话框样式（有 document 时） */
function injectGaugeStyles(): void {
	if (typeof document === 'undefined') return;
	if (document.getElementById(GAUGE_STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = GAUGE_STYLE_ID;
	style.textContent = GAUGE_STYLE;
	document.head.appendChild(style);
}

/** 卸载时清理对话框样式 */
export function disposeGaugeStyles(): void {
	if (typeof document === 'undefined') return;
	document.getElementById(GAUGE_STYLE_ID)?.remove();
}

/** 创建带类名与文本的 DOM 元素 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

/** 打开轨距换算对话框（英寸/毫米/像素/输出值联动） */
export function runGaugeConverter(): void {
	// 默认 Create 标称轨距
	const state: GaugeState = { inch: 0, mm: 0, px: 0, scale: 0 };
	syncFromPx(state, mmToPx(DEFAULT_GAUGE_MM));

	let dialogNode: HTMLElement | null = null;

	/** 把 state 同步回 DOM（edited 字段跳过，避免打断用户输入） */
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

	/** 某个输入框的当前值 → 全量换算（px 为基准） */
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

	/** 构建对话框 DOM（无 document 时返回空字符串） */
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

		// 三个输入框的联动：编辑任一 → 其余字段 + 输出一起更新
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
			// 确保初始显示正确（默认 1600mm）
			render();
		},
		onConfirm() {
			return undefined;
		},
	} as DialogOptions & { _driver?: GaugeDriver };

	// 冒烟测试钩子：直接驱动换算（真实 Blockbench 不依赖它）
	config._driver = driver;

	injectGaugeStyles();
	new Dialog(config).show();
}
