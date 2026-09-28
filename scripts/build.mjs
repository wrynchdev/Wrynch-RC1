// Build the app and the server functions.
//   node scripts/build.mjs   -> dist/ (static app) and .vercel/output/ (Vercel Build Output API: static + functions)
// Public settings are baked into the app at build time: SUPABASE_URL, SUPABASE_ANON_KEY.
// Without them the app runs in demo mode (seeded data in the browser).
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { loadEnv } from './env.mjs';

loadEnv();
export const appOptions = (dev = false) => ({
  entryPoints: { app: 'src/main.tsx' },
  outdir: 'dist/assets',
  // Production files get a content hash in their name so browsers never keep an old version.
  entryNames: dev ? '[name]' : '[name]-[hash]',
  metafile: !dev,
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  target: ['es2020'],
  minify: !dev,
  sourcemap: dev,
  loader: { '.json': 'json' },
  define: {
    'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production'),
    __WRYNCH_CONFIG__: JSON.stringify({
      supabaseUrl: process.env.SUPABASE_URL ?? '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY ?? '',
    }),
  },
  logLevel: 'info',
});

// The marketing page is served at "/" and the app at "/app/".
export function writeIndex() {
  mkdirSync('dist/assets', { recursive: true });
  mkdirSync('dist/app', { recursive: true });
  cpSync('site/index.html', 'dist/index.html');
  cpSync('index.html', 'dist/app/index.html');
}

const ROUTE_NAMES = ['ai-sort', 'ai-wording', 'vin', 'report', 'send-report'];

async function buildFunctions() {
  const out = '.vercel/output';
  rmSync(out, { recursive: true, force: true });
  mkdirSync(`${out}/static`, { recursive: true });
  cpSync('dist', `${out}/static`, { recursive: true });
  for (const name of ROUTE_NAMES) {
    const dir = `${out}/functions/api/${name}.func`;
    mkdirSync(dir, { recursive: true });
    await esbuild.build({
      stdin: {
        contents: `import { ROUTES } from './server/routes.ts'; import { toNode } from './server/lib.ts';\nexport default toNode(ROUTES[${JSON.stringify(name)}]);`,
        resolveDir: process.cwd(), loader: 'ts',
      },
      outfile: `${dir}/index.mjs`,
      bundle: true, platform: 'node', format: 'esm', target: 'node20', minify: true,
      loader: { '.json': 'json' }, logLevel: 'warning',
    });
    writeFileSync(`${dir}/.vc-config.json`, JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 60 }, null, 2));
  }
  writeFileSync(`${out}/config.json`, JSON.stringify({
    version: 3,
    routes: [
      { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
      { src: '/(index\\.html)?', headers: { 'cache-control': 'no-cache' }, continue: true },
      { src: '/app/?(index\\.html)?', headers: { 'cache-control': 'no-cache' }, continue: true },
      { src: '/app', status: 308, headers: { location: '/app/' } },
      { handle: 'filesystem' },
      { src: '/app/.*', dest: '/app/index.html' },
    ],
  }, null, 2));
  console.log(`functions: ${readdirSync(`${out}/functions/api`).join(', ')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  rmSync('dist', { recursive: true, force: true });
  writeIndex();
  const result = await esbuild.build(appOptions(false));
  // Point index.html at the hashed file names.
  let html = readFileSync('dist/app/index.html', 'utf8');
  for (const out of Object.keys(result.metafile.outputs)) {
    const file = out.replace(/^dist\//, '');
    if (/^assets\/app-[A-Z0-9]+\.js$/i.test(file)) html = html.replace('/assets/app.js', `/${file}`);
    if (/^assets\/app-[A-Z0-9]+\.css$/i.test(file)) html = html.replace('/assets/app.css', `/${file}`);
  }
  if (html.includes('assets/app.js') || html.includes('assets/app.css')) throw new Error('app/index.html still points at unhashed assets');
  writeFileSync('dist/app/index.html', html);
  await buildFunctions();
}
