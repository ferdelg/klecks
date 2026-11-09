import { c } from '../../../../bb/base/c';
import * as classes from './show-licenses-dialog.module.scss';
import { DynamicModal } from '../base/dynamic-modal';
import { BB } from '../../../../bb/bb';
import { LANG } from '../../../../language/language';

type TLicensesModule = typeof import('./licenses');
type TFontLicensesModule = typeof import('../../../../../fonts/font-licenses');

// Flinsh build: require() keeps everything in one bundle (no lazy chunks)
async function loadLicenses(): Promise<TLicensesModule> {
    if (process.env.KL_FLINSH === '1') {
        return require('./licenses') as TLicensesModule;
    } else {
        return await import('./licenses');
    }
}
async function loadFontLicenses(): Promise<TFontLicensesModule> {
    if (process.env.KL_FLINSH === '1') {
        return require('../../../../../fonts/font-licenses') as TFontLicensesModule;
    } else {
        return await import('../../../../../fonts/font-licenses');
    }
}

export function showLicensesDialog() {
    const libraries = c('.' + classes.licenses, LANG('loading'));
    const fonts = c('.' + classes.licenses, LANG('loading'));

    const content = c(',flex,flexCol,gap-10', [libraries, fonts]);

    new DynamicModal({
        title: BB.el({
            content: LANG('licenses'),
        }),
        content: BB.el({
            content,
            css: {
                height: '100%',
                overflowY: 'auto',
                padding: 10,
                boxSizing: 'border-box',
            },
        }),
        width: 800,
        onClose: () => {
            if (window.location.hash === '#licenses') {
                history.replaceState(
                    '',
                    document.title,
                    window.location.pathname + window.location.search,
                );
            }
        },
    });

    loadLicenses().then((result) => {
        libraries.innerHTML = '';
        result.LICENSES.forEach((item) => {
            libraries.append(
                c('details', [c('summary', item.title), c('', item.full.replace(/\n/g, '<br>'))]),
            );
        });
    });

    loadFontLicenses().then((result) => {
        fonts.innerHTML = '';
        result.FONT_LICENSES.forEach((item) => {
            fonts.append(
                c('details', [
                    c('summary', 'Font: ' + item.title),
                    c('', item.full.replace(/\n/g, '<br>')),
                ]),
            );
        });
    });
}
