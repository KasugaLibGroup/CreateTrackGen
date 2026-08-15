/**
 * Type-safe Blockbench plugin registration wrapper.
 *
 * Background: blockbench-types exports the Plugin class with `register` as a module export (only
 * `BBPlugin` is declared in the global scope), while lib.dom declares a legacy global `Plugin`
 * (navigator.plugins-related). The conflict makes it impossible to call the global `Plugin.register`
 * directly. This module wraps it once: it imports the official type via `import type` (erased at
 * compile time, so it doesn't affect the esbuild bundle) and forwards to the runtime global Plugin.
 */
import type { Plugin as PluginClass } from 'blockbench-types/generated/plugin_loader';

/** The config type passed to Plugin.register (PluginOptions isn't exported from that module; extracted via Parameters) */
type PluginOptions = Parameters<typeof PluginClass.register>[1];

/**
 * Registers the plugin. The id must match the final plugin file name
 * (create_track_gen.js → 'create_track_gen').
 */
export function registerPlugin(id: string, options: PluginOptions): PluginClass {
	return (Plugin as any).register(id, options) as PluginClass;
}
