const express = require('express');
const { findBook, findReferenceSections } = require('../db/queries');

function intParam(value, fallback, min, max) {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function referencesRouter() {
  const router = express.Router();
  router.get('/references', (req, res) => {
    const db = req.app.locals.db;
    const book = findBook(db, req.query.book);
    const chapter = intParam(req.query.chapter, null, 1, 1000000);
    const verse = intParam(req.query.verse, null, 1, 1000000);
    const lang = req.query.lang || 'en';
    const limit = intParam(req.query.limit, 20, 1, 50);
    const offset = intParam(req.query.offset, 0, 0, 10000);
    if (chapter === null || verse === null || !['en', 'ar'].includes(lang) || limit === null || offset === null) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid reference parameters' } });
    }
    const { rows, total } = findReferenceSections(db, { bookId: book.id, chapter, verse, lang, limit, offset });
    if (total === 0) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No sections cite this verse' } });
    res.json({
      data: rows.map((row) => ({
        id: row.id,
        book: { slug: row.book_slug, name: { en: row.name_en, ar: row.name_ar } },
        chapter: row.chapter_number,
        index: row.section_index,
        title: { [lang]: lang === 'ar' ? row.title_ar : row.title_en },
        reference: {
          chapter: row.ref_chapter, verse_start: row.verse_start,
          verse_end: row.verse_end, label: row.label, display: row.display,
        },
      })),
      meta: { lang, attribution: 'Fr. Tadros Y. Malaty / القمص تادرس يعقوب' },
      pagination: { limit, offset, total },
    });
  });
  return router;
}

module.exports = { referencesRouter };
