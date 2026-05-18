// Minimal Internal API client. Wraps cookie + x-budibase-app-id headers.
//
// Verified endpoints (2026-05-17, Budibase CE 3.38.4):
//   GET    /api/datasources              → list datasources (introspected from PG)
//   GET    /api/screens                  → list screens
//   GET    /api/automations              → list automations
//   GET    /api/queries                  → list queries
//   GET    /api/tables                   → list tables (Budibase DB + PG)
//   GET    /api/roles                    → list roles (ADMIN, BASIC, PUBLIC + custom)
//   POST   /api/queries                  → create query (200, returns _id + _rev)
//   POST   /api/queries/<id>             → execute query (returns row array)
//   DELETE /api/queries/<id>/<rev>       → delete query (200)
//
// All require cookie auth (POST /api/global/auth/default/login first)
// and the `x-budibase-app-id` header pinning the workspace.

import { login } from './login.mjs';

const DEFAULT_APP_URL = process.env.BB_APP || 'http://budibase-app:4002';

export class BudibaseClient {
  constructor({ appUrl = DEFAULT_APP_URL, appId, cookieHeader } = {}) {
    if (!appId) throw new Error('BudibaseClient: appId required');
    if (!cookieHeader) throw new Error('BudibaseClient: cookieHeader required (call login() first)');
    this.appUrl = appUrl;
    this.appId = appId;
    this.cookieHeader = cookieHeader;
  }

  static async connect({ appId, appUrl, username, password, workerUrl } = {}) {
    const { cookieHeader } = await login({ worker: workerUrl, username, password });
    return new BudibaseClient({ appUrl, appId, cookieHeader });
  }

  get _headers() {
    return {
      'Cookie': this.cookieHeader,
      'x-budibase-app-id': this.appId,
      'Content-Type': 'application/json',
    };
  }

  async _req(method, path, body) {
    const r = await fetch(`${this.appUrl}${path}`, {
      method,
      headers: this._headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (r.status < 200 || r.status >= 300) {
      const txt = await r.text().catch(() => '<no body>');
      // WR-03 fix (2026-05-18): keep the FULL body on the Error object so
      // structured-logging callers can capture the actual cause string.
      // The message field stays truncated (300 chars) to keep terminal
      // output legible; bodyText preserves the entire response.
      const err = new Error(`${method} ${path}: HTTP ${r.status} — ${txt.slice(0, 300)}`);
      err.status = r.status;
      err.bodyText = txt;
      throw err;
    }
    const ct = r.headers.get('content-type') || '';
    return ct.includes('application/json') ? r.json() : r.text();
  }

  list(resource) { return this._req('GET', `/api/${resource}`); }

  createQuery(query)        { return this._req('POST',   '/api/queries', query); }
  executeQuery(id, params)  { return this._req('POST',   `/api/queries/${id}`, { parameters: params || {} }); }
  deleteQuery(id, rev)      { return this._req('DELETE', `/api/queries/${id}/${rev}`); }

  // TODO (future plans): createScreen, createAutomation, createDatasource, configsPatch.
  // These were not exercised in the 2026-05-17 spike but the endpoints exist and follow
  // the same auth pattern. Add tests + methods incrementally per use case.
}
