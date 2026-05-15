// app/plugins/shifty-plugin/src/connections/Knex/requests/CommitRosterImport.js
// Lowdefy custom request: commit a validated roster preview (one transaction)
// and synchronously dispatch Resend magic-link invites with progress reporting.
// Tenant ID from request.user (session) — NEVER from request.properties. Layer-4 defense.
//
// Layer 5 (RLS) wireup: Stage 1 (per-row INSERT batch) and Stage 3 (roster_import_log
// summary) each run inside withTenantTx with SET LOCAL app.current_tenant. Stage 2
// (Resend dispatch) uses a bare Knex instance because sendInvite's only DB write is
// to `verification_tokens` (an Auth.js table that is intentionally NOT RLS-protected —
// magic links cross tenant boundaries by design; tenant scoping happens at session
// hydration in ShiftySessionCallback).
//
// knex is loaded indirectly via withTenantTx (dynamic import). Unit tests that exercise
// only the guard clauses can still import this module without knex installed.
//
// Implementation (Plan 02-08 Task 2 — replaces plan 02-02 stub):
//
// STAGE 1: one Knex transaction wraps the per-row INSERT batch.
//   For each row with status !== 'error' AND not (is_duplicate && !re_invite):
//     a) UPSERT any unknown role_tag keys: INSERT ... ON CONFLICT (tenant_id, key) DO NOTHING.
//     b) Resolve app_user — SELECT by (tenant_id, email), INSERT if absent (locale='he').
//     c) Race-safe color: SELECT FOR UPDATE on org_unit.last_color_index +
//        pickNextColor + UPDATE. No team_id → PALETTE[0].
//     d) INSERT soldier with canonicalizeText(display_name) AGAIN as belt-and-braces
//        (D-12 / Pitfall P2 — protects against a preview row edited in the AgGrid
//        without re-validation; first canonicalization ran in ParseCsvAndValidate).
//     e) SELECT-driven INSERT membership when team_id supplied (refuses cross-tenant joins).
//     f) schedule_audit row per soldier (to_state='soldier_created_via_csv_import').
//   Counters: rowsCreated / rowsSkipped (duplicate, no re-invite) / rowsErrored (status='error').
//
// STAGE 2: SYNC Resend dispatch loop. The transaction is already committed by here.
//   For each created soldier with email + (re_invite OR not duplicate):
//     - sendInvite({ email, callbackUrl, locale: 'he', knexTx: db }).
//     - On 429 / rate-limit: backoff [1000, 4000, 16000] ms, max 3 retries.
//     - After each successful send: sleep(500) — Resend free-tier 2 req/s budget.
//     - Failures push into errorDetails (no throw — soldier exists; admin can retry
//       from soldier_detail's "Invite later" button).
//
// STAGE 3: INSERT roster_import_log summary row using the LIVE schema column names
//   from migration 0007_imports_and_exports.up.sql (Pitfall P12 — NOT PRD §10 drift):
//     id, tenant_id, imported_by, source, rows_created, rows_skipped,
//     rows_errored, error_details, created_at.
//   `source: 'csv'` is one canonical SQL token (W4 fix from PLAN revision).

