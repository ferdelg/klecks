#!/usr/bin/env node
/**
 * Builds the Flinsh version of Kleki: one self-contained dist-flinsh/index.html.
 *
 * 1. Parcel builds src/flinsh.html with KL_FLINSH=1 and .parcelrc.flinsh:
 *    - KL_FLINSH=1 turns lazy import()s (languages, ag-psd, licenses) into require(),
 *      so there are no lazy chunks
 *    - .parcelrc.flinsh turns every `url:` import (fonts, images) into a data: URI
 * 2. This script inlines the remaining CSS/JS files (and anything they reference) into the HTML.
 * 3. It audits the result: no file references left, and every http(s) URL classified.
 *
 * Usage: node scripts/build-flinsh.mjs [--skip-parcel]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_DIR = path.join(ROOT, '.flinsh-build');
const OUT_DIR = path.join(ROOT, 'dist-flinsh');
const OUT_FILE = path.join(OUT_DIR, 'index.html');
const ENTRY = 'src/flinsh.html';
const skipParcel = process.argv.includes('--skip-parcel');

const MIME = {
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
};

/**
 * Every absolute URL in the output must be listed here.
 * text:             never requested (namespace, license text, comment, plain link label)
 * blocked-optional: would be requested by a feature that is hidden/disabled inside Flinsh
 * required:         needed at runtime -> must not exist (build fails)
 */
