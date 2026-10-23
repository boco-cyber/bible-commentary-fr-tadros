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
  const row = db.prepare('SELECT body FROM sections_plain_en LIMIT 1').get();
  assert.equal(/\*\*|\{\{|^#/m.test(row.body), false);
  db.close();
});
