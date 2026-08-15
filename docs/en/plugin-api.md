# `src/plugin_api.ts` — Type-safe plugin registration

A type-safe wrapper around Blockbench plugin registration.

Background: blockbench-types exports the `Plugin` class with `register` as a module export (only
`BBPlugin` is declared in the global scope), while lib.dom declares a legacy global `Plugin`
(navigator.plugins-related). The conflict makes it impossible to call the global `Plugin.register`
directly. This module wraps it once: it imports the official type via `import type` (erased at compile
time, so it doesn't affect the esbuild bundle) and forwards to the runtime global Plugin internally.

## `registerPlugin(id, options)`

Registers the plugin. The id must match the final plugin file name
(`create_track_gen.js` → `'create_track_gen'`).

```ts
export function registerPlugin(id: string, options: PluginOptions): PluginClass;
```

Parameters:

- `id` — plugin id; must match the bundled file name (without `.js`).
- `options` — the config passed to `Plugin.register` (`PluginOptions` isn't exported from that module,
  so it's extracted via `Parameters`).

Returns: the registered `Plugin` instance.
