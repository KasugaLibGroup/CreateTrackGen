/**
 * Internationalization — translation data comes from JSON files on disk (lang/en.json,
 * lang/zh.json) rather than being hardcoded in TS.
 *
 * Loading:
 *  - at build time esbuild bundles lang/*.json into the plugin (built-in defaults, so the single file
 *    works standalone);
 *  - at runtime onload calls `loadTranslationsFromDisk(pluginPath)` to re-read the JSON from the
 *    plugin directory's lang/ subfolder, overriding the built-in defaults (edit lang/*.json directly,
 *    no rebuild needed).
 *  - if there's no path / the lang directory is missing / reading fails, the built-in defaults are
 *    kept, so it never crashes.
 *
 * Usage:
 *  - all UI text goes through `t('ctg.xxx.yyy', [placeholder0, placeholder1], fallback?)`.
 *  - placeholders use Blockbench's `%0 / %1 …` (0-based, matching Language's tl semantics).
 *  - registration: this module calls `registerTranslations()` at its top level (in esbuild's
 *    dependency evaluation order, before any module that calls `t()`), writing the dictionaries into
 *    Blockbench's Language data.
 *
 * Environment compatibility:
 *  - in Blockbench, `t()` uses the global `tl` (current language data + English fallback).
 *  - in Node tests / the logic layer without Blockbench globals, `t()` falls back to the English
 *    dictionary (also replacing %N), so the pure logic (logic/) is independently unit-testable and
 *    its display names have a deterministic language.
 */
import enJson from '../lang/en.json';
import zhJson from '../lang/zh.json';

/** Single translation: key → text (with %0/%1… placeholders) */
type TranslationDict = Record<string, string>;

/** All plugin text (built-in defaults = bundled lang/*.json); overridable at runtime from disk JSON */
const TRANSLATIONS: Record<'en' | 'zh', TranslationDict> = { en: enJson, zh: zhJson };

/** Current language code (English when Node has no Language global; other languages fall back to English) */
function currentLang(): 'en' | 'zh' {
	const code = typeof Language !== 'undefined' ? Language.code : 'en';
	return code === 'zh' ? 'zh' : 'en';
}

/**
 * Translate: in Blockbench it uses the global `tl` (current language data + %N placeholder
 * replacement, English fallback); in Node / the logic layer without `tl` it falls back to the English
 * dictionary (also replacing %N), keeping the pure logic unit-testable.
 */
export function t(key: string, vars?: string | number | (string | number)[], def?: string): string {
	if (typeof tl === 'function') {
		return tl(key, vars as any, def ?? key);
	}
	const table: TranslationDict = currentLang() === 'zh' ? TRANSLATIONS.zh : TRANSLATIONS.en;
	let out = table[key] ?? def ?? key;
	if (vars) {
		const arr = Array.isArray(vars) ? vars : [vars];
		// Placeholders %0/%1/… (0-based), matching Blockbench's tl semantics: %0→arr[0], %1→arr[1]…
		for (let i = arr.length - 1; i >= 0; i--) {
			out = out.replace(new RegExp('%' + i, 'g'), String(arr[i]));
		}
	}
	return out;
}

/**
 * Writes the plugin dictionaries into Blockbench's Language data (`addTranslations` merges by current
 * language and always keeps the en fallback). Imported by every module that uses `t()`; by dependency
 * evaluation order this top-level call runs before any `t()` executes. Safely skipped in Node without
 * a Language global.
 */
export function registerTranslations(): void {
	if (typeof Language === 'undefined') return;
	Language.addTranslations('en', TRANSLATIONS.en);
	Language.addTranslations('zh', TRANSLATIONS.zh);
}

// Top-level registration: the module registers as soon as it is evaluated (see module comment)
registerTranslations();

/**
 * Blockbench evaluates plugin scripts via `new Function("requireNativeModule","require",code)`,
 * injecting the scoped require as local params `requireNativeModule` (and `require`). Using
 * `requireNativeModule` matters because esbuild renames the free identifier `require` to `__require`
 * (undefined), while `requireNativeModule` is preserved as-is. Type-declared here; guarded with
 * typeof when absent on web.
 */
declare const requireNativeModule: ((id: string, options?: Record<string, unknown>) => any) | undefined;

/**
 * At runtime, reads lang/en.json and lang/zh.json from the plugin directory, overriding the built-in
 * defaults and re-registering. pluginPath is the plugin file path (passed in from index.ts onload via
 * `Plugins.registered[id].path`). Keeps the built-in defaults (bundled into the artifact) when there's
 * no path / files are missing / reading fails, so the single file still works.
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
		// lang directory missing or read failed: keep the built-in defaults
	}
}

/** The return type of a scoped require (fs and other Node modules) */
type ScopedRequire = (id: string, options?: Record<string, unknown>) => any;