import { canonicalizeText } from '../../../helpers/canonicalize.js';
import { canonicalizeRoleTag } from '../../../helpers/role-tag.js';
import { pickNextColor, PALETTE } from '../../../helpers/palette.js';
import { sendInvite, bulkDispatchWithBackoff } from '../../../dispatch/resend.js';
import { withTenantTx } from '../../../hooks/with-tenant-tx.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function CommitRosterImport({ request, connection }) {
  const { rows } = request.properties || {};

  // Layer-4 tenant / actor guards.
  const tenant_id = request.user?.tenant_id;
  if (!tenant_id) {
    throw new Error('CommitRosterImport: tenant_id missing from session');
  }
  const actor_user_id = request.user?.user_id;
  if (!actor_user_id) {
    throw new Error('CommitRosterImport: actor_user_id missing from session — unauthenticated request');
  }
  // eslint-disable-next-line no-unused-vars
  const caller_team_ids = request.user?.team_ids || [];
  const roles = request.user?.roles || [];
  // eslint-disable-next-line no-unused-vars
  const is_admin = roles.includes('unit_admin');

  if (!Array.isArray(rows)) {
    throw new Error('CommitRosterImport: rows must be an array');
  }

  // Touch helper imports so the dispatch chain is exercised even on empty input.
  // eslint-disable-next-line no-unused-vars
  const _bulk = bulkDispatchWithBackoff;

  // Counters accumulated across all rows.
  let rowsCreated = 0;
  let rowsSkipped = 0;
  let rowsErrored = 0;
  const errorDetails = [];
  // Rows that successfully INSERTed and need invite dispatch — populated inside the
  // transaction, drained sync in Stage 2 AFTER commit so verification_tokens rows
  // are persisted via a separate connection.
  const dispatchQueue = [];

  // ── STAGE 1: transactional INSERT batch (RLS-scoped) ──────────────────────
  await withTenantTx(connection, tenant_id, async (trx) => {
    for (const row of rows) {
      // Skip rows the preview already flagged as unfixable.
      if (row.status === 'error') {
        rowsErrored++;
        errorDetails.push({
          row_index: row.row_index,
          reason: 'error_state',
          details: row.errors || [],
        });
        continue;
      }

      // Duplicates default to skip; admin can opt-in to re-invite (D-11).
      if (row.is_duplicate && !row.re_invite) {
        rowsSkipped++;
        continue;
      }

      // (a) UPSERT unknown role_tag keys. Re-canonicalize at write time.
      const writeRoleTags = Array.isArray(row.role_tags)
        ? Array.from(new Set(row.role_tags.map(canonicalizeRoleTag).filter(Boolean)))
        : [];
      const unknownTagsForRow = Array.isArray(row.unknown_tags)
        ? row.unknown_tags.map(canonicalizeRoleTag).filter(Boolean)
        : [];
      if (unknownTagsForRow.length > 0) {
        await trx('role_tag')
          .insert(unknownTagsForRow.map((key) => ({ tenant_id, key })))
          .onConflict(['tenant_id', 'key'])
          .ignore();
      }

      // (b) Resolve / create app_user.
      let appUserId = null;
      if (row.email && typeof row.email === 'string') {
        const lowerEmail = String(row.email).toLowerCase();
        const existing = await trx('app_user')
          .where({ tenant_id, email: lowerEmail })
          .first('id');
        if (existing) {
          appUserId = existing.id;
        } else {
          const inserted = await trx('app_user')
            .insert({
              tenant_id,
              email: lowerEmail,
              display_name: canonicalizeText(row.display_name),
              locale: 'he',
            })
            .returning('id');
          appUserId = inserted[0]?.id ?? inserted[0];
        }
      }

      // (c) Race-safe color assignment.
      let colorIndex = 0;
      let colorHex = PALETTE[0];
      if (row.team_id) {
        const ouRow = await trx('org_unit')
          .where({ id: row.team_id, tenant_id })
          .forUpdate()
          .first('last_color_index');
        if (!ouRow) {
          rowsErrored++;
          errorDetails.push({
            row_index: row.row_index,
            reason: 'team_id_not_found',
          });
          continue;
        }
        colorIndex = pickNextColor(ouRow.last_color_index);
        colorHex = PALETTE[colorIndex];
        await trx('org_unit')
          .where({ id: row.team_id, tenant_id })
          .update({ last_color_index: colorIndex, updated_at: trx.fn.now() });
      }

      // (d) INSERT soldier — second canonicalizeText layer (Pitfall P2 belt-and-braces).
      const canonicalDisplayName = canonicalizeText(row.display_name);
      const soldierInsert = await trx('soldier')
        .insert({
          tenant_id,
          user_id: appUserId,
          display_name: canonicalDisplayName,
          color: colorHex,
          seniority: typeof row.seniority === 'number' ? row.seniority : 0,
          role_tags: writeRoleTags,
          phone_e164: row.phone_e164 || null,
          status: 'active',
        })
        .returning('id');
      const soldier_id = soldierInsert[0]?.id ?? soldierInsert[0];

      // (e) SELECT-driven membership INSERT when team_id supplied.
      if (row.team_id) {
        await trx.raw(
          `INSERT INTO membership (tenant_id, soldier_id, org_unit_id, role)
           SELECT s.tenant_id, s.id, ou.id, 'member'
             FROM soldier s, org_unit ou
            WHERE s.id = :soldier_id
              AND ou.id = :team_id
              AND s.tenant_id = :tenant_id
              AND ou.tenant_id = :tenant_id
           ON CONFLICT (soldier_id, org_unit_id) DO NOTHING`,
          { soldier_id, team_id: row.team_id, tenant_id }
        );
      }

      // (f) audit row per created soldier.
      await trx('schedule_audit').insert({
        tenant_id,
        planning_window_id: null,
        from_state: null,
        to_state: 'soldier_created_via_csv_import',
        actor_user_id,
        actor_kind: 'user',
        payload: JSON.stringify({
          soldier_id,
          team_id: row.team_id || null,
          source: 'csv',
          role_tags: writeRoleTags,
          app_user_id: appUserId,
          color_index: row.team_id ? colorIndex : null,
        }),
      });

      rowsCreated++;

      // Enqueue for Stage 2 invite dispatch.
      if (row.email && (row.re_invite || !row.is_duplicate)) {
        dispatchQueue.push({
          row_index: row.row_index,
          soldier_id,
          email: row.email,
          displayName: canonicalDisplayName,
        });
      }
    }
  });

  // ── STAGE 2: SYNC Resend dispatch loop (post-commit) ─────────────────────
  // verification_tokens is an Auth.js table; intentionally NOT RLS-protected (PRD §8.3).
  // So Resend dispatch can use a bare Knex instance without tenant context.
  const { default: knex } = await import('knex');
  const db = knex(connection);
  try {
    const backoffSchedule = [1000, 4000, 16000];
    for (let i = 0; i < dispatchQueue.length; i++) {
      const job = dispatchQueue[i];
      let attempt = 0;
      let dispatched = false;
      let lastError = null;
      while (attempt <= backoffSchedule.length) {
        try {
          const r = await sendInvite({
            email: job.email,
            callbackUrl: '/admin_dashboard',
            displayName: job.displayName,
            locale: 'he',
            knexTx: db,
          });
          if (r.error) {
            const msg = (r.error || '').toLowerCase();
            const isRateLimit = msg.includes('429') || msg.includes('rate limit') || msg.includes('too many');
            if (isRateLimit && attempt < backoffSchedule.length) {
              await sleep(backoffSchedule[attempt]);
              attempt++;
              continue;
            }
            lastError = r.error;
            break;
          }
          dispatched = true;
          break;
        } catch (err) {
          const msg = (err?.message || String(err)).toLowerCase();
          const isRateLimit = msg.includes('429') || msg.includes('rate limit') || msg.includes('too many');
          if (isRateLimit && attempt < backoffSchedule.length) {
            await sleep(backoffSchedule[attempt]);
            attempt++;
            continue;
          }
          lastError = err?.message || String(err);
          break;
        }
      }

      if (!dispatched) {
        errorDetails.push({
          row_index: job.row_index,
          soldier_id: job.soldier_id,
          reason: 'resend_failed',
          message: lastError,
        });
      }

      if (i < dispatchQueue.length - 1) {
        await sleep(500);
      }
    }
  } finally {
    await db.destroy();
  }

  // ── STAGE 3: roster_import_log summary (RLS-scoped) ──────────────────────
  // roster_import_log IS RLS-protected, so wrap in withTenantTx.
  const import_id = await withTenantTx(connection, tenant_id, async (trx) => {
    const summaryInsert = await trx('roster_import_log')
      .insert({
        tenant_id,
        imported_by: actor_user_id,
        source: 'csv',
        rows_created: rowsCreated,
        rows_skipped: rowsSkipped,
        rows_errored: rowsErrored,
        error_details: JSON.stringify(errorDetails),
      })
      .returning('id');
    return summaryInsert[0]?.id ?? summaryInsert[0];
  });

  return {
    success: true,
    import_id,
    rowsCreated,
    rowsSkipped,
    rowsErrored,
    errorDetails,
  };
}

CommitRosterImport.schema = {
  type: 'object',
  required: ['rows'],
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          row_index: { type: 'integer', minimum: 0 },
          display_name: { type: 'string' },
          email: { type: 'string' },
          role_tags: { type: 'array', items: { type: 'string' } },
          seniority: { type: 'integer', minimum: 0, maximum: 10 },
          team_id: { type: ['string', 'null'] },
          phone_e164: { type: ['string', 'null'] },
          is_duplicate: { type: 'boolean' },
          unknown_tags: { type: 'array', items: { type: 'string' } },
          status: { enum: ['ok', 'warn', 'error'] },
          re_invite: { type: 'boolean' },
        },
      },
    },
  },
};
CommitRosterImport.connectionType = 'Knex';

export default CommitRosterImport;
