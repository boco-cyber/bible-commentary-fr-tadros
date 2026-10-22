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
    assert.ok(rows.every((r) => !('content_raw' in r)), `${lang} includes content_raw`);
    assert.ok(fs.statSync(path.join(DATA, lang, 'sections.jsonl.gz')).size < 100 * 1024 * 1024);
  }
});

test('section records are ordered by absolute book_id', async () => {
  for (const lang of ['en', 'ar']) {
    const rows = await load(lang);
    for (let i = 1; i < rows.length; i += 1) {
      assert.ok(
        rows[i].book_id >= rows[i - 1].book_id,
        `${lang} book_id decreases at row ${i}: ${rows[i - 1].book_id} -> ${rows[i].book_id}`,
      );
    }
  }
});

test('English and Arabic record keys match', async () => {
  const en = new Set((await load('en')).map((r) => r.source_record_id));
  const ar = new Set((await load('ar')).map((r) => r.source_record_id));
  assert.equal(en.size, ar.size);
  for (const key of en) assert.ok(ar.has(key), `missing Arabic key ${key}`);
});

test('catalog has 73 books with 67 included and unique absolute ids', async () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(DATA, 'catalog.json'), 'utf8'));
  assert.equal(catalog.books.length, 73);
  assert.equal(new Set(catalog.books.map((b) => b.id)).size, 73);

  const includedIds = new Set(catalog.books.filter((b) => !b.excluded_from_commentary).map((b) => b.id));
  assert.equal(includedIds.size, 67);

  for (const lang of ['en', 'ar']) {
    const sectionIds = new Set((await load(lang)).map((r) => r.book_id));
    assert.equal(sectionIds.size, 67);
    assert.deepEqual([...sectionIds].sort((a, b) => a - b), [...includedIds].sort((a, b) => a - b));
  }
});
