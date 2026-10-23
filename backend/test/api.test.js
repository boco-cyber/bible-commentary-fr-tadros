const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 10000 });
test.after(() => db.close());

test('meta describes the corpus', async () => {
  const res = await request(app).get('/api/v1/meta');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.books, 67);
  assert.equal(res.body.data.sections, 7590);
  assert.deepEqual(res.body.data.languages, ['en', 'ar']);
  assert.match(res.body.data.attribution, /Tadros/);
});

test('books can be filtered by testament', async () => {
  assert.equal((await request(app).get('/api/v1/books')).body.data.length, 67);
  assert.equal((await request(app).get('/api/v1/books?testament=nt')).body.data.length, 27);
  assert.equal((await request(app).get('/api/v1/books?testament=x')).status, 400);
});

test('book detail lists chapters including the introduction', async () => {
  const res = await request(app).get('/api/v1/books/genesis');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.slug, 'genesis');
  assert.equal(res.body.data.chapters[0].number, 0);
  assert.equal(res.body.data.chapters.find((c) => c.number === 1).section_count, 9);
});

test('missing Exodus chapters are marked unavailable', async () => {
  const res = await request(app).get('/api/v1/books/exodus');
  const chapter = res.body.data.chapters.find((c) => c.number === 37);
  assert.equal(chapter.available, false);
  assert.equal(chapter.section_count, 0);
});

test('chapter detail returns ordered section summaries', async () => {
  const res = await request(app).get('/api/v1/books/genesis/chapters/1');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.chapter.section_count, 9);
  assert.equal(res.body.data.sections[0].index, 1);
  assert.equal('content' in res.body.data.sections[0], false);
});

test('unknown book returns 404 JSON', async () => {
  const res = await request(app).get('/api/v1/books/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, 'NOT_FOUND');
});

test('section by chapter and index returns content and refs', async () => {
  const res = await request(app).get('/api/v1/books/genesis/chapters/1/sections/1?lang=en');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.source_id, 'ot_1_1:0');
  assert.ok(res.body.data.content.html.includes('<p>'));
  assert.ok(res.body.data.content.markdown.length > 0);
  assert.ok(Array.isArray(res.body.data.references));
  assert.equal(res.headers.etag, `"${res.body.data.content_hash}"`);
  assert.match(res.headers['cache-control'], /immutable/);
});

test('section supports markdown-only and Arabic responses', async () => {
  const res = await request(app).get('/api/v1/sections/1?lang=ar&format=markdown');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.content.html, undefined);
  assert.ok(res.body.data.content.markdown.length > 0);
  assert.equal(res.body.data.lang, 'ar');
});

test('matching If-None-Match returns 304', async () => {
  const first = await request(app).get('/api/v1/sections/1');
  const second = await request(app).get('/api/v1/sections/1').set('If-None-Match', first.headers.etag);
  assert.equal(second.status, 304);
});

test('unknown chapter and index return 404', async () => {
  assert.equal((await request(app).get('/api/v1/books/genesis/chapters/999')).status, 404);
  assert.equal((await request(app).get('/api/v1/books/genesis/chapters/1/sections/999')).status, 404);
});

test('invalid language and format return 400', async () => {
  assert.equal((await request(app).get('/api/v1/sections/1?lang=fr')).status, 400);
  assert.equal((await request(app).get('/api/v1/sections/1?format=pdf')).status, 400);
});
