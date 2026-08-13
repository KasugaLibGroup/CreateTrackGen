// build.mjs — 将 src/ 中的 TypeScript 源码打包成单个 Blockbench 插件文件
//
//   npm run build   一次构建
//   npm run watch   监听 src/ 变化并自动重建（配合 Blockbench 的 Ctrl/Cmd+J 重载使用）
//
// 产物为项目根目录下的 create_track_gen.js，插件 ID 必须与文件名一致（见 src/index.ts）。
// Blockbench 的全局对象（Plugin / Cube / Action 等）由 Blockbench 运行时注入，不需要打包。

import { build, context } from 'esbuild';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));

const isWatch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/index.ts'],
  outfile: 'create_track_gen.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  logLevel: 'info',
  banner: {
    js: `/*!
 * ${pkg.name} v${pkg.version} — 机械动力（Create Mod）轨道模型自动生成插件
 * 本文件为构建产物，请勿手动编辑。源码在 src/，运行 npm run build 重新生成。
 */
`,
  },
};

// 纯逻辑层（logic/）额外打包成 CJS，供 Node 单测直接 require
const logicOptions = {
  entryPoints: ['src/logic/index.ts'],
  outfile: 'logic_bundle.cjs',
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: ['es2022'],
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('👀 监听中… 修改 src/ 后会自动重建 create_track_gen.js');
  console.log('   在 Blockbench 中按 Ctrl/Cmd+J 重载插件');
} else {
  await build(options);
  await build(logicOptions);
  console.log('✅ 构建完成 → create_track_gen.js + logic_bundle.cjs');
}
