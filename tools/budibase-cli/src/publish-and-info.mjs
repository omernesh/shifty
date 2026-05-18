// Helper: publish the dev app + print published-app URL for Task 4.
import { BudibaseClient } from './client.mjs';

const APP_ID = process.env.BB_APP_ID || 'app_dev_169e766804934fd18f2e20200d8fd22d';
const c = await BudibaseClient.connect({ appId: APP_ID });

const before = await c.getApp();
console.log('Dev app:', { _id: before._id, appId: before.appId, status: before.status, url: before.url });

console.log('\nPublishing...');
const pub = await c.publishApp();
console.log('publish response:', JSON.stringify(pub, null, 2));

console.log('\nFetching apps?status=all...');
const apps = await c._req('GET', '/api/applications?status=all');
const published = apps.find(a => a.status === 'published');
const dev = apps.find(a => a.status === 'development');
console.log('Published:', published ? { appId: published.appId, url: published.url, updatedAt: published.updatedAt } : 'NONE');
console.log('Dev:', { appId: dev.appId, url: dev.url });
console.log('\nPublished URLs to test in browser:');
console.log('  LAN:    http://hpg5:8080/app' + published.url + '/shift-slots');
console.log('  Public: https://apps.nesher.co/app' + published.url + '/shift-slots');
