const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 10000 });
test.after(() => db.close());

test('parallel returns both languages for one section', async () => {
  const res = await request(app).get('/api/v1/parallel?book=genesis&chapter=1&index=1');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.en.source_id, res.body.data.ar.source_id);
  assert.ok(res.body.data.en.content.html.length > 0);
  assert.ok(res.body.data.ar.content.html.length > 0);
});

test('references returns sections citing a verse', async () => {
  const res = await request(app).get('/api/v1/references?book=revelation&chapter=20&verse=2&lang=en');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length > 0);
  assert.ok(res.body.pagination.total > 0);
  assert.equal(res.body.data[0].reference.chapter, 20);
});

test('references filters by language and paginates', async () => {
  const en = await request(app).get('/api/v1/references?book=revelation&chapter=20&verse=2&lang=en&limit=1');
  const ar = await request(app).get('/api/v1/references?book=revelation&chapter=20&verse=2&lang=ar&limit=1');
  assert.equal(en.body.data.length, 1);
  assert.equal(ar.body.data.length, 1);
  assert.equal(en.body.pagination.limit, 1);
});

test('unknown verse returns 404', async () => {
  const res = await request(app).get('/api/v1/references?book=genesis&chapter=1&verse=999');
  assert.equal(res.status, 404);
});
