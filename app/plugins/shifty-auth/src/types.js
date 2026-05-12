// shifty-auth plugin type registry
// ShiftySessionCallback: hydrates session with {tenant_id, roles, team_ids, locale}
// KnexAdapter: next-auth database adapter backed by the Shifty Postgres schema
export default {
  auth: {
    adapters: ['KnexAdapter'],
    callbacks: ['ShiftySessionCallback'],
  },
  // No request types in this plugin — auth-only.
};
