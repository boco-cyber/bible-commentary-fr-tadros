const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

const db = openTestDb();
test.after(() => db.close());

test('helmet security headers and default CORS are applied', async () => {
  const app = createApp(db, { rateLimitPerMin: 10000 });
  const res = await request(app).get('/api/v1/meta').set('Origin', 'https://example.org');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('Swagger UI CSP allows inline scripts and styles', async () => {
  const app = createApp(db, { rateLimitPerMin: 10000 });
  const res = await request(app).get('/docs/');
  const csp = res.headers['content-security-policy'];
  assert.ok(csp, 'content-security-policy header is missing');
  assert.match(csp, /script-src 'self' 'unsafe-inline'/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
  assert.match(csp, /img-src 'self' data:/);
});

test('CORS allows only configured origins when CORS_ORIGINS is a list', async () => {
  const app = createApp(db, {
    rateLimitPerMin: 10000,
    corsOrigins: 'https://one.example,https://two.example',
  });
  const allowed = await request(app)
    .get('/api/v1/meta')
    .set('Origin', 'https://two.example');
  assert.equal(allowed.headers['access-control-allow-origin'], 'https://two.example');

  const denied = await request(app)
    .get('/api/v1/meta')
    .set('Origin', 'https://evil.example');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

test('large JSON responses are gzip compressed', async () => {
  const app = createApp(db, { rateLimitPerMin: 10000 });
  const res = await request(app)
    .get('/api/v1/books')
    .set('Accept-Encoding', 'gzip');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-encoding'], 'gzip');
});
