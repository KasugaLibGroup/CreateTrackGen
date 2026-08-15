/**
 * 生成配置 —— 单页大对话框。
 *
 * 不再分步弹窗收集，所有输入放在一个页面：
 *  - 三个零件（左轨 / 右轨 / 枕木）的来源：从磁盘导入 .bbmodel，或「选择一个标签页」
 *    从当前打开的标签页中提取该标签页已选中的元素；右轨额外提供「从第一个模型对称」——
 *    把左轨沿其中心 YZ 平面镜像生成（mirrorPartYz）。
 *  - 轨距（px，含毫米 / 英寸换算：任一字段回车即回填其余两个）/ 轨道高度 /
 *    整体 Y 偏移（px）与新工作区名称。
 *  - 传送门纹理：两张分别可选导入——portal_track 铺轨道/枕木（缺省用零件默认纹理），
 *    portal_track_mip 生成左右覆层块 teleport_left / teleport_right（包裹枕木左/右半边、
 *    不含钢轨，贴 mip，缺省不生成）；两者都缺省时 teleport 与 z_ortho / x_ortho 一致。
 *    （参考 Create teleport.json）
 *  - 工作区格式由输入零件决定：任一零件含 mesh 组 → 自由模型（generic）；否则 Java 方块/物品模型。
 *
 * 零件在对话框内收集时**不**加纹理前缀，生成时统一 scopeTextureKeys 加前缀
 * （L / R / T），保证「源 key → 导入 Texture」映射全局唯一。
 */

import type { DialogOptions } from 'blockbench-types/generated/interface/dialog';
import { allShapes } from '../logic/generator';
import { DEFAULT_GAUGE_PX, inchToPx, mmToPx, pxToInch, pxToMM } from '../logic/gauge';
import { consistentTextureSize, scopeTextureKeys, targetFormatForParts } from '../logic/parts';
import { mirrorPartYz } from '../logic/transform';
import { t } from '../i18n';
import type { PartModel, PortalConfig, ShapeSpec, SourceTexture, TrackConfig } from '../logic/types';
import { pickBbModels, parseImportedBbModel, extractSelectedPart, pickTabProject, pickPortalTrackTexture, pickPortalMipTexture } from './import';
import { createTrackWorkspace } from '../build/workspace';

/** 对话框流程的最终输出 */
export interface GenerateOutput {
	config: TrackConfig;
	shapes: ShapeSpec[];
	/** 源纹理 key → 新工作区里导入的 Texture，供 assembly 层贴纹理 */
	textureByKey: Map<string, Texture>;
}

type PartName = 'left' | 'right' | 'tie';

/** 零件选择状态。零件均为未加纹理前缀的原始零件，前缀在生成时统一添加。 */
interface PartState {
	left: PartModel | null;
	right: PartModel | null;
	tie: PartModel | null;
	/** 右轨来源：none / file / selection / mirror（从第一个模型对称） */
	rightMode: 'none' | 'file' | 'selection' | 'mirror';
	/** portal_track 纹理（可选）：铺轨道/枕木 */
	portalTrack: SourceTexture | null;
	/** portal_track_mip 纹理（可选）：贴覆层块 */
	portalMip: SourceTexture | null;
}

/** 零件展示名（i18n） */
function partLabel(which: PartName): string {
	return t('ctg.dialog.part.' + which);
}

/** 零件来源动作 —— 供按钮点击与测试驱动（见 config._driver） */
interface PartActions {
	importPart(which: PartName): Promise<void>;
	/** 从当前打开的标签页里选一个，提取该标签页已选中的元素作为零件 */
	pickTab(which: PartName): Promise<void>;
	mirrorRight(): Promise<void>;
	importPortalTrack(): Promise<void>;
	importPortalMip(): Promise<void>;
}

/** 供冒烟测试驱动对话框（真实 Blockbench 中不直接使用） */
interface ConfigDriver {
	actions: PartActions;
	getState(): PartState;
}

