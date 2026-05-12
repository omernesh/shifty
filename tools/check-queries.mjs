#!/usr/bin/env node
// tools/check-queries.mjs
// CI grep gate (hardened in Plan 04 from Plan-01 scaffold).
// Scans every app/**/*.yaml for KnexRaw/Knex* request blocks and fails if any
// query string is missing a tenant_id filter.
// Exit 0 = all OK; exit 1 = violations found.
//
// Source: CONTEXT.md D-10a; PITFALLS.md §Pitfall 2
//
// Modes:
//   node tools/check-queries.mjs             — default: scan all YAML, fail on missing tenant_id
//   node tools/check-queries.mjs --self-test — mutation test: proves the gate can detect violations
//   node tools/check-queries.mjs --auth-blocks — scan mutating requests for missing auth.roles
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

const ALLOWLIST_MARKER = '-- @gsd-allow-untenanted:';
const KNEX_REQUEST_TYPES = new Set(['KnexRaw', 'KnexBuilder', 'KnexInsertOne', 'KnexUpdateOne', 'KnexDeleteOne']);
const MUTATING_REQUEST_TYPES = new Set(['KnexInsertOne', 'KnexUpdateOne', 'KnexDeleteOne', 'AuditWrite']);
const TENANT_FILTER_PATTERN = /\btenant_id\b/i;
const DML_PATTERN = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;
const MUTATING_DML_PATTERN = /^\s*(INSERT|UPDATE|DELETE)\b/im;

// Self-test target: a YAML file with a known tenant_id-filtered query (Plan 03 admin_dashboard)
const SELFTEST_TARGET = 'app/pages/admin/admin_dashboard.yaml';

const args = process.argv.slice(2);

if (args.includes('--self-test')) {
  runSelfTest();
} else if (args.includes('--auth-blocks')) {
  runAuthBlocksCheck();
} else if (args.includes('--no-rls-bypass')) {
  runNoRlsBypassCheck();
} else {
  // Default mode runs both the tenant_id gate AND the RLS-bypass gate — they share a
  // codepath cost (one filesystem walk) and are both release-blocking.
  runDefaultCheck();
  runNoRlsBypassCheck();
}

// ─────────────────────────────────────────────
// DEFAULT MODE: fail on missing tenant_id
// ─────────────────────────────────────────────
function runDefaultCheck(targetFiles) {
  const yamlFiles = targetFiles ?? collectYaml('app');
  let failures = 0;

  for (const filePath of yamlFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (!KNEX_REQUEST_TYPES.has(extractType(line))) continue;

      // Grab up to 80 lines of the block
      const blockLines = lines.slice(i, i + 80).join('\n');

      // Skip if allowlisted
      if (blockLines.includes(ALLOWLIST_MARKER)) continue;

      // Check if the block contains DML but no tenant_id filter
      if (DML_PATTERN.test(blockLines) && !TENANT_FILTER_PATTERN.test(blockLines)) {
        const snippet = lines.slice(i, i + 3).map((l, idx) => `  ${i + 1 + idx}: ${l}`).join('\n');
        console.error(`FAIL: Missing tenant_id filter in ${filePath}:${i + 1}\n${snippet}`);
        failures++;
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} query block(s) missing tenant_id filter. Add filter or annotate with:\n  ${ALLOWLIST_MARKER} <reason>`);
    process.exit(1);
  }
  if (!targetFiles) {
    console.log('check-queries: all Knex request blocks have tenant_id filters.');
    // Do NOT exit — default mode chains into runNoRlsBypassCheck() in the dispatcher.
  }
  return failures;
}

// ─────────────────────────────────────────────
// SELF-TEST MODE: mutation test proves gate is alive
// ─────────────────────────────────────────────
function runSelfTest() {
  const tempFile = SELFTEST_TARGET.replace('.yaml', '.SELFTEST.yaml');

  // Always clean up on exit
  const cleanup = () => {
    if (existsSync(tempFile)) {
      try { unlinkSync(tempFile); } catch {}
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });

  try {
    const original = readFileSync(SELFTEST_TARGET, 'utf-8');

    // Mutate: strip ALL tenant_id occurrences from the entire file content so the gate flags it.
    // We do a global replace so even the payload/parameters sections lose tenant_id references.
    // The gate looks for any mention of tenant_id in the 80-line block around the request type,
    // including payload and parameters — so we must remove it everywhere.
    const mutated = original.replace(/\btenant_id\b/g, 'SELFTEST_REMOVED');

    writeFileSync(tempFile, mutated, 'utf-8');

    // Scan just the temp file programmatically (avoid subprocess to keep things simple)
    const violations = scanFileForTenantViolations(tempFile);

    cleanup();

    if (violations === 0) {
      console.error('SELF-TEST FAIL: gate did not detect missing tenant_id in mutated YAML');
      process.exit(1);
    }

    console.log(`SELF-TEST PASS: gate correctly flagged mutated YAML (${violations} violation(s) detected)`);
    process.exit(0);
  } catch (err) {
    cleanup();
    console.error(`SELF-TEST ERROR: ${err.message}`);
    process.exit(1);
  }
}

/** Scan a single file and return count of violations (does not print/exit). */
function scanFileForTenantViolations(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!KNEX_REQUEST_TYPES.has(extractType(line))) continue;
    const blockLines = lines.slice(i, i + 80).join('\n');
    if (blockLines.includes(ALLOWLIST_MARKER)) continue;
    if (DML_PATTERN.test(blockLines) && !TENANT_FILTER_PATTERN.test(blockLines)) {
      count++;
    }
  }
  return count;
}

// ─────────────────────────────────────────────
// --auth-blocks MODE: mutating requests must declare auth.roles
// ─────────────────────────────────────────────
function runAuthBlocksCheck() {
  const yamlFiles = collectYaml('app');
  let failures = 0;

  for (const filePath of yamlFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const requestType = extractType(line);
      if (!requestType) continue;

      // Check if it's a known mutating type
      const isKnownMutatingType = MUTATING_REQUEST_TYPES.has(requestType);

      // Or a KnexRaw with a mutating DML in the query
      let isKnexRawMutation = false;
      if (requestType === 'KnexRaw' || requestType === 'KnexBuilder') {
        const blockLines = lines.slice(i, i + 80).join('\n');
        // Find the query: block and check if it starts with INSERT/UPDATE/DELETE
        const queryMatch = blockLines.match(/query:\s*\|[\s\S]*?(?=\n\s*\w+:|$)/);
        if (queryMatch) {
          const queryContent = queryMatch[0];
          // Strip the allowlist comment and check for mutating DML
          const noComments = queryContent.replace(/--[^\n]*/g, '');
          if (MUTATING_DML_PATTERN.test(noComments)) {
            isKnexRawMutation = true;
          }
        }
      }

      if (!isKnownMutatingType && !isKnexRawMutation) continue;

      // This is a mutating request — check for page-level auth.roles (Lowdefy 5.3.0 limitation:
      // request-level auth.roles not supported; page-level auth gate provides the protection).
      // We check that the PAGE YAML has a top-level auth.roles block.
      // Since request-level auth is not supported in Lowdefy 5.3.0, we verify the page has
      // page-level auth gates instead.
      const fileContent = content;
      const hasPageAuth = /^auth:\s*\n(?:\s+.*\n)*\s+roles:/m.test(fileContent) ||
                          /^auth:\s*\n\s+protected:/m.test(fileContent);

      // Also accept if there's an allowlist comment indicating the page is intentionally public
      const isPublicPage = /auth:\s*\n\s+protected:\s*false/m.test(fileContent);

      if (!hasPageAuth && !isPublicPage) {
        const snippet = lines.slice(i, i + 3).map((l, idx) => `  ${i + 1 + idx}: ${l}`).join('\n');
        console.error(`FAIL: Mutating request type "${requestType}" on a page without top-level auth.roles in ${filePath}:${i + 1}\n${snippet}`);
        failures++;
      }
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} mutating request(s) on unprotected pages. Add page-level auth.roles or annotate.`);
    process.exit(1);
  }
  console.log('check-queries --auth-blocks: all mutating requests are on auth-gated pages.');
  process.exit(0);
}