const URL_RULES = [
    { re: /^http:\/\/www\.w3\.org\//, cls: 'text', why: 'XML/SVG/MathML namespace identifier' },
    { re: /^https?:\/\/(www\.)?(apache\.org|opensource\.org|scripts\.sil\.org|openfontlicense\.org|creativecommons\.org|gnu\.org|fsf\.org)/, cls: 'text', why: 'license text' },
    { re: /^https?:\/\/(github\.com|bitbof\.com|kleki\.com|blog\.kleki\.com|2draw\.net)/, cls: 'text', why: 'link / credit text (popups blocked in sandbox)' },
    { re: /^https:\/\/api\.imgur\.com\//, cls: 'blocked-optional', why: 'Imgur upload (hidden inside Flinsh)' },
    { re: /^https?:\/\/(i\.)?imgur\.com/, cls: 'blocked-optional', why: 'Imgur upload result (hidden inside Flinsh)' },
    { re: /^https:\/\/fonts\.google\.com|^https:\/\/www\.google\.com\/fonts|^https?:\/\/(fonts\.)?google/, cls: 'text', why: 'font credit link' },
    { re: /^https?:\/\/(www\.)?(dafont\.com|fontlibrary\.org|fontspace\.com|velvetyne\.fr|tehroc|yunga|correction|freckleface|pixeloid|ggbot)/i, cls: 'text', why: 'font credit link' },
    { re: /^https:\/\/developer\.mozilla\.org|^https:\/\/(www\.)?w3\.org|^https:\/\/tc39\.es|^https:\/\/(html\.)?spec\.whatwg\.org/, cls: 'text', why: 'spec link in comment/error text' },
    { re: /^https?:\/\/(example\.(com|org)|localhost)/, cls: 'text', why: 'example in comment/code' },
    { re: /^https:\/\/(www\.shadertoy\.com|iquilezles\.org|www\.youtube\.com\/c\/InigoQuilez)/, cls: 'text', why: 'shader credit in license text' },
    { re: /^https:\/\/get\.webgl\.org/, cls: 'text', why: 'link in "WebGL not supported" error message' },
    { re: /^https:\/\/klecks\.org/, cls: 'text', why: 'link / credit text' },
    { re: /^https:\/\/camillewisniewski\.fr|^https:\/\/web\.archive\.org\//, cls: 'text', why: 'font / code credit in license text' },
];

function run(cmd, args, env = {}) {
    execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
}

function toDataUri(file) {
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) {
        throw new Error('no mime type for ' + file);
    }
    return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function kb(bytes) {
    return (bytes / 1024).toFixed(1) + ' KB';
}

// --------------------------------- 1. parcel ---------------------------------
if (!skipParcel) {
    // generated sources (gitignored)
    run('node', ['src/icons/generate.js']);
    run('node', ['src/languages/generate.js', 'build']);

    fs.rmSync(TMP_DIR, { recursive: true, force: true });
    run(
        'npx',
        [
            'parcel',
            'build',
            ENTRY,
            '--config',
            './.parcelrc.flinsh',
            '--dist-dir',
            TMP_DIR,
            '--public-url',
            './',
            '--no-source-maps',
            '--no-cache',
        ],
        { KL_FLINSH: '1' },
    );
}

// --------------------------------- 2. inline ---------------------------------
const files = fs.readdirSync(TMP_DIR);
const used = new Set(['flinsh.html']);
const inlined = []; // { file, bytes, as }

function readAsset(name) {
    const clean = name.replace(/^\.?\//, '').split(/[?#]/)[0];
    const full = path.join(TMP_DIR, clean);
    if (!fs.existsSync(full)) {
        throw new Error(`referenced file not found: ${name}`);
    }
    used.add(clean);
    return { clean, full };
}

function inlineCssUrls(css) {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, q, ref) => {
        if (/^(data:|#|blob:)/.test(ref)) {
            return match;
        }
        if (/^https?:/.test(ref)) {
            throw new Error('external url() in CSS: ' + ref);
        }
        const { clean, full } = readAsset(ref);
        inlined.push({ file: clean, bytes: fs.statSync(full).size, as: 'data: URI (CSS)' });
        return `url("${toDataUri(full)}")`;
    });
}

function escapeForScriptTag(js) {
    // A literal "</script" would end the inline <script>. "<\/script" is equivalent inside JS
    // strings, template literals and regexes.
    return js.replace(/<\/script/gi, '<\\/script');
}

let html = fs.readFileSync(path.join(TMP_DIR, 'flinsh.html'), 'utf8');

// stylesheets
html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
    const href = tag.match(/href=["']?([^"' >]+)/i)[1];
    const { clean, full } = readAsset(href);
    const css = inlineCssUrls(fs.readFileSync(full, 'utf8'));
    inlined.push({ file: clean, bytes: fs.statSync(full).size, as: '<style>' });
    return `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
});

// scripts
html = html.replace(/<script\b([^>]*)\bsrc=["']?([^"' >]+)["']?([^>]*)><\/script>/gi, (tag, a, src, b) => {
    const { clean, full } = readAsset(src);
    const js = fs.readFileSync(full, 'utf8');
    inlined.push({ file: clean, bytes: fs.statSync(full).size, as: '<script>' });
    const attrs = (a + b).replace(/\s+/g, ' ').trim();
    return `<script ${attrs}>${escapeForScriptTag(js)}</script>`;
});

// any other local reference left in the HTML (icons, images)
html = html.replace(/\b(src|href)=["']?([^"' >]+\.(png|gif|jpg|jpeg|svg|webp|ico))["']?/gi, (m, attr, ref) => {
    if (/^(data:|https?:)/.test(ref)) {
        return m;
    }
    const { clean, full } = readAsset(ref);
    inlined.push({ file: clean, bytes: fs.statSync(full).size, as: 'data: URI (HTML)' });
    return `${attr}="${toDataUri(full)}"`;
});

// <meta charset> must be within the first 1024 bytes; Parcel hoists stylesheets above it
html = html.replace(/<meta charset=["']?utf-8["']?\s*\/?>/i, '');
html = html.replace(/<html[^>]*>/i, (m) => m + '<meta charset="UTF-8">');

// --------------------------------- 3. audit ---------------------------------
const problems = [];

// lazy chunks or other files nobody inlined
const leftovers = files.filter((f) => !used.has(f));
if (leftovers.length) {
    problems.push('Parcel emitted files that were not inlined (lazy chunks?): ' + leftovers.join(', '));
}

// references to sibling files by name (e.g. a bundle-url manifest)
for (const f of files) {
    if (f !== 'flinsh.html' && html.includes(f)) {
        problems.push('output still references file by name: ' + f);
    }
}
if (/navigator\.serviceWorker\.register/.test(html)) {
    problems.push('service worker registration found');
}

// absolute URLs
const urlCounts = new Map();
for (const m of html.matchAll(/https?:\/\/[^\s"'`<>)\\]+/g)) {
    urlCounts.set(m[0], (urlCounts.get(m[0]) ?? 0) + 1);
}
const urlReport = { text: [], 'blocked-optional': [], required: [], unclassified: [] };
for (const [url, count] of [...urlCounts].sort()) {
    const rule = URL_RULES.find((r) => r.re.test(url));
    (rule ? urlReport[rule.cls] : urlReport.unclassified).push({ url, count, why: rule?.why });
}
if (urlReport.unclassified.length) {
    problems.push(
        'unclassified URLs (add to URL_RULES after checking they are never fetched):\n  ' +
            urlReport.unclassified.map((u) => u.url).join('\n  '),
    );
}

// data URI inventory
const dataUris = new Map();
// Parcel's data-url optimizer percent-encodes "+" "/" "=" inside the base64 payload
for (const m of html.matchAll(/data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=%]+)/g)) {
    const e = dataUris.get(m[1]) ?? { count: 0, bytes: 0 };
    e.count++;
    e.bytes += Math.floor((decodeURIComponent(m[2]).length * 3) / 4);
    dataUris.set(m[1], e);
}

// --------------------------------- write ---------------------------------
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, html);

console.log('\n=== Flinsh build ===');
console.log(`${path.relative(ROOT, OUT_FILE)}: ${kb(fs.statSync(OUT_FILE).size)}`);
console.log('\nInlined from Parcel output:');
inlined.forEach((i) => console.log(`  ${i.file.padEnd(40)} ${kb(i.bytes).padStart(10)}  -> ${i.as}`));
console.log('\nEmbedded data: URIs (decoded size, includes Parcel-inlined url: imports):');
[...dataUris].forEach(([mime, e]) => console.log(`  ${mime.padEnd(20)} ${String(e.count).padStart(3)} x  ${kb(e.bytes).padStart(10)}`));
console.log('\nAbsolute URLs in output:');
for (const cls of ['required', 'blocked-optional', 'text', 'unclassified']) {
    console.log(`  ${cls}: ${urlReport[cls].length}`);
    urlReport[cls].forEach((u) => console.log(`    ${u.url}${u.count > 1 ? ` (x${u.count})` : ''}${u.why ? '  - ' + u.why : ''}`));
}

if (problems.length) {
    console.error('\nFAILED:\n- ' + problems.join('\n- '));
    process.exit(1);
}
console.log('\nOK: single file, no lazy chunks, no runtime fetches of external URLs.');
