/**
 * Obsidian localStorage ↔ the storage adapter shape @dualtran/core expects
 * (`get(key)` → `{ [key]: value }`, `set({ [key]: value })`).
 *
 * `app.loadLocalStorage/saveLocalStorage` are mobile-safe and device-local, which
 * is what a catalogue cache wants: no vault sync, no file I/O, no quota surprises
 * beyond the usual localStorage limits — and every failure is swallowed so the
 * settings pane keeps working (the caller falls back to the built-in list).
 */

export interface LocalStorageHost {
  loadLocalStorage(key: string): unknown;
  saveLocalStorage(key: string, data: unknown): void;
}

export interface StorageAdapter {
  get(key: string): Promise<Record<string, unknown>>;
  set(obj: Record<string, unknown>): Promise<void>;
}

export function createObsidianStorage(host: LocalStorageHost): StorageAdapter {
  return {
    async get(key) {
      try {
        const value = host.loadLocalStorage(key);
        return value == null ? {} : { [key]: value };
      } catch {
        return {};
      }
    },
    async set(obj) {
      for (const [key, value] of Object.entries(obj)) {
        try {
          host.saveLocalStorage(key, value);
        } catch {
          // Quota or serialisation failure: run uncached rather than break the pane.
        }
      }
    },
  };
}
