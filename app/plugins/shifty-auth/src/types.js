// shifty-auth plugin type registry
// ShiftySessionCallback: hydrates session with {tenant_id, roles, team_ids, locale}
export default {
  authCallbacks: ['ShiftySessionCallback'],
  // No request types in this plugin — auth-only.
};
