// Local development: rebuilds the app on change and serves it with the /api functions.
//   npm run dev   -> http://localhost:5173
import * as esbuild from 'esbuild';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { appOptions, writeIndex } from './build.mjs';
import { ROUTES } from '../server/routes.ts';
import { toNode } from '../server/lib.ts';

writeIndex();
const ctx = await esbuild.context(appOptions(true));
await ctx.watch();

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json', '.svg': 'image/svg+xml' };
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
  let file = normalize(join('dist', url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith('dist') || !existsSync(file) || statSync(file).isDirectory()) file = 'dist/index.html';
  res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
  res.end(readFileSync(file));
}).listen(port, () => {
  const mode = process.env.SUPABASE_URL ? `connected to ${process.env.SUPABASE_URL}` : 'demo mode (no SUPABASE_URL)';
  console.log(`Wrynch dev server on http://localhost:${port} — ${mode}`);
});
