// Bundle the shared rules for the iOS app (run: npm run ios:domain).
//   ios/Wrynch/Resources/wrynch-domain.js        the rules, run by JavaScriptCore in the app
//   ios/WrynchTests/Fixtures/sample.json         a real inspection from the demo data, for the Swift tests
import * as esbuild from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';

mkdirSync('ios/Wrynch/Resources', { recursive: true });
await esbuild.build({
  entryPoints: ['ios/bridge/entry.ts'],
  outfile: 'ios/Wrynch/Resources/wrynch-domain.js',
  bundle: true, format: 'iife', target: ['es2020'], minify: true, legalComments: 'none',
  loader: { '.json': 'json' }, logLevel: 'warning',
  // JavaScriptCore has no structuredClone or console.
  banner: { js: 'globalThis.structuredClone||(globalThis.structuredClone=function(x){return x===undefined?x:JSON.parse(JSON.stringify(x))});globalThis.console||(globalThis.console={log(){},warn(){},error(){}});' },
});

const { seedInspections, VEHICLES } = await import('../src/domain/seed.ts');
const { analyzePhotos, applyAnalysis } = await import('../src/domain/aiStub.ts');
// The demo inspection in progress, with six under-car photos the AI stand-in has sorted (so there is AI to review).
const insp = seedInspections().find((i) => i.id === 'i-4r-now');
const vehicle = VEHICLES.find((v) => v.id === insp.vehicleId);
const photos = Array.from({ length: 6 }, (_, k) => ({ id: `m-${k + 1}`, name: `under-car-${k + 1}.jpg` }));
for (const p of photos) insp.media.push({ id: p.id, sectionId: 'under_car', url: `shop/${insp.id}/${p.id}.jpg`, label: p.name, excluded: false, customerVisible: true, analyzed: false, links: [], pointId: null, corner: null });
applyAnalysis(insp, analyzePhotos('under_car', photos, vehicle.config));
mkdirSync('ios/WrynchTests/Fixtures', { recursive: true });
writeFileSync('ios/WrynchTests/Fixtures/sample.json', JSON.stringify({ inspection: insp, vehicle }, null, 1));
console.log('ios: wrynch-domain.js and the test fixture are up to date');
