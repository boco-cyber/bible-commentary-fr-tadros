const { HttpError } = require('../middleware/errors');

function listBooks(db, testament) {
  const sql = `SELECT * FROM books WHERE included = 1 ${testament ? 'AND testament = ?' : ''} ORDER BY id`;
  return testament ? db.prepare(sql).all(testament) : db.prepare(sql).all();
}

function findBookAny(db, idOrSlug) {
  const numeric = /^\d+$/.test(String(idOrSlug));
  const row = numeric
    ? db.prepare('SELECT * FROM books WHERE id = ?').get(Number(idOrSlug))
    : db.prepare('SELECT * FROM books WHERE slug = ?').get(String(idOrSlug));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Book not found');
  return row;
}

function findBook(db, idOrSlug) {
  const numeric = /^\d+$/.test(String(idOrSlug));
  const row = numeric
    ? db.prepare('SELECT * FROM books WHERE included = 1 AND id = ?').get(Number(idOrSlug))
    : db.prepare('SELECT * FROM books WHERE included = 1 AND slug = ?').get(String(idOrSlug));
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Book not found');
  return row;
}

function listChapters(db, bookId) {
  return db.prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY number').all(bookId);
}

function findChapter(db, bookId, number) {
  const row = db.prepare('SELECT * FROM chapters WHERE book_id = ? AND number = ?').get(bookId, number);
  if (!row) throw new HttpError(404, 'NOT_FOUND', 'Chapter not found');
  return row;
}

function listSectionSummaries(db, chapterId) {
  return db.prepare(`SELECT id, section_index, title_en, title_ar, verse_ranges_json
    FROM sections WHERE chapter_id = ? ORDER BY sequence_number`).all(chapterId);
}

function listChapterSections(db, chapterId) {
  return db.prepare('SELECT * FROM sections WHERE chapter_id = ? ORDER BY sequence_number').all(chapterId);
}

function listChapterRefs(db, chapterId, lang) {
  return db.prepare(`SELECT r.section_id, r.ref_type, r.book_id, b.slug AS book_slug,
      b.name_en AS book_name_en, b.name_ar AS book_name_ar,
      r.chapter, r.verse_start, r.verse_end, r.label, r.display
    FROM section_refs r
    JOIN sections s ON s.id = r.section_id
    JOIN books b ON b.id = r.book_id
    WHERE s.chapter_id = ? AND r.lang = ? ORDER BY r.id`).all(chapterId, lang);
}

function findSectionById(db, id) {
  return db.prepare('SELECT * FROM sections WHERE id = ?').get(Number(id)) || null;
}

function findSectionByIndex(db, chapterId, index) {
  return db.prepare('SELECT * FROM sections WHERE chapter_id = ? AND section_index = ?').get(chapterId, index) || null;
}

function listSectionRefs(db, sectionId, lang) {
  return db.prepare(`SELECT r.ref_type, r.book_id, b.slug AS book_slug,
      b.name_en AS book_name_en, b.name_ar AS book_name_ar,
      r.chapter, r.verse_start, r.verse_end, r.label, r.display, r.raw_token
    FROM section_refs r JOIN books b ON b.id = r.book_id
    WHERE r.section_id = ? AND r.lang = ? ORDER BY r.id`).all(sectionId, lang);
}

function findReferenceSections(db, { bookId, chapter, verse, lang, limit, offset }) {
  const where = 'r.book_id = ? AND r.chapter = ? AND r.verse_start <= ? AND r.verse_end >= ? AND r.lang = ?';
  const total = db.prepare(`SELECT COUNT(DISTINCT s.id) AS n FROM section_refs r
    JOIN sections s ON s.id = r.section_id WHERE ${where}`).get(bookId, chapter, verse, verse, lang).n;
  const rows = db.prepare(`SELECT s.id, s.section_index, s.title_en, s.title_ar, s.verse_ranges_json,
      c.number AS chapter_number, b.slug AS book_slug, b.name_en, b.name_ar,
      r.label, r.display, r.chapter AS ref_chapter, r.verse_start, r.verse_end,
      tb.slug AS target_book_slug, tb.name_en AS target_name_en, tb.name_ar AS target_name_ar
    FROM section_refs r
    JOIN sections s ON s.id = r.section_id
    JOIN chapters c ON c.id = s.chapter_id
    JOIN books b ON b.id = c.book_id
    JOIN books tb ON tb.id = r.book_id
    WHERE ${where}
    GROUP BY s.id
    ORDER BY b.id, c.number, s.section_index
    LIMIT ? OFFSET ?`).all(bookId, chapter, verse, verse, lang, limit, offset);
  return { rows, total };
}

function searchSections(db, { match, lang, bookId, testament, chapter, limit, offset }) {
  const table = lang === 'ar' ? 'sections_fts_ar' : 'sections_fts_en';
  const filters = [];
  const params = [match];
  if (bookId) { filters.push('b.id = ?'); params.push(bookId); }
  if (testament) { filters.push('b.testament = ?'); params.push(testament); }
  if (chapter !== null && chapter !== undefined) { filters.push('c.number = ?'); params.push(chapter); }
  const extra = filters.length ? ` AND ${filters.join(' AND ')}` : '';
  const from = `FROM ${table} f
    JOIN sections s ON s.id = f.rowid
    JOIN chapters c ON c.id = s.chapter_id
    JOIN books b ON b.id = c.book_id
    WHERE ${table} MATCH ?${extra}`;
  const total = db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params).n;
  const rows = db.prepare(`SELECT s.id, s.section_index, s.title_en, s.title_ar, s.verse_ranges_json,
      c.number AS chapter_number, b.slug AS book_slug, b.name_en, b.name_ar,
      snippet(${table}, 1, '<mark>', '</mark>', '…', 32) AS snippet
    ${from}
    ORDER BY b.id, c.number, s.section_index
    LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { rows, total };
}

module.exports = {
  listBooks,
  findBook,
  findBookAny,
  listChapters,
  findChapter,
  listSectionSummaries,
  listChapterSections,
  listChapterRefs,
  findSectionById,
  findSectionByIndex,
  listSectionRefs,
  findReferenceSections,
  searchSections,
};
