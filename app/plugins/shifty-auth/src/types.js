// shifty-auth plugin type registry
// KnexAdapter: next-auth database adapter backed by the Shifty Postgres schema
// ShiftySessionCallback: hydrates session with {tenant_id, roles, team_ids, locale}
// EmailProvider: next-auth magic-link / SMTP provider (not in @lowdefy/plugin-next-auth)
export default {
  auth: {
    adapters: ['KnexAdapter'],
    callbacks: ['ShiftySessionCallback'],
    providers: ['EmailProvider'],
  },
  // No request types in this plugin — auth-only.
};
