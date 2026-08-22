# Create Track Gen — 机械动力轨道生成插件

[![Title](/plugin_title.png)]()

[![Wiki](https://img.shields.io/badge/CTG-百科-red)](https://github.com/KasugaLibGroup/CreateTrackGen/wiki)
[![MIT License](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)
[![README EN](https://img.shields.io/badge/Readme-English-green)](./README.md)
[![BlockBench](https://img.shields.io/badge/Blockbench-Model-yellow)](https://www.blockbench.net/wiki/docs/plugin/)

Blockbench 插件：根据玩家提供的 **左轨 / 右轨 / 枕木** 三个零件模型，输入轨距、轨道高度与整体 Y 偏移，
自动生成符合机械动力（Create Mod）轨道规范的 **11 种形状**（`x_ortho / diag / diag_2 / ascending_south /
teleport / cross_ortho / cross_diag / cross_d1_xo / cross_d2_xo / cross_d1_zo / cross_d2_zo`；其余方向由
blockstates 的 `y` 旋转表达）+ `tie` / `segment_left` / `segment_right` 三个弯道渲染基础分组，并把轨距
换算成 Create 用于计算弯道的**比例常数**（二次拟合）。可选导入两张传送门纹理：`portal_track` 铺传送门
轨道/枕木，`portal_track_mip` 生成左右覆层块 `teleport_left` / `teleport_right`。

## 功能

- **机械动力轨道生成**（`工具 → 机械动力轨道生成`）：依次提供三个零件（导入 `.bbmodel`，或「选择一个
  标签页」提取已选中元素；右轨也可从「左轨」镜像生成），输入轨距（px，Create 默认 1600mm ≈ 25.6px，
  支持毫米/英寸换算）、轨道高度、整体 Y 偏移与新工作区名称，自动生成到**新建的独立工作区**（轨道大组名 =
  工作区名）。三个零件纹理分辨率必须一致；任一零件含 mesh 组 → 新工作区为**自由模型**，否则为 Java
  方块/物品模型。
- **导出轨道模型**（`工具 → 导出轨道模型`）：把当前工作区的轨道大组导出为模型 + blockstates + 纹理 PNG，
  **4 种模式**——1.21.11+ 新 Java / 1.21.11- 经典 Java / 基岩版方块 / **全部导出为 OBJ**（单一合并网格）。
  无法用该模式表达的形状自动回退 OBJ；自由模型工作区锁定为 OBJ。
- **轨距换算**（`工具 → 轨距换算`）：英寸 / 毫米 / 像素联动换算，并输出 Create 弯道比例常数
  （锚点：1435mm→0.755、1600mm→0.965、1000mm→0.525）。
- **生成示例钢轨 / 枕木**（`工具 → …`）：在当前工作区摆放示例长方体（钢轨 2.4×2.8×8、枕木 32×4×3.5），
  可作生成零件或尺寸参考。

## 在 Blockbench 中安装与测试

1. `npm run build`，然后把 `create_track_gen.js` 拖进 Blockbench（或 `文件 → 打开 → 插件`）。
2. 菜单栏出现 `工具` 菜单，其下有**机械动力轨道生成**与**轨距换算**。
3. 使用 `test/sample_parts/` 下的示例零件（`test_rail.bbmodel` / `test_tie.bbmodel`）或自己的零件
   （Java Block 格式，底面在 xz 平面 y=0）。
4. 运行 `工具 → 机械动力轨道生成`，填入零件 + 轨距（示例用 25.6）+ 新工作区名称，结果出现在该新工作区。

> 重新构建后，在 Blockbench 中按 **Ctrl/Cmd + J** 重载插件。

## 技术栈

| 组件 | 说明 |
| --- | --- |
| TypeScript | 源码语言，`src/` 目录 |
| esbuild | 把多模块源码打包成单个插件 `.js` + 单测用 CJS 产物 |
| blockbench-types | Blockbench API 官方类型（自动补全 + 类型检查） |

## 目录结构

```
create_track_gen/
├── src/
│   ├── index.ts           # 插件入口：Plugin.register + 菜单 + Undo + onunload
│   ├── plugin_api.ts      # Plugin.register 的类型安全封装
│   ├── i18n.ts            # t() + registerTranslations + loadTranslationsFromDisk
│   ├── logic/             # ★ 纯逻辑层（零 Blockbench 依赖，Node 可单测）
│   │   ├── types.ts       # 纯类型：CubeSpec / ShapeSpec / TrackConfig
│   │   ├── gauge.ts       # 轨距二次拟合 + mm↔px↔inch 换算
│   │   ├── parts.ts       # .bbmodel 解析 + 归一化（底面 y=0、中线 x=0）
│   │   ├── transform.ts   # 平移 / 抬升 / 旋转 / 镜像（纯函数）
│   │   ├── generator.ts   # 11 种形状组装（核心）
│   │   └── export.ts      # 导出约定（Create 命名 + blockstates）
│   ├── build/             # 逻辑产物 → Blockbench 真实对象
│   │   ├── assembly.ts    # CubeSpec[] → Cube/Group
│   │   ├── workspace.ts   # 新建工作区 + 导入零件纹理
│   │   └── export.ts      # 导出轨道模型（JSON + blockstates + PNG）
│   └── ui/                # 对话框
│       ├── import.ts      # .bbmodel 导入 / 标签页提取元素
│       ├── dialog.ts      # 生成配置对话框
│       └── gauge.ts       # 轨距换算对话框
├── build.mjs              # esbuild 打包
├── create_track_gen.js    # 构建产物（拖进 Blockbench 加载）
├── lang/                  # en.json / zh.json — 国际化，可直接改无需重建
├── test/                  # 逻辑单测 + 冒烟测试 + 示例零件
├── README.md / README.zh-cn.md
└── package.json
```

## 开发流程

```bash
npm install          # 首次安装依赖
npm run dev          # 类型检查 + 构建
npm run typecheck    # 仅类型检查
npm run build        # 构建
npm run watch        # 监听 src/ 变化，自动重建
npm test             # typecheck + build + 单测 + 冒烟测试
```

## 文档

- [Wiki](https://github.com/KasugaLibGroup/CreateTrackGen/wiki) — 工具使用指南 + 源码接口文档（英文 / 中文）
- [Blockbench 插件开发指南](https://www.blockbench.net/wiki/docs/plugin/)
- [Blockbench API 参考](https://web.blockbench.net/docs)
