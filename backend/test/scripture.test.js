const test = require('node:test');
const assert = require('node:assert/strict');
const { createScriptureStore } = require('../src/services/scripture');
const { normalizeScripture } = require('../scripts/import-scripture');
const { openTestDb } = require('./helpers/db');
const { listSectionSummaries } = require('../src/db/queries');

test('all Arabic chapter verses are retained and connected to their actual commentary ranges', () => {
  const db = openTestDb();
  const chapter = db.prepare("SELECT c.id FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='john' AND c.number=3").get();
  const sections = listSectionSummaries(db, chapter.id);
  const data = createScriptureStore().chapter('john', 3, sections);
  assert.equal(data.verses.length, 36);
  assert.match(data.verses.find((verse) => verse.number === 16).text.ar, /ٱللهُ/);
  assert.equal(data.translations.en.id, 'NKJV');
  assert.equal(data.translations.en.status, 'source_required');
  assert.equal(data.verses[0].text.en, null);
  for (const verse of data.verses) {
    assert.deepEqual(verse.sections, sections.filter((section) => JSON.parse(section.verse_ranges_json).some(([start, end]) => verse.number >= start && verse.number <= end)).map((section) => section.section_index));
  }
  db.close();
});

test('missing Scripture and missing commentary are explicit rather than invented', () => {
  const store = createScriptureStore();
  const chapter = store.chapter('wisdom', 1, [{ section_index: 2, verse_ranges_json: '[[1,3]]' }]);
  assert.equal(chapter.translations.ar.status, 'not_found');
  assert.equal(chapter.verses.length, 3);
  assert.equal(chapter.verses[0].text.ar, null);
  assert.deepEqual(store.chapter('john', 3, []).verses[0].sections, []);
});

test('NKJV importer preserves identity and rejects malformed or duplicate verse keys', () => {
  const row = { translation: 'NKJV', book_code: 'John', chapter: 3, verse: 16, text: 'Licensed input fixture' };
  assert.equal(normalizeScripture(JSON.stringify(row))[0].book, 'john');
  for (const invalid of [{ ...row, translation: 'KJV' }, { ...row, chapter: 99 }, { ...row, verse: 0 }, { ...row, text: '' }]) assert.throws(() => normalizeScripture(JSON.stringify(invalid)));
  assert.throws(() => normalizeScripture([row, row].map(JSON.stringify).join('\n')), /Duplicate/);
});

test('Scripture API validates coordinates and returns the bilingual verse contract', async () => {
  const request = require('supertest');
  const { createApp } = require('../src/app');
  const db = openTestDb();
  const app = createApp(db, { rateLimitPerMin: 10000 });
  try {
    const result = await request(app).get('/api/v1/books/john/chapters/3/scripture');
    assert.equal(result.status, 200);
    assert.equal(result.body.data.verses.length, 36);
    assert.ok(result.body.data.verses[15].sections.length);
    for (const chapter of ['intro', '0', '-1', 'bad']) assert.equal((await request(app).get(`/api/v1/books/john/chapters/${chapter}/scripture`)).status, 400);
    assert.equal((await request(app).get('/api/v1/books/john/chapters/999/scripture')).status, 404);
  } finally { db.close(); }
});

test('an authorized English import aligns both languages by verse number', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const zlib = require('node:zlib');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scripture-test-'));
  try {
    for (const [translation, verses] of [['avd', [{ verse: 2, text: 'Arabic fixture two' }, { verse: 1, text: 'Arabic fixture one' }]], ['nkjv', [{ verse: 1, text: 'English fixture one' }]]]) {
      const records = verses.map((verse) => JSON.stringify({ book: 'john', chapter: 3, ...verse })).join('\n');
      fs.writeFileSync(path.join(directory, `${translation}.jsonl.gz`), zlib.gzipSync(records));
    }
    const result = createScriptureStore(directory).chapter('john', 3, []);
    assert.equal(result.translations.en.status, 'available');
    assert.deepEqual(result.verses.map((verse) => verse.number), [1, 2]);
    assert.deepEqual(result.verses[0].text, { en: 'English fixture one', ar: 'Arabic fixture one' });
    assert.equal(result.verses[1].text.en, null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
