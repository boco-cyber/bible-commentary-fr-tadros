const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { openTestDb } = require('./helpers/db');

const db = openTestDb();
const app = createApp(db, { rateLimitPerMin: 10000 });
test.after(() => db.close());

function versesOf(blocks) {
  return blocks.filter((block) => block.type === 'verses').flatMap((block) => block.verses);
}

test('study interleaves verse ranges with one commentary block after each range', async () => {
  const res = await request(app).get('/api/v1/books/john/chapters/3/study');
  assert.equal(res.status, 200);
  const { data } = res.body;
  assert.equal(data.book.slug, 'john');
  assert.equal(data.chapter.number, 3);
  assert.equal(data.translations.en.id, 'KJV');
  assert.equal(data.translations.en.status, 'available');
  assert.equal(data.translations.ar.id, 'AVD');
  assert.equal(data.translations.ar.status, 'available');

  const { blocks } = data;
  // Chapter introduction
  assert.equal(blocks[0].type, 'commentary');
  assert.deepEqual(blocks[0].verse_ranges, []);
  assert.equal(blocks[0].index, 1);
  assert.deepEqual(Object.keys(blocks[0].content), ['en']);
  assert.deepEqual(versesOf(blocks).map((verse) => verse.number), Array.from({ length: 36 }, (_, index) => index + 1));

  // Chunked blocks for lang=en should have block.lang and content only for that language
  const chunked = blocks.filter((block) => block.type === 'commentary' && block.verse_ranges.length > 0);
  assert.ok(chunked.length > 0);
  for (const block of chunked) {
    assert.equal(block.lang, 'en');
    assert.deepEqual(Object.keys(block.content), ['en']);
  }

  const verse16 = versesOf(blocks).find((verse) => verse.number === 16);
  assert.match(verse16.text.en, /^For God so loved the world/);
  assert.match(verse16.text.ar, /ٱللهُ/);

  const firstChunk = chunked[0];
  assert.equal(firstChunk.type, 'commentary');
  assert.deepEqual(firstChunk.verse_ranges[0], [1, 1]);
  assert.equal(firstChunk.lang, 'en');
  assert.equal(firstChunk.title.en, '1. A Dialogue about the New Birth');
  assert.ok(firstChunk.content.en.html.includes('<p>'));
  assert.ok(firstChunk.url.endsWith(`/api/v1/sections/${firstChunk.id}`));
});

test('study honors lang and format for commentary content', async () => {
  const res = await request(app).get('/api/v1/books/john/chapters/3/study?lang=ar&format=markdown');
  assert.equal(res.status, 200);
  const intro = res.body.data.blocks[0];
  assert.deepEqual(Object.keys(intro.content), ['ar']);
  assert.deepEqual(Object.keys(intro.content.ar), ['markdown']);
  assert.ok(intro.content.ar.markdown.length > 0);
  assert.equal(intro.content.en, undefined);
});

test('study supports both languages and both formats', async () => {
  const res = await request(app).get('/api/v1/books/john/chapters/3/study?lang=both&format=both');
  assert.equal(res.status, 200);
  const intro = res.body.data.blocks[0];
  assert.deepEqual(Object.keys(intro.content).sort(), ['ar', 'en']);
  assert.deepEqual(Object.keys(intro.content.en).sort(), ['html', 'markdown']);
  assert.deepEqual(Object.keys(intro.content.ar).sort(), ['html', 'markdown']);
  assert.deepEqual(Object.keys(intro.references).sort(), ['ar', 'en']);
});

test('study validates parameters and reports missing books', async () => {
  assert.equal((await request(app).get('/api/v1/books/john/chapters/3/study?lang=fr')).status, 400);
  assert.equal((await request(app).get('/api/v1/books/john/chapters/3/study?format=pdf')).status, 400);
  assert.equal((await request(app).get('/api/v1/books/john/chapters/intro/study')).status, 400);
  assert.equal((await request(app).get('/api/v1/books/john/chapters/0/study')).status, 400);
  assert.equal((await request(app).get('/api/v1/books/nope/chapters/1/study')).status, 404);
});

test('study serves deuterocanonical verse positions with null text', async () => {
  const res = await request(app).get('/api/v1/books/wisdom/chapters/1/study');
  assert.equal(res.status, 200);
  const { data } = res.body;
  assert.equal(data.translations.en.status, 'not_found');
  assert.equal(data.translations.ar.status, 'not_found');
  const verses = versesOf(data.blocks);
  assert.equal(verses.length, 16);
  assert.ok(verses.every((verse) => verse.text.en === null && verse.text.ar === null));
  assert.ok(data.blocks.some((block) => block.type === 'commentary' && block.verse_ranges.length > 0));
});

test('study returns verses without commentary for source gaps', async () => {
  const res = await request(app).get('/api/v1/books/exodus/chapters/37/study');
  assert.equal(res.status, 200);
  const { data } = res.body;
  assert.equal(data.blocks.length, 1);
  assert.equal(data.blocks[0].type, 'verses');
  assert.ok(data.blocks[0].verses.length > 0);
  assert.ok(data.blocks[0].verses.every((verse) => verse.text.en && verse.text.ar));
});

test('study requires cache revalidation and supports ETag revalidation', async () => {
  const first = await request(app).get('/api/v1/books/john/chapters/3/study?lang=en&format=html');
  assert.equal(first.status, 200);
  assert.match(first.headers['cache-control'], /public/);
  assert.match(first.headers['cache-control'], /must-revalidate/);
  assert.ok(first.headers.etag);
  const second = await request(app)
    .get('/api/v1/books/john/chapters/3/study?lang=en&format=html')
    .set('If-None-Match', first.headers.etag);
  assert.equal(second.status, 304);
});

test('2 Kings 6 study interleaves verse commentary instead of one block at the end', async () => {
  for (const lang of ['en', 'ar']) {
    const res = await request(app).get(`/api/v1/books/2-kings/chapters/6/study?lang=${lang}`);
    assert.equal(res.status, 200);
    const blocks = res.body.data.blocks;
    assert.equal(blocks[0].type, 'verses');
    const commentary = blocks.filter((block) => block.type === 'commentary');
    assert.ok(commentary.length >= 33);
    assert.deepEqual(commentary[0].verse_ranges, [[1, 1]]);
    assert.equal(commentary[0].title[lang], lang === 'en' ? 'Chapter 6 commentary' : 'تفسير الإصحاح 6');
    const verseOne = blocks.findIndex((block) => block.type === 'verses' && block.verses.some((v) => v.number === 1));
    assert.equal(blocks[verseOne + 1].type, 'commentary');
    assert.deepEqual(blocks[verseOne + 1].verse_ranges, [[1, 1]]);
  }
});
