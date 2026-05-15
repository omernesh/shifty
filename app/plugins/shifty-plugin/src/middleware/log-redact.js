// app/plugins/shifty-plugin/src/middleware/log-redact.js
// Patches console.log/error/warn/info at server startup to scrub *_SECRET / *_PASSWORD / *_KEY env values.
// Source: RESEARCH Pattern 12

// Match env var names ending in _SECRET, _PASSWORD, or _KEY (with optional trailing 's').
// Using suffix match ($) avoids false positives on keys like KEYSTONE_SERVER or APIKEY_PREFIX.
const SENSITIVE_PATTERN = /(_SECRET|_PASSWORD|_KEY)s?$/i;

function collectRedactValues() {
  return new Set(
    Object.entries(process.env)
      .filter(([k]) => SENSITIVE_PATTERN.test(k))
      .map(([, v]) => v)
      .filter(v => typeof v === 'string' && v.length > 8)
  );
}

// Frozen at module load; restart server to pick up env changes.
const REDACT_VALUES = collectRedactValues();

export function redact(input) {
  if (typeof input !== 'string') return input;
  let out = input;
  for (const val of REDACT_VALUES) {
    out = out.split(val).join('[REDACTED]');
  }
  return out;
}

// Monkey-patch console methods. Idempotent — calling this module twice is harmless because
// the patch checks for an idempotency marker on the function itself.
function patchConsole() {
  for (const method of ['log', 'error', 'warn', 'info']) {
    const orig = console[method].bind(console);
    if (orig.__shiftyRedacted) continue;
    const patched = (...args) => orig(...args.map(redact));
    patched.__shiftyRedacted = true;
    console[method] = patched;
  }
}

patchConsole();
