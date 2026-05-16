// tests/unit/invite-email-rtl.spec.ts
// Task 7 of Plan 02-11: RTL email smoke — automated.
//
// WHY THIS IS A UNIT TEST (not an e2e against Resend test mode):
// Resend's test API keys (`re_test_...`) accept calls and fire webhook events but
// do NOT expose rendered HTML body inspection inline via the SDK response. The
// only path to assert on the actual rendered HTML through Resend test mode is to
// run a publicly-reachable webhook listener and parse the `email.sent` event payload.
// That's well beyond a unit-test scope.
//
// The honest alternative — and the deliverable Plan 02-11 Task 7 calls out — is to
// assert the RTL markers on the OUTPUT of the template generator. This is the
// load-bearing claim: any email Resend delivers WILL contain these markers because
// they are baked into the function output, not generated downstream.
//
// CLAUDE.md §"Hebrew RTL email template — the canonical pattern" lists the markers:
//   1. `<html dir="rtl" lang="he">` on the root element.
//   2. `direction: rtl; text-align: right` on the wrapping container (defense
//      against Outlook variants that drop `<html dir>`).
//   3. (Optional, not in v1 template) `<span style="unicode-bidi: embed; ...">`
//      for embedded LTR content — Phase 3 polish candidate per the v1 template.
//
// PRD §"Outlook RTL email + plaintext U+200F prefix" requires the plaintext
// fallback to begin each line with U+200F RLM. Asserted here for the text variant.
//
// Run: node --test --experimental-strip-types tests/unit/invite-email-rtl.spec.ts
// Or via root package.json: npm run test:unit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInviteHtml,
  buildInviteText,
} from '../../app/plugins/shifty-plugin/src/dispatch/resend.js';

const HE_SAMPLE = {
  inviteUrl: 'https://apps.nesher.co/api/auth/callback/email?token=abc',
  displayName: 'נועם גלאל',
  locale: 'he',
};

const EN_SAMPLE = {
  inviteUrl: 'https://apps.nesher.co/api/auth/callback/email?token=abc',
  displayName: 'Noam Glalal',
  locale: 'en',
};

// ─── HTML template — Hebrew (RTL) ─────────────────────────────────────────────
test('invite-email-rtl: he template has dir="rtl" lang="he" on <html>', () => {
  const html = buildInviteHtml(HE_SAMPLE);
  // The canonical pair per CLAUDE.md §"Hebrew RTL email template".
  assert.match(
    html,
    /<html\s+dir="rtl"\s+lang="he">/,
    'expected <html dir="rtl" lang="he"> — both attributes required (different email clients respect different ones)'
  );
});

test('invite-email-rtl: he template has direction:rtl + text-align:right on wrapping container', () => {
  const html = buildInviteHtml(HE_SAMPLE);
  // Inline CSS belt-and-braces — Outlook variants drop top-level `dir`.
  assert.match(
    html,
    /direction:rtl/,
    'expected inline `direction:rtl` (some Outlook variants drop <html dir>)'
  );
  assert.match(
    html,
    /text-align:right/,
    'expected inline `text-align:right` for RTL paragraph alignment'
  );
});

test('invite-email-rtl: he template includes Hebrew subject + greeting', () => {
  const html = buildInviteHtml(HE_SAMPLE);
  // Subject in <title> + greeting in body. These prove the Hebrew copy actually
  // landed in the output (not just RTL chrome around empty/English content).
  assert.match(html, /הזמנה לשיפטי/, 'expected Hebrew subject "הזמנה לשיפטי" in <title>');
  assert.match(html, /שלום נועם גלאל/, 'expected personalized Hebrew greeting');
  assert.match(html, /היכנס לשיפטי/, 'expected Hebrew CTA "היכנס לשיפטי"');
});

