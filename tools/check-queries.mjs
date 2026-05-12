#!/usr/bin/env node
// tools/check-queries.mjs
// CI grep gate (Plan-01 scaffold — further hardened in Plan 04).
// Scans every app/**/*.yaml for KnexRaw/Knex request blocks and fails if any
// query string is missing a tenant_id filter.
// Exit 0 = all OK; exit 1 = violations found.
//
// Source: CONTEXT.md D-10a; PITFALLS.md §Pitfall 2
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ALLOWLIST_MARKER = '-- @gsd-allow-untenanted:';
const KNEX_REQUEST_TYPES = new Set(['KnexRaw', 'KnexBuilder', 'KnexInsertOne', 'KnexUpdateOne', 'KnexDeleteOne']);
const TENANT_FILTER_PATTERN = /\btenant_id\b/i;
const DML_PATTERN = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;

let failures = 0;
const yamlFiles = collectYaml('app');

for (const filePath of yamlFiles) {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if this line declares a Knex request type
    if (!KNEX_REQUEST_TYPES.has(extractType(line))) continue;

    // Grab the query block (lines after this until the next request block or end of file)
    const blockLines = lines.slice(i, i + 50).join('\n');

    // Skip if allowlisted
    if (blockLines.includes(ALLOWLIST_MARKER)) continue;

    // Check if the block contains DML but no tenant_id filter
    if (DML_PATTERN.test(blockLines) && !TENANT_FILTER_PATTERN.test(blockLines)) {
      console.error(`FAIL: Missing tenant_id filter in ${filePath}:${i + 1}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} query block(s) missing tenant_id filter. Add filter or annotate with:\n  ${ALLOWLIST_MARKER} <reason>`);
  process.exit(1);
}
console.log('check-queries: all Knex request blocks have tenant_id filters.');
process.exit(0);

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
