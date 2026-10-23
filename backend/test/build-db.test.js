const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { openDb } = require('../src/db/connection');
const { buildDb, EXPECTED } = require('../scripts/build-db');

const DB = process.env.TEST_DB || path.join(__dirname, '.tmp', 'commentary.sqlite');
const CATALOG = path.join(__dirname, '..', '..', 'data', 'catalog.json');

function writeJsonlGz(file, rows) {
  fs.writeFileSync(file, zlib.gzipSync(rows.map((row) => JSON.stringify(row)).join('\n') + '\n'));
}

function makeSection(index, overrides = {}) {
  return {
    source_record_id: `test_${index}`,
    book_id: 1,
    book_number: 1,
    testament: 'ot',
    chapter: 1,
    sequence_number: index,
    section_index: index,
    section_count: EXPECTED.sections,
    title: `Section ${index}`,
    source_title: `Section ${index}`,
    verse_start: null,
    verse_end: null,
    verse_ranges: [],
    content_markdown: `# Section ${index}\n\nBody.`,
    ...overrides,
  };
}

function makeDataDir(t, enRows, arRows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commentary-build-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'en'));
  fs.mkdirSync(path.join(dir, 'ar'));
  fs.copyFileSync(CATALOG, path.join(dir, 'catalog.json'));
  writeJsonlGz(path.join(dir, 'en', 'sections.jsonl.gz'), enRows);
  writeJsonlGz(path.join(dir, 'ar', 'sections.jsonl.gz'), arRows);
  return dir;
}

function openDescriptorsReferencing(fragment) {
  const fdDir = '/proc/self/fd';
  if (!fs.existsSync(fdDir)) return [];
  return fs.readdirSync(fdDir).filter((fd) => {
    try {
      return fs.readlinkSync(path.join(fdDir, fd)).includes(fragment);
    } catch {
      return false;
    }
  });
}

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

test('successful build leaves no temporary output behind', () => {
  const leftovers = fs.readdirSync(path.dirname(DB))
    .filter((name) => name.startsWith(`${path.basename(DB)}.tmp-`));
  assert.deepEqual(leftovers, []);
});

test('build rejects duplicate source_record_id instead of silently deduplicating', async (t) => {
  const row = makeSection(1);
  const dir = makeDataDir(t, [row, row], [row]);
  const outFile = path.join(dir, 'commentary.sqlite');

  await assert.rejects(
    buildDb({ dataDir: dir, outFile }),
    /Duplicate source_record_id test_1 in .*sections\.jsonl\.gz/,
  );
  assert.equal(fs.existsSync(outFile), false);
});

test('build rejects unconsumed sections and preserves the old output', async (t) => {
  const enRows = Array.from({ length: EXPECTED.sections }, (_, i) => makeSection(i + 1));
  enRows[enRows.length - 1] = makeSection(EXPECTED.sections, { book_id: 999, book_number: 999 });
  const arRows = Array.from({ length: EXPECTED.sections }, (_, i) => makeSection(i + 1));
  const dir = makeDataDir(t, enRows, arRows);
  const outFile = path.join(dir, 'commentary.sqlite');
  const tempPrefix = `${path.basename(outFile)}.tmp-`;
  fs.writeFileSync(outFile, 'previous database');

  await assert.rejects(
    buildDb({ dataDir: dir, outFile }),
    /Consumed 7589 of 7590 English sections/,
  );
  assert.equal(fs.readFileSync(outFile, 'utf8'), 'previous database');
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.startsWith(tempPrefix)), []);
  assert.deepEqual(openDescriptorsReferencing(tempPrefix), []);
});