// ── 对话框样式：两列布局（左列零件来源 + 右列配置表单）─────────
const DIALOG_STYLE_ID = 'create-track-gen-dialog-styles';
const DIALOG_STYLE = `
/* 两列：左列零件来源，右列表单参数（lines 与 form.node 是 .dialog_content 的两个直接子节点） */
#create-track-gen-dialog .dialog_content {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
	column-gap: 36px;
	row-gap: 4px;
	align-items: start;
}
/* 两个 grid 子项（左列容器 + 右侧 form.node）都允许收缩，避免内容撑破列宽 */
#create-track-gen-dialog .dialog_content > * { min-width: 0; }
#create-track-gen-dialog .ctg-col { min-width: 0; }
#create-track-gen-dialog .ctg-col-title {
	font-weight: 700;
	font-size: 12px;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--color-subtle_text, #9a9a9a);
	margin: 2px 0 10px;
	padding-bottom: 6px;
	border-bottom: 1px solid var(--color-border, #3a3a3a);
}
#create-track-gen-dialog .ctg-part-row {
	margin: 6px 0 16px;
	padding: 10px 12px;
	border: 1px solid var(--color-border, #3a3a3a);
	border-radius: 6px;
}
#create-track-gen-dialog .ctg-part-title { font-weight: 600; margin-right: 8px; }
#create-track-gen-dialog .ctg-part-desc { color: var(--color-subtle_text, #8a8a8a); font-size: 12px; }
#create-track-gen-dialog .ctg-part-status { margin: 4px 0 8px; font-size: 12px; color: var(--color-subtle_text, #8a8a8a); min-height: 15px; }
#create-track-gen-dialog .ctg-part-status.ctg-status-ok { color: var(--active-color, #4caf50); }
#create-track-gen-dialog .ctg-part-actions { display: flex; gap: 6px; flex-wrap: wrap; }
#create-track-gen-dialog .ctg-btn {
	padding: 4px 12px;
	border: 1px solid var(--color-border, #555);
	border-radius: 4px;
	background: var(--color-button, #3f3f3f);
	color: var(--text-color, #eee);
	cursor: pointer;
	white-space: nowrap;
}
#create-track-gen-dialog .ctg-btn:hover { border-color: var(--active-color, #4caf50); color: var(--active-color, #4caf50); }
#create-track-gen-dialog .ctg-hint { font-size: 12px; color: var(--color-subtle_text, #8a8a8a); margin-top: 2px; line-height: 1.5; }
/* 底部按钮（确定 / 取消）固定在右下角 */
#create-track-gen-dialog .dialog_bar.button_bar { text-align: right; }
`;

