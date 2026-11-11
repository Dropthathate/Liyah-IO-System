const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const publicPages = [
  'index.html',
  'packages.html',
  'ellis-case-study.html',
  'compare.html',
  'privacy.html',
  'terms.html',
  'ai-disclaimer.html',
  'brand-sketch.html',
];
const excludedPages = new Set([
  'book.html', 'roadmap.html', 'deposit.html', 'verification-return.html',
  'dashboard.html', 'clinical-workbench.html', 'brand.html', 'investor-pitch.html',
  'founding.html', 'launch.html', 'growth.html', 'elite.html', 'retainer.html',
  'october-special.html', 'apply.html', 'clients.html', 'payment-options.html',
]);

function copyFile(relativePath) {
  const source = path.resolve(root, relativePath);
  const target = path.resolve(dist, relativePath);
  if (!source.startsWith(root + path.sep) || !fs.existsSync(source) || !fs.statSync(source).isFile()) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

for (const page of publicPages) {
  if (!fs.existsSync(path.join(root, page))) throw new Error(`Missing public page: ${page}`);
  copyFile(page);
}
copyFile('styles.css');

// The assets/ folder contains the public site’s marketing imagery only.
const assetsSource = path.join(root, 'assets');
if (fs.existsSync(assetsSource)) {
  fs.cpSync(assetsSource, path.join(dist, 'assets'), { recursive: true });
}

// Copy only local static resources referenced by the selected public pages and stylesheet.
// Never copy HTML files outside the explicit allowlist, or anything under api/, backend/, docs/, or tests/.
const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.css', '.js', '.woff', '.woff2', '.ttf', '.webmanifest']);
const references = /(?:href|src|poster|data-src)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi;
for (const page of [...publicPages, 'styles.css']) {
  const content = fs.readFileSync(path.join(root, page), 'utf8');
  for (const match of content.matchAll(references)) {
    const raw = (match[1] || match[2] || '').trim();
    if (!raw.startsWith('/') || raw.startsWith('//')) continue;
    const relative = decodeURIComponent(raw.split(/[?#]/, 1)[0]).replace(/^\/+/, '');
    const segments = relative.split('/');
    if (segments.some((part) => ['api', 'backend', 'docs', 'tests', '.git'].includes(part))) continue;
    if (relative.endsWith('.html')) {
      if (!publicPages.includes(path.basename(relative)) || excludedPages.has(path.basename(relative))) continue;
    } else if (!allowedExtensions.has(path.extname(relative).toLowerCase())) {
      continue;
    }
    copyFile(relative);
  }
}

function makeNotice(title) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title><link rel="stylesheet" href="/styles.css"></head><body><main style="max-width:760px;margin:10vh auto;padding:32px"><p style="letter-spacing:.12em;text-transform:uppercase;color:#00d2c8">Staging preview</p><h1>${title}</h1><p>Booking, chat, identity verification, and payment actions are disabled on this preview. No personal or health information should be entered here.</p><p><a href="/packages.html">Return to packages</a> · <a href="/">Return home</a></p></main></body></html>`;
}
fs.writeFileSync(path.join(dist, 'preview-unavailable.html'), makeNotice('This action is not available in the staging preview'));
fs.writeFileSync(path.join(dist, 'book.html'), makeNotice('Consultation requests are disabled in this preview'));
fs.writeFileSync(path.join(dist, 'roadmap.html'), makeNotice('Roadmap requests are disabled in this preview'));
fs.writeFileSync(path.join(dist, 'deposit.html'), makeNotice('Project deposits and checkout are disabled in this preview'));
fs.writeFileSync(path.join(dist, 'verification-return.html'), makeNotice('Identity verification is disabled in this preview'));

// Remove the embedded AI chat + lead-capture widget and analytics beacon from the public homepage.
const indexPath = path.join(dist, 'index.html');
let homepage = fs.readFileSync(indexPath, 'utf8');
const markerText = homepage.indexOf('AI Chat Widget');
const widgetMarker = markerText >= 0 ? homepage.lastIndexOf('<!--', markerText) : -1;
if (widgetMarker >= 0) {
  const bodyClose = homepage.indexOf('\n</body>', widgetMarker);
  if (bodyClose < 0) throw new Error('Chat widget found, but closing body tag is missing.');
  homepage = homepage.slice(0, widgetMarker) + homepage.slice(bodyClose + 1);
}
homepage = homepage.replace(/<!-- Cloudflare Web Analytics -->[\s\S]*?<!-- End Cloudflare Web Analytics -->/gi, '');
homepage = homepage.replace(/<script[^>]*static\.cloudflareinsights\.com\/beacon\.min\.js[^>]*><\/script>/gi, '');
const previewBanner = '<div role="status" style="position:relative;z-index:10000;background:#15202b;color:#eef5f7;text-align:center;padding:10px 14px;font:600 13px/1.4 system-ui">STAGING PREVIEW — chat, booking, identity verification, and payment actions are disabled.</div>';
homepage = homepage.replace(/(<body\b[^>]*>)/i, `$1${previewBanner}`);
fs.writeFileSync(indexPath, homepage);

for (const page of publicPages.slice(1)) {
  const pagePath = path.join(dist, page);
  if (!fs.existsSync(pagePath)) continue;
  let content = fs.readFileSync(pagePath, 'utf8');
  content = content.replace(/<!-- Cloudflare Web Analytics -->[\s\S]*?<!-- End Cloudflare Web Analytics -->/gi, '');
  content = content.replace(/<script[^>]*static\.cloudflareinsights\.com\/beacon\.min\.js[^>]*><\/script>/gi, '');
  content = content.replace(/(<body\b[^>]*>)/i, `$1${previewBanner}`);
  fs.writeFileSync(pagePath, content);
}

const redirects = [
  '/founding.html /packages.html 301',
  '/launch.html /packages.html 301',
  '/growth.html /packages.html 301',
  '/elite.html /packages.html 301',
  '/retainer.html /packages.html 301',
  '/october-special.html /packages.html 301',
  '/apply.html /packages.html 301',
  '/clients.html /packages.html 301',
  '/payment-options.html /packages.html 301',
].join('\n') + '\n';
fs.writeFileSync(path.join(dist, '_redirects'), redirects);
fs.writeFileSync(path.join(dist, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
fs.writeFileSync(path.join(dist, '_headers'), `/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Permissions-Policy: microphone=(), camera=(), geolocation=(), payment=()\n  Cache-Control: no-store\n`);

// Fail closed if sensitive source trees or unapproved forms were copied to output.
for (const forbidden of ['api', 'backend', 'docs', 'tests', '.env.example', 'The-AALIYAH-Roadmap.pdf']) {
  if (fs.existsSync(path.join(dist, forbidden))) throw new Error(`Unexpected private/interactive output: ${forbidden}`);
}
const outputHtml = fs.readdirSync(dist).filter((name) => name.endsWith('.html'));
for (const file of outputHtml) {
  const text = fs.readFileSync(path.join(dist, file), 'utf8');
  if (text.includes('aal-chat-bubble') || text.includes("fetch('/api/") || text.includes('fetch("/api/') || text.includes('buy.stripe.com') || text.includes('checkout.stripe.com')) {
    throw new Error(`Unexpected chat/API handler in static preview: ${file}`);
  }
}
console.log(`Prepared static-only Leah Pages preview (${outputHtml.length} HTML files); API/backend, chat, lead capture, identity verification, and payment pages are not published.`);
