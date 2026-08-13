/**
 * 常量与配置 —— 轨距换算基准、生成默认参数。
 * 注意：本文件目前不被 src/ 引用（换算逻辑见 src/logic/gauge.ts），仅作文档性常量备份。
 */

/** 轨距比例常数锚点（用户实测于机械动力游戏内） */
export const GAUGE_ANCHOR_MM = [
	{ gaugeMM: 1435, scale: 0.755 }, // 标准轨
	{ gaugeMM: 1600, scale: 0.965 }, // 机械动力默认轨
	{ gaugeMM: 1000, scale: 0.525 }, // 米轨
] as const;

/** Create 默认轨道标称轨距（mm） */
export const DEFAULT_GAUGE_MM = 1600;

/** Create 默认轨距对应的模型 px（1600mm → 25.6px，1 格方块 = 1 米 = 1000mm = 16px） */
export const DEFAULT_GAUGE_PX = 25.6;

/** 默认轨道高度（px，1/16 方块） */
export const DEFAULT_HEIGHT_PX = 2;

/** 默认枕木间距（px） */
export const DEFAULT_TIE_INTERVAL = 8;
