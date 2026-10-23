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

module.exports = {
  listBooks,
  findBook,
  listChapters,
  findChapter,
  listSectionSummaries,
  findSectionById,
  findSectionByIndex,
  listSectionRefs,
};
