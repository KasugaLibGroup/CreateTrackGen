/**
 * Profile persistence — named batches of dialog parameter values (excluding source/destination file
 * paths) that can be saved once and quickly re-applied in the generate / export dialogs.
 *
 * Storage is injected (Blockbench.storage in the real app, a stub in Node tests) and profiles are
 * serialized to JSON under one storage key, so this module is pure and unit-testable.
 */

/** Minimal key/value persistence interface — Blockbench.storage has exactly this shape */
export interface KVStore {
	save(key: string, value: string): boolean;
	load(key: string): string | null;
	delete(key: string): void;
}

/** A named batch of values, as persisted */
export interface StoredProfile<T> {
	name: string;
	values: T;
}

/**
 * Generate-dialog profile values. Only the numeric/text form parameters are stored — the part /
 * portal-texture source files (source paths) are excluded. The gauge is stored in px; mm / inch are
 * re-derived from it when the profile is applied.
 */
export interface GenerateProfileValues {
	/** Track gauge (px, 1/16 block) — center distance between the rails */
	gauge: number;
	/** Track height above the tie bottom / ground (px) */
	height: number;
	/** Whole-model Y offset (px) */
	yoffset: number;
	/** New workspace name */
	name: string;
}

/**
 * Export-dialog profile values. The export root (save destination path) is excluded. texturePaths
 * stores each texture's resource path (an ordered "batch" — applied to the current dialog's textures
 * by key first, then by position, so profiles survive texture-set changes).
 */
export interface ExportProfileValues {
	/** Export mode id (see logic/export EXPORT_MODES) */
	mode: string;
	/** Resource pack namespace */
	namespace: string;
	/** Track id (model folder name + blockstates file name) */
	trackId: string;
	/** Mod loader for the OBJ reference JSON's loader field (forge / neoforge / …) */
	loader: string;
	/** Model resource path (block/track/{id} etc.) */
	modelPath: string;
	/** Per-texture resource paths, in texture-key order */
	texturePaths: { key: string; path: string }[];
}

/**
 * Reads / writes a list of named profiles under one storage key, JSON-serialized.
 * A profile's name is its identity: put() upserts (an existing name is overwritten, keeping its
 * position), remove() deletes by name. Corrupt / missing data degrades to an empty list.
 */
export class ProfileStore<T> {
	constructor(
		private store: KVStore,
		private storageKey: string
	) {}

	/** All saved profiles, in insertion order */
	list(): StoredProfile<T>[] {
		const raw = this.store.load(this.storageKey);
		if (!raw) return [];
		try {
			const data = JSON.parse(raw);
			if (!Array.isArray(data)) return [];
			return data.filter(
				(p): p is StoredProfile<T> => !!p && typeof p.name === 'string' && typeof p.values === 'object' && p.values !== null
			);
		} catch {
			return [];
		}
	}

	/** Finds a profile by name; undefined when absent */
	find(name: string): StoredProfile<T> | undefined {
		return this.list().find((p) => p.name === name);
	}

	/** Saves a profile (upserts by name, keeping the existing position when overwriting) */
	put(profile: StoredProfile<T>): void {
		const all = this.list();
		const i = all.findIndex((p) => p.name === profile.name);
		if (i === -1) all.push(profile);
		else all[i] = profile;
		this.store.save(this.storageKey, JSON.stringify(all));
	}

	/** Removes a profile by name; no-op when absent */
	remove(name: string): void {
		const all = this.list().filter((p) => p.name !== name);
		this.store.save(this.storageKey, JSON.stringify(all));
	}
}
