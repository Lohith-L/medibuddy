/**
 * capacitorStorage.ts
 *
 * A storage adapter that makes Supabase use @capacitor/preferences on native
 * (Android / iOS) and falls back to localStorage on the web.
 *
 * Pass this as the `storage` option when creating the Supabase client.
 */
import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

/** Supabase expects a synchronous-looking storage interface, but Capacitor
 *  Preferences is async. We work around this by:
 *  1. Keeping an in-memory cache that is pre-populated on first use.
 *  2. Writing through to Preferences on every set/remove.
 */
class CapacitorPreferencesStorage implements Storage {
  private cache: Record<string, string> = {};
  private ready: Promise<void>;

  constructor() {
    // Pre-load all keys from Preferences into the in-memory cache
    this.ready = Preferences.keys().then(({ keys }) =>
      Promise.all(
        keys.map((key) =>
          Preferences.get({ key }).then(({ value }) => {
            if (value !== null) this.cache[key] = value;
          })
        )
      ).then(() => undefined)
    );
  }

  get length(): number {
    return Object.keys(this.cache).length;
  }

  key(index: number): string | null {
    return Object.keys(this.cache)[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.cache[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.cache[key] = value;
    Preferences.set({ key, value }); // fire-and-forget async write
  }

  removeItem(key: string): void {
    delete this.cache[key];
    Preferences.remove({ key }); // fire-and-forget async remove
  }

  clear(): void {
    this.cache = {};
    Preferences.clear(); // fire-and-forget
  }

  /** Call this once at app start to ensure the cache is populated before
   *  Supabase tries to restore the session. */
  async waitUntilReady(): Promise<void> {
    return this.ready;
  }
}

/** Singleton instance — only created on native platforms */
let _nativeStorage: CapacitorPreferencesStorage | null = null;

export function getSupabaseStorage(): Storage {
  if (Capacitor.isNativePlatform()) {
    if (!_nativeStorage) {
      _nativeStorage = new CapacitorPreferencesStorage();
    }
    return _nativeStorage;
  }
  return localStorage;
}

/** Await this in main.tsx on native so the session is available before render */
export async function waitForStorageReady(): Promise<void> {
  if (Capacitor.isNativePlatform() && _nativeStorage) {
    return _nativeStorage.waitUntilReady();
  }
}
