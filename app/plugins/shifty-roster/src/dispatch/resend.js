// app/plugins/shifty-roster/src/dispatch/resend.js
// Shared Resend dispatcher for shifty-roster magic-link invites.
//
// This helper centralizes Resend SDK invocation so plan 06 (InviteLater) and
// plan 08 (CommitRosterImport bulk dispatch) share the same primitive.
//
// Resolution note: createRequire is called with process.cwd() + '/package.json' so that
// Node.js resolves the `resend` SDK from the Lowdefy server's working directory
// (/build/.lowdefy/server/), where it is installed as a top-level dependency.
// Do NOT use import.meta.url for createRequire — pnpm's strict isolation means the plugin's
// own node_modules tree does not contain `resend` symlinks. Same idiom as shifty-auth/providers.js.
//
// ====================================================================================
// IMPORTANT — Assumption A1 (from 02-RESEARCH §"Magic-Link Invites"):
// The verification_tokens.token column holds sha256(rawToken + NEXTAUTH_SECRET) hex.
// This MUST be confirmed against the live node_modules/next-auth source in the running
// container during the plan-08 2-hour spike BEFORE shipping the bulk-invite path
// (T-02-04 in the phase threat register). If the algorithm differs, invite-link clicks
// will fail verification at the NextAuth callback step. Document outcome in plan 08.
// ====================================================================================

import { createRequire } from 'module';
import { randomBytes, createHash } from 'node:crypto';

const serverRequire = createRequire(process.cwd() + '/package.json');

