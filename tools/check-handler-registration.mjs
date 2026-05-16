#!/usr/bin/env node
// tools/check-handler-registration.mjs
//
// Structural verifier for the shifty-plugin Knex request handlers.
//
// Authority: Plan 03-01 Task 5. The Phase 02 retrospective (02-11-SUMMARY)
// recommended this gate to prevent silent runtime failures of the class
// "Request type X can not be found." surfaced after the merged shifty-plugin
// landed. Phase 03 adds 11 new request handlers; without this verifier each
// one must be manually cross-checked in three places (connections/Knex/Knex.js,
// types.js, the handler file's .meta/.connectionType setters).
//
// CHECKS PERFORMED:
//   (a) Every requests/*.js file has a default-exported handler whose function
//       name matches the filename basename.
//   (b) Every handler file sets `.meta = { checkRead ... }` (Phase 02-11 hotfix).
//   (c) Every handler file sets `.connectionType = 'Knex'`.
//   (d) Every handler basename appears in the `requests:` array literal of types.js.
//   (e) Every handler basename has BOTH an `import X from './requests/X.js'` line
//       AND an entry in the `requests:` object literal inside connections/Knex/Knex.js.
//
// Exits 0 if all five checks pass for every discovered handler. Exits 1 with
// numbered violations otherwise.
//
// Stdlib only — no npm packages, runs in <2s.

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PLUGIN_ROOT = join(REPO_ROOT, 'app', 'plugins', 'shifty-plugin', 'src');
const REQUESTS_DIR = join(PLUGIN_ROOT, 'connections', 'Knex', 'requests');
const KNEX_JS = join(PLUGIN_ROOT, 'connections', 'Knex', 'Knex.js');
const TYPES_JS = join(PLUGIN_ROOT, 'types.js');

const violations = [];