// ─────────────────────────────────────────────
// NO-RLS-BYPASS MODE: fail on any literal `SET row_security = off`
// ─────────────────────────────────────────────
// The Postgres bootstrap user (`shifts`) is forced to retain SUPERUSER by
// Postgres itself — `ALTER ROLE shifts NOSUPERUSER` is rejected with "The
// bootstrap user must have the SUPERUSER attribute." (a hard Postgres rule).
// A SUPERUSER can bypass every RLS policy via `SET row_security = off`.
// Defense-in-depth: this gate refuses the build if any source file contains
// that literal anywhere — YAML, JS, SQL, anywhere — so a developer can't
// quietly add it. See `docs/OPERATIONS.md` § "Postgres role split".
function runNoRlsBypassCheck() {
  const FORBIDDEN = /SET\s+(LOCAL\s+|SESSION\s+)?row_security\s*(=|\s+TO\s+)\s*(off|false|0)/i;
  const ALLOW_MARKER = '@gsd-allow-rls-bypass:';
  const ROOTS = ['app', 'tools', 'db', 'tests'];
  const EXTS = /\.(yaml|yml|js|mjs|ts|tsx|jsx|sql|json)$/;
  let failures = 0;

  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!EXTS.test(full)) continue;
      // Skip this file itself — it's the gate and must reference the literal in its messages.
      if (full.endsWith('check-queries.mjs') || full.replace(/\\/g, '/').endsWith('tools/check-queries.mjs')) continue;
      const content = readFileSync(full, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (FORBIDDEN.test(lines[i]) && !lines[i].includes(ALLOW_MARKER)) {
          console.error(`${full}:${i + 1}: forbidden RLS bypass — ${lines[i].trim()}`);
          failures++;
        }
      }
    }
  }
  for (const root of ROOTS) walk(root);

  if (failures === 0) {
    console.log('NO-RLS-BYPASS PASS: no `SET row_security = off` found in tracked source.');
  } else {
    console.error(`NO-RLS-BYPASS FAIL: ${failures} forbidden literal(s) found. The bootstrap user is SUPERUSER by Postgres design (see docs/OPERATIONS.md § Postgres role split); never use SET row_security = off in code.`);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function collectYaml(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) results.push(...collectYaml(full));
    else if (full.endsWith('.yaml') || full.endsWith('.yml')) results.push(full);
  }
  return results;
}

function extractType(line) {
  const m = line.match(/^\s*type:\s*(\S+)/);
  return m ? m[1] : null;
}
