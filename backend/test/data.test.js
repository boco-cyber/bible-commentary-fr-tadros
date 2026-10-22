const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readJsonlGz } = require('../scripts/lib/jsonl');

const DATA = path.join(__dirname, '..', '..', 'data');

async function load(lang) {
  const rows = [];
  for await (const row of readJsonlGz(path.join(DATA, lang, 'sections.jsonl.gz'))) rows.push(row);
  return rows;
}

test('both languages contain 7,590 trimmed unique records', async () => {
  for (const lang of ['en', 'ar']) {
    const rows = await load(lang);
    assert.equal(rows.length, 7590);
    assert.equal(new Set(rows.map((r) => r.source_record_id)).size, 7590);
    assert.equal(new Set(rows.map((r) => r.book_id)).size, 67);
    assert.equal('content_raw' in rows[0], false);
    assert.ok(fs.statSync(path.join(DATA, lang, 'sections.jsonl.gz')).size < 100 * 1024 * 1024);
  }
});

test('English and Arabic record keys match', async () => {
  const en = new Set((await load('en')).map((r) => r.source_record_id));
  const ar = new Set((await load('ar')).map((r) => r.source_record_id));
  assert.equal(en.size, ar.size);
  for (const key of en) assert.ok(ar.has(key), `missing Arabic key ${key}`);
});

test('catalog has 73 books with 67 included', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(DATA, 'catalog.json'), 'utf8'));
  assert.equal(catalog.books.length, 73);
  assert.equal(catalog.books.filter((b) => !b.excluded_from_commentary).length, 67);
});
