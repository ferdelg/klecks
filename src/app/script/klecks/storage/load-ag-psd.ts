export type TAgPsd = Awaited<typeof import('./ag-psd')>;
let agPsdLazy: TAgPsd;

export async function loadAgPsd(): Promise<TAgPsd> {
    if (process.env.KL_FLINSH === '1') {
        // Flinsh build: require() keeps ag-psd in the single bundle (no lazy chunk)
        agPsdLazy ??= require('./ag-psd') as TAgPsd;
    } else {
        agPsdLazy ??= await import('./ag-psd');
    }
    return agPsdLazy;
}
