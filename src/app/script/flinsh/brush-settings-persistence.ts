import { LocalStorage } from '../bb/base/local-storage';

/**
 * Remembers the selected brush and each brush's size and opacity (Flinsh build only).
 * Upstream Kleki does not persist brush settings. Stored via LocalStorage, which inside
 * Flinsh is backed by flinsh.store (coalesced writes), so dragging a slider is cheap.
 */
export const LS_BRUSH_SETTINGS_KEY = 'kl-brush-settings';

type TBrushValues = { size?: number; opacity?: number };
export type TStoredBrushSettings = {
    current?: string;
    brushes: Record<string, TBrushValues>;
};

type TBrushUiLike = {
    getSize: () => number;
    setSize: (size: number) => void;
    getOpacity: () => number;
    setOpacity: (opacity: number) => void;
};

function isFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

export function readBrushSettings(): TStoredBrushSettings {
    try {
        const parsed = JSON.parse(LocalStorage.getItem(LS_BRUSH_SETTINGS_KEY) ?? 'null');
        if (parsed && typeof parsed === 'object' && parsed.brushes) {
            return parsed as TStoredBrushSettings;
        }
    } catch (e) {
        // invalid -> defaults
    }
    return { brushes: {} };
}

/** Apply stored size/opacity to the brush UIs. Returns the stored current brush id, if valid. */
export function restoreBrushSettings(brushUiMap: Record<string, TBrushUiLike>): string | undefined {
    const stored = readBrushSettings();
    Object.entries(stored.brushes).forEach(([id, values]) => {
        const ui = brushUiMap[id];
        if (!ui) {
            return;
        }
        if (isFiniteNumber(values.size) && values.size > 0) {
            ui.setSize(values.size);
        }
        if (isFiniteNumber(values.opacity) && values.opacity >= 0 && values.opacity <= 1) {
            ui.setOpacity(values.opacity);
        }
    });
    return stored.current && stored.current in brushUiMap ? stored.current : undefined;
}

export function saveBrushSettings(
    brushUiMap: Record<string, TBrushUiLike>,
    currentBrushId: string | undefined,
): void {
    const data: TStoredBrushSettings = { current: currentBrushId, brushes: {} };
    Object.entries(brushUiMap).forEach(([id, ui]) => {
        data.brushes[id] = {
            size: Math.round(ui.getSize() * 100) / 100,
            opacity: Math.round(ui.getOpacity() * 1000) / 1000,
        };
    });
    LocalStorage.setItem(LS_BRUSH_SETTINGS_KEY, JSON.stringify(data));
}
