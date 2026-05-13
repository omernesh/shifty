// app/plugins/shifty-roster/src/connections/requests/ParseCsvAndValidate.js
// Lowdefy custom request: parse an uploaded CSV (base64) and produce a per-row
// preview state for the import wizard (ok / warn / error per row).
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// knex imported dynamically inside the function body so unit tests can import
// this module without requiring 'knex' to be installed in the test environment.
// In the Lowdefy Docker image, knex is available via @lowdefy/connection-knex.
//
// Implementation (Plan 02-08 Task 2 — replaces plan 02-02 stub):
// 1. decode base64 file bytes -> UTF-8 string
// 2. Papa.parse({ header: true, skipEmptyLines: true })
// 3. Required-header gate: display_name, email, role_tags, seniority, team_id
// 4. Per-tenant pre-flight SELECTs (all WHERE tenant_id = :tenant_id):
//      - existing app_user emails (duplicate detection scoped to THIS tenant only —
//        cross-tenant duplicates are NOT flagged; T-02-02 mitigation)
//      - valid team_ids
//      - valid role_tag keys
// 5. Per-row map: canonicalizeText(display_name), canonicalizeRoleTag(each tag),
//    validate email format, seniority range, team_id membership, unknown tag warnings,
//    duplicate detection. Status: error (unfixable) | warn (recoverable) | ok.
// 6. Return { rows, total } — caller renders the editable AgGrid preview.

import Papa from 'papaparse';
import { canonicalizeText } from '../../helpers/canonicalize.js';
import { canonicalizeRoleTag } from '../../helpers/role-tag.js';

// Required CSV headers — aligned with the soldier table column names so no translation
// step lives between the CSV and the handler. PRD §7.3.1 names the column `display_name`.
const REQUIRED_HEADERS = ['display_name', 'email', 'role_tags', 'seniority', 'team_id'];

// RFC 5322-lite — sufficient to flag malformed pastes without false-rejecting valid edge
// addresses. CSV import is a Hebrew-first form; admins fix borderline cases in the preview.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function ParseCsvAndValidate({ request, connection }) {
  const { file_b64 } = request.properties || {};

  // Layer-4 tenant / actor guards (BEFORE any DB interaction).
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('ParseCsvAndValidate: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('ParseCsvAndValidate: actor_user_id missing from session — unauthenticated request');
  }

  if (!file_b64) {
    throw new Error('ParseCsvAndValidate: file_b64 is required');
  }

  // STEP 1 — decode base64 → UTF-8.
  let csvText;
  try {
    csvText = Buffer.from(file_b64, 'base64').toString('utf-8');
  } catch (err) {
    throw new Error(`ParseCsvAndValidate: failed to decode base64 file: ${err.message}`);
  }

  // STEP 2 — parse with papaparse (header mode; empty lines skipped).
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });

  // STEP 3 — required-header gate. Hebrew error so the UI can surface the
  // exact list of missing columns to the admin.
  const headerFields = (parsed.meta && parsed.meta.fields) || [];
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !headerFields.includes(h));
  if (missingHeaders.length) {
    throw new Error(`חסרות עמודות: ${missingHeaders.join(', ')}`);
  }

  // Lowercase + trim all candidate emails up front so pre-flight + per-row use the
  // SAME canonical form. Duplicate detection compares against canonical app_user.email.
  const candidateEmails = (parsed.data || [])
    .map((r) => (r && typeof r.email === 'string' ? r.email.trim().toLowerCase() : ''))
    .filter(Boolean);

  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    // STEP 4 — pre-flight SELECTs, all scoped to tenant_id (T-02-01 / T-02-02).
    let existingEmails = new Set();
    if (candidateEmails.length) {
      const emailRows = await db.raw(
        `SELECT email FROM app_user WHERE tenant_id = :tenant_id AND email = ANY(:emails)`,
        { tenant_id, emails: candidateEmails }
      );
      const rows = emailRows.rows || emailRows;
      existingEmails = new Set((rows || []).map((r) => String(r.email).toLowerCase()));
    }

    const teamRows = await db.raw(
      `SELECT id FROM org_unit WHERE tenant_id = :tenant_id`,
      { tenant_id }
    );
    const validTeamIds = new Set(((teamRows.rows || teamRows) || []).map((r) => String(r.id)));

    const tagRows = await db.raw(
      `SELECT key FROM role_tag WHERE tenant_id = :tenant_id`,
      { tenant_id }
    );
    const validRoleTagKeys = new Set(((tagRows.rows || tagRows) || []).map((r) => String(r.key)));

    // STEP 5 — per-row validation map.
    const rows = (parsed.data || []).map((raw, idx) => {
      const errors = [];
      const warnings = [];

      const displayNameRaw = raw && typeof raw.display_name === 'string' ? raw.display_name : '';
      // canonicalizeText invoked here at parse time (D-12 / ROST-11 / Pitfall P2 first
      // belt-and-braces layer). CommitRosterImport canonicalizes AGAIN at write time
      // (second layer) so a preview row edited in the AgGrid without re-validation
      // still canonicalizes correctly before INSERT.
      const display_name = canonicalizeText(displayNameRaw);

      const email = raw && typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';

      const seniorityRaw = raw && raw.seniority !== undefined ? String(raw.seniority) : '0';
      const seniority = parseInt(seniorityRaw, 10);

      const tagsRaw = raw && typeof raw.role_tags === 'string'
        ? raw.role_tags.split('|').map((s) => s.trim()).filter(Boolean)
        : [];
      const role_tags = Array.from(new Set(tagsRaw.map(canonicalizeRoleTag).filter(Boolean)));

      const team_id = raw && typeof raw.team_id === 'string' ? raw.team_id.trim() : '';
      const phone_e164 = raw && typeof raw.phone_e164 === 'string' ? raw.phone_e164.trim() : null;

      // Errors — unfixable inline. Preview will block the Confirm button.
      if (!display_name) errors.push('שם חסר');
      if (email && !EMAIL_RE.test(email)) errors.push('כתובת אימייל לא תקפה');
      if (Number.isNaN(seniority) || seniority < 0 || seniority > 10) {
        errors.push('ותק חייב להיות בין 0 ל-10');
      }
      if (team_id && !validTeamIds.has(team_id)) errors.push('יחידה לא קיימת');

      // Warnings — recoverable. Duplicate emails default to skip; re-invite checkbox
      // (D-11) lets the admin opt-in to re-send. Unknown tags will be auto-inserted by
      // CommitRosterImport via ON CONFLICT DO NOTHING (D-13).
      const is_duplicate = email !== '' && existingEmails.has(email);
      if (is_duplicate) warnings.push('כפילות אימייל');

      const unknown_tags = role_tags.filter((t) => !validRoleTagKeys.has(t));
      if (unknown_tags.length) warnings.push(`תגיות חדשות: ${unknown_tags.join(', ')}`);

      const rowStatus = errors.length ? 'error' : (warnings.length ? 'warn' : 'ok');

      return {
        row_index: idx,
        display_name_raw: displayNameRaw,
        display_name,
        email,
        seniority,
        role_tags,
        team_id: team_id || null,
        phone_e164,
        is_duplicate,
        unknown_tags,
        status: rowStatus,
        errors,
        warnings,
        re_invite: false,
      };
    });

    return {
      rows,
      total: rows.length,
    };
  } finally {
    await db.destroy();
  }
}

ParseCsvAndValidate.schema = {
  type: 'object',
  required: ['file_b64'],
  properties: {
    file_b64: { type: 'string', minLength: 1 },
  },
};
ParseCsvAndValidate.connectionType = 'Knex';

export default ParseCsvAndValidate;
