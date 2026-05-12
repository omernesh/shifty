// app/plugins/shifty-audit-writer/src/types.js
// Plugin type registry for shifty-audit-writer.
// Registers the AuditWrite request type. The Lowdefy server reads this at startup
// to know which `type:` values in YAML are handled by this plugin.
// TypeName must match exactly the `type:` field used in YAML request blocks.
export default {
  requests: ['AuditWrite'],
};
