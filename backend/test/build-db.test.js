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
  fs.copyFileSync(path.join(path.dirname(CATALOG), 'attribution.json'), path.join(dir, 'attribution.json'));
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

test('build contains all catalog books, included books, sections, and introductions', () => {
  const db = openDb(DB);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM books').get().n, 73);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM books WHERE included = 1').get().n, 67);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM books WHERE included = 0').get().n, 6);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sections').get().n, 7590);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chapters WHERE number = 0').get().n, 67);
  assert.equal(db.prepare("SELECT section_count AS n FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='genesis' AND c.number=1").get().n, 9);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.included=0").get().n, 0);
  db.close();
});

test('excluded catalog books can be reference targets but have no content', () => {
  const db = openDb(DB);
  const row = db.prepare("SELECT id, included FROM books WHERE slug='2-chronicles'").get();
  assert.equal(row.included, 0);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM section_refs WHERE book_id = ?').get(row.id).n > 0);
  db.close();
});

test('missing Exodus 36-40 are present but empty', () => {
  const db = openDb(DB);
  const rows = db.prepare("SELECT number, section_count FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='exodus' AND number BETWEEN 36 AND 40 ORDER BY number").all();
  assert.deepEqual(rows.map((r) => r.number), [36, 37, 38, 39, 40]);
  assert.ok(rows.every((r) => r.section_count === 0));
  db.close();
});

test('chapter titles are canonical and descriptions are separate', () => {
  const db = openDb(DB);
  const genesis = db.prepare("SELECT c.* FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='genesis' AND c.number=1").get();
  assert.equal(genesis.title_en, 'Chapter 1');
  assert.equal(genesis.title_ar, 'الإصحاح 1');
  assert.equal(genesis.description_en, 'The Creation of the World');
  assert.equal(genesis.description_ar, 'خلقة العالم');
  const kings = db.prepare("SELECT c.* FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='1-kings' AND c.number=2").get();
  assert.equal(kings.title_en, 'Chapter 2');
  assert.equal(kings.title_ar, 'الإصحاح 2');
  assert.equal(kings.description_en, null);
  db.close();
});

test('2 Kings 6 has an evidence-backed range and author attribution in both languages', () => {
  const db = openDb(DB);
  const row = db.prepare("SELECT * FROM sections WHERE source_record_id='ot_12_6:0'").get();
  assert.equal(row.title_en, 'Chapter 6 commentary');
  assert.equal(row.title_ar, 'تفسير الإصحاح 6');
  assert.equal(row.attribution_en, 'Origen');
  assert.equal(row.attribution_ar, 'العلامة أوريجينوس');
  assert.equal(row.verse_ranges_json, '[[1,33]]');
  assert.equal(row.section_kind, 'verse_commentary');
  assert.doesNotMatch(row.content_md_en, /\[v\d+\]/);
  assert.doesNotMatch(row.content_md_ar, /\[v[٠-٩]+\]/);
  db.close();
});

test('display content is normalized while raw source files remain unchanged', () => {
  const db = openDb(DB);
  const row = db.prepare("SELECT * FROM sections WHERE source_record_id='ot_1_1:1'").get();
  assert.doesNotMatch(row.content_md_en, /\[v1\]/);
  assert.doesNotMatch(row.content_md_en, /\\\*\\\*/);
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(path.dirname(CATALOG), 'en', 'sections.jsonl.gz'))).toString();
  assert.match(raw, /\[v1\]/);
  db.close();
});

test('commentary chunks stay inside source ranges without requiring invented gap coverage', () => {
  const db = openDb(DB);
  const sections = db.prepare("SELECT id, verse_ranges_json FROM sections WHERE verse_ranges_json != '[]'").all();
  const rows = db.prepare(`SELECT section_id, lang, verse_start, verse_end, content_md, content_html, content_hash
    FROM commentary_chunks ORDER BY section_id, lang, sequence_number`).all();
  const bySection = new Map();
  for (const row of rows) {
    const key = `${row.section_id}:${row.lang}`;
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(row);
  }
  for (const section of sections) {
    const ranges = JSON.parse(section.verse_ranges_json);
    const [start, end] = ranges[0];
    for (const lang of ['en', 'ar']) {
      const chunks = bySection.get(`${section.id}:${lang}`) || [];
      if (!chunks.length) {
        const content = db.prepare(`SELECT content_md_en, content_md_ar FROM sections WHERE id = ?`).get(section.id);
        const body = (lang === 'en' ? content.content_md_en : content.content_md_ar)
          .replace(/^(?:\s*\[v\d+\])+\s*/, '').trim();
        assert.equal(body, '', `missing ${lang} chunks for non-empty section ${section.id}`);
        continue;
      }

      let expected = start;
      let rangeIndex = 0;
      for (const chunk of chunks) {
        // Find which range contains this chunk
        while (rangeIndex < ranges.length && chunk.verse_start > ranges[rangeIndex][1]) {
          rangeIndex++;
          if (rangeIndex < ranges.length) expected = ranges[rangeIndex][0];
        }
        assert.ok(chunk.verse_start >= expected);
        // Check if chunk is within any range
        const inRange = ranges.some(([rs, re]) => chunk.verse_start >= rs && chunk.verse_end <= re);
        assert.ok(inRange);
        assert.ok(chunk.verse_end >= chunk.verse_start);
        assert.ok(chunk.content_md.length > 0);
        assert.ok(chunk.content_html.length > 0);
        assert.equal(/<script/i.test(chunk.content_html), false);
        assert.match(chunk.content_hash, /^[0-9a-f]{64}$/);
        expected = chunk.verse_end + 1;
      }

    }
  }
  db.close();
});

