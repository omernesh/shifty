// Probe: create a minimal workspaceApp + screen, dump round-trip, then delete.
// Run from hpg5 in an ephemeral node:22-alpine container.
import { login } from './login.mjs';

const APP_ID = 'app_dev_169e766804934fd18f2e20200d8fd22d';
const APP_URL = process.env.BB_APP || 'http://budibase-app:4002';

const { cookieHeader } = await login({});

const _headers = {
  'Cookie': cookieHeader,
  'x-budibase-app-id': APP_ID,
  'Content-Type': 'application/json',
};

async function req(method, path, body) {
  const r = await fetch(`${APP_URL}${path}`, {
    method,
    headers: _headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: r.status, text, json: parsed };
}

const log = (label, val) => console.log(`\n===== ${label} =====\n` + JSON.stringify(val, null, 2));

// Step 1: ensure a workspaceApp exists (create one if not)
let wapp;
const wlist = await req('GET', '/api/workspaceApp');
log('listWorkspaceApps', wlist);
if (wlist.json?.workspaceApps?.length > 0) {
  wapp = wlist.json.workspaceApps[0];
} else {
  // Need to create one
  const newWA = await req('POST', '/api/workspaceApp', {
    name: 'Shifty',
    url: '/',
  });
  log('createWorkspaceApp', newWA);
  wapp = newWA.json?.workspaceApp || newWA.json;
}
console.log('Using workspaceApp:', wapp?._id);

// Step 2: create a minimal screen ("Blank")
const newScreen = {
  showNavigation: true,
  width: 'Large',
  props: {
    _id: 'cmp_' + Math.random().toString(36).slice(2, 10),
    _component: '@budibase/standard-components/container',
    _styles: { normal: {}, hover: {}, active: {}, selected: {} },
    _children: [],
    _instanceName: 'Probe Screen',
    layout: 'flex',
    direction: 'column',
    hAlign: 'stretch',
    vAlign: 'top',
    size: 'grow',
    gap: 'M',
  },
  routing: { route: '/__shape_probe', roleId: 'BASIC', homeScreen: false },
  name: 'screen-probe',
  workspaceAppId: wapp._id,
};

const screenResp = await req('POST', '/api/screens', newScreen);
log('createScreen', screenResp);

// Step 3: list to confirm it lands
const listAfter = await req('GET', '/api/screens');
log('listScreens', { status: listAfter.status, count: listAfter.json?.length });

// Step 4: clean up — delete the probe screen
if (screenResp.json?._id && screenResp.json?._rev) {
  const delResp = await req('DELETE', `/api/screens/${screenResp.json._id}/${screenResp.json._rev}`);
  log('deleteScreen', delResp);
}
