/**
 * 国际化 —— 翻译数据来自文件系统上的 JSON（lang/en.json、lang/zh.json），
 * 不再硬编码在 TS 代码块里。
 *
 * 加载方式：
 *  - 构建时 esbuild 把 lang/*.json 打包进插件（内置默认，保证单文件可独立使用）；
 *  - 运行时 onload 调用 `loadTranslationsFromDisk(pluginPath)`，从插件所在目录的
 *    lang/ 子文件夹重新读取 JSON 覆盖内置默认（直接改 lang/*.json 即可，无需重新构建）。
 *  - 无路径 / lang 目录缺失 / 读取失败时保持内置默认，保证不崩。
 *
 * 用法：
 *  - 所有界面文字一律用 `t('ctg.xxx.yyy', [占位0, 占位1], 兜底值?)` 查译。
 *  - 占位符用 Blockbench 的 `%0 / %1 …`（0 基，与 Language 的 tl 语义一致）。
 *  - 注册：本模块顶层调用 `registerTranslations()`（在 esbuild 依赖求值顺序中，
 *    早于任何调用 `t()` 的模块），把词典写入 Blockbench 的 Language 数据。
 *
 * 环境兼容：
 *  - Blockbench 运行时走全局 `tl`（当前语言数据 + 英文兜底）。
 *  - Node 单测 / 逻辑层无 Blockbench 全局时，`t()` 回退英文词典（同样替换 %N），
 *    保证纯逻辑（logic/）可独立单测，且 logic 内的展示名有确定语言。
 */
import enJson from '../lang/en.json';
import zhJson from '../lang/zh.json';

/** 单条翻译：key → 文案（%0/%1… 占位符） */
export type TranslationDict = Record<string, string>;

/** 全部插件文案（内置默认 = 打包的 lang/*.json）；运行时可按磁盘 JSON 覆盖 */
export const TRANSLATIONS: Record<'en' | 'zh', TranslationDict> = { en: enJson, zh: zhJson };

/** 当前语言 code（Node 无 Language 全局时按英文处理；其他语言回退英文） */
function currentLang(): 'en' | 'zh' {
	const code = typeof Language !== 'undefined' ? Language.code : 'en';
	return code === 'zh' ? 'zh' : 'en';
}

/**
 * 翻译：Blockbench 运行时走全局 `tl`（当前语言数据 + %N 占位替换，英文兜底）；
 * Node / 逻辑层无 `tl` 时回退英文词典（同样替换 %N），保证纯逻辑可单测。
 */
export function t(key: string, vars?: string | number | (string | number)[], def?: string): string {
	if (typeof tl === 'function') {
		return tl(key, vars as any, def ?? key);
	}
	const table: TranslationDict = currentLang() === 'zh' ? TRANSLATIONS.zh : TRANSLATIONS.en;
	let out = table[key] ?? def ?? key;
	if (vars) {
		const arr = Array.isArray(vars) ? vars : [vars];
		// 占位符 %0/%1/…（0 基），与 Blockbench 的 tl 语义一致：%0→arr[0]、%1→arr[1]…
		for (let i = arr.length - 1; i >= 0; i--) {
			out = out.replace(new RegExp('%' + i, 'g'), String(arr[i]));
		}
	}
	return out;
}

/**
 * 把插件词典写入 Blockbench 的 Language 数据（`addTranslations` 会按当前语言合并，
 * 并始终保留 en 兜底）。本模块被所有用 `t()` 的模块 import，按依赖求值顺序，
 * 这里的顶层调用早于任何 `t()` 的执行。Node 环境无 Language 全局时安全跳过。
 */
export function registerTranslations(): void {
	if (typeof Language === 'undefined') return;
	Language.addTranslations('en', TRANSLATIONS.en);
	Language.addTranslations('zh', TRANSLATIONS.zh);
}

// 顶层注册：确保模块被求值即完成注册（见模块注释）
registerTranslations();

/**
 * Blockbench 加载插件脚本用 `new Function("requireNativeModule","require",code)` 求值，
 * scoped require 以局部参数 `requireNativeModule`（与 `require`）注入插件作用域。
 * 用 `requireNativeModule` 是因为 esbuild 会把自由标识符 `require` 改名为 `__require`
 * （undefined），而 `requireNativeModule` 原样保留。这里做类型声明；Web 端不存在时 typeof 守卫兜底。
 */
declare const requireNativeModule: ((id: string, options?: Record<string, unknown>) => any) | undefined;

/**
 * 运行时从插件所在目录读取 lang/en.json、lang/zh.json，覆盖内置默认并重新注册。
 * pluginPath 为插件文件路径（index.ts onload 经 `Plugins.registered[id].path` 传入）。
 * 无路径 / 文件缺失 / 读取失败时保持内置默认（打包进产物的 JSON），保证单文件也能用。
 */
export function loadTranslationsFromDisk(pluginPath?: string): void {
	if (typeof pluginPath !== 'string' || !pluginPath) return;
	const norm = pluginPath.replace(/[\\/]+$/, '');
	const folder = norm.slice(0, Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\')));
	if (!folder) return;
	const g = globalThis as { require?: unknown };
	const load =
		typeof requireNativeModule === 'function'
			? requireNativeModule
			: typeof g.require === 'function'
				? (g.require as ScopedRequire)
				: undefined;
	if (typeof load !== 'function') return;
	try {
		const fs = load('fs', { scope: folder });
		if (!fs || typeof fs.readFileSync !== 'function') return;
		const read = (name: string): TranslationDict => JSON.parse(fs.readFileSync(`${folder}/lang/${name}`, 'utf8'));
		const en = read('en.json');
		const zh = read('zh.json');
		TRANSLATIONS.en = en;
		TRANSLATIONS.zh = zh;
		registerTranslations();
	} catch {
		// lang 目录缺失或读取失败：保持内置默认
	}
}

/** scoped require 的返回（fs 等 Node 模块） */
type ScopedRequire = (id: string, options?: Record<string, unknown>) => any;
