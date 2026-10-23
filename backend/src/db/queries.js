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

module.exports = { listBooks, findBook, listChapters, findChapter, listSectionSummaries };
