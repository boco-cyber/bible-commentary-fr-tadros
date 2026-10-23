const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { openDb } = require('../src/db/connection');
const { normalizeForSearch } = require('../src/services/normalize');

const DB = process.env.TEST_DB || path.join(__dirname, '.tmp', 'commentary.sqlite');

test('English FTS finds creation commentary', () => {
  const db = openDb(DB);
  const rows = db.prepare('SELECT rowid FROM sections_fts_en WHERE sections_fts_en MATCH ? LIMIT 5').all('"creation"');
  assert.ok(rows.length > 0);
  db.close();
});

test('Arabic FTS matches with and without diacritics', () => {
  const db = openDb(DB);
  const plain = normalizeForSearch('الخليقة');
  assert.equal(plain, 'الخليقه');
  const rows = db.prepare('SELECT rowid FROM sections_fts_ar WHERE sections_fts_ar MATCH ? LIMIT 5').all(`"${plain}"`);
  assert.ok(rows.length > 0);
  assert.equal(normalizeForSearch('الْخَلِيقَة'), plain);
  db.close();
});

test('plain bodies contain no markdown or raw markup', () => {
  const db = openDb(DB);
  for (const table of ['sections_plain_en', 'sections_plain_ar']) {
    const rows = db.prepare(`SELECT id, title, body FROM ${table}`).all();
    for (const row of rows) {
      assert.doesNotMatch(row.body, /---|\\|\{\{|\}\}|\*\*|^#/m, `${table} id ${row.id} contains markup`);
      assert.doesNotMatch(row.title, /---|\\|\{\{|\}\}|\*\*|^#/m, `${table} id ${row.id} title contains markup`);
    }
  }
  db.close();
});

test('horizontal rules and backslash escapes are removed from every plain body', () => {
  const db = openDb(DB);
  for (const table of ['sections_plain_en', 'sections_plain_ar']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE body LIKE '%---%'`).get().n, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE instr(body, '\\') > 0`).get().n, 0);
  }
  db.close();
});
