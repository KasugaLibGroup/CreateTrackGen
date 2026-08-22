/**
 * Shared "profiles" widget + storage accessor, used by both the generate dialog (src/ui/dialog.ts)
 * and the export dialog (src/build/export.ts).
 *
 * The widget lets the user save the dialog's current parameter values under a name, then re-apply /
 * delete them later. Values are persisted through Blockbench.storage (localStorage-backed) via the
 * pure ProfileStore (src/logic/profile.ts); only the widget DOM + the storage accessor live here.
 */

import { t } from '../i18n';
import type { KVStore, StoredProfile } from '../logic/profile';

/**
 * Returns a KVStore backed by localStorage — Blockbench's own persistence mechanism. Blockbench does
 * NOT expose a `Blockbench.storage` API in current versions (its internal state — settings,
 * keybindings, display presets — is all written straight to localStorage), so relying on it would
 * silently lose profiles. Degrades to a shared module-level in-memory store when localStorage is
 * unavailable (unusual host / Node without a stub), so saving never crashes — it just doesn't persist.
 */
let memStorage: Map<string, string> | null = null;

export function blockbenchStorage(): KVStore {
	const ls = (globalThis as { localStorage?: Storage }).localStorage;
	if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
		return {
			save: (key, value) => {
				try {
					ls.setItem(key, value);
				} catch {
					// quota / unavailable: treat as not persisted
				}
				return true;
			},
			load: (key) => {
				try {
					const v = ls.getItem(key);
					return typeof v === 'string' ? v : null;
				} catch {
					return null;
				}
			},
			delete: (key) => {
				try {
					ls.removeItem(key);
				} catch {
					// ignore
				}
			},
		};
	}
	memStorage ??= new Map<string, string>();
	return {
		save: (key, value) => {
			memStorage!.set(key, value);
			return true;
		},
		load: (key) => memStorage!.get(key) ?? null,
		delete: (key) => {
			memStorage!.delete(key);
		},
	};
}

/** Widget callbacks — each dialog supplies apply / save / remove against its own form state */
export interface ProfileWidgetHandlers<T> {
	list(): StoredProfile<T>[];
	/** Applies the named profile's values to the dialog */
	apply(name: string): void;
	/** Saves the dialog's current parameter values under the given name */
	save(name: string): void;
	/** Deletes the named profile */
	remove(name: string): void;
}

/** Smoke-test / driver hook shape (real Blockbench doesn't depend on it) */
export interface ProfileDriver<T> {
	list(): StoredProfile<T>[];
	save(name: string): void;
	apply(name: string): void;
	remove(name: string): void;
}

/** Creates a DOM element with a class name and optional text */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

/** A small .ctg-btn-styled button with a click handler */
function profileButton(label: string, onClick: () => void): HTMLButtonElement {
	const b = el('button', 'ctg-btn', label) as HTMLButtonElement;
	b.type = 'button';
	b.addEventListener('click', onClick);
	return b;
}

/**
 * Builds + wires the profiles widget DOM (empty string in Node smoke tests, where there is no
 * document). Row 1: existing-profile dropdown + Apply / Delete; row 2: name input + Save.
 */
export function buildProfileWidget<T>(handlers: ProfileWidgetHandlers<T>): HTMLElement | '' {
	if (typeof document === 'undefined') return '';

	const box = el('div', 'ctg-profile');
	box.append(el('div', 'ctg-col-title', t('ctg.profile.title')));

	const select = el('select', 'ctg-profile-select') as HTMLSelectElement;
	const row1 = el('div', 'ctg-profile-row');
	row1.append(select);
	row1.append(
		profileButton(t('ctg.profile.apply'), () => applySelected()),
		profileButton(t('ctg.profile.delete'), () => deleteSelected())
	);
	box.append(row1);

	const nameInput = el('input', 'ctg-profile-name') as HTMLInputElement;
	nameInput.type = 'text';
	nameInput.placeholder = t('ctg.profile.name_ph');
	const row2 = el('div', 'ctg-profile-row');
	row2.append(nameInput);
	row2.append(profileButton(t('ctg.profile.save'), () => saveCurrent()));
	box.append(row2);

	box.append(el('div', 'ctg-hint', t('ctg.profile.hint')));

	/** Refills the dropdown with the saved profile names, keeping the previous selection if possible */
	const refresh = (selectName?: string): void => {
		const names = handlers.list().map((p) => p.name);
		const prev = select.value;
		select.textContent = '';
		for (const n of names) {
			const opt = document.createElement('option');
			opt.value = n;
			opt.textContent = n;
			select.append(opt);
		}
		const target = selectName ?? (names.includes(prev) ? prev : '');
		if (target) select.value = target;
	};

	const applySelected = (): void => {
		if (select.value) handlers.apply(select.value);
	};
	const deleteSelected = (): void => {
		if (!select.value) return;
		handlers.remove(select.value);
		refresh();
	};
	const saveCurrent = (): void => {
		const name = nameInput.value.trim();
		if (!name) {
			Blockbench.showQuickMessage(t('ctg.profile.empty_name'));
			return;
		}
		handlers.save(name);
		refresh(name);
		nameInput.value = '';
	};

	refresh();
	return box;
}
