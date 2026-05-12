// app/plugins/shifty-auth/src/auth/providers.js
// EmailProvider: wraps next-auth's built-in email (magic-link) provider.
//
// next-auth's EmailProvider is not exported from @lowdefy/plugin-next-auth because it
// uses a different flow (SMTP / nodemailer) vs OAuth providers. We wrap it here so
// Lowdefy's type registry can recognize 'EmailProvider' as a valid auth.providers type.
//
// Called by Lowdefy build system via: import { EmailProvider } from 'shifty-auth/auth/providers'
// Signature per Lowdefy plugin provider convention: EmailProvider({ properties }) → ProviderConfig
//
// Resolution note: createRequire is called with process.cwd() + '/package.json' so that
// Node.js resolves next-auth and nodemailer from the Lowdefy server's working directory
// (/build/.lowdefy/server/), where both packages are installed as direct dependencies
// (nodemailer via the top-level app package.json → Lowdefy server lockfile).
// Do NOT use import.meta.url for createRequire — pnpm's strict isolation means the plugin's
// own node_modules tree does not contain next-auth or nodemailer symlinks.

import { createRequire } from 'module';

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
  // Resolve next-auth from the server's working directory (process.cwd() = /build/.lowdefy/server)
  // where next-auth and nodemailer are installed as top-level dependencies.
  const serverRequire = createRequire(process.cwd() + '/package.json');
  let emailProviderFactory;
  try {
    emailProviderFactory = serverRequire('next-auth/providers/email');
  } catch {
    throw new Error(
      'EmailProvider: failed to load next-auth/providers/email from server cwd. ' +
      'Ensure nodemailer is in app/package.json dependencies.'
    );
  }
  // next-auth exports as default or as named export depending on version
  const Email = emailProviderFactory.default ?? emailProviderFactory;
  return Email(properties ?? {});
}

export default { EmailProvider };
