// tools/budibase-helpers/build.mjs
// Bundles the 4 pure-function helpers into a single IIFE exposing global `Shifty`.
// Output: helpers.bundle.js + helpers.bundle.js.map (external sourcemap).
// Consumed by Builder UI JS code blocks via paste-as-fixture (see README.md).
//
// esbuild flags (per plan 03-W0-03 D-01):
//   --bundle --format=iife --global-name=Shifty
//   --platform=neutral (Budibase JS sandbox is browser-shaped, no Node APIs)
//   --target=es2020 (modern enough for optional chaining etc.; harmless here)
//   --minify (smaller paste into Builder UI)
//   --sourcemap=external (sibling .map; bundle stays small)
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The IIFE entry file aggregates the 4 helpers and re-exports them as a single
// module. esbuild's --global-name=Shifty then produces:
//   var Shifty = (() => { ... return { canonicalizeText, PALETTE, ... } })();
const entryContent = `\
export { canonicalizeText } from './src/canonicalize.js';
export { PALETTE, pickNextColor, colorByIndex } from './src/palette.js';
export { canonicalizeRoleTag } from './src/role-tag.js';
export { SOURCE_RANK, SOURCE_VALUES } from './src/availability-source.js';
`;

const entryPath = join(__dirname, '.entry.mjs');
writeFileSync(entryPath, entryContent, 'utf8');

try {
  await build({
    entryPoints: [entryPath],
    outfile: join(__dirname, 'helpers.bundle.js'),
    bundle: true,
    format: 'iife',
    globalName: 'Shifty',
    platform: 'neutral',
    target: 'es2020',
    minify: true,
    sourcemap: 'external',
    logLevel: 'info',
  });
  console.log('Bundle built: helpers.bundle.js + helpers.bundle.js.map');
} finally {
  // Clean up the synthesized entry — it is a build artifact, not source.
  try { rmSync(entryPath); } catch { /* best-effort */ }
}
