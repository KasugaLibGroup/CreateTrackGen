/**
 * 纯类型定义 —— 逻辑层与 Blockbench 之间的解耦枢纽。
 * 本模块零依赖，可在 Node 中直接单测。
 */

/** 三维向量 */
export type Vec3 = [number, number, number];

/** 方块面方向 */
export type CubeFaceDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

/**
 * 源纹理：从 .bbmodel 或当前项目提取的纹理，用于导入到新工作区并应用到对应面。
 * key 是源模型内的唯一标识（.bbmodel 的 texture id，或当前项目的纹理 UUID），
 * 生成时由 CubeSpec 面的 texture 字段引用，assembly 层据此映射到新工作区里导入的 Texture。
 */
export interface SourceTexture {
	/** 源模型内的唯一键 */
	key: string;
	name: string;
	/** 位图数据：base64 data URL 或桌面文件路径 */
	source: string;
	width: number;
	height: number;
}

/** 面 UV 描述（透传给 Blockbench CubeFace） */
export interface FaceSpec {
	uv?: [number, number, number, number];
	rotation?: number;
	/** 源纹理 key（见 SourceTexture），由 assembly 层映射到导入的 Texture */
	texture?: string;
}

/**
 * 立方体的平台无关描述。
 * 与 Blockbench 的 ICubeOptions.from/to/rotation/origin/faces 一一对应。
 * from/to 为盒子两个对角（px），rotation 为绕 origin 的三轴旋转角（度）。
 */
export interface CubeSpec {
	name?: string;
	from: Vec3;
	to: Vec3;
	rotation?: Vec3;
	origin?: Vec3;
	faces?: Partial<Record<CubeFaceDirection, FaceSpec>>;
}

/**
 * 网格元素（mesh 组）的面：引用一组顶点 id，附 UV 与源纹理 key。
 * uv 直接透传 .bbmodel / Blockbench 的原始结构（mesh 面的 uv 是顶点 UV 列表，
 * 数组或对象均可），创建 Mesh 时原样交还 Blockbench 解释。
 */
export interface MeshFaceSpec {
	/** 组成该面的顶点 id 列表（按逆时针顺序） */
	vertices: string[];
	/** 顶点 UV（透传，不做任何修改） */
	uv?: number[] | Record<string, any>;
	rotation?: number;
	/** 源纹理 key（见 SourceTexture），由 assembly 层映射到导入的 Texture */
	texture?: string;
}

/**
 * 网格元素（mesh 组）：顶点 id → 位置，面 id → 面。
 * .bbmodel 中 type 为 'mesh' 的元素（区别于 'cube' 的体块组）。
 */
export interface MeshSpec {
	name?: string;
	vertices: Record<string, Vec3>;
	faces: Record<string, MeshFaceSpec>;
	origin?: Vec3;
	rotation?: Vec3;
}

/**
 * 零件模型：从 .bbmodel 或当前项目解析出的元素集合。
 * 归一化约定：底面 y = 0，轨道横向中线 x = 0。
 * cubes 为体块元素（用于生成轨道形状），meshes 为网格元素（mesh 组，
 * 仅用于工作区里的基础分组，不参与轨道形状生成）。
 */
export interface PartModel {
	cubes: CubeSpec[];
	/** mesh 元素（type='mesh'），有则说明该零件含网格组 */
	meshes?: MeshSpec[];
	/** 零件是否含 mesh 组（决定新工作区是否为自由模型） */
	hasMesh?: boolean;
	/** 归一化后的包围盒（含 cube 与 mesh 顶点） */
	bbox: {
		min: Vec3;
		max: Vec3;
	};
	/** 横向中线 x 值（归一化后通常为 0） */
	xMid: number;
	/** 纹理分辨率 [w, h]（px）。三个零件必须一致，否则拒绝生成 */
	textureSize?: [number, number];
	/** 零件引用的全部源纹理 */
	textures?: SourceTexture[];
}

/**
 * 传送门配置（可选）：两张纹理独立可选。
 *  - trackTexture（portal_track）提供时，teleport 形状把轨道/枕木铺这个纹理；
 *    缺省则用零件自身的默认纹理。
 *  - mipTexture（portal_track_mip）提供时，生成两个覆层块（teleport_left / teleport_right）
 *    把枕木左/右半边包住（不包含钢轨）并贴这个纹理；缺省则不生成覆层块。
 * 结构参考 Create 原版 teleport.json —— 整个模型铺 portal_track，两个覆层（左 cube5 / 右 cube6）贴 mip。
 */
export interface PortalConfig {
	/** portal_track 纹理源 key（已带前缀，如 'P/track'）；缺省则不重映射，轨道/枕木用默认纹理 */
	trackTexture?: string;
	/** portal_track_mip 纹理源 key（已带前缀，如 'P/mip'）；缺省则不生成覆层块 */
	mipTexture?: string;
	/** 覆层（mip）纹理尺寸 [w, h]（px），用于覆层面 UV 铺满（缺省 32×32） */
	mipTextureSize?: [number, number];
	/** 覆层相对枕木外缘的包覆余量（px，避免与枕木共面闪烁），缺省 0.1 */
	margin?: number;
}

/** 一种轨道形状的生成结果 */
export interface ShapeSpec {
	/** TrackShape 标识，如 'x_ortho'、'diag'、'ascending_south' */
	id: string;
	/** 展示名（Group 名） */
	name: string;
	cubes: CubeSpec[];
}

/** 生成轨道所需的全部输入 */
export interface TrackConfig {
	/** 轨距（px，1/16 方块）＝左右钢轨中心距 */
	gaugePx: number;
	/** 轨道距模型底面的高度（px，1/16 方块） */
	heightPx: number;
	/** 整个模型（含枕木与轨道）的 y 偏移（px），默认 0 */
	wholeModelYOffset?: number;
	parts: {
		left: PartModel;
		right: PartModel;
		tie: PartModel;
	};
	/** 传送门配置（可选）：两张纹理独立可选，见 PortalConfig */
	portal?: PortalConfig;
}
