// Regenerate after editing the inline import map: node scripts/security-config.cjs
// Verify generated configs without changing them: node scripts/security-config.cjs --check
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const importMap = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
if (!importMap) throw new Error('Missing inline import map');
const hash = crypto.createHash('sha256').update(importMap[1]).digest('base64');
const policy = [
    "default-src 'self'",
    `script-src 'self' 'sha256-${hash}' 'wasm-unsafe-eval'`,
    "script-src-attr 'none'",
    "style-src 'self' https://fonts.googleapis.com",
    "style-src-attr 'none'",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' blob: data:",
    "connect-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
].join('; ');
const headers = {
    'Content-Security-Policy': policy,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Strict-Transport-Security': 'max-age=31536000',
    'Cross-Origin-Opener-Policy': 'same-origin',
};
const vercel = {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    framework: null,
    buildCommand: null,
    outputDirectory: 'public',
    headers: [
        { source: '/(.*)', headers: Object.entries(headers).map(([key, value]) => ({ key, value })) },
        { source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }] },
        { source: '/vendor/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }] },
    ],
};
// _headers also ships with manual Netlify uploads of public/.
const netlifyHeaders = ['/*',
    ...Object.entries(headers).map(([key, value]) => `  ${key}: ${value}`),
    ...['/assets/*', '/vendor/*'].flatMap(route => ['', route, '  Cache-Control: public, max-age=3600']), '',
].join('\n');
const toml = '[build]\n  publish = "public"\n\n# Response headers are generated in public/_headers (also supports manual uploads).\n';
for (const [file, content] of [['vercel.json', JSON.stringify(vercel, null, 2) + '\n'], ['netlify.toml', toml], ['public/_headers', netlifyHeaders]]) {
    const destination = path.join(root, file);
    if (process.argv.includes('--check')) {
        if (fs.readFileSync(destination, 'utf8') !== content) throw new Error(`Stale ${file}; run node scripts/security-config.cjs`);
    } else fs.writeFileSync(destination, content);
}
console.log('Security headers and import-map CSP hash verified.');
