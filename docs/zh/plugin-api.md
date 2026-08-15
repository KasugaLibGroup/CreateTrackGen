# `src/plugin_api.ts` — 类型安全的插件注册

类型安全的 Blockbench 插件注册包装。

背景：blockbench-types 把带 register 的 `Plugin` 类作为模块导出（全局作用域里只声明了 `BBPlugin`），
而 lib.dom 又声明了一个遗留的全局 `Plugin`（navigator.plugins 相关），二者冲突导致无法直接调用全局
`Plugin.register`。这里集中封装一次：用 `import type` 引用官方类型（编译期擦除，不影响 esbuild 打包），
内部转交运行时全局 Plugin。

## `registerPlugin(id, options)`

注册插件。id 必须与最终插件文件名一致（`create_track_gen.js` → `'create_track_gen'`）。

```ts
export function registerPlugin(id: string, options: PluginOptions): PluginClass;
```

参数：

- `id` — 插件 id，必须与打包产物文件名一致（不含 `.js`）。
- `options` — `Plugin.register` 的配置参数（PluginOptions 未从该模块导出，用 `Parameters` 提取）。

返回：注册后的 `Plugin` 实例。
