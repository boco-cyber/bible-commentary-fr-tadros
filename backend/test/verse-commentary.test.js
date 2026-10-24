const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 10000 });
test.after(() => db.close());

function sectionId(id) {
  return db.prepare('SELECT id FROM sections WHERE source_record_id = ?').get(id).id;
}

test('returns the commentary chunk for a selected verse', async () => {
  const res = await request(app).get('/api/v1/books/john/chapters/9/verses/1/commentary');
  assert.equal(res.status, 200);
  const { data } = res.body;
  assert.equal(data.number, 1);
  assert.match(data.text.en, /^And as Jesus passed by/);
  assert.match(data.text.ar.replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, ''), /وفيما هو مجتاز/);
  assert.equal(data.translations.en.id, 'KJV');
  assert.equal(data.translations.en.status, 'available');
  assert.equal(data.translations.ar.id, 'AVD');
  assert.equal(data.commentary.length, 1);
  const entry = data.commentary[0];
  assert.equal(entry.section_id, sectionId('nt_4_9:1'));
  assert.equal(entry.index, 2);
  assert.equal(entry.lang, 'en');
  assert.deepEqual([entry.verse_start, entry.verse_end], [1, 1]);
  assert.equal(entry.title.en, '1- Healing of the Blind Man');
  assert.match(entry.content.html, /Now as Jesus passed by/);
  assert.doesNotMatch(entry.content.html, /And His disciples asked/);
  assert.ok(entry.references.length > 0);
  assert.ok(entry.url.endsWith(`/api/v1/sections/${entry.section_id}`));
});

test('returns distinct chunks for verses 2, 3, and 4', async () => {
  const expected = [
    [2, /And His disciples asked/],
    [3, /Jesus answered/],
    [4, /I must work the works/],
  ];
  for (const [verse, pattern] of expected) {
    const res = await request(app).get(`/api/v1/books/john/chapters/9/verses/${verse}/commentary`);
    assert.equal(res.status, 200);
    const entry = res.body.data.commentary[0];
    assert.deepEqual([entry.verse_start, entry.verse_end], [verse, verse]);
    assert.match(entry.content.html, pattern);
  }
});

test('returns both languages and the requested representation', async () => {
  const res = await request(app).get('/api/v1/books/john/chapters/9/verses/1/commentary?lang=both&format=markdown');
  assert.equal(res.status, 200);
  const { commentary } = res.body.data;
  assert.deepEqual(commentary.map((entry) => entry.lang), ['en', 'ar']);
  for (const entry of commentary) {
    assert.deepEqual(Object.keys(entry.content), ['markdown']);
    assert.ok(entry.content.markdown.length > 0);
    assert.ok(entry.references.length > 0);
  }
  assert.match(commentary[0].content.markdown, /Now as Jesus passed by/);
  assert.match(commentary[1].content.markdown, /وفيما هو مجتاز/);
});

test('returns an empty commentary list when the source has no commentary for the verse', async () => {
  const res = await request(app).get('/api/v1/books/psalms/chapters/119/verses/1/commentary');
  assert.equal(res.status, 200);
  assert.ok(res.body.data.text.en);
  assert.deepEqual(res.body.data.commentary, []);
  assert.equal(res.body.data.commentary_status.en.available, false);
  assert.equal(res.body.data.commentary_status.en.message.en, 'No commentary available');
});

test('validates the verse, chapter, language, and format', async () => {
  for (const url of [
    '/api/v1/books/john/chapters/9/verses/0/commentary',
    '/api/v1/books/john/chapters/9/verses/abc/commentary',
    '/api/v1/books/john/chapters/0/verses/1/commentary',
    '/api/v1/books/john/chapters/intro/verses/1/commentary',
    '/api/v1/books/john/chapters/9/verses/1/commentary?lang=fr',
    '/api/v1/books/john/chapters/9/verses/1/commentary?format=pdf',
  ]) {
    assert.equal((await request(app).get(url)).status, 400, url);
  }
  assert.equal((await request(app).get('/api/v1/books/nope/chapters/9/verses/1/commentary')).status, 404);
});

test('requires cache revalidation and supports ETag revalidation', async () => {
  const url = '/api/v1/books/john/chapters/9/verses/1/commentary?lang=en&format=html';
  const first = await request(app).get(url);
  assert.equal(first.status, 200);
  assert.match(first.headers['cache-control'], /must-revalidate/);
  assert.ok(first.headers.etag);
  const second = await request(app).get(url).set('If-None-Match', first.headers.etag);
  assert.equal(second.status, 304);
});


test('unmarked gaps do not repeat adjacent commentary and preserve shared source context', async () => {
  const res = await request(app).get('/api/v1/books/genesis/chapters/4/verses/3/commentary?lang=both');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.commentary.filter((entry) => entry.lang === 'en').length, 0);
  assert.equal(res.body.data.commentary_status.en.available, false);
  assert.equal(res.body.data.commentary_status.en.status, 'shared_only');
  assert.equal(res.body.data.source_commentary_status.en.available, true);
  assert.ok(res.body.data.shared_commentary.some((entry) => entry.lang === 'en' && entry.scope === 'section'));
});

test('missing source chapters explicitly report no commentary', async () => {
  for (let chapter = 36; chapter <= 40; chapter++) {
    const res = await request(app).get(`/api/v1/books/exodus/chapters/${chapter}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.chapter.commentary.available, false);
    assert.equal(res.body.data.chapter.commentary.message.en, 'No commentary available');
    assert.equal(res.body.data.sections.length, 0);
  }
});

test('unsplit source ranges are shared context rather than repeated individual comments', async () => {
  const res = await request(app).get('/api/v1/books/genesis/chapters/1/verses/3/commentary?lang=en');
  assert.equal(res.status, 200);
  assert.equal(res.body.data.commentary.length, 0);
  assert.ok(res.body.data.shared_commentary.some((entry) => entry.scope === 'range' && entry.verse_start === 3 && entry.verse_end === 5));
  assert.equal(res.body.data.source_commentary_status.en.available, true);
});

test('2 Kings 6 section and verse commentary expose attribution and quote metadata', async () => {
  const section = await request(app).get('/api/v1/books/2-kings/chapters/6/sections/1?lang=en');
  assert.equal(section.body.data.title.en, 'Chapter 6 commentary');
  assert.equal(section.body.data.attribution.en, 'Origen');
  assert.equal(section.body.data.kind, 'verse_commentary');
  const verse = await request(app).get('/api/v1/books/2-kings/chapters/6/verses/1/commentary?lang=en&format=markdown');
  assert.ok(verse.body.data.commentary[0].scripture_quote.markdown.includes('sons of the prophets'));
});
