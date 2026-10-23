const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
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

test('request logging is disabled when NODE_ENV is test', async () => {
  const appPath = path.join(__dirname, '..', 'src', 'app');
  const dbPath = path.join(__dirname, 'helpers', 'db');
  const supertestPath = require.resolve('supertest');
  const script = `
    const request = require(${JSON.stringify(supertestPath)});
    const { createApp } = require(${JSON.stringify(appPath)});
    const { openTestDb } = require(${JSON.stringify(dbPath)});
    const db = openTestDb();
    const app = createApp(db, { rateLimitPerMin: 10000 });
    request(app).get('/api/v1/meta').then(() => {
      db.close();
      process.stdout.write('REQUEST_DONE\\n');
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  `;
  const { stdout } = await promisify(execFile)(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
  });
  assert.match(stdout, /REQUEST_DONE/);
  assert.doesNotMatch(stdout, /GET \/api\/v1\/meta/);
});

test('5xx responses never expose vendor error codes', async () => {
  const brokenDb = {
    prepare() {
      const error = new Error('malformed database');
      error.code = 'SQLITE_CORRUPT';
      throw error;
    },
  };
  const app = createApp(brokenDb, { rateLimitPerMin: 10000, logRequests: false });
  const original = console.error;
  console.error = () => {};
  let res;
  try {
    res = await request(app).get('/health');
  } finally {
    console.error = original;
  }
  assert.equal(res.status, 500);
  assert.equal(res.body.error.code, 'INTERNAL_ERROR');
  assert.equal(res.body.error.message, 'Internal server error');
});

test('large JSON responses are gzip compressed', async () => {
  const app = createApp(db, { rateLimitPerMin: 10000 });
  const res = await request(app)
    .get('/api/v1/books')
    .set('Accept-Encoding', 'gzip');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-encoding'], 'gzip');
});