test('invite-email-rtl: he template embeds the magic-link URL', () => {
  const html = buildInviteHtml(HE_SAMPLE);
  // Token round-trip: the URL we passed in must appear verbatim in the rendered HTML.
  assert.match(
    html,
    /https:\/\/apps\.nesher\.co\/api\/auth\/callback\/email\?token=abc/,
    'expected magic-link URL to appear in rendered HTML'
  );
});

// ─── HTML template — English (LTR alternative path) ───────────────────────────
test('invite-email-rtl: en template has dir="ltr" lang="en" on <html>', () => {
  const html = buildInviteHtml(EN_SAMPLE);
  assert.match(
    html,
    /<html\s+dir="ltr"\s+lang="en">/,
    'en locale must flip <html> to dir=ltr lang=en'
  );
});

test('invite-email-rtl: en template has direction:ltr + text-align:left on wrapping container', () => {
  const html = buildInviteHtml(EN_SAMPLE);
  assert.match(html, /direction:ltr/, 'en locale must use direction:ltr inline');
  assert.match(html, /text-align:left/, 'en locale must use text-align:left for LTR alignment');
});

test('invite-email-rtl: en template uses English subject + CTA', () => {
  const html = buildInviteHtml(EN_SAMPLE);
  assert.match(html, /Invitation to Shifty/, 'en locale must use "Invitation to Shifty" subject');
});

// ─── Plaintext fallback — U+200F RLM prefix per PRD ──────────────────────────
test('invite-email-rtl: he plaintext fallback prefixes lines with U+200F RLM', () => {
  const text = buildInviteText(HE_SAMPLE);
  const RLM = '‏';
  // First line is the greeting; PRD §"Outlook RTL email + plaintext U+200F prefix"
  // requires Hebrew lines to begin with RLM so clients without HTML support
  // (or with HTML disabled) render right-to-left.
  assert.ok(
    text.startsWith(RLM),
    `expected plaintext to begin with U+200F RLM, got first char U+${text.charCodeAt(0).toString(16).toUpperCase()}`
  );
  // The greeting line includes the soldier's name.
  assert.ok(text.includes('שלום נועם גלאל'), 'plaintext should include Hebrew greeting with name');
});

test('invite-email-rtl: he plaintext includes the magic-link URL on its own line', () => {
  const text = buildInviteText(HE_SAMPLE);
  assert.ok(
    text.includes('https://apps.nesher.co/api/auth/callback/email?token=abc'),
    'plaintext fallback must include the magic-link URL'
  );
});

// ─── Display-name optionality ────────────────────────────────────────────────
test('invite-email-rtl: he template without displayName uses bare "שלום," greeting', () => {
  const html = buildInviteHtml({ ...HE_SAMPLE, displayName: undefined });
  // Anchored: NOT followed by a name token.
  assert.match(html, /<p>שלום,<\/p>/, 'expected bare "שלום," when displayName is undefined');
});

test('invite-email-rtl: he plaintext without displayName uses bare RLM+"שלום," greeting', () => {
  const text = buildInviteText({ ...HE_SAMPLE, displayName: undefined });
  const RLM = '‏';
  // First line: RLM + "שלום," + comma + newline.
  assert.ok(
    text.startsWith(`${RLM}שלום,`),
    `expected plaintext to begin with RLM+שלום, when displayName undefined`
  );
});

// ─── Locale fallback ─────────────────────────────────────────────────────────
test('invite-email-rtl: missing locale defaults to Hebrew (he)', () => {
  // buildInviteHtml doesn't have a default param — locale must be passed.
  // But sendInvite() defaults locale='he', so this assertion documents that
  // the only callers reaching buildInviteHtml see explicit 'he' or 'en'.
  // (If a future caller forgets the locale, the template will render in `lang="he"`
  //  because the conditional is `locale === 'en' ? ... : 'he'`.)
  const html = buildInviteHtml({ ...HE_SAMPLE, locale: undefined });
  assert.match(html, /<html\s+dir="rtl"\s+lang="he">/);
});
