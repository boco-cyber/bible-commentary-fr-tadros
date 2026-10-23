const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');
const { buildMatchQuery } = require('../src/services/search');

const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 10000 });
test.after(() => db.close());

test('buildMatchQuery quotes terms and preserves phrases', () => {
  assert.equal(buildMatchQuery('creation god'), '"creation" AND "god"');
  assert.equal(buildMatchQuery('"holy spirit" grace'), '"holy spirit" AND "grace"');
  assert.equal(buildMatchQuery('   '), null);
});

test('English search returns highlighted hits with canonical URLs', async () => {
  const res = await request(app).get('/api/v1/search?q=creation&lang=en&limit=3');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length > 0);
  assert.ok(res.body.data.some((hit) => /<mark>/.test(hit.snippet)));
  assert.equal(res.body.pagination.limit, 3);
  for (const hit of res.body.data) {
    assert.equal(
      hit.url,
      `https://commentary.copticfaith.org/api/v1/books/${hit.book.slug}/chapters/${hit.chapter}/sections/${hit.index}?lang=en`,
    );
  }
});

test('search results are ordered by absolute book id', async () => {
  const ids = new Map(db.prepare('SELECT slug, id FROM books').all().map((row) => [row.slug, row.id]));
  const res = await request(app).get('/api/v1/search?q=God&lang=en&limit=50');
  assert.equal(res.status, 200);
  const order = res.body.data.map((hit) => ids.get(hit.book.slug));
  assert.ok(order.length > 1);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('Arabic search is diacritic-insensitive', async () => {
  const without = await request(app).get('/api/v1/search?q=الخليقة&lang=ar&limit=3');
  const withDiacritics = await request(app).get('/api/v1/search?q=الْخَلِيقَة&lang=ar&limit=3');
  assert.equal(without.status, 200);
  assert.ok(without.body.data.length > 0);
  assert.equal(withDiacritics.body.data.length, without.body.data.length);
});

test('search rejects control characters instead of failing', async () => {
  const res = await request(app).get('/api/v1/search?q=a%00b&lang=en');
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'BAD_REQUEST');
});

test('search filters by book and rejects invalid input', async () => {
  const res = await request(app).get('/api/v1/search?q=creation&lang=en&book=genesis');
  assert.ok(res.body.data.every((hit) => hit.book.slug === 'genesis'));
  assert.equal((await request(app).get('/api/v1/search?q=a&lang=en')).status, 400);
  assert.equal((await request(app).get('/api/v1/search?q=creation&lang=fr')).status, 400);
  assert.equal((await request(app).get('/api/v1/search?q=creation&limit=500')).status, 400);
});

test('empty chapter filter means absent and other params must be plain integers', async () => {
  const empty = await request(app).get('/api/v1/search?q=creation&lang=en&chapter=');
  assert.equal(empty.status, 200);
  assert.ok(empty.body.data.length > 0);
  for (const query of [
    'q=creation&limit=1e2',
    'q=creation&offset=0x1',
    'q=creation&chapter=0x1',
    'q=creation&chapter=1.0',
  ]) {
    assert.equal((await request(app).get(`/api/v1/search?${query}`)).status, 400, query);
  }
});
