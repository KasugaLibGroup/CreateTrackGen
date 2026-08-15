/**
 * Create track generator — plugin entry point.
 *
 * The plugin id must match the bundled artifact's file name: create_track_gen.js
 * Loading: drag the project root's create_track_gen.js into Blockbench, or reload with Ctrl/Cmd+J.
 *
 * Features:
 *  - "Tools" → "Generate Create Tracks" → single-page config dialog collecting the left rail / right
 *    rail / tie parts + gauge + height; the right rail can be mirrored from the left; on completion it
 *    generates the 16 Create-spec track shapes.
 *  - Track gauge converter: converts a player-entered gauge into Create's curve scale constant
 *    (quadratic fit).
 */
import { registerPlugin } from './plugin_api';
import { runGenerateWizard, injectDialogStyles, disposeDialogStyles } from './ui/dialog';
import { runGaugeConverter, disposeGaugeStyles } from './ui/gauge';
import { buildAllShapes, buildBaseParts } from './build/assembly';
import { runTrackExport, injectExportStyles, disposeExportStyles } from './build/export';
import { t, loadTranslationsFromDisk } from './i18n';
import { DEFAULT_FIT, formatFit, gaugeMMToScale, mmToInch, pxToMM, scaleForPx } from './logic/gauge';

/** Actions created in onload must be deleted in onunload */
const knownActions: Action[] = [];

/** The main generate Action: collects input and generates all shapes */
let generateAction: Action | undefined;

/** MenuBar.menus is loosely typed; narrow it with one assertion */
const toolsMenu = (MenuBar.menus as Record<string, Menu>).tools;

registerPlugin('create_track_gen', {
	title: t('ctg.plugin.title'),
	author: 'KasugaLib Group',
	description: t('ctg.plugin.description'),
	about: t('ctg.plugin.about'),
	icon: 'icon.png',
	version: '0.2.0',
	variant: 'both',
	tags: ['Minecraft: Java Edition', 'Exporter', 'Utility'],
	onload() {
		// Prefer reading lang/*.json from the plugin directory (translation edits need no rebuild);
		// falls back to the built-in defaults when missing
		loadTranslationsFromDisk((globalThis as any).Plugins?.registered?.['create_track_gen']?.path);
		injectDialogStyles();
		injectExportStyles();
		// Main generate
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
					// Curve-rendering base groups: tie / segment_left / segment_right (Create's curve
					// rendering), attached under the track parent group alongside the directional shapes
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
					// Show the gauge conversion result
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

		// Standalone gauge converter: inch/mm/px inputs with a read-only linked output dialog
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

		// Export track models: writes the current workspace's track parent group per Create naming +
		// blockstates
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
