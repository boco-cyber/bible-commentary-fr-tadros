const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 2 });
test.after(() => db.close());

test('third request over the limit returns 429 with Retry-After', async () => {
  assert.equal((await request(app).get('/api/v1/meta')).status, 200);
  assert.equal((await request(app).get('/api/v1/meta')).status, 200);
  const res = await request(app).get('/api/v1/meta');
  assert.equal(res.status, 429);
  assert.equal(res.headers['retry-after'], '60');
  assert.equal(res.body.error.code, 'RATE_LIMITED');
});