test('John 9 chunks follow the inline verse quotes in both languages', () => {
  const db = openDb(DB);
  const section = db.prepare("SELECT id FROM sections WHERE source_record_id='nt_4_9:1'").get();
  for (const lang of ['en', 'ar']) {
    const chunks = db.prepare(`SELECT verse_start, verse_end, content_md FROM commentary_chunks
      WHERE section_id = ? AND lang = ? ORDER BY sequence_number`).all(section.id, lang);
    assert.deepEqual(chunks.map((chunk) => [chunk.verse_start, chunk.verse_end]),
      [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7]]);
    assert.match(chunks[0].content_md, lang === 'en' ? /Now as Jesus passed by/ : /وفيما هو مجتاز/);
  }
  db.close();
});

test('table content is preserved inside commentary chunks', () => {
  const db = openDb(DB);
  const section = db.prepare("SELECT id FROM sections WHERE source_record_id='ot_1_5:1'").get();
  const chunks = db.prepare("SELECT content_md FROM commentary_chunks WHERE section_id = ? AND lang = 'en'").all(section.id);
  assert.ok(chunks.some((chunk) => chunk.content_md.includes('| --- |')), 'expected a Markdown table in a chunk');
  db.close();
});

test('meta records schema, counts, provenance, and checksums', () => {
  const db = openDb(DB);
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
  assert.equal(meta.schema_version, '5');
  assert.equal(meta.chunks_en, '12858');
  assert.equal(meta.chunks_ar, '12496');
  assert.equal(meta.sections, '7590');
  assert.equal(meta.books, '67');
  assert.equal(meta.books_total, '73');
  assert.equal(meta.ref_segments_en, '43326');
  assert.equal(meta.ref_segments_ar, '45234');
  assert.equal(meta.dropped_refs_en, '1');
  assert.equal(meta.dropped_refs_ar, '1');
  assert.match(meta.source_sha256_en, /^[0-9a-f]{64}$/);
  assert.match(meta.source_sha256_ar, /^[0-9a-f]{64}$/);
  assert.match(meta.content_checksum, /^[0-9a-f]{64}$/);
  assert.equal(meta.author_en, 'Fr. Tadros Y. Malaty');
  assert.match(meta.author_ar, /[\u0600-\u06FF]/);
  assert.equal(meta.work_en, 'Bible Commentary');
  assert.match(meta.attribution_notice, /permission of the rights holder/);
  db.close();
});

test('invalid reference segments are dropped rather than stored', () => {
  const db = openDb(DB);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM section_refs WHERE chapter = 4 AND verse_start = 0").get().n, 0);
  const meta = Object.fromEntries(db.prepare('SELECT key, value FROM meta').all().map((r) => [r.key, r.value]));
  assert.equal(meta.dropped_refs_en, '1');
  assert.equal(meta.dropped_refs_ar, '1');
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

test('pickTitle prefers source_title, then title, then fallback', () => {
  const { pickTitle } = require('../scripts/build-db');
  assert.equal(pickTitle('  Localized  ', 'Placeholder', 'Fallback'), 'Localized');
  assert.equal(pickTitle('', '  Placeholder ', 'Fallback'), 'Placeholder');
  assert.equal(pickTitle('   ', '', 'Fallback'), 'Fallback');
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


test('generated headings are localized and specific, while missing chapters remain empty', () => {
  const db = openDb(DB);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM chapters WHERE title_en='Chapter Introduction' OR title_ar='Chapter Introduction'").get().n, 0);
  const chapter = db.prepare("SELECT c.* FROM chapters c JOIN books b ON b.id=c.book_id WHERE b.slug='2-kings' AND c.number=8").get();
  assert.equal(chapter.title_en, 'Chapter 8');
  assert.equal(chapter.title_ar, 'الإصحاح 8');
  assert.ok(chapter.section_count > 0);
  db.close();
});

test('whole rebuilt corpus preserves every original language body and source range', () => {
  const db = openDb(DB);
  const lookup = db.prepare('SELECT * FROM sections WHERE source_record_id=?');
  const { normalizeMarkdown } = require('../src/services/section-structure');
  const { deriveVerseRanges } = require('../src/services/section-structure');
  const enRows = zlib.gunzipSync(fs.readFileSync(path.join(path.dirname(CATALOG), 'en', 'sections.jsonl.gz'))).toString().trim().split('\n').map(JSON.parse);
  const enById = Object.fromEntries(enRows.map((r) => [r.source_record_id, r]));
  for (const lang of ['en', 'ar']) {
    const rows = zlib.gunzipSync(fs.readFileSync(path.join(path.dirname(CATALOG), lang, 'sections.jsonl.gz'))).toString().trim().split('\n').map(JSON.parse);
    for (const row of rows) {
      const stored = lookup.get(row.source_record_id);
      assert.equal(stored[`content_md_${lang}`], normalizeMarkdown(row.content_markdown), `${lang}:${row.source_record_id}`);
    }
  }
  for (const row of enRows) {
    const stored = lookup.get(row.source_record_id);
    const expected = row.verse_ranges?.length ? row.verse_ranges : deriveVerseRanges(row.content_markdown);
    assert.deepEqual(JSON.parse(stored.verse_ranges_json), expected);
  }
  db.close();
});
