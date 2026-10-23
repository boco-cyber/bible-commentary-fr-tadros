const { HttpError } = require('../middleware/errors');

function listBooks(db, testament) {
  const sql = `SELECT * FROM books ${testament ? 'WHERE testament = ?' : ''} ORDER BY book_number`;
  return testament ? db.prepare(sql).all(testament) : db.prepare(sql).all();
}

function findBook(db, idOrSlug) {
  const numeric = /^\d+$/.test(String(idOrSlug));
  const row = numeric
    ? db.prepare('SELECT * FROM books WHERE id = ?').get(Number(idOrSlug))
    : db.prepare('SELECT * FROM books WHERE slug = ?').get(String(idOrSlug));
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

function findSectionById(db, id) {
  return db.prepare('SELECT * FROM sections WHERE id = ?').get(Number(id)) || null;
}

function findSectionByIndex(db, chapterId, index) {
  return db.prepare('SELECT * FROM sections WHERE chapter_id = ? AND section_index = ?').get(chapterId, index) || null;
}

function listSectionRefs(db, sectionId, lang) {
  return db.prepare(`SELECT ref_type, book_id, chapter, verse_start, verse_end, label, display, raw_token
    FROM section_refs WHERE section_id = ? AND lang = ? ORDER BY id`).all(sectionId, lang);
}

function findReferenceSections(db, { bookId, chapter, verse, lang, limit, offset }) {
  const where = 'r.book_id = ? AND r.chapter = ? AND r.verse_start <= ? AND r.verse_end >= ? AND r.lang = ?';
  const total = db.prepare(`SELECT COUNT(DISTINCT s.id) AS n FROM section_refs r
    JOIN sections s ON s.id = r.section_id WHERE ${where}`).get(bookId, chapter, verse, verse, lang).n;
  const rows = db.prepare(`SELECT s.id, s.section_index, s.title_en, s.title_ar, s.verse_ranges_json,
      c.number AS chapter_number, b.slug AS book_slug, b.name_en, b.name_ar,
      r.label, r.display, r.chapter AS ref_chapter, r.verse_start, r.verse_end
    FROM section_refs r
    JOIN sections s ON s.id = r.section_id
    JOIN chapters c ON c.id = s.chapter_id
    JOIN books b ON b.id = c.book_id
    WHERE ${where}
    GROUP BY s.id
    ORDER BY b.book_number, c.number, s.section_index
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
    ORDER BY b.book_number, c.number, s.section_index
    LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { rows, total };
}

module.exports = {
  listBooks,
  findBook,
  listChapters,
  findChapter,
  listSectionSummaries,
  findSectionById,
  findSectionByIndex,
  listSectionRefs,
  findReferenceSections,
  searchSections,
};
