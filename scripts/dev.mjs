// Local development (marketing page at /, app at /app/): rebuilds the app on change and serves it with the /api functions.
//   npm run dev   -> http://localhost:5173 (marketing page) and http://localhost:5173/app/ (the app)
import * as esbuild from 'esbuild';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { APP_DOMAIN, APP_HOST, SITE_HOST, appOptions, writeIndex } from './build.mjs';
import { ROUTES } from '../server/routes.ts';
import { toNode } from '../server/lib.ts';

writeIndex();
const ctx = await esbuild.context(appOptions(true));
await ctx.watch();

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const port = Number(process.env.PORT ?? 5173);

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const api = /^\/api\/([a-z-]+)$/.exec(url.pathname);
  if (api) {
    const h = ROUTES[api[1]];
    if (!h) { res.statusCode = 404; res.end('Not found'); return; }
    await toNode(h)(req, res);
    return;
  }
  // Same host rules as production (scripts/build.mjs): the app's domain and shop addresses open the app at "/";
  // the marketing domain sends /app to the app's domain. Other hosts: "/" is the marketing page, "/app/" the app.
  const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
  const port = (req.headers.host ?? '').includes(':') ? `:${req.headers.host.split(':')[1]}` : '';
  if (new RegExp(`^${SITE_HOST}$`).test(host) && /^\/app(\/|$)/.test(url.pathname)) { res.statusCode = 308; res.setHeader('location', `http://${APP_DOMAIN}${port}/`); res.end(); return; }
  if (new RegExp(`^${APP_HOST}$`).test(host) && (url.pathname === '/' || url.pathname === '/index.html')) { res.setHeader('content-type', 'text/html'); res.end(readFileSync('dist/app/index.html')); return; }
  if (url.pathname === '/app') { res.statusCode = 308; res.setHeader('location', '/app/'); res.end(); return; }
  let file = normalize(join('dist', url.pathname));
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!file.startsWith('dist') || !existsSync(file)) file = url.pathname.startsWith('/app/') ? 'dist/app/index.html' : 'dist/index.html';
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(port, () => {
  const mode = process.env.SUPABASE_URL ? `connected to ${process.env.SUPABASE_URL}` : 'demo mode (no SUPABASE_URL)';
  console.log(`Wrynch dev server on http://localhost:${port} — ${mode}`);
});
