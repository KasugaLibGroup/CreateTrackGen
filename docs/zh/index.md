# create_track_gen 接口文档（中文版）

Blockbench 插件，根据 **左轨 / 右轨 / 枕木** 三个零件模型与轨距、轨道高度、整体 Y 偏移等参数，
自动生成符合机械动力（Create Mod）轨道规范的 9 种轨道形状，并支持 4 种模式导出。

本文档只覆盖 **源码导出的 API**（类型、常量、函数），不包含使用说明（见根目录 `../../README.zh-cn.md`）。

## 分层结构

| 层 | 目录 | 说明 |
| --- | --- | --- |
| 纯逻辑层 | `src/logic/` | 零 Blockbench 依赖的纯函数与类型，可在 Node 中单测 |
| 组装层 | `src/build/` | 把逻辑层产物转成 Blockbench 真实的 Cube / Group / 文件 |
| UI 层 | `src/ui/` | 对话框与零件导入（依赖 Blockbench 全局 API） |
| 基础设施 | `src/plugin_api.ts`、`src/i18n.ts`、`src/index.ts` | 插件注册、国际化、入口 |

## 文档索引

### 纯逻辑层 `src/logic/`

- [types.ts — 纯类型定义](logic-types.md)
- [gauge.ts — 轨距换算](logic-gauge.md)
- [parts.ts — 零件解析与归一化](logic-parts.md)
- [transform.ts — 几何变换](logic-transform.md)
- [generator.ts — 轨道形状组装](logic-generator.md)
- [export.ts — 导出约定与序列化](logic-export.md)

### 组装层 `src/build/`

- [assembly.ts — CubeSpec → Cube/Group](build-assembly.md)
- [workspace.ts — 新建工作区与纹理导入](build-workspace.md)
- [export.ts — 导出轨道模型](build-export.md)

### UI 层 `src/ui/`

- [import.ts — 零件获取（导入/提取）](ui-import.md)
- [dialog.ts — 生成配置对话框](ui-dialog.md)
- [gauge.ts — 轨距换算对话框](ui-gauge.md)

### 基础设施

- [plugin_api.ts — 类型安全插件注册](plugin-api.md)
- [i18n.ts — 国际化](i18n.md)

## 数据流概览

```
零件（.bbmodel / 标签页选中元素）
      │  ui/import.ts
      ▼
PartModel ──(归一化)──► src/logic/parts.ts
      │
      │  src/logic/transform.ts（平移/旋转/镜像/烘焙）
      │  src/logic/generator.ts（9 种形状组装）
      ▼
ShapeSpec[] / TrackConfig
      │  src/logic/export.ts（命名映射 + blockstates + 序列化）
      │  src/build/export.ts（写盘）
      ▼
Minecraft 模型 JSON / OBJ / 基岩版 geometry + blockstates + 纹理 PNG
```
