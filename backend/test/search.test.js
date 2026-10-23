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

test('English search returns highlighted hits', async () => {
  const res = await request(app).get('/api/v1/search?q=creation&lang=en&limit=3');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.length > 0);
  assert.ok(res.body.data.some((hit) => /<mark>/.test(hit.snippet)));
  assert.equal(res.body.pagination.limit, 3);
});

test('Arabic search is diacritic-insensitive', async () => {
  const without = await request(app).get('/api/v1/search?q=الخليقة&lang=ar&limit=3');
  const withDiacritics = await request(app).get('/api/v1/search?q=الْخَلِيقَة&lang=ar&limit=3');
  assert.equal(without.status, 200);
  assert.ok(without.body.data.length > 0);
  assert.equal(withDiacritics.body.data.length, without.body.data.length);
});

test('search filters by book and rejects invalid input', async () => {
  const res = await request(app).get('/api/v1/search?q=creation&lang=en&book=genesis');
  assert.ok(res.body.data.every((hit) => hit.book.slug === 'genesis'));
  assert.equal((await request(app).get('/api/v1/search?q=a&lang=en')).status, 400);
  assert.equal((await request(app).get('/api/v1/search?q=creation&lang=fr')).status, 400);
  assert.equal((await request(app).get('/api/v1/search?q=creation&limit=500')).status, 400);
});
