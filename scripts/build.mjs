// Build (and optionally serve) the app with esbuild.
//   node scripts/build.mjs          -> dist/
//   node scripts/build.mjs --serve  -> http://localhost:5173 with rebuild on change
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';

const serve = process.argv.includes('--serve');
mkdirSync('dist/assets', { recursive: true });
cpSync('index.html', 'dist/index.html');

const options = {
  entryPoints: { app: 'src/main.tsx' },
  outdir: 'dist/assets',
  bundle: true,
  format: 'iife',
  jsx: 'automatic',
  target: ['es2020'],
  minify: !serve,
  sourcemap: serve,
  loader: { '.json': 'json' },
  external: ['https://*'],
  define: { 'process.env.NODE_ENV': JSON.stringify(serve ? 'development' : 'production') },
  logLevel: 'info',
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: 'dist', port: 5173 });
  console.log(`Wrynch dev server: http://localhost:${port}`);
} else {
  await esbuild.build(options);
}
