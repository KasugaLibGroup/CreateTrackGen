/**
 * Pure type definitions — the decoupling hub between the logic layer and Blockbench.
 * Zero dependencies; directly unit-testable in Node.
 */

/** A 3D vector. */
export type Vec3 = [number, number, number];

/** A block-face direction. */
export type CubeFaceDirection = 'north' | 'south' | 'east' | 'west' | 'up' | 'down';

/**
 * A source texture extracted from a .bbmodel or the current project, to be imported into the new
 * workspace and applied to the corresponding faces. key is a unique id inside the source model
 * (the .bbmodel texture id, or the current project's texture UUID); face texture references in
 * CubeSpec use this key, which the assembly layer maps to the imported Texture.
 */
export interface SourceTexture {
	/** Unique key within the source model */
	key: string;
	name: string;
	/** Bitmap data: base64 data URL or desktop file path */
	source: string;
	width: number;
	height: number;
}

/** Face UV description (passed through to the Blockbench CubeFace) */
export interface FaceSpec {
	uv?: [number, number, number, number];
	rotation?: number;
	/** Source texture key (see SourceTexture), resolved by the assembly layer to the imported Texture */
	texture?: string;
}

/**
 * A platform-independent cube description, mirroring Blockbench's ICubeOptions
 * from/to/rotation/origin/faces. from/to are the box's two opposite corners (px); rotation is the
 * 3-axis rotation about origin (degrees).
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
 * A mesh-group face: a list of vertex ids plus UV and the source texture key.
 * uv is passed straight through from the .bbmodel / Blockbench raw structure (per-vertex UV list,
 * array or object) and handed back to Blockbench unchanged when the Mesh is created.
 */
export interface MeshFaceSpec {
	/** Vertex ids forming the face (counter-clockwise) */
	vertices: string[];
	/** Per-vertex UV (passthrough, unmodified) */
	uv?: number[] | Record<string, any>;
	rotation?: number;
	/** Source texture key (see SourceTexture), resolved by the assembly layer to the imported Texture */
	texture?: string;
}

/**
 * A mesh-group element: vertex id → position, face id → face.
 * .bbmodel elements with type 'mesh' (as opposed to 'cube' volume groups).
 */
export interface MeshSpec {
	name?: string;
	vertices: Record<string, Vec3>;
	faces: Record<string, MeshFaceSpec>;
	origin?: Vec3;
	rotation?: Vec3;
}

/**
 * A part model: the element collection parsed from a .bbmodel or the current project.
 * Normalization contract: bottom face y = 0, track lateral centerline x = 0.
 * cubes are the volume elements (used to build track shapes); meshes are mesh-group elements
 * (used only for the workspace's base groups, not for track shapes).
 */
export interface PartModel {
	cubes: CubeSpec[];
	/** Mesh elements (type='mesh'); present when the part contains mesh groups */
	meshes?: MeshSpec[];
	/** Whether the part has mesh groups (decides whether the new workspace is a free model) */
	hasMesh?: boolean;
	/** Normalized bounding box (cubes + mesh vertices) */
	bbox: {
		min: Vec3;
		max: Vec3;
	};
	/** Lateral centerline x (≈0 after normalization) */
	xMid: number;
	/** Texture resolution [w, h] (px). Must match across all three parts or generation is rejected */
	textureSize?: [number, number];
	/** All source textures referenced by the part */
	textures?: SourceTexture[];
}

/**
 * Portal configuration (optional); the two textures are independently optional.
 *  - When trackTexture (portal_track) is set, the teleport shape applies it to the track/ties;
 *    otherwise the parts' own default textures are used.
 *  - When mipTexture (portal_track_mip) is set, two overlay cubes (teleport_left / teleport_right)
 *    wrap the left/right halves of the ties (excluding the rails) and are textured with it;
 *    otherwise no overlay cubes are generated.
 * Structure follows Create's original teleport.json — the whole model uses portal_track, the two
 * overlays (left cube5 / right cube6) use the mip.
 */
export interface PortalConfig {
	/** portal_track source key (prefixed, e.g. 'P/track'); when unset, track/tie keep their default textures */
	trackTexture?: string;
	/** portal_track_mip source key (prefixed, e.g. 'P/mip'); when unset, no overlay cubes are generated */
	mipTexture?: string;
	/** Overlay (mip) texture size [w, h] (px), used to fill the overlay faces' UV (default 32×32) */
	mipTextureSize?: [number, number];
	/** Overlay wrap margin beyond the tie's outer edge (px, avoids z-fighting with the tie), default 0.1 */
	margin?: number;
}

/** The generated result for one track shape. */
export interface ShapeSpec {
	/** TrackShape id, e.g. 'x_ortho', 'diag', 'ascending_south' */
	id: string;
	/** Display name (Group name) */
	name: string;
	cubes: CubeSpec[];
}

/** All inputs needed to generate the track. */
export interface TrackConfig {
	/** Gauge (px, 1/16 block) = center distance between the left/right rails */
	gaugePx: number;
	/** Rail height above the model's bottom face (px, 1/16 block) */
	heightPx: number;
	/** Whole-model (tie + track) Y offset (px), default 0 */
	wholeModelYOffset?: number;
	parts: {
		left: PartModel;
		right: PartModel;
		tie: PartModel;
	};
	/** Optional portal config: two independently optional textures, see PortalConfig */
	portal?: PortalConfig;
}
