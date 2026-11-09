/**
 * Synchronous key-value backend. LocalStorage routes through one of these when set,
 * e.g. the Flinsh settings store (preloaded into memory, written through asynchronously).
 */
export type TKeyValueBackend = {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
};

/**
 * LocalStorage wrapper that does not throw exceptions.
 * If cookies disabled in Safari localStorage interactions throw exception "insecure operation"
 *
 * By default it uses window.localStorage. A different backend can be swapped in via setBackend()
 * before the app reads any settings (see main-flinsh.ts).
 */
export class LocalStorage {
    private static error: unknown | undefined;
    private static backend: TKeyValueBackend | undefined;

    static setBackend(backend: TKeyValueBackend | undefined): void {
        this.backend = backend;
    }

    static getItem(key: string): string | null {
        let result = null;
        try {
            result = (this.backend ?? localStorage).getItem(key);
        } catch (e) {
            this.error = e;
        }
        return result;
    }

    static setItem(key: string, value: string): void {
        try {
            (this.backend ?? localStorage).setItem(key, value);
        } catch (e) {
            this.error = e;
        }
    }

    static removeItem(key: string): void {
        try {
            (this.backend ?? localStorage).removeItem(key);
        } catch (e) {
            this.error = e;
        }
    }

    static getError(): unknown {
        return this.error;
    }
}