async function main() {
  // Discover all handler files in requests/.
  let handlerFiles;
  try {
    handlerFiles = (await readdir(REQUESTS_DIR))
      .filter((f) => f.endsWith('.js'))
      .sort();
  } catch (e) {
    console.error(`FATAL: cannot read ${REQUESTS_DIR}: ${e.message}`);
    process.exit(2);
  }

  if (handlerFiles.length === 0) {
    console.error(`FATAL: no handler files found in ${REQUESTS_DIR}`);
    process.exit(2);
  }

  const handlerBasenames = handlerFiles.map((f) => basename(f, '.js'));

  // Load Knex.js + types.js once.
  const knexJsRaw = await readFile(KNEX_JS, 'utf8');
  const typesJsRaw = await readFile(TYPES_JS, 'utf8');
  // Strip comments BEFORE searching — `requests:` may appear inside JSDoc
  // commentary describing the export shape, which would confuse extractArrayLiteral.
  const knexJs = stripComments(knexJsRaw);
  const typesJs = stripComments(typesJsRaw);

  // Extract the `requests:` array literal from types.js.
  const typesRequestsArr = extractArrayLiteral(typesJs, 'requests');
  if (typesRequestsArr === null) {
    violations.push(
      `types.js: could not locate \`requests:\` array literal — file shape unexpected`,
    );
  }

  // Extract the `requests:` object literal from Knex.js.
  const knexRequestsObj = extractObjectLiteral(knexJs, 'requests');
  if (knexRequestsObj === null) {
    violations.push(
      `connections/Knex/Knex.js: could not locate \`requests:\` object literal — file shape unexpected`,
    );
  }

  // Per-handler checks.
  for (const handlerFile of handlerFiles) {
    const handlerName = basename(handlerFile, '.js');
    const filePath = join(REQUESTS_DIR, handlerFile);
    const src = await readFile(filePath, 'utf8');

    // (a) default export whose name matches filename
    // Accept either:
    //   `export default <name>;`
    //   `export default <name>` (no semicolon)
    //   `export default function <name>(...)` (rare)
    const defaultExportNamed = new RegExp(
      `export\\s+default\\s+${escapeRegExp(handlerName)}\\b`,
    );
    const defaultExportFunction = new RegExp(
      `export\\s+default\\s+(?:async\\s+)?function\\s+${escapeRegExp(handlerName)}\\b`,
    );
    if (!defaultExportNamed.test(src) && !defaultExportFunction.test(src)) {
      violations.push(
        `${handlerFile}: missing \`export default ${handlerName}\` (check a — default export name must match filename)`,
      );
    }

    // (b) `.meta = { checkRead ...` setter
    if (!/\.meta\s*=\s*\{\s*checkRead/.test(src)) {
      violations.push(
        `${handlerFile}: missing \`.meta = { checkRead, checkWrite }\` setter (check b — required by @lowdefy/api 5.3)`,
      );
    }

    // (c) `.connectionType = 'Knex'`
    if (!/\.connectionType\s*=\s*['"]Knex['"]/.test(src)) {
      violations.push(
        `${handlerFile}: missing \`.connectionType = 'Knex'\` setter (check c — required for runtime resolution)`,
      );
    }

    // (d) name appears in types.js `requests:` array
    if (typesRequestsArr !== null) {
      const tokens = parseArrayTokens(typesRequestsArr);
      if (!tokens.includes(handlerName)) {
        violations.push(
          `types.js: missing \`${handlerName}\` in \`requests:\` array (check d — required for plugin manifest)`,
        );
      }
    }

    // (e) import + map entry in Knex.js
    const importRe = new RegExp(
      `import\\s+${escapeRegExp(handlerName)}\\s+from\\s+['"]\\./requests/${escapeRegExp(handlerName)}\\.js['"]`,
    );
    if (!importRe.test(knexJs)) {
      violations.push(
        `connections/Knex/Knex.js: missing \`import ${handlerName} from './requests/${handlerName}.js'\` (check e1)`,
      );
    }
    if (knexRequestsObj !== null) {
      const objTokens = parseObjectShorthandTokens(knexRequestsObj);
      if (!objTokens.includes(handlerName)) {
        violations.push(
          `connections/Knex/Knex.js: missing \`${handlerName}\` entry in \`requests:\` object (check e2)`,
        );
      }
    }
  }

  // Report.
  const total = handlerBasenames.length;
  if (violations.length === 0) {
    console.log(`OK ${total}/${total} handlers registered correctly`);
    process.exit(0);
  }

  console.error(`FAIL ${violations.length} violation(s) across handlers (${total} discovered):`);
  violations.forEach((v, i) => console.error(`  ${i + 1}. ${v}`));
  console.error(`\nSee tools/check-handler-registration.mjs header for the 5 invariants checked.`);
  process.exit(1);
}

/**
 * Extract the contents (between `[` and matching `]`) of a top-level `<key>:` array
 * literal inside a JS source. Returns the inner string (without the brackets) or
 * null if the key is not found or brackets don't match.
 */
function extractArrayLiteral(src, key) {
  const keyRe = new RegExp(`${escapeRegExp(key)}\\s*:\\s*\\[`);
  const m = keyRe.exec(src);
  if (!m) return null;
  const openIdx = src.indexOf('[', m.index);
  if (openIdx < 0) return null;
  let depth = 1;
  for (let i = openIdx + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

/**
 * Extract the contents (between `{` and matching `}`) of a top-level `<key>:`
 * object literal inside a JS source.
 */
function extractObjectLiteral(src, key) {
  const keyRe = new RegExp(`${escapeRegExp(key)}\\s*:\\s*\\{`);
  const m = keyRe.exec(src);
  if (!m) return null;
  const openIdx = src.indexOf('{', m.index);
  if (openIdx < 0) return null;
  let depth = 1;
  for (let i = openIdx + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

/**
 * Strip JS line and block comments from a source string. Preserves the
 * character count rough equivalence by replacing comments with whitespace
 * (so byte offsets in error messages stay sensible). Not a full lexer — it
 * does not handle strings containing `//` or `/*`, which is acceptable for
 * the files we parse (Knex.js + types.js have no such strings).
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

/** Split an array's inner contents by commas and strip quotes / whitespace / comments. */
function parseArrayTokens(inner) {
  return inner
    .replace(/\/\/[^\n]*/g, '')       // strip line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // strip block comments
    .split(',')
    .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

/**
 * Parse the inner contents of a `requests: { ... }` object. Each entry is
 * either `Name` (shorthand), `Name: Foo` (explicit), or `...spread`. We collect
 * the names that appear as keys (shorthand or explicit).
 */
function parseObjectShorthandTokens(inner) {
  const cleaned = inner
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // Match identifier-only entries (shorthand) and `Name:` (key) forms.
  // Skip `...spread` entries (they don't add named keys).
  const tokens = [];
  for (const piece of cleaned.split(',')) {
    const t = piece.trim();
    if (!t || t.startsWith('...')) continue;
    // `Name: value` — take Name; or bare `Name` — take it as-is.
    const m = /^([A-Za-z_$][A-Za-z0-9_$]*)\s*(:|$)/.exec(t);
    if (m) tokens.push(m[1]);
  }
  return tokens;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((e) => {
  console.error(`FATAL: ${e.stack || e.message}`);
  process.exit(2);
});