function loadResend() {
  let ResendSdk;
  try {
    ResendSdk = serverRequire('resend');
  } catch {
    throw new Error(
      'sendInvite: failed to load resend SDK from server cwd. ' +
      'Ensure `resend` is in app/package.json dependencies.'
    );
  }
  const ResendCtor = ResendSdk.Resend ?? ResendSdk.default ?? ResendSdk;
  return new ResendCtor(process.env.RESEND_API_KEY);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildInviteHtml({ inviteUrl, displayName, locale }) {
  // RTL Hebrew template per 02-RESEARCH §"Magic-Link Invites".
  // Belt-and-braces: dir + lang attributes on <html>; inline dir + text-align on the
  // wrapping container as well (some Outlook variants drop top-level dir).
  const greeting = displayName ? `שלום ${displayName},` : 'שלום,';
  const langAttr = locale === 'en' ? 'en' : 'he';
  const dirAttr = locale === 'en' ? 'ltr' : 'rtl';
  const subject = locale === 'en' ? 'Invitation to Shifty' : 'הזמנה לשיפטי';
  return `<!doctype html>
<html dir="${dirAttr}" lang="${langAttr}">
<head><meta charset="utf-8"><title>${subject}</title></head>
<body style="direction:${dirAttr};text-align:${dirAttr === 'rtl' ? 'right' : 'left'};font-family:Heebo,Assistant,-apple-system,'Segoe UI',Roboto,sans-serif;color:#000000D9">
<div style="max-width:560px;margin:0 auto;padding:24px;direction:${dirAttr};text-align:${dirAttr === 'rtl' ? 'right' : 'left'}">
  <p>${greeting}</p>
  <p>הוזמנת להצטרף לשיפטי. לחץ על הקישור הבא כדי להיכנס:</p>
  <p><a href="${inviteUrl}" style="display:inline-block;padding:10px 16px;background:#1677FF;color:#FFFFFF;text-decoration:none;border-radius:4px">היכנס לשיפטי</a></p>
  <p style="color:#00000073;font-size:12px">קישור זה תקף ל-30 דקות בלבד.</p>
</div>
</body></html>`;
}

function buildInviteText({ inviteUrl, displayName, locale }) {
  // Plaintext fallback begins with U+200F RLM to force Hebrew display direction
  // in clients that do not honor HTML dir attributes (per RESEARCH §"Magic-Link Invites").
  const RLM = '‏';
  const greeting = displayName ? `${RLM}שלום ${displayName},` : `${RLM}שלום,`;
  return `${greeting}
${RLM}הוזמנת להצטרף לשיפטי. כדי להיכנס, לחץ על הקישור הבא:

${inviteUrl}

${RLM}קישור זה תקף ל-30 דקות בלבד.`;
}

/**
 * sendInvite — generates a magic-link token, persists its hash to verification_tokens,
 * and dispatches a Hebrew-RTL invitation email via Resend.
 *
 * The raw token is generated as randomBytes(32).toString('hex') (256 bits entropy).
 * Storage: sha256(rawToken + NEXTAUTH_SECRET) hex. See Assumption A1 caveat above.
 *
 * @param {object} param0
 * @param {string} param0.email — recipient email (lowercased before storage)
 * @param {string} [param0.callbackUrl] — post-login redirect; defaults to /admin_dashboard
 * @param {string} [param0.displayName] — soldier's display name (for greeting)
 * @param {string} [param0.locale] — 'he' (default) or 'en'
 * @param {object} param0.knexTx — Knex transaction or Knex instance for verification_tokens insert
 * @returns {Promise<{ messageId: string | null, error?: string }>}
 */
export async function sendInvite({ email, callbackUrl, displayName, locale = 'he', knexTx }) {
  if (!email) throw new Error('sendInvite: email is required');
  if (!knexTx) throw new Error('sendInvite: knexTx is required for verification_tokens insert');

  const lowerEmail = String(email).toLowerCase();
  const rawToken = randomBytes(32).toString('hex'); // 256 bits of entropy
  const hashedToken = createHash('sha256')
    .update(rawToken + (process.env.NEXTAUTH_SECRET || ''))
    .digest('hex');

  const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  await knexTx('verification_tokens').insert({
    identifier: lowerEmail,
    token: hashedToken,
    expires,
  });

  const baseUrl = process.env.NEXTAUTH_URL || '';
  const target = encodeURIComponent(callbackUrl || '/admin_dashboard');
  const inviteUrl = `${baseUrl}/api/auth/callback/email?callbackUrl=${target}&token=${rawToken}&email=${encodeURIComponent(lowerEmail)}`;

  const resend = loadResend();
  const fromAddr = process.env.RESEND_FROM_EMAIL;
  const subject = locale === 'en' ? 'Invitation to Shifty' : 'הזמנה לשיפטי';

  try {
    const result = await resend.emails.send({
      from: fromAddr,
      to: [lowerEmail],
      subject,
      html: buildInviteHtml({ inviteUrl, displayName, locale }),
      text: buildInviteText({ inviteUrl, displayName, locale }),
    });
    const messageId = result?.data?.id ?? result?.id ?? null;
    return { messageId };
  } catch (err) {
    return { messageId: null, error: err?.message || String(err) };
  }
}

/**
 * bulkDispatchWithBackoff — sequentially dispatches invites for a batch of rows,
 * spacing calls at ~500 ms (Resend free-tier ~2 req/s budget per 02-RESEARCH
 * §"Resend rate limits"). On HTTP 429 / rate-limit errors, retries with backoff
 * `[1000, 4000, 16000]` ms (NOTF-07 contract). After 3 retries, the row is recorded
 * as failed and the loop continues — this function never throws out of the loop.
 *
 * @param {Array<{ email: string, callbackUrl?: string, displayName?: string, locale?: string, knexTx: object, row_index: number }>} rows
 * @param {(progress: { sent: number, total: number }) => void} [onProgress]
 * @returns {Promise<Array<{ row_index: number, status: 'sent' | 'failed', error?: string, messageId?: string | null }>>}
 */
export async function bulkDispatchWithBackoff(rows, onProgress) {
  const results = [];
  const total = rows.length;
  const backoffSchedule = [1000, 4000, 16000]; // NOTF-07: 1s / 4s / 16s

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let attempt = 0;
    let outcome = null;

    while (attempt <= backoffSchedule.length) {
      try {
        const r = await sendInvite(row);
        if (r.error) {
          // Inspect error string for rate-limit signature
          const msg = (r.error || '').toLowerCase();
          const isRateLimit = msg.includes('429') || msg.includes('rate limit') || msg.includes('too many');
          if (isRateLimit && attempt < backoffSchedule.length) {
            await sleep(backoffSchedule[attempt]);
            attempt++;
            continue;
          }
          outcome = { row_index: row.row_index, status: 'failed', error: r.error };
          break;
        }
        outcome = { row_index: row.row_index, status: 'sent', messageId: r.messageId };
        break;
      } catch (err) {
        const msg = (err?.message || String(err)).toLowerCase();
        const isRateLimit = msg.includes('429') || msg.includes('rate limit') || msg.includes('too many');
        if (isRateLimit && attempt < backoffSchedule.length) {
          await sleep(backoffSchedule[attempt]);
          attempt++;
          continue;
        }
        outcome = { row_index: row.row_index, status: 'failed', error: err?.message || String(err) };
        break;
      }
    }

    results.push(outcome);
    if (typeof onProgress === 'function') {
      const sent = results.filter((r) => r.status === 'sent').length;
      try { onProgress({ sent, total }); } catch { /* swallow progress errors */ }
    }
    // ~2 req/s pacing per Resend free tier — only sleep if more rows remain
    if (i < rows.length - 1) await sleep(500);
  }

  return results;
}

export default { sendInvite, bulkDispatchWithBackoff };
