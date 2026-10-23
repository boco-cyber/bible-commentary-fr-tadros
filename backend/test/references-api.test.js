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

test('references expose the target book slug, including excluded books', async () => {
  const res = await request(app).get('/api/v1/references?book=2-chronicles&chapter=20&verse=7&lang=en');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length > 0);
  assert.equal(res.body.data[0].reference.book_slug, '2-chronicles');
  assert.deepEqual(res.body.data[0].reference.book.name.en, '2 Chronicles');
});

test('section references include the target book slug', async () => {
  const row = db.prepare("SELECT id FROM sections WHERE source_record_id='ot_1_18:0'").get();
  const res = await request(app).get(`/api/v1/sections/${row.id}?lang=en`);
  assert.equal(res.status, 200);
  const ref = res.body.data.references.find((item) => item.book_id === 14);
  assert.ok(ref);
  assert.equal(ref.book_slug, '2-chronicles');
  assert.equal(ref.book.name.en, '2 Chronicles');
});

test('reference results are ordered by absolute book id', async () => {
  const ids = new Map(db.prepare('SELECT slug, id FROM books').all().map((row) => [row.slug, row.id]));
  const res = await request(app).get('/api/v1/references?book=genesis&chapter=1&verse=1&lang=en&limit=50');
  assert.equal(res.status, 200);
  const order = res.body.data.map((row) => ids.get(row.book.slug));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('strict integer query parameters are enforced', async () => {
  for (const query of [
    'book=genesis&chapter=0x1&verse=1',
    'book=genesis&chapter=1&verse=%201',
    'book=genesis&chapter=1&verse=1&limit=1e2',
    'book=genesis&chapter=1&verse=1&offset=1.0',
  ]) {
    assert.equal((await request(app).get(`/api/v1/references?${query}`)).status, 400, query);
  }
});
