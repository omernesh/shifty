// shifty-auth plugin type registry
//
// auth.adapters: KnexAdapter — next-auth database adapter (Shifty Postgres schema)
// auth.callbacks: ShiftySessionCallback — hydrates session with
//   {tenant_id, roles, team_ids, locale}
// auth.providers: EmailProvider — next-auth magic-link/SMTP provider (not bundled in
//   @lowdefy/plugin-next-auth)
// requests: KnexRawTenant — Layer 5 RLS-aware KnexRaw replacement. Wraps every query
//   in a Knex transaction with SET LOCAL app.current_tenant from request.user.tenant_id.
export default {
  auth: {
    adapters: ['KnexAdapter'],
    callbacks: ['ShiftySessionCallback'],
    providers: ['EmailProvider'],
  },
  requests: ['KnexRawTenant'],
};
