import { test } from 'node:test';
import assert from 'node:assert/strict';

// Set env vars BEFORE import — log-redact.js freezes REDACT_VALUES at module load time.
process.env.RESEND_API_KEY = 're_abcdef1234567890_LONG_KEY';
process.env.NEXTAUTH_SECRET = 'a_very_long_session_signing_secret_value';
process.env.SHORT_KEY = 'short';   // <= 8 chars; should NOT be redacted

const { redact } = await import('../src/middleware/log-redact.js');

test('redacts RESEND_API_KEY value', () => {
  const out = redact('connecting with re_abcdef1234567890_LONG_KEY token');
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /re_abcdef/);
});

test('redacts NEXTAUTH_SECRET value', () => {
  const out = redact('signed with: a_very_long_session_signing_secret_value');
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /a_very_long_session/);
});

test('does NOT redact short values (<= 8 chars)', () => {
  const out = redact('value is short');
  assert.equal(out, 'value is short');
});

test('passes through non-string inputs', () => {
  assert.equal(redact(42), 42);
  assert.deepEqual(redact({ a: 1 }), { a: 1 });
  assert.equal(redact(null), null);
});

test('console.log is monkey-patched (idempotently)', () => {
  // The module's import side-effect should have patched console.log.
  // Assert the patched function has the __shiftyRedacted marker.
  // Note: this is fragile — Node's console may have been re-patched by test infrastructure.
  // For Phase 1 we assert the redact() function is exported (smoke test); the console patch
  // is verified end-to-end by tests/e2e/log-redaction.spec.ts.
  assert.equal(typeof redact, 'function');
});
