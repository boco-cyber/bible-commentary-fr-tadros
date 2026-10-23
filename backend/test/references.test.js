const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openDb } = require('../src/db/connection');

const DB = process.env.TEST_DB || path.join(__dirname, '.tmp', 'commentary.sqlite');

test('reference segments are stored per language', () => {
  const db = openDb(DB);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM section_refs WHERE lang='en'").get().n, 43326);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM section_refs WHERE lang='ar'").get().n, 45234);
  db.close();
});

test('a known reference is queryable', () => {
  const db = openDb(DB);
  const row = db.prepare(`SELECT sr.* FROM section_refs sr
    WHERE sr.book_id=73 AND sr.chapter=20 AND sr.verse_start=2 AND sr.lang='en' LIMIT 1`).get();
  assert.ok(row);
  assert.equal(row.ref_type, 'single');
  assert.ok(row.label.startsWith('Revelation'));
  assert.equal(db.prepare('SELECT included FROM books WHERE id = ?').get(73).included, 1);
  db.close();
});

test('references can target an excluded catalog book', () => {
  const db = openDb(DB);
  const book = db.prepare("SELECT id, included FROM books WHERE slug = '2-chronicles'").get();
  assert.equal(book.included, 0);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM section_refs WHERE book_id = ?').get(book.id).n > 0);
  db.close();
});
