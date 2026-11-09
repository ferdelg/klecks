import { TKeyValueBackend } from '../bb/base/local-storage';
import { TFlinshStoreScope } from './flinsh';

/** All settings live in one store value. Small (a few KB), one write per flush. */
export const FLINSH_SETTINGS_KEY = 'kleki/settings';
const FORMAT_VERSION = 1;
const FLUSH_DELAY_MS = 400;

type TStoredSettings = {
    v: number;
    items: Record<string, string>;
};

/** Keys that are only meaningful within one page session (cross-tab messaging, IndexedDB sync). */
function isEphemeralKey(key: string): boolean {
    return key.startsWith('cross-tab-channel--') || key === 'indexedDbUpdatedAt';
}

/**
 * Settings backend for LocalStorage that persists in window.flinsh.store (user scope).
 * - preload: create() reads everything once, after that reads are synchronous from memory
 * - write-through: every change marks the cache dirty and schedules a flush
 * - coalesced: rapid changes within FLUSH_DELAY_MS become one store.set(), and writes never overlap
 */
export class FlinshSettingsBackend implements TKeyValueBackend {
    private readonly items = new Map<string, string>();
    private lastSavedJson: string;
    private flushTimeout: ReturnType<typeof setTimeout> | undefined;
    private flushing: Promise<void> = Promise.resolve();

    private constructor(
        private readonly store: TFlinshStoreScope,
        initial: Record<string, string>,
    ) {
        Object.entries(initial).forEach(([key, value]) => {
            if (typeof value === 'string') {
                this.items.set(key, value);
            }
        });
        this.lastSavedJson = this.serialize();

        // flush right away when the app gets hidden or closed
        const flushNow = (): void => {
            if (this.flushTimeout !== undefined) {
                this.flush();
            }
        };
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                flushNow();
            }
        });
        window.addEventListener('pagehide', flushNow);
    }

    private serialize(): string {
        const items: Record<string, string> = {};
        [...this.items.keys()]
            .filter((key) => !isEphemeralKey(key))
            .sort()
            .forEach((key) => (items[key] = this.items.get(key)!));
        const data: TStoredSettings = { v: FORMAT_VERSION, items };
        return JSON.stringify(data);
    }

    private scheduleFlush(key: string): void {
        if (isEphemeralKey(key)) {
            return;
        }
        clearTimeout(this.flushTimeout);
        this.flushTimeout = setTimeout(() => this.flush(), FLUSH_DELAY_MS);
    }

    private flush(): Promise<void> {
        clearTimeout(this.flushTimeout);
        this.flushTimeout = undefined;
        // chain, so writes land in order and never overlap
        this.flushing = this.flushing.then(async () => {
            const json = this.serialize();
            if (json === this.lastSavedJson) {
                return;
            }
            try {
                await this.store.set(FLINSH_SETTINGS_KEY, JSON.parse(json));
                this.lastSavedJson = json;
            } catch (e) {
                // e.g. quota. Keep running with in-memory settings; the next change retries.
                console.warn('Kleki: could not save settings to Flinsh', e);
            }
        });
        return this.flushing;
    }

    // ----------------------------------- public -----------------------------------

    static async create(store: TFlinshStoreScope): Promise<FlinshSettingsBackend> {
        let initial: Record<string, string> = {};
        try {
            const stored = (await store.get(FLINSH_SETTINGS_KEY)) as TStoredSettings | null;
            if (stored && typeof stored === 'object' && stored.items) {
                initial = stored.items;
            }
        } catch (e) {
            console.warn('Kleki: could not load settings from Flinsh', e);
        }
        return new FlinshSettingsBackend(store, initial);
    }

    getItem(key: string): string | null {
        return this.items.get(key) ?? null;
    }

    setItem(key: string, value: string): void {
        value = '' + value;
        if (this.items.get(key) === value) {
            return;
        }
        this.items.set(key, value);
        this.scheduleFlush(key);
    }

    removeItem(key: string): void {
        if (!this.items.has(key)) {
            return;
        }
        this.items.delete(key);
        this.scheduleFlush(key);
    }

    /** Write pending changes now. */
    async flushNow(): Promise<void> {
        await this.flush();
    }
}

/** In-memory backend: used in a sandboxed frame without the Flinsh bridge (no localStorage). */
export class MemorySettingsBackend implements TKeyValueBackend {
    private readonly items = new Map<string, string>();
    getItem(key: string): string | null {
        return this.items.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        this.items.set(key, '' + value);
    }
    removeItem(key: string): void {
        this.items.delete(key);
    }
}
