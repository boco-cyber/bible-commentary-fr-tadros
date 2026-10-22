const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openDb } = require('../src/db/connection');

const DB = process.env.TEST_DB || path.join(__dirname, '.tmp', 'commentary.sqlite');

test('build contains all books, sections, and introductions', () => {
  const db = openDb(DB);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM books').get().n, 67);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sections').get().n, 7590);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chapters WHERE number = 0').get().n, 67);
  assert.equal(db.prepare("SELECT section_count AS n FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='genesis' AND c.number=1").get().n, 9);
  db.close();
});

test('missing Exodus 36-40 are present but empty', () => {
  const db = openDb(DB);
  const rows = db.prepare("SELECT number, section_count FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='exodus' AND number BETWEEN 36 AND 40 ORDER BY number").all();
  assert.deepEqual(rows.map((r) => r.number), [36, 37, 38, 39, 40]);
  assert.ok(rows.every((r) => r.section_count === 0));
  db.close();
});

test('sections contain both languages and safe HTML', () => {
  const db = openDb(DB);
  const row = db.prepare("SELECT * FROM sections WHERE source_record_id='ot_1_1:0'").get();
  assert.equal(row.title_en, 'Chapter Introduction');
  assert.ok(row.content_md_en.includes('Creation'));
  assert.ok(row.content_md_ar.length > 0);
  assert.ok(row.content_html_en.includes('<p>'));
  assert.equal(/<script/i.test(row.content_html_en), false);
  assert.equal(row.content_hash.length, 64);
  db.close();
});

test('meta records schema and counts', () => {
  const db = openDb(DB);
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
  assert.equal(meta.schema_version, '1');
  assert.equal(meta.sections, '7590');
  assert.equal(meta.books, '67');
  db.close();
});
