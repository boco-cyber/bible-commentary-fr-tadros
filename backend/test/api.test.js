const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 10000 });
test.after(() => db.close());

function expectedEtag(hash, lang, format) {
  return `"${crypto.createHash('sha256').update(`${hash}:${lang}:${format}`).digest('hex')}"`;
}

test('meta describes the corpus and its provenance', async () => {
  const res = await request(app).get('/api/v1/meta');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.books, 67);
  assert.equal(res.body.data.books_total, 73);
  assert.equal(res.body.data.sections, 7590);
  assert.deepEqual(res.body.data.chunks, { en: 12457, ar: 11955 });
  assert.deepEqual(res.body.data.languages, ['en', 'ar']);
  assert.match(res.body.data.attribution, /Tadros/);
  assert.match(res.body.data.author.ar, /[\u0600-\u06FF]/);
  assert.equal(res.body.data.work.en, 'Bible Commentary');
  assert.match(res.body.data.notice, /permission of the rights holder/);
  assert.match(res.body.data.license, /MIT/);
  assert.deepEqual(res.body.data.dropped_refs, { en: 1, ar: 1 });
  assert.match(res.body.data.source_sha256.en, /^[0-9a-f]{64}$/);
  assert.match(res.body.data.source_sha256.ar, /^[0-9a-f]{64}$/);
  assert.match(res.body.data.content_checksum, /^[0-9a-f]{64}$/);
  assert.equal(res.body.data.schema_version, 4);
  assert.ok(res.body.data.build);
});

test('meta uses the configured site name', async () => {
  const custom = createApp(db, { rateLimitPerMin: 10000, siteName: 'Custom Site' });
  const res = await request(custom).get('/api/v1/meta');
  assert.equal(res.body.data.name, 'Custom Site');
});

test('books can be filtered by testament', async () => {
  assert.equal((await request(app).get('/api/v1/books')).body.data.length, 67);
  assert.equal((await request(app).get('/api/v1/books?testament=nt')).body.data.length, 27);
  assert.equal((await request(app).get('/api/v1/books?testament=x')).status, 400);
});

test('books are ordered by absolute canonical id, not per-testament number', async () => {
  const books = (await request(app).get('/api/v1/books')).body.data;
  const slugs = books.map((book) => book.slug);
  assert.ok(slugs.indexOf('revelation') > slugs.indexOf('malachi'));
  assert.deepEqual(books.map((book) => book.id), [...books.map((book) => book.id)].sort((a, b) => a - b));
});

test('excluded catalog books are not listed or addressable as content', async () => {
  const res = await request(app).get('/api/v1/books');
  assert.equal(res.body.data.some((book) => book.slug === '2-chronicles'), false);
  assert.equal((await request(app).get('/api/v1/books/2-chronicles')).status, 404);
  assert.equal((await request(app).get('/api/v1/books/14')).status, 404);
});

test('section routes support parallel=1 with representation-specific caching', async () => {
  const url = '/api/v1/books/genesis/chapters/1/sections/1?parallel=1&format=both';
  const first = await request(app).get(url);
  assert.equal(first.status, 200);
  assert.equal(first.body.data.en.source_id, 'ot_1_1:0');
  assert.equal(first.body.data.ar.source_id, 'ot_1_1:0');
  assert.ok(first.body.data.en.content.html.length > 0);
  assert.ok(first.body.data.ar.content.markdown.length > 0);
  assert.equal(first.headers.etag, expectedEtag(first.body.data.en.content_hash, 'both', 'both'));
  assert.equal((await request(app).get(url).set('If-None-Match', first.headers.etag)).status, 304);
  const markdown = await request(app).get('/api/v1/sections/1?parallel=1&format=markdown');
  assert.equal(markdown.status, 200);
  assert.notEqual(markdown.headers.etag, first.headers.etag);
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
  const res = await request(app).get('/api/v1/books/genesis/chapters/1/sections/1?lang=en&format=both');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.source_id, 'ot_1_1:0');
  assert.ok(res.body.data.content.html.includes('<p>'));
  assert.ok(res.body.data.content.markdown.length > 0);
  assert.ok(Array.isArray(res.body.data.references));
  assert.equal(res.headers.etag, expectedEtag(res.body.data.content_hash, 'en', 'both'));
  assert.match(res.headers['cache-control'], /immutable/);
});

test('section defaults to html only', async () => {
  const res = await request(app).get('/api/v1/sections/1');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.content.html.length > 0);
  assert.equal(res.body.data.content.markdown, undefined);
  assert.equal(res.headers.etag, expectedEtag(res.body.data.content_hash, 'en', 'html'));
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

test('ETags identify the language and format representation', async () => {
  const paths = [
    '/api/v1/sections/1',
    '/api/v1/sections/1?lang=ar',
    '/api/v1/sections/1?format=markdown',
    '/api/v1/sections/1?lang=ar&format=markdown',
  ];
  const responses = await Promise.all(paths.map((path) => request(app).get(path)));
  const etags = responses.map((res) => res.headers.etag);
  assert.equal(responses.every((res) => res.status === 200), true);
  assert.equal(new Set(etags).size, paths.length);
  assert.equal(
    (await request(app).get(paths[3]).set('If-None-Match', etags[3])).status,
    304,
  );
  assert.equal(
    (await request(app).get('/api/v1/sections/1?lang=ar').set('If-None-Match', etags[3])).status,
    200,
  );
});

test('unknown chapter and index return 404', async () => {
  assert.equal((await request(app).get('/api/v1/books/genesis/chapters/999')).status, 404);
  assert.equal((await request(app).get('/api/v1/books/genesis/chapters/1/sections/999')).status, 404);
});

test('numeric route parameters must be plain integers', async () => {
  for (const path of [
    '/api/v1/sections/1e2',
    '/api/v1/sections/0x10',
    '/api/v1/sections/%201',
    '/api/v1/books/genesis/chapters/0x1',
    '/api/v1/books/genesis/chapters/1.0',
    '/api/v1/books/genesis/chapters/1/sections/1e2',
    '/api/v1/parallel?book=genesis&chapter=1&index=0x1',
  ]) {
    const res = await request(app).get(path);
    assert.equal(res.status, 400, `${path} returned ${res.status}`);
  }
});

test('invalid language and format return 400', async () => {
  assert.equal((await request(app).get('/api/v1/sections/1?lang=fr')).status, 400);
  assert.equal((await request(app).get('/api/v1/sections/1?format=pdf')).status, 400);
});
