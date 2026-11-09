/**
 * Entry point of the Flinsh single-file build (src/flinsh.html, npm run build:flinsh).
 *
 * Settings must be loaded from the Flinsh store before any app module runs, because several
 * modules read their settings when they are evaluated. So this file only imports the tiny
 * storage layer statically and pulls in the app with require() after the preload.
 */

import './bb/base/polyfills';
import { LocalStorage } from './bb/base/local-storage';
import { isRestrictedFrame, waitForFlinshBridge } from './flinsh/flinsh';
import { FlinshSettingsBackend, MemorySettingsBackend } from './flinsh/flinsh-settings';

const BRIDGE_TIMEOUT_MS = 400;

(async () => {
    const bridge = await waitForFlinshBridge(BRIDGE_TIMEOUT_MS);

    if (bridge?.store) {
        LocalStorage.setBackend(await FlinshSettingsBackend.create(bridge.store));
    } else if (isRestrictedFrame()) {
        // sandboxed without bridge: localStorage throws, keep settings for this session at least
        LocalStorage.setBackend(new MemorySettingsBackend());
    } // else: standalone, regular localStorage

    const { bootStandalone } = require('./app/boot-standalone') as typeof import('./app/boot-standalone');
    await bootStandalone({
        onReady: () => {
            // canvas is up
            try {
                bridge?.ready?.();
            } catch (e) {
                console.warn('Kleki: flinsh.ready() failed', e);
            }
        },
    });
})();
