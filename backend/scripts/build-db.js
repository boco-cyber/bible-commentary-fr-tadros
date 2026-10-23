#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { readJsonlGz } = require('./lib/jsonl');
const { renderMarkdown } = require('../src/services/render');
const { markdownToPlain } = require('../src/services/plain-text');
const { normalizeForSearch } = require('../src/services/normalize');
const { splitCommentary } = require('../src/services/split-commentary');

const EXPECTED = {
  books: 67,
  catalogBooks: 73,
  sections: 7590,
  refSegmentsEn: 43326,
  refSegmentsAr: 45234,
  droppedRefsEn: 1,
  droppedRefsAr: 1,
  chunksEn: 12457,
  chunksAr: 11955,
  schemaVersion: 3,
};
const DEFAULT_DATA = path.join(__dirname, '..', '..', 'data');
const DEFAULT_OUT = path.join(__dirname, '..', 'data', 'commentary.sqlite');

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE books (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, book_number INTEGER NOT NULL,
  testament TEXT NOT NULL, name_en TEXT NOT NULL, name_ar TEXT NOT NULL,
  short_en TEXT, short_ar TEXT, chapters_expected INTEGER NOT NULL,
  included INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE chapters (
  id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES books(id),
  number INTEGER NOT NULL, title_en TEXT, title_ar TEXT,
  section_count INTEGER NOT NULL, UNIQUE (book_id, number)
);
CREATE TABLE sections (
  id INTEGER PRIMARY KEY, source_record_id TEXT NOT NULL UNIQUE,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id),
  sequence_number INTEGER NOT NULL, section_index INTEGER NOT NULL,
  section_count INTEGER NOT NULL, title_en TEXT, title_ar TEXT,
  verse_start INTEGER, verse_end INTEGER, verse_ranges_json TEXT NOT NULL,
  content_md_en TEXT NOT NULL, content_md_ar TEXT NOT NULL,
  content_html_en TEXT NOT NULL, content_html_ar TEXT NOT NULL,
  content_hash TEXT NOT NULL, UNIQUE (chapter_id, section_index)
);
CREATE INDEX idx_chapters_book ON chapters(book_id, number);
CREATE INDEX idx_sections_chapter ON sections(chapter_id, sequence_number);
CREATE TABLE section_refs (
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  lang TEXT NOT NULL CHECK (lang IN ('en','ar')),
  ref_type TEXT NOT NULL,
  book_id INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  verse_start INTEGER NOT NULL,
  verse_end INTEGER NOT NULL,
  label TEXT NOT NULL,
  display TEXT NOT NULL,
  raw_token TEXT NOT NULL
);
CREATE INDEX idx_refs_target ON section_refs(book_id, chapter, verse_start, verse_end);
CREATE INDEX idx_refs_section ON section_refs(section_id, lang);
CREATE TABLE commentary_chunks (
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES sections(id),
  book_id INTEGER NOT NULL,
  chapter INTEGER NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('en','ar')),
  sequence_number INTEGER NOT NULL,
  verse_start INTEGER NOT NULL,
  verse_end INTEGER NOT NULL,
  content_md TEXT NOT NULL,
  content_html TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  UNIQUE (section_id, lang, sequence_number)
);
CREATE INDEX idx_chunks_lookup ON commentary_chunks(lang, book_id, chapter, verse_start, verse_end);
CREATE INDEX idx_chunks_section ON commentary_chunks(section_id, lang, sequence_number);
CREATE TABLE sections_plain_en (
  id INTEGER PRIMARY KEY REFERENCES sections(id), title TEXT NOT NULL, body TEXT NOT NULL
);
CREATE TABLE sections_plain_ar (
  id INTEGER PRIMARY KEY REFERENCES sections(id), title TEXT NOT NULL, body TEXT NOT NULL
);
CREATE VIRTUAL TABLE sections_fts_en USING fts5(
  title, body, content='sections_plain_en', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE VIRTUAL TABLE sections_fts_ar USING fts5(
  title, body, content='sections_plain_ar', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
`;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = args.indexOf('--out');
  const data = args.indexOf('--data-dir');
  return {
    outFile: path.resolve(out >= 0 ? args[out + 1] : DEFAULT_OUT),
    dataDir: path.resolve(data >= 0 ? args[data + 1] : DEFAULT_DATA),
  };
}

function hashContent(titleEn, titleAr, mdEn, mdAr) {
  return crypto.createHash('sha256').update([titleEn, titleAr, mdEn, mdAr].join('\0')).digest('hex');
}

function pickTitle(sourceTitle, title, fallback) {
  for (const value of [sourceTitle, title]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return fallback;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function loadMap(file) {
  const map = new Map();
  for await (const row of readJsonlGz(file)) {
    if (map.has(row.source_record_id)) {
      throw new Error(`Duplicate source_record_id ${row.source_record_id} in ${file}`);
    }
    map.set(row.source_record_id, row);
  }
  return map;
}

async function buildDb({ dataDir, outFile }) {
  const catalog = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'));
  const attribution = JSON.parse(fs.readFileSync(path.join(dataDir, 'attribution.json'), 'utf8'));
  const catalogIds = new Set(catalog.books.map((book) => Number(book.id)));
  if (catalog.books.length !== EXPECTED.catalogBooks || catalogIds.size !== EXPECTED.catalogBooks) {
    throw new Error(`Expected ${EXPECTED.catalogBooks} unique catalog books, got ${catalog.books.length}/${catalogIds.size}`);
  }
  const included = catalog.books.filter((book) => !book.excluded_from_commentary);
  if (included.length !== EXPECTED.books) throw new Error(`Expected ${EXPECTED.books} books, got ${included.length}`);

  const enFile = path.join(dataDir, 'en', 'sections.jsonl.gz');
  const arFile = path.join(dataDir, 'ar', 'sections.jsonl.gz');
  const sourceShaEn = sha256File(enFile);
  const sourceShaAr = sha256File(arFile);
  const en = await loadMap(enFile);
  const ar = await loadMap(arFile);
  if (en.size !== EXPECTED.sections || ar.size !== EXPECTED.sections) {
    throw new Error(`Expected ${EXPECTED.sections} sections per language, got ${en.size}/${ar.size}`);
  }
  for (const key of en.keys()) if (!ar.has(key)) throw new Error(`Missing Arabic record ${key}`);

  const tempFile = `${outFile}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.rmSync(tempFile, { force: true });

  let db = null;
  let inserted = 0;
  const chunkCounts = { en: 0, ar: 0 };
  let committed = false;
  try {
    db = new Database(tempFile);
    db.exec(SCHEMA);

    const insertBook = db.prepare(`INSERT INTO books
      (id, slug, book_number, testament, name_en, name_ar, short_en, short_ar, chapters_expected, included)
      VALUES (@id, @slug, @book_number, @testament, @name_en, @name_ar, @short_en, @short_ar, @chapters_expected, @included)`);
    const insertChapter = db.prepare(`INSERT INTO chapters
      (book_id, number, title_en, title_ar, section_count) VALUES (?, ?, ?, ?, ?)`);
    const insertSection = db.prepare(`INSERT INTO sections
      (source_record_id, chapter_id, sequence_number, section_index, section_count,
       title_en, title_ar, verse_start, verse_end, verse_ranges_json,
       content_md_en, content_md_ar, content_html_en, content_html_ar, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    const insertChunk = db.prepare(`INSERT INTO commentary_chunks
      (section_id, book_id, chapter, lang, sequence_number, verse_start, verse_end, content_md, content_html, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertRef = db.prepare(`INSERT INTO section_refs
      (section_id, lang, ref_type, book_id, chapter, verse_start, verse_end, label, display, raw_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertPlainEn = db.prepare('INSERT INTO sections_plain_en (id, title, body) VALUES (?, ?, ?)');
    const insertPlainAr = db.prepare('INSERT INTO sections_plain_ar (id, title, body) VALUES (?, ?, ?)');
    const refCounts = { en: 0, ar: 0 };
    const droppedRefs = { en: 0, ar: 0 };
    const contentHashes = [];

    const byBookChapter = new Map();
    for (const [key, row] of en) {
      const group = `${row.book_id}:${row.chapter}`;
      if (!byBookChapter.has(group)) byBookChapter.set(group, []);
      byBookChapter.get(group).push(key);
    }
    for (const keys of byBookChapter.values()) keys.sort((a, b) => Number(en.get(a).section_index) - Number(en.get(b).section_index));

    const transaction = db.transaction(() => {
      for (const book of catalog.books) {
        const isIncluded = !book.excluded_from_commentary;
        insertBook.run({
          id: book.id,
          slug: book.path_stem.replace(/^\d+-/, ''),
          book_number: book.book_number,
          testament: book.testament,
          name_en: book.englishName,
          name_ar: book.name,
          short_en: book.englishShortName,
          short_ar: book.shortName,
          chapters_expected: book.chaptersCount,
          included: isIncluded ? 1 : 0,
        });
        if (!isIncluded) continue;

        for (let number = 0; number <= book.chaptersCount; number += 1) {
          const keys = byBookChapter.get(`${book.id}:${number}`) || [];
          let firstKey = keys[0];
          for (const key of keys) {
            const enSource = String(en.get(key).source_title || '').trim();
            const arSource = String(ar.get(key).source_title || '').trim();
            if (enSource || arSource) { firstKey = key; break; }
          }
          const first = keys.length ? en.get(firstKey) : null;
          const firstAr = keys.length ? ar.get(firstKey) : null;
          const fallbackEn = number === 0 ? 'Introduction' : `Chapter ${number}`;
          const fallbackAr = number === 0 ? 'مقدمة' : `الإصحاح ${number}`;
          const titleEn = pickTitle(first?.source_title, first?.title, fallbackEn);
          const titleAr = pickTitle(firstAr?.source_title, firstAr?.title, fallbackAr);
          const info = insertChapter.run(book.id, number, titleEn, titleAr, keys.length);
          const chapterId = Number(info.lastInsertRowid);

          for (const key of keys) {
            const enRow = en.get(key);
            const arRow = ar.get(key);
            const mdEn = enRow.content_markdown || '';
            const mdAr = arRow.content_markdown || '';
            if (!mdEn || !mdAr) throw new Error(`Empty content for ${key}`);
            const titleEn = pickTitle(enRow.source_title, enRow.title, '');
            const titleAr = pickTitle(arRow.source_title, arRow.title, '');
            const contentHash = hashContent(titleEn, titleAr, mdEn, mdAr);
            contentHashes.push(`${key}:${contentHash}`);
            const infoSection = insertSection.run(
              key, chapterId, Number(enRow.sequence_number), Number(enRow.section_index), Number(enRow.section_count),
              titleEn, titleAr,
              enRow.verse_start == null ? null : Number(enRow.verse_start),
              enRow.verse_end == null ? null : Number(enRow.verse_end),
              JSON.stringify(enRow.verse_ranges || []),
              mdEn, mdAr, renderMarkdown(mdEn), renderMarkdown(mdAr),
              contentHash,
            );
            if (!infoSection.changes) throw new Error(`Failed to insert ${key}`);
            const sectionId = Number(infoSection.lastInsertRowid);
            const ranges = enRow.verse_ranges || [];
            if (ranges.length > 1) throw new Error(`Multiple verse ranges are not supported for ${key}`);
            if (ranges.length === 1) {
              const [start, end] = ranges[0].map(Number);
              for (const [lang, markdown] of [['en', mdEn], ['ar', mdAr]]) {
                const chunks = splitCommentary(markdown, start, end);
                for (const [index, chunk] of chunks.entries()) {
                  const chunkHash = crypto.createHash('sha256')
                    .update([contentHash, lang, chunk.verseStart, chunk.verseEnd, chunk.markdown].join('\0'))
                    .digest('hex');
                  insertChunk.run(
                    sectionId, book.id, number, lang, index,
                    chunk.verseStart, chunk.verseEnd, chunk.markdown,
                    renderMarkdown(chunk.markdown), chunkHash,
                  );
                  chunkCounts[lang] += 1;
                }
              }
            }
            for (const [lang, row] of [['en', enRow], ['ar', arRow]]) {
              for (const ref of row.references || []) {
                const targetBookId = Number(ref.book_id);
                for (const segment of ref.segments || []) {
                  const chapter = Number(segment.chapter);
                  const verseStart = Number(segment.verse_start);
                  const verseEnd = Number(segment.verse_end);
                  const valid = catalogIds.has(targetBookId)
                    && Number.isInteger(chapter) && chapter >= 1
                    && Number.isInteger(verseStart) && verseStart >= 1
                    && Number.isInteger(verseEnd) && verseEnd >= verseStart;
                  if (!valid) {
                    droppedRefs[lang] += 1;
                    console.warn(`Dropping invalid ${lang} reference segment ${ref.label || ref.raw_token || ''} in ${key}`);
                    continue;
                  }
                  insertRef.run(
                    sectionId, lang, ref.type || 'single', targetBookId,
                    chapter, verseStart, verseEnd,
                    ref.label || '', ref.display_text || ref.label || '', ref.raw_token || '',
                  );
                  refCounts[lang] += 1;
                }
              }
            }
            insertPlainEn.run(sectionId, normalizeForSearch(titleEn), normalizeForSearch(markdownToPlain(mdEn)));
            insertPlainAr.run(sectionId, normalizeForSearch(titleAr), normalizeForSearch(markdownToPlain(mdAr)));
            inserted += 1;
          }
        }
      }
      if (inserted !== en.size) {
        throw new Error(`Consumed ${inserted} of ${en.size} English sections; sections outside catalog book/chapter ranges were not inserted`);
      }
      if (refCounts.en !== EXPECTED.refSegmentsEn || refCounts.ar !== EXPECTED.refSegmentsAr) {
        throw new Error(`Unexpected reference segment counts: ${refCounts.en}/${refCounts.ar}`);
      }
      if (droppedRefs.en !== EXPECTED.droppedRefsEn || droppedRefs.ar !== EXPECTED.droppedRefsAr) {
        throw new Error(`Unexpected dropped reference counts: ${droppedRefs.en}/${droppedRefs.ar}`);
      }
      if (chunkCounts.en !== EXPECTED.chunksEn || chunkCounts.ar !== EXPECTED.chunksAr) {
        throw new Error(`Unexpected commentary chunk counts: ${chunkCounts.en}/${chunkCounts.ar}`);
      }
      const contentChecksum = crypto.createHash('sha256').update(contentHashes.sort().join('\n')).digest('hex');
      const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
      setMeta.run('schema_version', String(EXPECTED.schemaVersion));
      setMeta.run('built_at', new Date().toISOString());
      setMeta.run('books', String(included.length));
      setMeta.run('books_total', String(catalog.books.length));
      setMeta.run('sections', String(inserted));
      setMeta.run('ref_segments_en', String(refCounts.en));
      setMeta.run('ref_segments_ar', String(refCounts.ar));
      setMeta.run('dropped_refs_en', String(droppedRefs.en));
      setMeta.run('dropped_refs_ar', String(droppedRefs.ar));
      setMeta.run('chunks_en', String(chunkCounts.en));
      setMeta.run('chunks_ar', String(chunkCounts.ar));
      setMeta.run('source_sha256_en', sourceShaEn);
      setMeta.run('source_sha256_ar', sourceShaAr);
      setMeta.run('content_checksum', contentChecksum);
      setMeta.run('author_en', attribution.author.en);
      setMeta.run('author_ar', attribution.author.ar);
      setMeta.run('work_en', attribution.work.en);
      setMeta.run('work_ar', attribution.work.ar);
      setMeta.run('attribution_notice', attribution.notice);
      setMeta.run('attribution', `${attribution.author.en} / ${attribution.author.ar}`);
    });
    transaction();
    db.exec("INSERT INTO sections_fts_en(sections_fts_en) VALUES('rebuild')");
    db.exec("INSERT INTO sections_fts_ar(sections_fts_ar) VALUES('rebuild')");
    db.close();
    db = null;
    fs.renameSync(tempFile, outFile);
    committed = true;
  } finally {
    try {
      if (db) db.close();
    } finally {
      if (!committed) fs.rmSync(tempFile, { force: true });
    }
  }
  return { books: included.length, sections: inserted, chunks: chunkCounts };
}

if (require.main === module) {
  const options = parseArgs();
  buildDb(options)
    .then((result) => console.log(`built ${options.outFile}: ${result.books} books, ${result.sections} sections, ${result.chunks.en}/${result.chunks.ar} commentary chunks`))
    .catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { buildDb, pickTitle, EXPECTED };
