# Create Track Gen — 机械动力轨道生成插件

[![Title](/plugin_title.png)]()

[![Wiki](https://img.shields.io/badge/CTG-百科-red)](https://github.com/KasugaLibGroup/CreateTrackGen/wiki)
[![MIT License](https://img.shields.io/badge/License-MIT-blue)](./LICENSE)
[![README ZH-CN](https://img.shields.io/badge/Readme-English-green)](./README.md)
[![BlockBench](https://img.shields.io/badge/Blockbench-Model-yellow)](https://www.blockbench.net/wiki/docs/plugin/)

Blockbench 插件：根据玩家提供的 **左轨 / 右轨 / 枕木** 三个零件模型，输入轨距、轨道高度与整体 Y 偏移，
自动生成符合机械动力（Create Mod）轨道规范的 **9 种形状**（直轨 / 45° 斜轨 / 上升 / 传送门 / 4 种交叉；`z_ortho` / `ascending_n/e/w` / `teleport_x` / `cross_d1_zo` / `cross_d2_zo` 不单独生成，方向由 blockstates 的 `y` 旋转表达），
并把玩家输入的轨距换算成 Create 用于计算弯道的**比例常数**（二次拟合曲线）。
可选分别导入两张传送门纹理（`portal_track.png` / `portal_track_mip.png`）：`portal_track` 铺轨道/枕木（缺省用零件默认纹理）；`portal_track_mip` 生成左右两个覆层块 `teleport_left` / `teleport_right` 把枕木左/右半边包住（不包含钢轨）并贴 mip（缺省不生成）。两者都缺省时传送门轨道与 `z_ortho` / `x_ortho` 一致（结构参照 Create 原版 `teleport.json`）。

## 功能

- **生成轨道模型组**：`工具 → 机械动力轨道生成`
  - 依次提供 左轨 / 右轨 / 枕木 三个零件（从磁盘导入 `.bbmodel`，或「选择一个标签页」从当前打开的标签页里提取已选中的元素）
  - 三个零件的**纹理分辨率必须一致**，否则拒绝生成
  - 输入轨距（px，1/16 方块，Create 默认 1600mm ≈ 25.6px，支持毫米/英寸换算）、轨道高度（px）与整个模型的 Y 偏移（px，默认 0）
  - 可选分别点击「导入 portal_track…」与「导入 portal_track_mip…」：`portal_track` 铺 `teleport` / `teleport_x` 的轨道/枕木（缺省用零件默认纹理）；`portal_track_mip` 生成左右两个覆层块（`teleport_left` / `teleport_right`，包裹枕木左/右半边、不含钢轨）并贴 mip（缺省不生成）
  - 指定新工作区名称（默认 `track`）；结果自动生成到**新建的独立工作区**（模型选项卡），并把三个零件的纹理导入、应用到对应组；**轨道大组名 = 该工作区名**（默认 `track`），导出时按当前工作区名查找
  - 自动生成 9 种形状：`x_ortho / diag / diag_2 / ascending_south / teleport / cross_ortho / cross_diag / cross_d1_xo / cross_d2_xo`（只生成 blockstates 引用的模型；`z_ortho` → `x_ortho` 旋转 90°、上升/传送门其余方向 → `y` 旋转、`cross_d1_zo` / `cross_d2_zo` → `cross_d1_xo` / `cross_d2_xo` 旋转 90°；`cross_d1_xo` = 负对角 + Z 直轨、`cross_d2_xo` = 正对角 + Z 直轨，与参考 Kuayue 命名相反）
  - **上升轨道**：与斜轨一样 3 段钢轨 / 3 根枕木（长度 24px），绕中心 -45° 倾斜后整体抬升，**在轨道高度与整体 Y 偏移两个用户可定义偏移生效之后**，最低的枕木角仍恰好落在 xz 平面（y≥0）——整体偏移为负时也会把上升轨顶回平面
  - **弯道渲染基础分组**：`tie` / `segment_left` / `segment_right` 三个分组（Create 曲线渲染用的三个模型）**与各方向轨道形状一起挂在轨道大组下**（大组名 = 工作区名），各含对应零件（cube + mesh 组），并排成**轨道单元布局**：两条钢轨各自以自身模型中心为轴、中心 x 坐标归零（Java 模型中心的 (8,8) / 其他格式的 (0,0) 都平移到 x=0，同 Create 的 segment_left/right.obj），近 z 端靠在 xy 平面（z=0），钢轨底面抬升到 轨道高度 + 整体 Y 偏移；枕木移到 z_ortho 中靠近 x 轴的第一个枕木位置（z=4），仅加整体 Y 偏移（不抬升）。钢轨之间的 ±轨距/2 间距由 Create 在渲染时摆放
  - **工作区格式自动判定**：任一零件含 mesh 组（`.bbmodel` 的 `type:"mesh"` 元素）→ 新工作区为**自由模型**（generic）；否则为 **Java 方块/物品模型**
- **导出轨道模型**：`工具 → 导出轨道模型`，**4 种导出模式**（对话框下拉选择）；**若当前工作区是自由模型（generic），导出模式被锁定为「全部导出为 OBJ」**——自由模型以原点为中心的几何无法用 Java / 基岩版方块格式表达，对话框会禁用模式选择并提示
  - **1.21.11+ 新 Java**（`format_version: "1.21.11"`，元素旋转支持多轴 `{x,y,z}`）
  - **1.21.11- 经典 Java**（不加 `format_version`，完全匹配 assets 示例；元素仅单轴旋转 `{angle,axis}`）
  - **基岩版方块模型**（每形状一个 `minecraft:geometry` + `blocks.json`）
  - **全部导出为 OBJ**
  - 把当前工作区「机械动力轨道」大组下的各分组，按所选模式导出 + **blockstates** + 纹理 PNG，写到用户指定文件夹
  - 模型：`models/block/track/{轨道id}/{形状}.json`（`x_ortho / diag / diag_2 / ascending / teleport / cross_ortho / cross_diag / cross_d1_xo / cross_d2_xo / tie / segment_left / segment_right`，共 12 个；`z_ortho` 由 `x_ortho` 旋转 90° 表达、`cross_d1_zo` / `cross_d2_zo` 由 `cross_d1_xo` / `cross_d2_xo` 旋转表达；`ascending` 只导出南向变体、`teleport` 只导出 Z 向，其余方向由 blockstates 的 `y` 旋转表达，与 Create/Kuayue 一致）
  - blockstates：`blockstates/{轨道id}_track.json`（MC 要求直接罗列在 `blockstates/` 下；shape × turn × waterlogged 共 76 个变体，模型引用 `{命名空间}:block/track/{轨道id}/…`；`shape=zo → x_ortho y:90`，`cr_pdx → cross_d1_xo y:90`、`cr_pdz → cross_d2_xo y:180`、`cr_ndx → cross_d2_xo y:270`、`cr_ndz → cross_d1_xo`，与参考 Kuayue meter/guard blockstates 一致）
  - 纹理：`textures/block/track/{轨道id}/{资源名}.png`（按源纹理文件名去重导出；基岩版模式写 `textures/blocks/{轨道id}/`）
  - 导出时弹出配置对话框：**导出模式**（默认经典 Java）+ **命名空间**（默认 `kuayue`）+ **轨道 id**（默认工作区名）；随后选目标文件夹（首次访问会请求「文件夹访问」权限）
  - 导出完成后弹出**加宽的汇总对话框**（640px）：汇总信息 + 每条警告/提示各自独立的显示框，文字完整显示
  - **能否导出的判定条件**（无法导出 → 自动回退 OBJ）：

    | 元素/形状 | 新 Java | 经典 Java | 基岩版 | OBJ |
    | --- | --- | --- | --- | --- |
    | 立方体（单轴旋转） | ✓ | ✓ | ✓ | ✓ |
    | 立方体（多轴旋转） | ✓（`{x,y,z}`） | ✗→OBJ | ✓ | ✓ |
    | mesh 组（三角面） | ✗→OBJ | ✗→OBJ | ✗→OBJ | ✓ |
    | 形状引用多张纹理 | ✓ | ✓ | ✗→OBJ | ✓ |

    （例如 `ascending` 的 `[-45, yaw, 0]` 多轴旋转在经典模式回退 OBJ，与 Create 原版一致。）
  - **OBJ 导出**：把分组内所有体块 / 网格烘焙为**单一合并网格**（单一 `o` 对象、位于根下、无 `o`/`g` 分组），以便 Forge 加载器整体读取；坐标为方块单位（px/16），vt 翻底，纹理经 `usemtl m_<key>` + MTL `map_Kd {命名空间}:block/track/{轨道id}/{资源名}` 绑定；模型 JSON 为 `forge:obj` 引用（`flip_v: true`）
- **轨距换算**：`工具 → 轨距换算`，输入 mm 输出 Create 弯道比例常数
  - 锚点：1435mm→0.755、1600mm→0.965、1000mm→0.525（二次多项式拟合）
- **生成示例零件**：`工具 → 生成示例钢轨` / `生成示例枕木`，在当前工作区摆放一个示例长方体（钢轨 2.4×2.8×8、枕木 32×4×3.5，居中于当前格式对称点），尺寸参考 `test/sample_parts/` 的部件，可作零件使用或仅作尺寸参考

## 技术栈

| 组件 | 说明 |
| --- | --- |
| TypeScript | 源码语言，`src/` 目录 |
| esbuild | 打包器，把多模块源码打包成单个插件 `.js` 文件 + 单测用 CJS 产物 |
| blockbench-types | Blockbench API 官方类型，提供自动补全 + 类型检查 |

## 目录结构

```
create_track_gen/
├── docs/                  # ★ 接口文档（中文 / English 两版，docs/zh + docs/en）
├── src/
│   ├── index.ts           # 插件入口：Plugin.register + 菜单 + Undo 事务 + onunload 清理
│   ├── plugin_api.ts      # Plugin.register 的类型安全封装
│   ├── i18n.ts            # 国际化：t() + registerTranslations + loadTranslationsFromDisk
│   ├── logic/             # ★ 纯逻辑层（零 Blockbench 依赖，Node 可单测）
│   │   ├── types.ts       # CubeSpec / ShapeSpec / TrackConfig 纯类型
│   │   ├── gauge.ts       # 轨距二次拟合 + mm↔px↔inch 换算
│   │   ├── parts.ts       # .bbmodel 解析 + 归一化（底面 y=0、中线 x=0）
│   │   ├── transform.ts   # 平移 / 抬升 / 绕 Y/X 旋转（纯函数）
│   │   ├── generator.ts   # 9 种形状组装（核心）
│   │   └── export.ts      # 导出约定（Create 命名映射 + blockstates，纯逻辑）
│   ├── build/
│   │   ├── assembly.ts    # CubeSpec[] → 真实 Cube/Group（唯一依赖 Blockbench 树）
│   │   ├── workspace.ts   # 新建工作区 + 导入零件纹理（newProject / Texture）
│   │   └── export.ts      # 导出轨道模型（分组 → Minecraft JSON + blockstates + 纹理 PNG）
│   └── ui/
│       ├── import.ts      # 磁盘导入 .bbmodel / 选择一个标签页提取选中元素
│       ├── dialog.ts      # 单页配置对话框（零件来源 + 参数 + 传送门纹理）
│       └── gauge.ts       # 轨距换算对话框
├── build.mjs              # esbuild 打包（插件 IIFE + logic CJS 次产物）
├── create_track_gen.js    # 构建产物，拖进 Blockbench 即可加载
├── README.md              # 中文说明
├── README.en.md           # English readme
├── test/
│   ├── logic.test.js      # 纯逻辑单测（轨距/解析/变换/组装）
│   ├── smoke.js           # 冒烟测试（桩 Blockbench API 跑产物）
│   └── sample_parts/      # 示例零件（left_rail/right_rail/tie .bbmodel）
└── package.json
```

## 开发流程

```bash
npm install          # 首次安装依赖
npm run dev          # 类型检查 + 构建一次
npm run typecheck    # 仅类型检查
npm run build        # 构建
npm run watch        # 监听 src/ 变化，自动重建 create_track_gen.js
npm test             # typecheck + build + logic 单测 + smoke 冒烟
```

## 在 Blockbench 中测试

### 第 1 步：构建插件

```bash
npm run build
```

确保项目根目录出现 `create_track_gen.js`。

### 第 2 步：加载插件

1. 打开 **Blockbench**（桌面版，建议 5.x）。
2. 新建一个 Java Block 项目：`文件 → 新建 → Java Block/Item`。
3. 把 `create_track_gen.js` 拖进 Blockbench 窗口（或 `文件 → 打开 → 插件` 选择该文件）。
4. 菜单栏应出现 `工具` 菜单，其下有 **「机械动力轨道生成」** 和 **「轨距换算」**。

> 重载插件：修改源码重新 `npm run build` 后，在 Blockbench 按 **Ctrl/Cmd + J**。

### 第 3 步：准备零件（二选一）

**方式 A：导入示例零件（推荐，直接跑通）**

使用 `test/sample_parts/` 下的三个文件：`left_rail.bbmodel`、`right_rail.bbmodel`、`tie.bbmodel`。

**方式 B：用你自己的零件**

三个零件必须满足：
- 均为 Java Block 格式（`.bbmodel`）
- 底面在 xz 平面（y=0）
- 左轨 / 右轨 / 枕木 各是一个模型文件（或当前项目里选中的一组元素）

**对称点规定**（归一化基准，按模型格式自动判断）：
- **Java Block / Item**（`java_block` / `java_item`）：对称点为 xz 平面的 **(8, 8)** —— 因为该模式画布是 0..16，原点在角上，模型中心在 (8,8)。零件可以在 0..16 画布内做大，不受"关于零点对称"的尺寸限制。
- **其他格式**（generic / free 等）：对称点为 xz 平面的 **(0, 0)** —— 原点即画布中心。

插件归一化时会把对称点平移到原点，再把左右轨按轨距 ±g/2 摆放，因此零件本身是否精确居中不影响最终结果。

**轨距的度量方式**：`gaugePx` 是**左右钢轨中心之间的距离**（Create 默认标称轨距 1600mm，按「1 格方块 = 1 米 = 16px」换算为 **25.6px**）。因此钢轨零件的宽度应当明显小于轨距，否则两条钢轨会贴在一起。Create 官方的 `segment_left.obj` / `segment_right.obj`（宽约 2.4px、高约 4.5px）配合默认轨距 25.6px 即可得到正确的 25.6px 中心距轨道。

**轨道长度**：默认生成一个完整方块（16px）。钢轨零件长度不足时会沿铺设方向自动平铺补齐（Create 的钢轨段是 8px 的半块段，一个方块需要两块）。枕木按间距沿整条轨道铺设，不会再因为钢轨零件过短而消失。

**纹理一致性**：左轨 / 右轨 / 枕木三个零件的纹理分辨率（图片像素尺寸）必须完全一致，否则会弹出「纹理分辨率不一致」并拒绝生成。生成时会把三个零件的纹理自动导入新工作区，并应用到对应元素的面（左轨贴左轨纹理、右轨贴右轨纹理、枕木贴枕木纹理）。

**mesh 组**：零件可以是纯 cube（Java 方块模型），也可以含 mesh 组（如从 Create 的 `.obj` 导入的模型）。任一零件含 mesh 组时，新工作区为**自由模型**；mesh 组被搬进 `tie` / `segment_left` / `segment_right` 基础分组（不参与 9 种轨道形状的组装，那些形状仍由 cube 部分生成）。插件会把 mesh 的 origin（世界锚点）与 rotation 烘焙进顶点，因此带非零 origin 的 mesh（如 Java 模型的 origin (8,8,8)）也能正确定位到 x=0。

### 第 4 步：运行生成

1. 点击 `工具 → 机械动力轨道生成`。
2. 依次按提示选择「左轨」「右轨」「枕木」的来源：
   - 选 **导入文件** → 弹出文件框 → 选对应 `.bbmodel`
   - 或选 **选择一个标签页…** → 从当前打开的标签页列表里选一个，插件提取该标签页中已选中的元素作为零件（先在目标标签页里 outliner 框选该零件的全部元素）
3. 输入 **轨距**（px，示例用 25.6 ≈ 1600mm）、**轨道高度**（px，示例用 2）与 **整个模型的 Y 偏移**（px，示例用 0）。毫米/英寸字段输入后回车可自动换算回 px。
4. 输入 **新工作区名称**（示例用「机械动力轨道」）。生成结果会放入这个**新建的工作区**（模型选项卡），不污染当前工作区；工作区纹理分辨率自动设为零件纹理的尺寸。
5. 等待生成完成，新工作区的 outliner 出现父分组 **「机械动力轨道」**，内含 9 个子分组，各组的立方体已贴上对应零件纹理；另有两个顶层分组 **`segment_left` / `segment_right` / `tie`**（弯道渲染基础模型）。
6. 新工作区的模型格式由零件决定：**任一零件含 mesh 组 → 自由模型**；否则为 **Java Block/Item 模型**（mesh 组无法存在于 Java 模型，只能放进自由模型）。

### 第 5 步：验证结果

- **直轨**：展开 `z_ortho` 分组，左右钢轨中心距应 = 轨距（默认 25.6px）。
- **斜轨**：`diag` 分组的元素带 45° Y 旋转（选中元素看右侧属性面板的旋转）。
- **上升**：`ascending_*` 分组的元素带 -45° X 旋转，枢轴在方块中心（Java 画布 xz (8,8)）；3 根枕木，绕中心倾斜后整体抬升，轨道高度与整体 Y 偏移生效后最低的枕木角仍落在 xz 平面（y≥0）。
- **弯道基础分组**：工作区顶层有 `segment_left` / `segment_right` / `tie` 三个分组，分别对应左轨 / 右轨 / 枕木零件（Create 曲线渲染用）。左/右轨道各自以自身中心为轴（中心 x 归零）、近 z 端在 z=0、底面在 轨道高度 + Y 偏移；枕木在 z=4（第一个枕木位置）、底面仅 +Y 偏移。
- **纹理**：左轨 / 右轨 / 枕木元素应分别贴有自己的纹理（纹理列表里有导入的零件贴图，UV 编辑器可查看）。
- **传送门/交叉**：`teleport*` 分组含直轨（导入 `portal_track` 则铺它，否则用零件默认纹理）+ 左右两个覆层块 `teleport_left` / `teleport_right`（导入 `portal_track_mip` 才生成，包裹枕木半边、贴 mip、不含钢轨）；都未导入时与 `z_ortho` / `x_ortho` 一致。`cross_*` 分组含交叉元素。
- **轨距换算**：`工具 → 轨距换算`，输入 1435 → 应得 ≈0.755；输入 1600 → ≈0.965。

## 官方文档

- [Blockbench 插件开发指南](https://www.blockbench.net/wiki/docs/plugin/)
- [Blockbench API 参考](https://web.blockbench.net/docs)
