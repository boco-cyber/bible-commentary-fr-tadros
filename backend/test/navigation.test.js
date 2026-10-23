const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');
const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 10000 });
test.after(() => db.close());

test('navigation exposes catalog, ordered chapters, verses and section associations', async () => {
  const res = await request(app).get('/api/v1/navigation?book=matthew&chapter=2');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.books.length, 73);
  assert.equal(res.body.data.verses.length, 23);
  assert.ok(res.body.data.verses[0].sections.includes(2));
  assert.equal(res.body.data.sections[0].verse_ranges.length, 0);
  assert.equal((await request(app).get('/api/v1/navigation?chapter=2')).status, 400);
  assert.equal((await request(app).get('/api/v1/navigation?book=john&chapter=999')).status, 404);
});

test('reference resolver handles aliases, ranges, Arabic names and invalid locations', async () => {
  for (const reference of ['John 3:16-18', 'Jn 3:16-18', 'يوحنا ٣:١٦-١٨']) {
    const res = await request(app).get('/api/v1/resolve').query({ q: reference });
    assert.equal(res.status, 200, reference);
    assert.equal(res.body.data.verses.length, 3);
    assert.match(res.body.data.verses[0].text.en, /For God so loved/);
  }
  assert.equal((await request(app).get('/api/v1/resolve?q=John%203:999')).status, 404);
  const chapter = await request(app).get('/api/v1/resolve?q=John%203');
  assert.equal(chapter.body.data.verses.length, 36);
  assert.equal((await request(app).get('/api/v1/books/revelation/chapters/1/scripture')).status, 200);
  assert.equal((await request(app).get('/api/v1/resolve?q=John%203:18-16')).status, 400);
  assert.equal((await request(app).get('/api/v1/resolve?q=unknown%203:16')).status, 404);
});

test('indexed Bible search finds words and phrases with filters and pagination', async () => {
  const res = await request(app).get('/api/v1/scripture/search').query({ q: '"God so loved"', book: 'john', limit: 1 });
  assert.equal(res.status, 200);
  assert.equal(res.body.data[0].reference, 'John 3:16');
  assert.equal(res.body.meta.translation, 'KJV');
  const first = await request(app).get('/api/v1/scripture/search?q=love&limit=1');
  const next = await request(app).get('/api/v1/scripture/search?q=love&limit=1&offset=1');
  assert.ok(first.body.pagination.total > 1);
  assert.notEqual(first.body.data[0].reference, next.body.data[0].reference);
  const arabic = await request(app).get('/api/v1/scripture/search').query({ q: 'الله', lang: 'ar', book: 'john' });
  assert.equal(arabic.status, 200);
  assert.ok(arabic.body.pagination.total > 0);
  for (const query of ['q=a', 'q=love&limit=0', 'q=love&lang=xx', 'q=%22%22', 'q=love&offset=-1']) assert.equal((await request(app).get(`/api/v1/scripture/search?${query}`)).status, 400);
});

test('database contains both complete Scripture translations and index', () => {
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM scripture_verses WHERE lang='en'").get().n, 31102);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM scripture_verses WHERE lang='ar'").get().n, 31104);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM scripture_fts').get().n, 62206);
});
