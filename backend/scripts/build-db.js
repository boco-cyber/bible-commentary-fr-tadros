#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { readJsonlGz } = require('./lib/jsonl');
const { renderMarkdown } = require('../src/services/render');

const EXPECTED = { books: 67, sections: 7590 };
const DEFAULT_DATA = path.join(__dirname, '..', '..', 'data');

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE books (
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, book_number INTEGER NOT NULL,
  testament TEXT NOT NULL, name_en TEXT NOT NULL, name_ar TEXT NOT NULL,
  short_en TEXT, short_ar TEXT, chapters_expected INTEGER NOT NULL
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
`;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = args.indexOf('--out');
  const data = args.indexOf('--data-dir');
  return {
    outFile: path.resolve(out >= 0 ? args[out + 1] : path.join(DEFAULT_DATA, 'commentary.sqlite')),
    dataDir: path.resolve(data >= 0 ? args[data + 1] : DEFAULT_DATA),
  };
}

function hashContent(titleEn, titleAr, mdEn, mdAr) {
  return crypto.createHash('sha256').update([titleEn, titleAr, mdEn, mdAr].join('\0')).digest('hex');
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
  const included = catalog.books.filter((book) => !book.excluded_from_commentary);
  if (included.length !== EXPECTED.books) throw new Error(`Expected ${EXPECTED.books} books, got ${included.length}`);

  const en = await loadMap(path.join(dataDir, 'en', 'sections.jsonl.gz'));
  const ar = await loadMap(path.join(dataDir, 'ar', 'sections.jsonl.gz'));
  if (en.size !== EXPECTED.sections || ar.size !== EXPECTED.sections) {
    throw new Error(`Expected ${EXPECTED.sections} sections per language, got ${en.size}/${ar.size}`);
  }
  for (const key of en.keys()) if (!ar.has(key)) throw new Error(`Missing Arabic record ${key}`);

  const tempFile = `${outFile}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.rmSync(tempFile, { force: true });

  let db = null;
  let inserted = 0;
  let committed = false;
  try {
    db = new Database(tempFile);
    db.exec(SCHEMA);

    const insertBook = db.prepare(`INSERT INTO books
      (id, slug, book_number, testament, name_en, name_ar, short_en, short_ar, chapters_expected)
      VALUES (@id, @slug, @book_number, @testament, @name_en, @name_ar, @short_en, @short_ar, @chapters_expected)`);
    const insertChapter = db.prepare(`INSERT INTO chapters
      (book_id, number, title_en, title_ar, section_count) VALUES (?, ?, ?, ?, ?)`);
    const insertSection = db.prepare(`INSERT INTO sections
      (source_record_id, chapter_id, sequence_number, section_index, section_count,
       title_en, title_ar, verse_start, verse_end, verse_ranges_json,
       content_md_en, content_md_ar, content_html_en, content_html_ar, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

    const insertRef = db.prepare(`INSERT INTO section_refs
      (section_id, lang, ref_type, book_id, chapter, verse_start, verse_end, label, display, raw_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const refCounts = { en: 0, ar: 0 };

    const byBookChapter = new Map();
    for (const [key, row] of en) {
      const group = `${row.book_id}:${row.chapter}`;
      if (!byBookChapter.has(group)) byBookChapter.set(group, []);
      byBookChapter.get(group).push(key);
    }
    for (const keys of byBookChapter.values()) keys.sort((a, b) => Number(en.get(a).section_index) - Number(en.get(b).section_index));

    const transaction = db.transaction(() => {
      for (const book of included) {
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
        });

        for (let number = 0; number <= book.chaptersCount; number += 1) {
          const keys = byBookChapter.get(`${book.id}:${number}`) || [];
          const first = keys.length ? en.get(keys[0]) : null;
          const firstAr = keys.length ? ar.get(keys[0]) : null;
          const titleEn = first ? first.title || `Chapter ${number}` : number === 0 ? 'Introduction' : `Chapter ${number}`;
          const titleAr = firstAr ? firstAr.title || `الإصحاح ${number}` : number === 0 ? 'مقدمة' : `الإصحاح ${number}`;
          const info = insertChapter.run(book.id, number, titleEn, titleAr, keys.length);
          const chapterId = Number(info.lastInsertRowid);

          for (const key of keys) {
            const enRow = en.get(key);
            const arRow = ar.get(key);
            const mdEn = enRow.content_markdown || '';
            const mdAr = arRow.content_markdown || '';
            if (!mdEn || !mdAr) throw new Error(`Empty content for ${key}`);
            const infoSection = insertSection.run(
              key, chapterId, Number(enRow.sequence_number), Number(enRow.section_index), Number(enRow.section_count),
              enRow.title, arRow.title,
              enRow.verse_start == null ? null : Number(enRow.verse_start),
              enRow.verse_end == null ? null : Number(enRow.verse_end),
              JSON.stringify(enRow.verse_ranges || []),
              mdEn, mdAr, renderMarkdown(mdEn), renderMarkdown(mdAr),
              hashContent(enRow.title || '', arRow.title || '', mdEn, mdAr),
            );
            if (!infoSection.changes) throw new Error(`Failed to insert ${key}`);
            const sectionId = Number(infoSection.lastInsertRowid);
            for (const [lang, row] of [['en', enRow], ['ar', arRow]]) {
              for (const ref of row.references || []) {
                for (const segment of ref.segments || []) {
                  insertRef.run(
                    sectionId, lang, ref.type || 'single', Number(ref.book_id),
                    Number(segment.chapter), Number(segment.verse_start), Number(segment.verse_end),
                    ref.label || '', ref.display_text || ref.label || '', ref.raw_token || '',
                  );
                  refCounts[lang] += 1;
                }
              }
            }
            inserted += 1;
          }
        }
      }
      if (inserted !== en.size) {
        throw new Error(`Consumed ${inserted} of ${en.size} English sections; sections outside catalog book/chapter ranges were not inserted`);
      }
      if (refCounts.en !== 43327 || refCounts.ar !== 45235) {
        throw new Error(`Unexpected reference segment counts: ${refCounts.en}/${refCounts.ar}`);
      }
      const setMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
      setMeta.run('schema_version', '1');
      setMeta.run('built_at', new Date().toISOString());
      setMeta.run('books', String(included.length));
      setMeta.run('sections', String(inserted));
      setMeta.run('ref_segments_en', String(refCounts.en));
      setMeta.run('ref_segments_ar', String(refCounts.ar));
      setMeta.run('attribution', 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب');
    });
    transaction();
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
  return { books: included.length, sections: inserted };
}

if (require.main === module) {
  const options = parseArgs();
  buildDb(options)
    .then((result) => console.log(`built ${options.outFile}: ${result.books} books, ${result.sections} sections`))
    .catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { buildDb, EXPECTED };
