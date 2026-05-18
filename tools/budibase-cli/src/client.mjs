// Minimal Internal API client. Wraps cookie + x-budibase-app-id headers.
//
// Verified endpoints (2026-05-18, Budibase CE 3.38.4):
//   GET    /api/datasources              → list datasources (introspected from PG)
//   GET    /api/screens                  → list screens
//   GET    /api/automations              → list automations
//   GET    /api/queries                  → list queries
//   GET    /api/tables                   → list tables (Budibase DB + PG)
//   GET    /api/roles                    → list roles (ADMIN, BASIC, PUBLIC + custom)
//   GET    /api/workspaceApp             → list workspaceApps
//   POST   /api/workspaceApp             → create workspaceApp (body: {name, url})
//   PUT    /api/workspaceApp/<id>        → update workspaceApp
//   POST   /api/queries                  → create OR update query (server distinguishes by _id+_rev)
//   POST   /api/queries/<id>             → execute query (returns row array)
//   DELETE /api/queries/<id>/<rev>       → delete query (200)
//   POST   /api/screens                  → create OR update screen (server distinguishes by _id+_rev)
//   DELETE /api/screens/<id>/<rev>       → delete screen (200)
//   GET    /api/applications/<id>        → fetch app metadata (incl. url + status)
//   GET    /api/applications?status=all  → list apps (dev + published)
//   POST   /api/applications/<id>/publish → publish app changes
//   POST   /api/applications/<id>/unpublish → unpublish app
//
// All require cookie auth (POST /api/global/auth/default/login first)
// and the `x-budibase-app-id` header pinning the workspace.
//
// Methods added in W1-01 Task 1 (2026-05-18):
//   listScreens, createScreen, updateScreen, deleteScreen — covered by tools/test/budibase-client-screens.test.mjs
//   listRoles                                              — covered by tools/test/budibase-client-screens.test.mjs
//   listWorkspaceApps, createWorkspaceApp                  — covered by tools/test/budibase-client-screens.test.mjs
//   updateQuery                                            — used by apply-fixtures.mjs drift path
//   publishApp, getApp                                     — used by apply-fixtures.mjs + Task 4 verification

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

  // ──────────── Queries ────────────
  createQuery(query)        { return this._req('POST',   '/api/queries', query); }
  updateQuery(query)        { return this._req('POST',   '/api/queries', query); }  // same endpoint; server distinguishes by _id+_rev
  executeQuery(id, params)  { return this._req('POST',   `/api/queries/${id}`, { parameters: params || {} }); }
  deleteQuery(id, rev)      { return this._req('DELETE', `/api/queries/${id}/${rev}`); }

  // ──────────── Screens ────────────
  // W1-01 (2026-05-18): Reverse-engineered against bundle + live probe.
  // See tools/budibase-cli/SCREEN-SHAPE.md for the JSON contract.
  listScreens()             { return this._req('GET',    '/api/screens'); }
  createScreen(screen)      { return this._req('POST',   '/api/screens', screen); }
  updateScreen(screen)      { return this._req('POST',   '/api/screens', screen); }  // same endpoint; server distinguishes by _id+_rev
  deleteScreen(id, rev)     { return this._req('DELETE', `/api/screens/${id}/${rev}`); }

  // ──────────── Roles ────────────
  listRoles()               { return this._req('GET',    '/api/roles'); }

  // ──────────── WorkspaceApps ────────────
  // W1-01 (2026-05-18): Discovered during Task 0 probe — every screen MUST
  // reference a workspaceApp _id. Default workspace shipped with empty
  // workspaceApps[]; apply-fixtures.mjs ensures one exists before applying
  // screens. POST body accepts ONLY {name, url} on create — server populates
  // navigation/customTheme/etc. defaults.
  listWorkspaceApps()                { return this._req('GET',    '/api/workspaceApp'); }
  createWorkspaceApp({ name, url })  { return this._req('POST',   '/api/workspaceApp', { name, url }); }
  updateWorkspaceApp(wapp)           { return this._req('PUT',    `/api/workspaceApp/${wapp._id}`, wapp); }

  // ──────────── Application lifecycle ────────────
  getApp()                  { return this._req('GET',    `/api/applications/${this.appId}`); }
  publishApp()              { return this._req('POST',   `/api/applications/${this.appId}/publish`); }
  unpublishApp()            { return this._req('POST',   `/api/applications/${this.appId}/unpublish`); }
}
