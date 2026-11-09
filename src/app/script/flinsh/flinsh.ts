/**
 * Flinsh integration (https://flinsh), only active in the single-file build (npm run build:flinsh).
 *
 * Inside Flinsh the app runs in a sandboxed iframe (sandbox="allow-scripts", opaque origin) with a
 * strict CSP: no network, no service worker, no localStorage, no IndexedDB, no nested frames,
 * no popups, and (without allow-downloads) no file downloads. The only channel out is the
 * injected window.flinsh bridge.
 */

export type TFlinshStoreScope = {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<unknown>;
    delete(key: string): Promise<boolean>;
    list(prefix?: string): Promise<string[]>;
};

export type TFlinshBridge = {
    input?: Record<string, unknown>;
    ready?: () => void;
    done?: (result: unknown) => void;
    resize?: (height: number) => void;
    store?: TFlinshStoreScope;
};

declare global {
    interface Window {
        flinsh?: TFlinshBridge;
    }
}

export const IS_FLINSH_BUILD = process.env.KL_FLINSH === '1';

let bridge: TFlinshBridge | undefined;

/**
 * The bridge may be injected after our script parses. Resolve as soon as it's there,
 * or with undefined after timeoutMs (= run standalone).
 */
export function waitForFlinshBridge(timeoutMs: number): Promise<TFlinshBridge | undefined> {
    if (window.flinsh) {
        bridge = window.flinsh;
        return Promise.resolve(bridge);
    }
    return new Promise((resolve) => {
        const finish = (): void => {
            clearTimeout(timeout);
            window.removeEventListener('flinsh:ready', finish);
            bridge = window.flinsh;
            resolve(bridge);
        };
        window.addEventListener('flinsh:ready', finish);
        const timeout = setTimeout(finish, timeoutMs);
    });
}

export function getFlinshBridge(): TFlinshBridge | undefined {
    return bridge;
}

/** Opaque origin inside a frame: sandboxed iframe without allow-same-origin. */
function isSandboxedFrame(): boolean {
    let isFramed = true;
    try {
        isFramed = window.self !== window.top;
    } catch (e) {
        // cross-origin access throws -> definitely framed
    }
    return isFramed && window.origin === 'null';
}

/**
 * True when running inside Flinsh, or inside any sandboxed iframe with an opaque origin
 * (where downloads, popups, nested frames and browser storage are blocked as well).
 */
export function isRestrictedFrame(): boolean {
    return IS_FLINSH_BUILD && (!!bridge || isSandboxedFrame());
}

/**
 * Which features work in the current environment. Outside the Flinsh build everything is true.
 * Each "false" entry names the platform capability that would restore the feature.
 */
export const FLINSH_FEATURES = {
    // sandbox lacks allow-downloads -> needs sandbox flag allow-downloads or bridge flinsh.saveFile()
    get canDownload(): boolean {
        return !isRestrictedFrame();
    },
    // connect-src 'none' + no popups -> needs a server-side upload proxy (not planned)
    get canUploadImgur(): boolean {
        return !isRestrictedFrame();
    },
    // Web Share needs the "web-share" permission policy delegated to the iframe
    get canShare(): boolean {
        return !isRestrictedFrame();
    },
    // help.html / home are iframe modals or popups: frame-src 'none', no allow-popups
    get canShowIframePages(): boolean {
        return !isRestrictedFrame();
    },
};

export const FLINSH_STORAGE_COMING_SOON = 'Saving drawings to Flinsh is coming soon.';