/** 注入对话框样式（Blockbench 有 document；Node 冒烟测试无 document 时安全跳过） */
export function injectDialogStyles(): void {
	if (typeof document === 'undefined') return;
	if (document.getElementById(DIALOG_STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = DIALOG_STYLE_ID;
	style.textContent = DIALOG_STYLE;
	document.head.appendChild(style);
}

/** 卸载时清理对话框样式 */
export function disposeDialogStyles(): void {
	if (typeof document === 'undefined') return;
	document.getElementById(DIALOG_STYLE_ID)?.remove();
}

/** 创建带类名与文本的 DOM 元素 */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

/** 零件来源的动作按钮（which 不限于 PartName，'portal' 也走 data-which） */
function partButton(act: string, which: string, label: string): HTMLButtonElement {
	const b = el('button', 'ctg-btn');
	b.type = 'button';
	b.dataset.act = act;
	b.dataset.which = which;
	b.textContent = label;
	return b;
}

/** 构建单个零件行（DOM） */
function partRowEl(which: PartName): HTMLElement {
	const isRight = which === 'right';
	const row = el('div', 'ctg-part-row');
	row.dataset.part = which;
	const head = el('div', 'ctg-part-head');
	head.append(el('span', 'ctg-part-title', partLabel(which)));
	head.append(
		el(
			'span',
			'ctg-part-desc',
			isRight ? t('ctg.dialog.part.desc.right') : t('ctg.dialog.part.desc.left')
		)
	);
	row.append(head);
	const status = el('div', 'ctg-part-status', t('ctg.dialog.not_selected'));
	status.dataset.status = which;
	row.append(status);
	const actions = el('div', 'ctg-part-actions');
	actions.append(partButton('file', which, t('ctg.dialog.import_btn')));
	actions.append(partButton('tab', which, t('ctg.dialog.pick_tab_btn')));
	if (isRight) actions.append(partButton('mirror', which, t('ctg.dialog.mirror_btn')));
	row.append(actions);
	return row;
}

/**
 * 左列容器：零件来源（左轨 / 右轨 / 枕木）+ 底部提示。
 * 用一个 HTMLElement 作为 lines 项（避免 HTML 字符串行触发 Blockbench 的 deprecation 警告），
 * 使 .dialog_content 恰有两个直接子节点：本列 + 右侧 form.node，从而两列并排。
 * Node 冒烟测试无 document 时返回空字符串（其 Dialog 桩不渲染 lines）。
 */
function buildLeftColumn(): HTMLElement | '' {
	if (typeof document === 'undefined') return '';
	const col = el('div', 'ctg-col');
	col.append(el('div', 'ctg-col-title', t('ctg.dialog.col_parts')));
	col.append(partRowEl('left'));
	col.append(partRowEl('right'));
	col.append(partRowEl('tie'));
	// 传送门纹理：两张分别可选导入
	const portalRow = el('div', 'ctg-part-row');
	portalRow.dataset.part = 'portal';
	const portalHead = el('div', 'ctg-part-head');
	portalHead.append(el('span', 'ctg-part-title', t('ctg.dialog.portal.title')));
	portalHead.append(el('span', 'ctg-part-desc', t('ctg.dialog.portal.desc')));
	portalRow.append(portalHead);
	const statusTrack = el('div', 'ctg-part-status', t('ctg.dialog.portal.track_default'));
	statusTrack.dataset.status = 'portal_track';
	portalRow.append(statusTrack);
	const statusMip = el('div', 'ctg-part-status', t('ctg.dialog.portal.mip_default'));
	statusMip.dataset.status = 'portal_mip';
	portalRow.append(statusMip);
	const portalActions = el('div', 'ctg-part-actions');
	portalActions.append(partButton('portal_track', 'portal', t('ctg.dialog.portal.import_track')));
	portalActions.append(partButton('portal_mip', 'portal', t('ctg.dialog.portal.import_mip')));
	portalRow.append(portalActions);
	col.append(portalRow);

	col.append(el('div', 'ctg-hint', t('ctg.dialog.hint')));
	return col;
}

/** 某个零件 / 传送门纹理的状态文本与是否"已就绪"（OK 样式） */
function statusInfo(state: PartState, which: PartName | 'portal_track' | 'portal_mip'): { text: string; ok: boolean } {
	if (which === 'portal_track') {
		return state.portalTrack
			? { text: t('ctg.dialog.portal.track_ok', state.portalTrack.name), ok: true }
			: { text: t('ctg.dialog.portal.track_default'), ok: false };
	}
	if (which === 'portal_mip') {
		return state.portalMip
			? { text: t('ctg.dialog.portal.mip_ok', state.portalMip.name), ok: true }
			: { text: t('ctg.dialog.portal.mip_default'), ok: false };
	}
	if (which === 'right' && state.rightMode === 'mirror') {
		return state.left
			? { text: t('ctg.dialog.mirror_status'), ok: true }
			: { text: t('ctg.dialog.need_left_short'), ok: false };
	}
	const part = which === 'left' ? state.left : which === 'tie' ? state.tie : state.right;
	if (!part) return { text: t('ctg.dialog.not_selected'), ok: false };
	const tex = part.textureSize ? t('ctg.dialog.tex_size', [part.textureSize[0], part.textureSize[1]]) : '';
	const count = part.cubes.length + (part.meshes?.length ?? 0);
	const meshNote = part.hasMesh ? t('ctg.dialog.mesh_note') : '';
	return { text: t('ctg.dialog.selected', [count, meshNote, tex]), ok: true };
}

/** 刷新零件状态行 */
function renderStatus(state: PartState, root: HTMLElement | null): void {
	if (!root) return;
	for (const which of ['left', 'right', 'tie', 'portal_track', 'portal_mip'] as (PartName | 'portal_track' | 'portal_mip')[]) {
		const el = root.querySelector(`[data-status="${which}"]`);
		if (!el) continue;
		const info = statusInfo(state, which);
		el.textContent = info.text;
		el.classList.toggle('ctg-status-ok', info.ok);
	}
}

/** 创建零件来源动作（更新 state 并触发状态行刷新） */
function createPartActions(state: PartState, onChange: () => void): PartActions {
	const setPart = (which: PartName, part: PartModel) => {
		if (which === 'left') state.left = part;
		else if (which === 'tie') state.tie = part;
		else {
			state.right = part;
			state.rightMode = part ? 'file' : 'none';
		}
		onChange();
	};

	return {
		async importPart(which) {
			const files = await pickBbModels();
			if (!files || files.length === 0) return;
			const file = files[0];
			try {
				const part = parseImportedBbModel(file);
				setPart(which, part);
				Blockbench.showQuickMessage(t('ctg.dialog.part_imported', [partLabel(which), file.name]));
			} catch (e: any) {
				Blockbench.showMessageBox({
					title: t('ctg.dialog.import_failed'),
					message: t('ctg.dialog.import_failed_msg', [file.name, e?.message ?? String(e)]),
					buttons: [t('ctg.ok')],
					confirm: 0,
				});
			}
		},
		async pickTab(which) {
			try {
				const proj = await pickTabProject();
				if (!proj) return;
				const part = extractSelectedPart(proj);
				setPart(which, part);
				const count = part.cubes.length + (part.meshes?.length ?? 0);
				Blockbench.showQuickMessage(
					t('ctg.dialog.part_extracted', [partLabel(which), (proj as any).name || t('ctg.dialog.unnamed'), count])
				);
			} catch (e: any) {
				Blockbench.showMessageBox({
					title: t('ctg.dialog.extract_failed'),
					message: e?.message ?? String(e),
					buttons: [t('ctg.ok')],
					confirm: 0,
				});
			}
		},
		async mirrorRight() {
			if (!state.left) {
				Blockbench.showMessageBox({
					title: t('ctg.dialog.need_left'),
					message: t('ctg.dialog.need_left_msg'),
					buttons: [t('ctg.ok')],
					confirm: 0,
				});
				return;
			}
			state.right = null;
			state.rightMode = 'mirror';
			onChange();
		},
		async importPortalTrack() {
			const tex = await pickPortalTrackTexture();
			if (!tex) {
				Blockbench.showQuickMessage(t('ctg.dialog.portal.track_not_imported'));
				return;
			}
			state.portalTrack = tex;
			onChange();
			Blockbench.showQuickMessage(t('ctg.dialog.portal.track_imported', tex.name));
		},
		async importPortalMip() {
			const tex = await pickPortalMipTexture();
			if (!tex) {
				Blockbench.showQuickMessage(t('ctg.dialog.portal.mip_not_imported'));
				return;
			}
			state.portalMip = tex;
			onChange();
			Blockbench.showQuickMessage(t('ctg.dialog.portal.mip_imported', tex.name));
		},
	};
}

/** 给零件行的按钮绑定来源动作 */
function wireButtons(root: HTMLElement, actions: PartActions): void {
	root.querySelectorAll('button[data-act]').forEach((btn) => {
		btn.addEventListener('click', () => {
			const act = btn.getAttribute('data-act');
			const which = btn.getAttribute('data-which') as PartName;
			if (act === 'file') void actions.importPart(which);
			else if (act === 'tab') void actions.pickTab(which);
			else if (act === 'mirror') void actions.mirrorRight();
			else if (act === 'portal_track') void actions.importPortalTrack();
			else if (act === 'portal_mip') void actions.importPortalMip();
		});
	});
}

/** 显示用舍入：最多保留 digits 位小数并去掉多余的 0（22.9600000 → 22.96） */
function roundDisplay(n: number, digits = 4): number {
	return Number(n.toFixed(digits));
}

/**
 * 轨距三字段（px / 毫米 / 英寸）互换算：在任意一个输入框按回车，
 * 以该输入值为准，自动更新其余两个输入框的显示值（px 为生成使用的基准）。
 * Blockbench 数字/文本表单字段的 input 元素 id 即表单键名（input#gauge 等）。
 * 注意拦截 Enter 冒泡，避免触发对话框的默认提交行为。
 */
function wireGaugeConversion(root: HTMLElement): void {
	const pxEl = root.querySelector<HTMLInputElement>('input#gauge');
	const mmEl = root.querySelector<HTMLInputElement>('input#gauge_mm');
	const inchEl = root.querySelector<HTMLInputElement>('input#gauge_inch');
	if (!pxEl || !mmEl || !inchEl) return;

	// 以某个输入框的当前值换算并回填三个字段
	const sync = (toPx: (v: number) => number, source: HTMLInputElement) => {
		const v = parseFloat(source.value);
		if (!Number.isFinite(v) || v <= 0) return;
		const px = toPx(v);
		pxEl.value = String(roundDisplay(px));
		mmEl.value = String(roundDisplay(pxToMM(px)));
		inchEl.value = String(roundDisplay(pxToInch(px)));
	};

	const bindEnter = (input: HTMLInputElement, toPx: (v: number) => number) => {
		input.addEventListener('keydown', (ev) => {
			if (ev.key !== 'Enter') return;
			sync(toPx, input);
			ev.preventDefault();
			ev.stopPropagation();
		});
	};

	bindEnter(pxEl, (v) => v);
	bindEnter(mmEl, (v) => mmToPx(v));
	bindEnter(inchEl, (v) => inchToPx(v));
}

/** 零件纹理分辨率的展示文本 */
function textureLabel(part: PartModel): string {
	if (!part.textureSize) return t('ctg.dialog.no_texture');
	return `${part.textureSize[0]} × ${part.textureSize[1]} px`;
}

/**
 * 由对话框状态 + 表单数值构建生成结果。
 * 统一在此处给三份零件加纹理前缀（L / R / T），右轨为 mirror 时用 mirrorPartYz 派生。
 * 返回 { output } 或 { error }（错误时对话框保持打开）。
 */
function buildOutput(
	state: PartState,
	values: { gauge: number; height: number; yoffset: number; name: string }
): { output: GenerateOutput } | { error: string } {
	const { gauge, height, yoffset, name } = values;
	if (!state.left) return { error: t('ctg.error.need_left') };
	if (state.rightMode !== 'mirror' && !state.right) {
		return { error: t('ctg.error.need_right') };
	}
	if (!state.tie) return { error: t('ctg.error.need_tie') };
	if (!Number.isFinite(gauge) || gauge <= 0) return { error: t('ctg.error.gauge_positive') };
	if (!Number.isFinite(height) || height < 0) return { error: t('ctg.error.height_nonneg') };
	if (!Number.isFinite(yoffset)) return { error: t('ctg.error.yoffset_number') };
	if (!name) return { error: t('ctg.error.need_name') };

	// 右轨 = 左轨沿其中心 YZ 平面的镜像（右轨复用左轨的源纹理，只是采样方向翻转）
	const left = scopeTextureKeys(state.left, 'L');
	const right =
		state.rightMode === 'mirror'
			? scopeTextureKeys(mirrorPartYz(state.left), 'R')
			: scopeTextureKeys(state.right!, 'R');
	const tie = scopeTextureKeys(state.tie, 'T');

	// 三份零件纹理分辨率须一致，否则拒绝生成
	const textureSize = consistentTextureSize([left, right, tie]);
	if (!textureSize) {
		return {
			error: t('ctg.error.texture_mismatch', [textureLabel(left), textureLabel(right), textureLabel(tie)]),
		};
	}

	// 传送门纹理：各自可选，加 'P' 前缀；track 铺轨道/枕木，mip 贴覆层块
	const portalTextures: SourceTexture[] = [];
	const portal: PortalConfig = {};
	if (state.portalTrack) {
		const t = { ...state.portalTrack, key: 'P/track' };
		portalTextures.push(t);
		portal.trackTexture = t.key;
	}
	if (state.portalMip) {
		const t = { ...state.portalMip, key: 'P/mip' };
		portalTextures.push(t);
		portal.mipTexture = t.key;
		portal.mipTextureSize = [t.width, t.height];
	}

	const config: TrackConfig = { gaugePx: gauge, heightPx: height, wholeModelYOffset: yoffset, parts: { left, right, tie } };
	if (Object.keys(portal).length) config.portal = portal;
	const shapes = allShapes(config);
	try {
		const allTextures = [left, right, tie].flatMap((p) => p.textures ?? []).concat(portalTextures);
		// 工作区格式：任一零件含 mesh 组 → 自由模型（generic）；否则 Java 方块/物品模型
		const targetFormat = targetFormatForParts([left, right, tie], (Project as any).format?.id);
		const textureByKey = createTrackWorkspace(targetFormat, name, textureSize, allTextures);
		return { output: { config, shapes, textureByKey } };
	} catch (e: any) {
		return { error: t('ctg.error.workspace_create', e?.message ?? String(e)) };
	}
}

/**
 * 完整生成流程入口（单页对话框）。返回生成结果，失败/取消返回 null。
 * 用户在对话框里填好所有输入后点「确定」，onConfirm 里同步建工作区并 resolve。
 */
export function runGenerateWizard(): Promise<GenerateOutput | null> {
	return new Promise((resolve) => {
		const state: PartState = { left: null, right: null, rightMode: 'none', tie: null, portalTrack: null, portalMip: null };
		let settled = false;
		const finish = (out: GenerateOutput | null) => {
			if (settled) return;
			settled = true;
			resolve(out);
		};

		let dialogNode: HTMLElement | null = null;
		const actions = createPartActions(state, () => renderStatus(state, dialogNode));

		const config = {
			id: 'create-track-gen-dialog',
			title: t('ctg.dialog.title'),
			icon: 'train',
			width: 700,
			buttons: [t('ctg.ok'), t('ctg.cancel')],
			confirmIndex: 0,
			cancelIndex: 1,
			// lines 在前（左列零件），form 在后（右列参数）；.dialog_content 用 grid 排成两列
			part_order: ['lines', 'form'],
			lines: [buildLeftColumn()],
			form: {
				gauge: { label: t('ctg.form.gauge'), type: 'number', value: DEFAULT_GAUGE_PX, min: 0.1, step: 0.1, description: t('ctg.form.gauge.desc') },
				gauge_mm: { label: t('ctg.form.gauge_mm'), type: 'number', value: roundDisplay(pxToMM(DEFAULT_GAUGE_PX)), min: 0.1, step: 0.5, description: t('ctg.form.gauge_mm.desc') },
				gauge_inch: { label: t('ctg.form.gauge_inch'), type: 'number', value: roundDisplay(pxToInch(DEFAULT_GAUGE_PX)), min: 0.01, step: 0.1, description: t('ctg.form.gauge_inch.desc') },
				height: { label: t('ctg.form.height'), type: 'number', value: 2, min: 0, step: 0.5, description: t('ctg.form.height.desc') },
				yoffset: { label: t('ctg.form.yoffset'), type: 'number', value: 0, step: 0.5, description: t('ctg.form.yoffset.desc') },
				name: { label: t('ctg.form.name'), type: 'text', value: 'track', description: t('ctg.form.name.desc') },
			},
			onBuild(node?: HTMLElement) {
				if (!node) return;
				dialogNode = node;
				wireButtons(node, actions);
				wireGaugeConversion(node);
				renderStatus(state, node);
			},
			onConfirm(formResult: any) {
				const result = buildOutput(state, {
					gauge: Number(formResult.gauge),
					height: Number(formResult.height),
					yoffset: Number(formResult.yoffset),
					name: String(formResult.name ?? '').trim(),
				});
				if ('error' in result) {
					Blockbench.showMessageBox({ title: t('ctg.form.config_error'), message: result.error, buttons: [t('ctg.ok')], confirm: 0 });
					return false; // 保持对话框打开，让用户修改后重试
				}
				finish(result.output);
				return undefined; // 允许对话框关闭
			},
			onCancel() {
				finish(null);
			},
			onClose() {
				finish(null);
			},
		} as DialogOptions & { _driver?: ConfigDriver };

		// 冒烟测试钩子：直接驱动零件来源动作 + 读取状态（真实 Blockbench 不依赖它）
		config._driver = { actions, getState: () => state };

		injectDialogStyles();
		const dialog = new Dialog(config);
		dialog.show();
	});
}
