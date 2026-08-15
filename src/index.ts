/**
 * 机械动力轨道生成器 —— 插件入口。
 *
 * 插件 ID 必须与打包产物的文件名一致：create_track_gen.js
 * 加载方式：把项目根目录下的 create_track_gen.js 拖进 Blockbench，或用 Ctrl/Cmd+J 重载。
 *
 * 功能：
 *  - 「工具」菜单 →「机械动力轨道生成」→ 单页配置对话框收集 左轨/右轨/枕木 零件 + 轨距 + 高度，
 *    右轨可从左轨镜像生成，完成后生成符合 Create 轨道规范的 16 种形状。
 *  - 轨距换算：把玩家输入的轨距换算成 Create 弯道比例常数（二次拟合曲线）。
 */
import { registerPlugin } from './plugin_api';
import { runGenerateWizard, injectDialogStyles, disposeDialogStyles } from './ui/dialog';
import { runGaugeConverter, disposeGaugeStyles } from './ui/gauge';
import { buildAllShapes, buildBaseParts } from './build/assembly';
import { runTrackExport, injectExportStyles, disposeExportStyles } from './build/export';
import { t, loadTranslationsFromDisk } from './i18n';
import { DEFAULT_FIT, formatFit, gaugeMMToScale, mmToInch, pxToMM, scaleForPx } from './logic/gauge';

/** onload 中创建的 Action，onunload 时必须删除 */
const knownActions: Action[] = [];

/** 主生成 Action：收集输入并生成全部形状 */
let generateAction: Action | undefined;

/** MenuBar.menus 类型较宽松，做一次收窄断言 */
const toolsMenu = (MenuBar.menus as Record<string, Menu>).tools;

registerPlugin('create_track_gen', {
	title: t('ctg.plugin.title'),
	author: 'Kuayue Team',
	description: t('ctg.plugin.description'),
	about: t('ctg.plugin.about'),
	icon: 'train',
	version: '0.2.0',
	variant: 'both',
	tags: ['Minecraft: Java Edition'],
	onload() {
		// 优先读取插件目录下 lang/*.json（改翻译无需重新构建）；缺失时用内置默认
		loadTranslationsFromDisk((globalThis as any).Plugins?.registered?.['create_track_gen']?.path);
		injectDialogStyles();
		injectExportStyles();
		// 主生成
		generateAction = new Action('create_track_gen.generate', {
			name: t('ctg.action.generate.name'),
			description: t('ctg.action.generate.desc'),
			icon: 'train',
			click: async () => {
				const result = await runGenerateWizard();
				if (!result) {
					Blockbench.showQuickMessage(t('ctg.cancelled'));
					return;
				}
				try {
					Undo.initEdit({ outliner: true });
					const group = buildAllShapes(result.shapes, result.textureByKey);
					// 弯道渲染基础分组：tie / segment_left / segment_right（Create 曲线渲染用），
					// 挂到轨道大组 group 下，与各方向轨道形状并列
					buildBaseParts(group, result.config.parts, result.config, result.textureByKey);
					Undo.finishEdit(t('ctg.undo.generate'), { outliner: true });
					Canvas.updateView({ selection: true });
					const hasMesh = [result.config.parts.left, result.config.parts.right, result.config.parts.tie].some((p) => p.hasMesh);
					const meshNote = hasMesh ? t('ctg.generate.mesh_note') : '';
					Blockbench.showToastNotification({
						text: t('ctg.generate.done_toast', [result.shapes.length, Project.name, meshNote]),
						icon: 'train',
						color: '#7cb342',
					});
					// 展示轨距换算结果
					const mm = pxToMM(result.config.gaugePx);
					const yOff = result.config.wholeModelYOffset ?? 0;
					Blockbench.showMessageBox({
						title: t('ctg.gauge.generate_title'),
						message: t('ctg.gauge.generate_msg', [
							result.config.gaugePx,
							mm.toFixed(1),
							mmToInch(mm).toFixed(2),
							yOff,
							scaleForPx(result.config.gaugePx).toFixed(4),
							formatFit(DEFAULT_FIT),
							gaugeMMToScale(1435).toFixed(3),
							gaugeMMToScale(1600).toFixed(3),
							gaugeMMToScale(1000).toFixed(3),
						]),
						buttons: [t('ctg.ok')],
						confirm: 0,
					});
				} catch (e: any) {
					Undo.cancelEdit();
					Blockbench.showMessageBox({
						title: t('ctg.generate.failed'),
						message: e?.message ?? String(e),
						buttons: [t('ctg.ok')],
						confirm: 0,
					});
				}
			},
		});
		toolsMenu?.addAction(generateAction);
		knownActions.push(generateAction);

		// 轨距换算独立入口：英寸/毫米/像素 + 只读输出值联动对话框
		const gaugeAction = new Action('create_track_gen.gauge', {
			name: t('ctg.action.gauge.name'),
			description: t('ctg.action.gauge.desc'),
			icon: 'straighten',
			click: () => {
				runGaugeConverter();
			},
		});
		toolsMenu?.addAction(gaugeAction);
		knownActions.push(gaugeAction);

		// 导出轨道模型：把当前工作区「机械动力轨道」大组按 Create 命名规范写出 + blockstates
		const exportAction = new Action('create_track_gen.export', {
			name: t('ctg.action.export.name'),
			description: t('ctg.action.export.desc'),
			icon: 'save',
			click: () => {
				void runTrackExport();
			},
		});
		toolsMenu?.addAction(exportAction);
		knownActions.push(exportAction);
	},
	onunload() {
		for (const action of knownActions) {
			action.delete();
		}
		knownActions.length = 0;
		disposeDialogStyles();
		disposeExportStyles();
		disposeGaugeStyles();
	},
});
