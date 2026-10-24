const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

test('GET /health returns ok', async () => {
  const res = await request(createApp(null)).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok', service: 'bible-commentary-fr-tadros' });
});

test('GET /health is not cacheable', async () => {
  const res = await request(createApp(null)).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('GET /health reports schema version and content checksum', async () => {
  const db = openTestDb();
  const res = await request(createApp(db)).get('/health');
  db.close();
  assert.equal(res.status, 200);
  assert.equal(res.body.schema_version, 5);
  assert.match(res.body.checksum, /^[0-9a-f]{64}$/);
  assert.equal(res.body.books, 67);
  assert.equal(res.body.sections, 7590);
  assert.ok(res.body.build);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('unknown route returns JSON 404', async () => {
  const res = await request(createApp(null)).get('/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});
