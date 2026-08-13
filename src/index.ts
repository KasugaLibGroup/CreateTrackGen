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
import { buildAllShapes, buildBaseParts } from './build/assembly';
import { DEFAULT_FIT, formatFit, gaugeMMToScale, mmToInch, pxToMM, scaleForPx } from './logic/gauge';

/** onload 中创建的 Action，onunload 时必须删除 */
const knownActions: Action[] = [];

/** 主生成 Action：收集输入并生成全部形状 */
let generateAction: Action | undefined;

/** MenuBar.menus 类型较宽松，做一次收窄断言 */
const toolsMenu = (MenuBar.menus as Record<string, Menu>).tools;

registerPlugin('create_track_gen', {
	title: '机械动力轨道生成器',
	author: 'Your Name',
	description: '自动生成机械动力（Create Mod）的轨道模型组',
	about:
		'「工具」→「机械动力轨道生成」：\n' +
		'1. 单页配置中一次提供 左轨 / 右轨 / 枕木 三个零件（导入 .bbmodel，或「选择一个标签页」从当前打开的标签页中提取选中的元素）\n' +
		'2. 右轨可直接选择零件，也可「从第一个模型对称」——把左轨沿其中心 YZ 平面镜像生成\n' +
		'3. 输入轨距（px，1/16 方块，Create 默认 1600mm ≈ 25.6px，左右钢轨中心距）、轨道高度与整体 Y 偏移、新工作区名称\n' +
		'4. 可选分别导入两张传送门纹理：portal_track 铺轨道/枕木（缺省用零件默认纹理）；portal_track_mip 生成左右覆层块（teleport_left / teleport_right，包裹枕木半边、贴 mip、不含钢轨，缺省不生成）；两者都缺省时 teleport 与 z_ortho / x_ortho 一致\n' +
		'5. 自动生成 16 种轨道形状（新工作区），并应用原模型的纹理；另生成 tie / segment_left / segment_right 三个弯道渲染基础分组\n' +
		'6. 任一零件含 mesh 组（bbmodel 的 mesh 组）时新工作区为自由模型，否则为 Java 方块/物品模型；三个零件的纹理分辨率须一致，否则拒绝生成\n\n' +
		'「工具」→「轨距换算」：输入轨距(mm)，输出 Create 弯道比例常数。\n' +
		'  锚点：1435mm→0.755, 1600mm→0.965, 1000mm→0.525（二次拟合）',
	icon: 'train',
	version: '0.2.0',
	variant: 'both',
	tags: ['Minecraft: Java Edition'],
	onload() {
		injectDialogStyles();
		// 主生成
		generateAction = new Action('create_track_gen.generate', {
			name: '机械动力轨道生成',
			description: '单页配置三个零件（右轨可镜像）与参数，生成全部机械动力轨道形状 + 弯道基础分组',
			icon: 'train',
			click: async () => {
				const result = await runGenerateWizard();
				if (!result) {
					Blockbench.showQuickMessage('已取消');
					return;
				}
				try {
					Undo.initEdit({ outliner: true });
					const group = buildAllShapes(result.shapes, result.textureByKey);
					// 弯道渲染基础分组：tie / segment_left / segment_right（Create 曲线渲染用）
					buildBaseParts(result.config.parts, result.config, result.textureByKey);
					Undo.finishEdit('生成机械动力轨道', { outliner: true });
					Canvas.updateView({ selection: true });
					const hasMesh = [result.config.parts.left, result.config.parts.right, result.config.parts.tie].some((p) => p.hasMesh);
					const meshNote = hasMesh
						? '（含 mesh 组的零件仅生成基础分组，mesh 元素不参与轨道形状）'
						: '';
					Blockbench.showToastNotification({
						text: `已生成 ${result.shapes.length} 种轨道形状 + tie/segment_left/segment_right 基础分组 → 新工作区「${Project.name}」${meshNote}`,
						icon: 'train',
						color: '#7cb342',
					});
					// 展示轨距换算结果
					const mm = pxToMM(result.config.gaugePx);
					const yOff = result.config.wholeModelYOffset ?? 0;
					Blockbench.showMessageBox({
						title: '轨距换算结果',
						message:
							`轨距 ${result.config.gaugePx}px ≈ ${mm.toFixed(1)}mm ≈ ${mmToInch(mm).toFixed(2)}in，整体 Y 偏移 ${yOff}px\n\n` +
							`Create 弯道比例常数 = ${scaleForPx(result.config.gaugePx).toFixed(4)}\n\n` +
							`拟合公式：${formatFit(DEFAULT_FIT)}\n` +
							`锚点：1435mm→${gaugeMMToScale(1435).toFixed(3)}, ` +
							`1600mm→${gaugeMMToScale(1600).toFixed(3)}, ` +
							`1000mm→${gaugeMMToScale(1000).toFixed(3)}`,
						buttons: ['确定'],
						confirm: 0,
					});
				} catch (e: any) {
					Undo.cancelEdit();
					Blockbench.showMessageBox({
						title: '生成失败',
						message: e?.message ?? String(e),
						buttons: ['确定'],
						confirm: 0,
					});
				}
			},
		});
		toolsMenu?.addAction(generateAction);
		knownActions.push(generateAction);

		// 轨距换算独立入口
		const gaugeAction = new Action('create_track_gen.gauge', {
			name: '轨距换算',
			description: '输入轨距(mm)，输出 Create 弯道比例常数',
			icon: 'straighten',
			click: () => {
				Blockbench.textPrompt(
					'输入轨距（mm）',
					'1600',
					(mmText) => {
						const mm = parseFloat(mmText);
						if (Number.isNaN(mm)) {
							Blockbench.showQuickMessage('输入无效');
							return;
						}
						Blockbench.showMessageBox({
							title: '轨距换算结果',
							message:
								`${mm}mm 轨距\n\n` +
								`Create 弯道比例常数 = ${gaugeMMToScale(mm).toFixed(4)}\n\n` +
								`拟合公式：${formatFit(DEFAULT_FIT)}`,
							buttons: ['确定'],
							confirm: 0,
						});
					},
					{ description: '锚点：1435→0.755, 1600→0.965, 1000→0.525' }
				);
			},
		});
		toolsMenu?.addAction(gaugeAction);
		knownActions.push(gaugeAction);
	},
	onunload() {
		for (const action of knownActions) {
			action.delete();
		}
		knownActions.length = 0;
		disposeDialogStyles();
	},
});
