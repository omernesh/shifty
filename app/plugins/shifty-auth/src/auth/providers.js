// app/plugins/shifty-auth/src/auth/providers.js
// EmailProvider: wraps next-auth's built-in email (magic-link) provider.
//
// next-auth's EmailProvider is not exported from @lowdefy/plugin-next-auth because it
// uses a different flow (SMTP / nodemailer) vs OAuth providers. We wrap it here so
// Lowdefy's type registry can recognize 'EmailProvider' as a valid auth.providers type.
//
// Called by Lowdefy build system via: import { EmailProvider } from 'shifty-auth/auth/providers'
// Signature per Lowdefy plugin provider convention: EmailProvider({ properties }) → ProviderConfig

import { createRequire } from 'module';

const _require = createRequire(import.meta.url);

/**
 * EmailProvider({ properties }) — next-auth v4 EmailProvider (magic-link / SMTP).
 *
 * @param {object} param0
 * @param {object} param0.properties — Lowdefy provider properties from lowdefy.yaml auth.providers[*]
 *   - server: { host, port, auth: { user, pass } }
 *   - from: string (sender email address)
 *   - maxAge: number (seconds link is valid, default 1800)
 */
export function EmailProvider({ properties } = {}) {
  let emailProviderFactory;
  try {
    // next-auth is a CJS module
    emailProviderFactory = _require('next-auth/providers/email');
  } catch {
    throw new Error(
      'EmailProvider: failed to load next-auth/providers/email. Ensure next-auth is installed.'
    );
  }
  // next-auth exports as default or as named export depending on version
  const Email = emailProviderFactory.default ?? emailProviderFactory;
  return Email(properties ?? {});
}

export default { EmailProvider };
