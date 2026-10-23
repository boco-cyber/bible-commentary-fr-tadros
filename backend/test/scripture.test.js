const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { createScriptureStore } = require('../src/services/scripture');
const { openTestDb } = require('./helpers/db');
const { listSectionSummaries } = require('../src/db/queries');

const DATA = path.join(__dirname, '..', '..', 'data', 'bible');

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

test('Scripture sources are public-domain with matching counts and hashes', () => {
  for (const [file, translation, verses] of [['kjv', 'KJV', 31102], ['avd', 'AVD', 31104]]) {
    const metadata = JSON.parse(fs.readFileSync(path.join(DATA, `${file}-source.json`), 'utf8'));
    const gzip = fs.readFileSync(path.join(DATA, `${file}.jsonl.gz`));
    assert.equal(metadata.translation, translation);
    assert.match(metadata.license, /public domain/i);
    assert.equal(metadata.verses, verses);
    assert.equal(metadata.books, 66);
    assert.equal(metadata.gzip_sha256, sha256(gzip));
    assert.equal(metadata.jsonl_sha256, sha256(zlib.gunzipSync(gzip)));
  }
});

test('store exposes KJV and AVD metadata with full verse and book counts', () => {
  const store = createScriptureStore();
  assert.equal(store.translations.en.id, 'KJV');
  assert.equal(store.translations.en.name, 'King James Version');
  assert.equal(store.translations.en.verses, 31102);
  assert.equal(store.translations.en.books, 66);
  assert.match(store.translations.en.license, /public domain/i);
  assert.equal(store.translations.ar.id, 'AVD');
  assert.equal(store.translations.ar.verses, 31104);
  assert.equal(store.translations.ar.books, 66);
  assert.match(store.translations.ar.license, /public domain/i);
});

test('chapter retains every KJV and AVD verse and maps commentary ranges', () => {
  const db = openTestDb();
  const chapter = db.prepare("SELECT c.id FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='john' AND c.number=3").get();
  const sections = listSectionSummaries(db, chapter.id);
  const data = createScriptureStore().chapter('john', 3, sections);
  assert.equal(data.verses.length, 36);
  assert.equal(data.translations.en.id, 'KJV');
  assert.equal(data.translations.en.status, 'available');
  assert.equal(data.translations.ar.id, 'AVD');
  assert.equal(data.translations.ar.status, 'available');
  const verse16 = data.verses.find((verse) => verse.number === 16);
  assert.match(verse16.text.en, /^For God so loved the world/);
  assert.match(verse16.text.ar, /ٱللهُ/);
  for (const verse of data.verses) {
    assert.deepEqual(verse.sections, sections.filter((section) => JSON.parse(section.verse_ranges_json).some(([start, end]) => verse.number >= start && verse.number <= end)).map((section) => section.section_index));
  }
  db.close();
});

test('deuterocanonical chapters retain verse positions without Scripture text', () => {
  const db = openTestDb();
  const chapter = db.prepare("SELECT c.id FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='wisdom' AND c.number=1").get();
  const sections = listSectionSummaries(db, chapter.id);
  const data = createScriptureStore().chapter('wisdom', 1, sections);
  assert.equal(data.verses.length, 16);
  assert.equal(data.translations.en.status, 'not_found');
  assert.equal(data.translations.ar.status, 'not_found');
  assert.ok(data.verses.every((verse) => verse.text.en === null && verse.text.ar === null));
  db.close();
});

test('missing commentary is explicit rather than invented', () => {
  const store = createScriptureStore();
  const chapter = store.chapter('john', 3, []);
  assert.equal(chapter.verses.length, 36);
  assert.deepEqual(chapter.verses[0].sections, []);
});
